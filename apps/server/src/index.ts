import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "socket.io";
import {
  applyCommand,
  applyTimeout,
  botCommand,
  CAPACITY_OPTIONS,
  createGame,
  DEFAULT_OPTIONS,
  DEFAULT_ROOM_ACCESS,
  finalScores,
  pendingActors,
  redactGameForViewer,
  type Capacity,
  type GameCommand,
  type ClientToServerEvents,
  type IceServerConfig,
  type CreateRoomPayload,
  type GameOptions,
  type GameState,
  type JoinRoomPayload,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type RoomAccess,
  type RoomChatMessage,
  type ServerToClientEvents,
  type Spectator,
  type VoiceSignal,
} from "@wonders/game";

interface RoomState {
  code: string;
  /** 对外展示用的随机标识，不泄露房间码。 */
  publicId: string;
  capacity: Capacity;
  /** 开房选的变体，房主在等候房间里可以改。 */
  options: GameOptions;
  status: "waiting" | "playing";
  ownerId: string;
  members: LobbyMember[];
  /** 观战的人：不占座位，离开或断线就移出。 */
  spectators: Spectator[];
  /** 拿房间码进来（或者本来坐着改成观战）的观战者：看得到房间码，也能坐下。从列表进来的只有公开房间才能坐下。 */
  invited: Set<string>;
  access: RoomAccess;
  chat: RoomChatMessage[];
  game?: GameState;
  /** 下一位加入者的座位编号；座位 id 在对局里固定，断线重连只换连接 id。 */
  nextSeat: number;
  /** 对局中所有玩家都离线时启动的关闭计时器。 */
  abandonTimer?: ReturnType<typeof setTimeout>;
  /** 在语音里的成员及其是否静音。 */
  voice: Map<string, { muted: boolean }>;
  /** 整轮结束后的继续投票。 */
  rematch?: { deadline: number; accepted: Set<string>; timer: ReturnType<typeof setTimeout> };
  /** 这一步（一轮出牌 / 插入选择 / 挑奇迹）的截止时间；key 是 game.step，别人交牌、撤回不变，所以不会重置倒计时。到点由人机替还没出的人出。 */
  turn?: { deadline: number; timer: ReturnType<typeof setTimeout>; key: string };
  /** 由人机行动的座位（人机座位、托管、离线的人）各自下一步的计时器；key 同 turn。同时出牌时可能有好几个。 */
  botTimers: Map<string, { timer: ReturnType<typeof setTimeout>; key: string }>;
  /** 每位真人连续超时的次数（座位 id → 次数）；自己动一下就清零，到 AUTO_AFTER_TIMEOUTS 次转托管。 */
  timeouts: Map<string, number>;
}

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const ROOM_CHAT_LIMIT = 100;
const ROOM_CHAT_MAX_LENGTH = 200;
const ROOM_CHAT_RATE_LIMIT_MS = 1_000;
const ROOM_ABANDON_MS = Number(process.env.ROOM_ABANDON_MS ?? 2 * 60_000);
const REMATCH_TIMEOUT_MS = Number(process.env.REMATCH_TIMEOUT_MS ?? 60_000);
const ADMIN_RETRY_DELAY_MS = 2_000;
const VOICE_SIGNAL_MAX_LENGTH = 20_000;
const MAX_SPECTATORS = 20;
/** 每一步的计时（毫秒）；默认每轮出牌 60 秒、插入选择 20 秒、挑奇迹 30 秒，测试时可以用环境变量统一缩短。 */
const TURN_MS_OVERRIDE = process.env.TURN_MS ? Number(process.env.TURN_MS) : undefined;
/** 人机的名字，按顺序取第一个没人用的。 */
const BOT_NAMES = ["咕噜一号", "咕噜二号", "咕噜三号", "咕噜四号", "咕噜五号", "咕噜六号"];
/** 人机每一步的停顿乘上这个倍数；测试时设成 0 让人机立刻行动。 */
const BOT_DELAY_SCALE = Number(process.env.BOT_DELAY_SCALE ?? 1);
/** 离线的人轮到时先等这么久再由人机代打（刷新页面、短暂断线的人来得及回来）。 */
const OFFLINE_GRACE_MS = 3_000;
/** 连续超时几次转托管。 */
const AUTO_AFTER_TIMEOUTS = 2;
/** 每局结束后把种子和动作序列追加到这里，便于复盘。 */
const GAME_LOG = process.env.GAME_LOG ?? resolve(process.cwd(), "logs/games.jsonl");
const TURN_CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;
const rooms = new Map<string, RoomState>();
const socketRooms = new Map<string, string>();
const roomChatTimes = new Map<string, number>();
const adminFailureTimes = new Map<string, number>();

export const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "wonders-server" }));
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

/** 本地网页开发端口（和 vite 的 WEB_PORT 一致，默认 5189）。 */
const DEV_WEB_PORT = String(Number(process.env.WEB_PORT ?? 5189));

const configuredWebOrigins = new Set(
  (process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN ?? `http://localhost:${DEV_WEB_PORT}`)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return first === 10 || first === 192 && second === 168 || first === 172 && second >= 16 && second <= 31;
}

function isAllowedWebOrigin(origin: string | undefined): boolean {
  if (!origin || configuredWebOrigins.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:"
      && parsed.port === DEV_WEB_PORT
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || isPrivateIpv4(parsed.hostname));
  } catch {
    return false;
  }
}

export const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: (origin, callback) => callback(null, isAllowedWebOrigin(origin)),
    methods: ["GET", "POST"],
  },
});

function normalizeChatMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ");
  return message.length >= 1 && message.length <= ROOM_CHAT_MAX_LENGTH ? message : null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 18 ? name : null;
}

function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "");
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : null;
}

/** 只认布尔值，其余沿用原来的。 */
function normalizeOptions(value: unknown, base: GameOptions): GameOptions {
  const input = (typeof value === "object" && value !== null ? value : {}) as Partial<Record<keyof GameOptions, unknown>>;
  const pick = (name: keyof GameOptions) => (typeof input[name] === "boolean" ? (input[name] as boolean) : base[name]);
  return { randomSides: pick("randomSides"), chooseWonders: pick("chooseWonders") };
}

function isCapacity(value: unknown): value is Capacity {
  return (CAPACITY_OPTIONS as readonly unknown[]).includes(value);
}

function generateRoomCode(): string {
  return Array.from({ length: ROOM_CODE_LENGTH }, () =>
    ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)],
  ).join("");
}

function snapshot(room: RoomState, viewerId: string): LobbyRoomSnapshot {
  const seated = room.members.some((member) => member.id === viewerId);
  return {
    code: seated || room.invited.has(viewerId) ? room.code : "",
    spectators: room.spectators.map((spectator) => ({ ...spectator })),
    access: { ...room.access },
    capacity: room.capacity,
    options: { ...room.options },
    status: room.status,
    members: room.members.map((member) => ({ ...member })),
    chat: room.chat.map((entry) => ({ ...entry })),
    voice: [...room.voice].map(([id, state]) => ({ id, muted: state.muted })),
    ...(room.turn && humanPending(room) ? { turnRemainingMs: Math.max(0, room.turn.deadline - Date.now()) } : {}),
    ...(room.rematch ? { rematch: { remainingMs: Math.max(0, room.rematch.deadline - Date.now()), acceptedIds: [...room.rematch.accepted] } } : {}),
    ...(room.game ? { game: seated ? redactGameForViewer(room.game, seatOf(room, viewerId)) : spectatorGame(room) } : {}),
  };
}

/**
 * 观战的人看到的对局：默认只看公开信息（和对手看到的一样）；房主打开「观战看全部」后能看所有人的手牌、交了什么、
 * 垫奇迹的牌、弃牌堆。种子、随机数状态、动作序列永远不给（Age III 抽掉的行会根本不在状态里）。
 */
function spectatorGame(room: RoomState): GameState {
  return redactGameForViewer(room.game!, "", { seeAll: room.access.spectatorsSeeAll });
}

/** 现在还有没有由真人自己行动、还没出的座位（有才显示倒计时）。 */
function humanPending(room: RoomState): boolean {
  const game = room.game;
  if (!game || game.phase === "finished") return false;
  return pendingActors(game).some((playerId) => !robotSeat(room, playerId));
}

function isSpectator(room: RoomState, socketId: string): boolean {
  return room.spectators.some((spectator) => spectator.id === socketId);
}

function nameTaken(room: RoomState, name: string): boolean {
  return room.members.some((member) => member.name === name) || room.spectators.some((spectator) => spectator.name === name);
}

function seatOf(room: RoomState, memberId: string): string {
  return room.members.find((member) => member.id === memberId)?.playerId ?? "";
}

/** 真人玩家（不含人机）。房间里没有真人就关掉，房主也只交给真人。 */
function humans(room: RoomState): LobbyMember[] {
  return room.members.filter((member) => !member.bot);
}

/** 这个座位由人机行动：人机座位、托管、离线的人。 */
function robotSeat(room: RoomState, playerId: string): boolean {
  const member = room.members.find((candidate) => candidate.playerId === playerId);
  return !member || member.bot === true || member.auto === true || !member.connected;
}

function setAuto(room: RoomState, playerId: string, enabled: boolean): void {
  room.members = room.members.map((member) => {
    if (member.playerId !== playerId) return member;
    const { auto: _auto, ...rest } = member;
    return enabled ? { ...rest, auto: true } : rest;
  });
}

function roomSummaries(): PublicRoomSummary[] {
  const order = { playing: 0, waiting: 1, finished: 2 } as const;
  return [...rooms.values()]
    .map((room): PublicRoomSummary => {
      const game = room.game;
      const status = room.status === "waiting" ? "waiting" : game?.phase === "finished" ? "finished" : "playing";
      const scores = game ? (game.finalResult ?? finalScores(game)).scores : [];
      const waitingFor = game ? pendingActors(game) : [];
      return {
        id: room.publicId,
        status,
        capacity: room.capacity,
        open: room.access.open,
        allowSpectators: room.access.allowSpectators,
        spectators: room.spectators.length,
        players: room.members.map((member) => {
          const player = game?.players.find((candidate) => candidate.id === member.playerId);
          return {
            name: member.name,
            isHost: member.isHost,
            connected: member.connected,
            ...(member.bot ? { bot: true } : {}),
            ...(player ? {
              score: scores.find((entry) => entry.player === player.id)?.total ?? 0,
              isActive: waitingFor.includes(player.id),
              isWinner: game!.finalResult?.winners.includes(player.id) ?? false,
            } : {}),
          };
        }),
      };
    })
    .sort((left, right) => order[left.status] - order[right.status]);
}

/** 「在线牌桌」列表最多每秒推送一次，期间的变化合并到下一次。 */
const LOBBY_UPDATE_INTERVAL_MS = 1_000;
let lobbyUpdateTimer: ReturnType<typeof setTimeout> | undefined;
let lobbyUpdatePending = false;

/** 只推送给停留在首页（不在任何房间里）的连接；房间里的玩家看不到这个列表。 */
function sendLobbyUpdate(): void {
  const summaries = roomSummaries();
  for (const [socketId, client] of io.sockets.sockets) {
    if (!socketRooms.has(socketId)) client.emit("lobby:updated", summaries);
  }
}

function emitLobbyUpdate(): void {
  if (lobbyUpdateTimer) {
    lobbyUpdatePending = true;
    return;
  }
  sendLobbyUpdate();
  const flush = () => {
    if (!lobbyUpdatePending) {
      lobbyUpdateTimer = undefined;
      return;
    }
    lobbyUpdatePending = false;
    sendLobbyUpdate();
    lobbyUpdateTimer = setTimeout(flush, LOBBY_UPDATE_INTERVAL_MS);
    lobbyUpdateTimer.unref();
  };
  lobbyUpdateTimer = setTimeout(flush, LOBBY_UPDATE_INTERVAL_MS);
  lobbyUpdateTimer.unref();
}

function emitRoomUpdate(room: RoomState): void {
  // 每位成员单独发送，隐藏牌库和他人暗抽预留卡的内容。
  for (const member of room.members) {
    io.to(member.id).emit("room:updated", snapshot(room, member.id));
  }
  for (const spectator of room.spectators) io.to(spectator.id).emit("room:updated", snapshot(room, spectator.id));
  emitLobbyUpdate();
}

function findRoomForSocket(socketId: string): RoomState | undefined {
  const code = socketRooms.get(socketId);
  return code ? rooms.get(code) : undefined;
}

function removeWaitingMember(socketId: string): void {
  const code = socketRooms.get(socketId);
  if (!code) return;
  socketRooms.delete(socketId);
  rooms.get(code)?.voice.delete(socketId);

  const room = rooms.get(code);
  if (!room) return;
  if (isSpectator(room, socketId)) {
    room.spectators = room.spectators.filter((spectator) => spectator.id !== socketId);
    room.invited.delete(socketId);
    emitRoomUpdate(room);
    return;
  }
  if (room.status === "playing") {
    room.members = room.members.map((member) =>
      member.id === socketId ? { ...member, connected: false } : member,
    );
    if (humans(room).every((member) => !member.connected)) scheduleAbandonedRoomClose(room);
    // 轮到的是这个人的话，改由人机代打
    updateTurnTimer(room);
    emitRoomUpdate(room);
    return;
  }

  room.members = room.members.filter((member) => member.id !== socketId);
  if (humans(room).length === 0) {
    deleteRoom(room, "玩家都离开了，房间已关闭。");
    return;
  }
  if (room.ownerId === socketId) {
    room.ownerId = humans(room)[0]!.id;
    room.members = room.members.map((member) => ({
      ...member,
      isHost: member.id === room.ownerId,
    }));
  }
  emitRoomUpdate(room);
}

/** 所有玩家离线满 ROOM_ABANDON_MS 后关闭房间；期间有人重新加入则取消。 */
function scheduleAbandonedRoomClose(room: RoomState): void {
  clearTimeout(room.abandonTimer);
  room.abandonTimer = setTimeout(() => {
    if (rooms.get(room.code) !== room || humans(room).some((member) => member.connected)) return;
    deleteRoom(room, "玩家都离线了，房间已关闭。");
  }, ROOM_ABANDON_MS);
  room.abandonTimer.unref();
}

/** 通知某个连接已被移出房间，并断开它和房间的关联。 */
function closeMemberConnection(room: RoomState, memberId: string, reason: string): void {
  socketRooms.delete(memberId);
  const memberSocket = io.sockets.sockets.get(memberId);
  if (!memberSocket) return;
  void memberSocket.leave(room.code);
  memberSocket.emit("room:closed", { reason });
}

/** 删除房间；还在看的观战者会收到 reason。 */
function deleteRoom(room: RoomState, reason = "房间已关闭。"): void {
  for (const spectator of room.spectators) closeMemberConnection(room, spectator.id, reason);
  room.spectators = [];
  clearTimeout(room.abandonTimer);
  clearGameTimers(room);
  clearTimeout(room.rematch?.timer);
  for (const member of room.members) socketRooms.delete(member.id);
  rooms.delete(room.code);
  emitLobbyUpdate();
}

function dissolveRoom(room: RoomState, reason: string): void {
  for (const member of room.members) closeMemberConnection(room, member.id, reason);
  deleteRoom(room, reason);
}

/** 移出成员并在需要时转移房主；房间空了就删除。返回房间是否还在。 */
function removeMembers(room: RoomState, memberIds: string[], reason: string): boolean {
  for (const memberId of memberIds) closeMemberConnection(room, memberId, reason);
  for (const memberId of memberIds) room.voice.delete(memberId);
  room.members = room.members.filter((member) => !memberIds.includes(member.id));
  if (humans(room).length === 0) {
    deleteRoom(room);
    return false;
  }
  if (!room.members.some((member) => member.id === room.ownerId)) room.ownerId = humans(room)[0]!.id;
  room.members = room.members.map((member) => ({ ...member, isHost: member.id === room.ownerId }));
  return true;
}

/** 有人拒绝或超时：移出这些人和已离线的人，其余玩家回到等待大厅。 */
function returnToWaiting(room: RoomState, kickedIds: string[], reason: string): void {
  clearTimeout(room.rematch?.timer);
  delete room.rematch;
  clearTimeout(room.abandonTimer);
  delete room.abandonTimer;
  const offlineIds = room.members.filter((member) => !member.connected && !kickedIds.includes(member.id)).map((member) => member.id);
  if (!removeMembers(room, [...kickedIds, ...offlineIds], reason)) return;
  room.status = "waiting";
  clearGameTimers(room);
  delete room.game;
  emitRoomUpdate(room);
}

function clearTurnTimer(room: RoomState): void {
  clearTimeout(room.turn?.timer);
  delete room.turn;
}

function clearBotTimer(room: RoomState, playerId: string): void {
  clearTimeout(room.botTimers.get(playerId)?.timer);
  room.botTimers.delete(playerId);
}

function clearGameTimers(room: RoomState): void {
  clearTurnTimer(room);
  for (const playerId of [...room.botTimers.keys()]) clearBotTimer(room, playerId);
}

function setTurnDeadline(room: RoomState, deadline: number, key: string): void {
  clearTurnTimer(room);
  const timer = setTimeout(() => expireTurn(room), Math.max(0, deadline - Date.now()));
  timer.unref();
  room.turn = { deadline, timer, key };
}

/**
 * 这一步的标识：变了就重新计时。只看 game.step（换轮、换阶段、换人挑奇迹才变），
 * 同时出牌时别人交牌、撤回都不改它，所以不会重置还没出的人的倒计时。
 */
function turnKey(game: GameState): string {
  return `${game.step}`;
}

/** 这一步的时限：每轮出牌 60 秒，巴比伦第 7 张 / 哈利卡纳苏斯挑弃牌 20 秒，挑奇迹 30 秒。 */
function stepMs(game: GameState): number {
  if (TURN_MS_OVERRIDE !== undefined) return TURN_MS_OVERRIDE;
  const seconds = game.phase === "play" ? game.config.roundSec : game.phase === "wonders" ? game.config.wonderPickSec : game.config.choiceSec;
  return seconds * 1000;
}

/**
 * 每次对局变化、有人掉线 / 回来、托管开关后重新安排：
 * - 每一步（game.step）开始时定一个截止时间，同一步里不再改（别人交牌、撤回、掉线都不重置）；
 * - 在等的座位里由人机行动的（人机座位、托管、离线的人）各自排一个计时器，停顿一下再出（离线的人至少等 3 秒）；
 * - 到截止时间还没出的由人机替他出（真人记一次超时）。
 */
function updateTurnTimer(room: RoomState): void {
  const game = room.game;
  if (!game || game.phase === "finished") {
    clearGameTimers(room);
    return;
  }
  const key = turnKey(game);
  const actors = pendingActors(game);
  for (const [playerId, entry] of [...room.botTimers]) {
    if (entry.key !== key || !actors.includes(playerId) || !robotSeat(room, playerId)) clearBotTimer(room, playerId);
  }
  for (const playerId of actors) {
    if (!robotSeat(room, playerId) || room.botTimers.has(playerId)) continue;
    const timer = setTimeout(() => runBot(room, playerId, key), botDelay(room, game, playerId) * BOT_DELAY_SCALE);
    timer.unref();
    room.botTimers.set(playerId, { timer, key });
  }
  if (room.turn?.key !== key) setTurnDeadline(room, Date.now() + stepMs(game), key);
}

/** 人机每一步前停多久（毫秒，再乘 BOT_DELAY_SCALE）：同时出牌时错开一点，像真人在想；离线的人先等 3 秒。 */
function botDelay(room: RoomState, game: GameState, playerId: string): number {
  const member = room.members.find((candidate) => candidate.playerId === playerId);
  const offline = member !== undefined && !member.bot && !member.connected;
  const base = game.phase === "play" ? 1500 + 2500 * Math.random() : 1200 + 600 * Math.random();
  return Math.max(base, offline ? OFFLINE_GRACE_MS : 0);
}

/** 人机给的命令（只看它自己座位的视角）；出错就返回 null，交给保底动作。 */
function safeBotCommand(game: GameState, playerId: string): GameCommand | null {
  try {
    return botCommand(redactGameForViewer(game, playerId), playerId);
  } catch (error) {
    console.error("人机出错，改用保底动作", error);
    return null;
  }
}

function runBot(room: RoomState, playerId: string, key: string): void {
  if (room.botTimers.get(playerId)?.key === key) room.botTimers.delete(playerId);
  const game = room.game;
  if (rooms.get(room.code) !== room || !game || game.phase === "finished" || turnKey(game) !== key) return;
  if (!pendingActors(game).includes(playerId) || !robotSeat(room, playerId)) return;
  const command = safeBotCommand(game, playerId);
  let next: GameState;
  try {
    next = command ? applyCommand(game, playerId, command) : applyTimeout(game, playerId, null, false);
  } catch (error) {
    console.error("人机行动失败，改用保底动作", error);
    next = applyTimeout(game, playerId, null, false);
  }
  room.game = next;
  afterGameChange(room);
  emitRoomUpdate(room);
}

/** 到截止时间：这一步还没出的人都由人机替他出；真人记一次超时，连续 2 次转托管。 */
function expireTurn(room: RoomState): void {
  if (rooms.get(room.code) !== room || !room.game || room.game.phase === "finished") return;
  const key = turnKey(room.game);
  const handled = new Set<string>();
  for (let guard = 0; guard < 16; guard += 1) {
    const game = room.game;
    if (!game || game.phase === "finished" || turnKey(game) !== key) break;
    const playerId = pendingActors(game).find((candidate) => !handled.has(candidate));
    if (!playerId) break;
    handled.add(playerId);
    const human = !robotSeat(room, playerId);
    if (human) {
      const count = (room.timeouts.get(playerId) ?? 0) + 1;
      room.timeouts.set(playerId, count);
      if (count >= AUTO_AFTER_TIMEOUTS) setAuto(room, playerId, true);
    }
    clearBotTimer(room, playerId);
    room.game = applyTimeout(game, playerId, safeBotCommand(game, playerId), human);
  }
  afterGameChange(room);
  emitRoomUpdate(room);
}

/** 对局状态变化后：结束则清空聊天并发起继续投票，否则更新回合计时。 */
function afterGameChange(room: RoomState): void {
  if (room.game?.phase === "finished") {
    clearGameTimers(room);
    room.chat = [];
    void logFinishedGame(room.game);
    startRematchVote(room);
    return;
  }
  updateTurnTimer(room);
}

/** 种子用服务端的安全随机数生成；所有骰子都在服务端掷。新的一局托管和超时次数都清零。 */
function newGame(room: RoomState, seed = randomInt(2 ** 32 - 1)): GameState {
  for (const member of room.members) setAuto(room, member.playerId, false);
  room.timeouts.clear();
  clearGameTimers(room);
  return createGame(room.members.map((member) => ({ id: member.playerId, name: member.name })), seed, room.options);
}

/** 记录一局的种子、玩家和动作序列，同一种子重放这串动作就能复现整局。 */
async function logFinishedGame(game: GameState): Promise<void> {
  try {
    await mkdir(dirname(GAME_LOG), { recursive: true });
    const entry = {
      endedAt: new Date().toISOString(),
      seed: game.seed,
      players: game.players.map((player) => ({ id: player.id, name: player.name, wonder: player.wonder, side: player.side })),
      scores: game.finalResult?.scores.map((entry) => ({ player: entry.player, total: entry.total, coins: entry.coinsHeld })) ?? [],
      log: game.log,
    };
    await appendFile(GAME_LOG, JSON.stringify(entry) + "\n");
  } catch (error) {
    console.error("写对局记录失败", error);
  }
}

/** 整轮结束：所有人需在 REMATCH_TIMEOUT_MS 内确认是否继续。 */
function startRematchVote(room: RoomState): void {
  clearTimeout(room.rematch?.timer);
  const timer = setTimeout(() => {
    if (rooms.get(room.code) !== room || !room.rematch) return;
    const accepted = room.rematch.accepted;
    const pending = room.members.filter((member) => !accepted.has(member.id)).map((member) => member.id);
    returnToWaiting(room, pending, "没有在 1 分钟内确认继续，已被移出房间。");
  }, REMATCH_TIMEOUT_MS);
  timer.unref();
  // 人机总是同意再来一局
  const bots = room.members.filter((member) => member.bot).map((member) => member.id);
  room.rematch = { deadline: Date.now() + REMATCH_TIMEOUT_MS, accepted: new Set(bots), timer };
}

/** 未配置 ADMIN_TOKEN 时管理功能关闭。 */
const adminTokenHash = process.env.ADMIN_TOKEN
  ? createHash("sha256").update(process.env.ADMIN_TOKEN).digest()
  : null;

function checkAdminToken(socketId: string, token: unknown): string | null {
  if (!adminTokenHash) return "管理功能未启用。";
  const now = Date.now();
  if (now - (adminFailureTimes.get(socketId) ?? 0) < ADMIN_RETRY_DELAY_MS) {
    return "尝试太频繁了，请稍后再试。";
  }
  const tokenHash = createHash("sha256").update(typeof token === "string" ? token : "").digest();
  if (!timingSafeEqual(tokenHash, adminTokenHash)) {
    adminFailureTimes.set(socketId, now);
    return "管理员口令不正确。";
  }
  return null;
}

/**
 * 语音用的 STUN/TURN 配置。配置了 TURN_HOST 和 TURN_SECRET 时，按 coturn 的
 * use-auth-secret 约定发放 24 小时有效的临时凭证；否则只靠局域网直连（本地开发）。
 */
function iceServersFor(memberId: string): IceServerConfig[] {
  const host = process.env.TURN_HOST;
  const secret = process.env.TURN_SECRET;
  if (!host || !secret) return [];
  const username = `${Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS}:${memberId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return [
    { urls: `stun:${host}:3478` },
    { urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`], username, credential },
  ];
}

function isVoiceSignal(value: unknown): value is VoiceSignal {
  if (!value || typeof value !== "object") return false;
  if (JSON.stringify(value).length > VOICE_SIGNAL_MAX_LENGTH) return false;
  const data = value as { description?: { type?: unknown; sdp?: unknown }; candidate?: { candidate?: unknown } };
  if (data.description) {
    return (data.description.type === "offer" || data.description.type === "answer") && typeof data.description.sdp === "string";
  }
  return Boolean(data.candidate) && typeof data.candidate?.candidate === "string";
}

/** 把离线玩家的座位交给新的连接，保留其对局状态。 */
function reassignMember(room: RoomState, previousId: string, nextId: string): void {
  const swap = (id: string) => (id === previousId ? nextId : id);
  room.members = room.members.map((member) =>
    member.id === previousId ? { ...member, id: nextId, connected: true } : member,
  );
  room.ownerId = swap(room.ownerId);
  room.chat = room.chat.map((entry) => ({ ...entry, senderId: swap(entry.senderId) }));
  if (room.rematch) room.rematch.accepted = new Set([...room.rematch.accepted].map(swap));
}

function invalidNameMessage(payload: CreateRoomPayload | JoinRoomPayload): string | null {
  return normalizeName(payload?.name) ? null : "昵称长度需为 2–18 个字符。";
}

/**
 * 同一个账号同时登录的设备有上限。网关（Caddy forward_auth）把每条连接属于哪次登录放在
 * X-GC-Session 请求头里；游戏中心挤掉某次登录时发 admin:kick-session，这里断开它的所有连接。
 */
const socketsBySession = new Map<string, Set<string>>();

io.on("connection", (socket) => {
  const loginSession = socket.handshake.headers["x-gc-session"];
  if (typeof loginSession === "string" && loginSession) {
    const sockets = socketsBySession.get(loginSession) ?? new Set<string>();
    sockets.add(socket.id);
    socketsBySession.set(loginSession, sockets);
    socket.on("disconnect", () => {
      sockets.delete(socket.id);
      if (sockets.size === 0 && socketsBySession.get(loginSession) === sockets) socketsBySession.delete(loginSession);
    });
  }

  socket.on("lobby:get", (ack) => {
    ack({ ok: true, data: roomSummaries() });
  });

  socket.on("room:create", (payload, ack) => {
    if (socketRooms.has(socket.id)) {
      ack({ ok: false, error: "请先离开当前房间，再创建新房间。" });
      return;
    }
    const invalidName = invalidNameMessage(payload);
    if (invalidName) {
      ack({ ok: false, error: invalidName });
      return;
    }
    if (!isCapacity(payload?.capacity)) {
      ack({ ok: false, error: "房间人数必须是 3–7 人。" });
      return;
    }

    let code = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = generateRoomCode();
      if (!rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      ack({ ok: false, error: "暂时无法分配房间码，请重试。" });
      return;
    }

    const room: RoomState = {
      code,
      publicId: randomUUID(),
      capacity: payload.capacity,
      options: normalizeOptions(payload.options, DEFAULT_OPTIONS),
      status: "waiting",
      ownerId: socket.id,
      members: [{ id: socket.id, playerId: "p1", name: normalizeName(payload.name)!, isHost: true, connected: true }],
      nextSeat: 2,
      spectators: [],
      invited: new Set(),
      access: { ...DEFAULT_ROOM_ACCESS },
      chat: [],
      voice: new Map(),
      timeouts: new Map(),
      botTimers: new Map(),
    };
    rooms.set(code, room);
    socketRooms.set(socket.id, code);
    void socket.join(code);
    ack({ ok: true, data: snapshot(room, socket.id) });
    emitRoomUpdate(room);
  });

  socket.on("room:join", (payload, ack) => {
    if (socketRooms.has(socket.id)) {
      ack({ ok: false, error: "请先离开当前房间，再加入新房间。" });
      return;
    }
    const invalidName = invalidNameMessage(payload);
    if (invalidName) {
      ack({ ok: false, error: invalidName });
      return;
    }
    // 从首页列表点进来的带 roomId（公开 id），用房间码进来的带 code。
    const viaList = typeof payload.roomId === "string";
    let room: RoomState | undefined;
    if (viaList) {
      room = [...rooms.values()].find((candidate) => candidate.publicId === payload.roomId);
      if (!room) {
        ack({ ok: false, error: "这个房间已经不在了。" });
        return;
      }
    } else {
      const code = normalizeCode(payload?.code);
      if (!code) {
        ack({ ok: false, error: "请输入有效的 6 位房间码。" });
        return;
      }
      room = rooms.get(code);
      if (!room) {
        ack({ ok: false, error: "找不到这个房间，请检查房间码。" });
        return;
      }
    }
    const code = room.code;
    const name = normalizeName(payload.name)!;

    if (payload.spectate === true) {
      if (!room.access.allowSpectators) {
        ack({ ok: false, error: "这个房间没有开放观战。" });
        return;
      }
      if (room.spectators.length >= MAX_SPECTATORS) {
        ack({ ok: false, error: "观战的人已经满了。" });
        return;
      }
      if (nameTaken(room, name)) {
        ack({ ok: false, error: "房间里已有同名的人，请换一个昵称。" });
        return;
      }
      room.spectators.push({ id: socket.id, name });
      if (!viaList) room.invited.add(socket.id);
      socketRooms.set(socket.id, code);
      void socket.join(code);
      ack({ ok: true, data: snapshot(room, socket.id) });
      emitRoomUpdate(room);
      return;
    }

    if (room.status !== "waiting") {
      if (viaList) {
        ack({ ok: false, error: "对局已经开始了，可以进去观战。" });
        return;
      }
      // 对局中只允许离线玩家用原昵称回到自己的座位。
      const seat = room.members.find((member) => member.name === name);
      if (!seat) {
        ack({ ok: false, error: "对局已经开始，只有原房间玩家可以用原昵称重新加入。" });
        return;
      }
      if (seat.connected) {
        ack({ ok: false, error: "这个昵称的玩家仍在线，无法重新加入。" });
        return;
      }
      clearTimeout(room.abandonTimer);
      delete room.abandonTimer;
      reassignMember(room, seat.id, socket.id);
      socketRooms.set(socket.id, code);
      void socket.join(code);
      // 回来了：不再由人机代打（托管中的除外）
      updateTurnTimer(room);
      ack({ ok: true, data: snapshot(room, socket.id) });
      emitRoomUpdate(room);
      return;
    }
    if (viaList && !room.access.open) {
      ack({ ok: false, error: "这个房间是邀请制，要有房间码才能加入。" });
      return;
    }
    if (room.members.length >= room.capacity) {
      ack({ ok: false, error: "房间已满。" });
      return;
    }
    if (nameTaken(room, name)) {
      ack({ ok: false, error: "房间里已有同名的人，请换一个昵称。" });
      return;
    }

    const member: LobbyMember = {
      id: socket.id,
      playerId: `p${room.nextSeat++}`,
      name,
      isHost: false,
      connected: true,
    };
    room.members.push(member);
    socketRooms.set(socket.id, code);
    void socket.join(code);
    ack({ ok: true, data: snapshot(room, socket.id) });
    emitRoomUpdate(room);
  });

  socket.on("room:access", (settings, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以修改房间设置。" });
      return;
    }
    const next = { ...room.access };
    for (const key of ["allowSpectators", "spectatorsSeeAll", "open"] as const) {
      const value = settings?.[key];
      if (value === undefined) continue;
      if (typeof value !== "boolean") {
        ack({ ok: false, error: "设置内容不正确。" });
        return;
      }
      next[key] = value;
    }
    room.access = next;
    if (!next.allowSpectators && room.spectators.length > 0) {
      for (const spectator of room.spectators) closeMemberConnection(room, spectator.id, "房主关闭了观战。");
      room.spectators = [];
      room.invited.clear();
    }
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:sit", (ack) => {
    const room = findRoomForSocket(socket.id);
    const spectator = room?.spectators.find((candidate) => candidate.id === socket.id);
    if (!room || !spectator) {
      ack({ ok: false, error: "你现在不在观战。" });
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局开始后不能再坐下，等这局结束吧。" });
      return;
    }
    if (room.members.length >= room.capacity) {
      ack({ ok: false, error: "座位已经满了。" });
      return;
    }
    if (!room.access.open && !room.invited.has(socket.id)) {
      ack({ ok: false, error: "这个房间是邀请制，要有房间码才能坐下。" });
      return;
    }
    room.spectators = room.spectators.filter((candidate) => candidate.id !== socket.id);
    room.invited.delete(socket.id);
    room.members.push({ id: socket.id, playerId: `p${room.nextSeat++}`, name: spectator.name, isHost: false, connected: true });
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:stand", (ack) => {
    const room = findRoomForSocket(socket.id);
    const member = room?.members.find((candidate) => candidate.id === socket.id);
    if (!room || !member) {
      ack({ ok: false, error: "你当前不在座位上。" });
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局中不能离开座位。" });
      return;
    }
    if (member.isHost) {
      ack({ ok: false, error: "房主不能改成观战。" });
      return;
    }
    if (!room.access.allowSpectators) {
      ack({ ok: false, error: "这个房间没有开放观战。" });
      return;
    }
    room.members = room.members.filter((candidate) => candidate.id !== socket.id);
    room.voice.delete(socket.id);
    room.spectators.push({ id: socket.id, name: member.name });
    room.invited.add(socket.id);
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:start", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room) {
      ack({ ok: false, error: "你当前不在房间中。" });
      return;
    }
    if (room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以开始对局。" });
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局已经开始。" });
      return;
    }
    if (room.members.length < 3) {
      ack({ ok: false, error: "至少需要 3 位玩家才能开始（人不够可以加人机）。" });
      return;
    }

    try {
      room.game = newGame(room);
      room.status = "playing";
      updateTurnTimer(room);
      const roomSnapshot = snapshot(room, socket.id);
      ack({ ok: true, data: roomSnapshot });
      emitRoomUpdate(room);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法开始对局。";
      ack({ ok: false, error: message });
    }
  });

  socket.on("room:settings", (payload, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以改设置。" });
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局中不能改设置。" });
      return;
    }
    if (typeof payload !== "object" || payload === null) {
      ack({ ok: false, error: "设置不正确。" });
      return;
    }
    room.options = normalizeOptions(payload, room.options);
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:leave", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room) {
      ack({ ok: false, error: "你当前不在房间中。" });
      return;
    }
    if (room.status === "playing" && !isSpectator(room, socket.id)) {
      ack({ ok: false, error: "对局开始后暂不能离开房间。" });
      return;
    }
    const code = room.code;
    removeWaitingMember(socket.id);
    void socket.leave(code);
    ack({ ok: true, data: undefined });
  });

  socket.on("game:command", (command, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.status !== "playing" || !room.game) {
      ack({ ok: false, error: "当前没有进行中的对局。" });
      return;
    }
    if (isSpectator(room, socket.id)) {
      ack({ ok: false, error: "观战中不能操作。" });
      return;
    }

    try {
      const playerId = seatOf(room, socket.id);
      room.game = applyCommand(room.game, playerId, command);
      // 自己动了一下：超时次数清零，托管也取消
      room.timeouts.delete(playerId);
      setAuto(room, playerId, false);
      afterGameChange(room);
      const roomSnapshot = snapshot(room, socket.id);
      ack({ ok: true, data: roomSnapshot });
      emitRoomUpdate(room);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法执行这个行动。";
      ack({ ok: false, error: message });
    }
  });

  socket.on("room:rematch", (accept, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room?.rematch || !room.members.some((member) => member.id === socket.id)) {
      ack({ ok: false, error: "现在不需要确认。" });
      return;
    }
    ack({ ok: true, data: undefined });
    if (accept !== true) {
      returnToWaiting(room, [socket.id], "你选择了不继续，已离开房间。");
      return;
    }
    room.rematch.accepted.add(socket.id);
    if (room.members.every((member) => room.rematch!.accepted.has(member.id))) {
      clearTimeout(room.rematch.timer);
      delete room.rematch;
      room.game = newGame(room);
      updateTurnTimer(room);
    }
    emitRoomUpdate(room);
  });

  socket.on("room:kick", (memberId, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以移出玩家。" });
      return;
    }
    if (isSpectator(room, memberId)) {
      // 观战的人随时可以移出。
      closeMemberConnection(room, memberId, "你已被房主移出房间。");
      room.spectators = room.spectators.filter((spectator) => spectator.id !== memberId);
      room.invited.delete(memberId);
      ack({ ok: true, data: undefined });
      emitRoomUpdate(room);
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局中不能移出玩家；有人挂机可以解散房间。" });
      return;
    }
    if (memberId === socket.id || !room.members.some((member) => member.id === memberId)) {
      ack({ ok: false, error: "找不到这位玩家。" });
      return;
    }
    removeMembers(room, [memberId], "你已被房主移出房间。");
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:add-bot", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以加人机。" });
      return;
    }
    if (room.status !== "waiting") {
      ack({ ok: false, error: "对局开始后不能再加人机。" });
      return;
    }
    if (room.members.length >= room.capacity) {
      ack({ ok: false, error: "座位已经满了。" });
      return;
    }
    const name = BOT_NAMES.find((candidate) => !nameTaken(room, candidate));
    if (!name) {
      ack({ ok: false, error: "人机已经加满了。" });
      return;
    }
    room.members.push({ id: `bot-${randomUUID()}`, playerId: `p${room.nextSeat++}`, name, isHost: false, connected: true, bot: true });
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:auto", (enabled, ack) => {
    const room = findRoomForSocket(socket.id);
    const member = room?.members.find((candidate) => candidate.id === socket.id);
    if (!room || !member || room.status !== "playing" || !room.game) {
      ack({ ok: false, error: "现在没有你参加的对局。" });
      return;
    }
    room.timeouts.delete(member.playerId);
    setAuto(room, member.playerId, enabled === true);
    updateTurnTimer(room);
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("room:dissolve", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.ownerId !== socket.id) {
      ack({ ok: false, error: "只有房主可以解散房间。" });
      return;
    }
    ack({ ok: true, data: undefined });
    dissolveRoom(room, "房主解散了房间。");
  });

  socket.on("admin:verify", (token, ack) => {
    const error = checkAdminToken(socket.id, token);
    ack(error ? { ok: false, error } : { ok: true, data: undefined });
  });

  socket.on("admin:kick-session", (payload, ack) => {
    const error = checkAdminToken(socket.id, payload?.token);
    if (error) {
      ack({ ok: false, error });
      return;
    }
    const ids = typeof payload?.sessionId === "string" ? [...(socketsBySession.get(payload.sessionId) ?? [])] : [];
    let kicked = 0;
    for (const id of ids) {
      const target = io.sockets.sockets.get(id);
      if (!target) continue;
      target.emit("session:kicked");
      target.disconnect(true);
      kicked += 1;
    }
    ack({ ok: true, data: kicked });
  });

  socket.on("admin:dissolve", (payload, ack) => {
    const error = checkAdminToken(socket.id, payload?.token);
    if (error) {
      ack({ ok: false, error });
      return;
    }
    const room = [...rooms.values()].find((candidate) => candidate.publicId === payload.roomId);
    if (!room) {
      ack({ ok: false, error: "这个房间已经不存在。" });
      return;
    }
    dissolveRoom(room, "管理员解散了这个房间。");
    ack({ ok: true, data: undefined });
  });

  socket.on("voice:join", (payload, ack) => {
    const room = findRoomForSocket(socket.id);
    if (!room) {
      ack({ ok: false, error: "你当前不在房间中。" });
      return;
    }
    if (isSpectator(room, socket.id)) {
      ack({ ok: false, error: "观战时不能加入语音。" });
      return;
    }
    room.voice.set(socket.id, { muted: payload?.muted === true });
    ack({ ok: true, data: iceServersFor(socket.id) });
    emitRoomUpdate(room);
  });

  socket.on("voice:mute", (muted, ack) => {
    const room = findRoomForSocket(socket.id);
    const state = room?.voice.get(socket.id);
    if (!room || !state) {
      ack({ ok: false, error: "你还没有加入语音。" });
      return;
    }
    state.muted = muted === true;
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("voice:leave", (ack) => {
    const room = findRoomForSocket(socket.id);
    if (room?.voice.delete(socket.id)) emitRoomUpdate(room);
    ack({ ok: true, data: undefined });
  });

  socket.on("voice:signal", (payload) => {
    // 只在同一房间、都在语音里的两人之间转发。
    const room = findRoomForSocket(socket.id);
    if (!room || !room.voice.has(socket.id) || !room.voice.has(payload?.to) || payload.to === socket.id) return;
    if (!isVoiceSignal(payload.data)) return;
    io.to(payload.to).emit("voice:signal", { from: socket.id, data: payload.data });
  });

  socket.on("room:chat", (payload, ack) => {
    const room = findRoomForSocket(socket.id);
    const member = room?.members.find((candidate) => candidate.id === socket.id)
      ?? room?.spectators.find((candidate) => candidate.id === socket.id);
    if (!room || !member) {
      ack({ ok: false, error: "你当前不在房间中。" });
      return;
    }
    const spectator = isSpectator(room, socket.id);
    const message = normalizeChatMessage(payload?.message);
    if (!message) {
      ack({ ok: false, error: `消息需为 1–${ROOM_CHAT_MAX_LENGTH} 个字符。` });
      return;
    }
    const now = Date.now();
    if (now - (roomChatTimes.get(socket.id) ?? 0) < ROOM_CHAT_RATE_LIMIT_MS) {
      ack({ ok: false, error: "发送太快了，请稍等一下。" });
      return;
    }

    roomChatTimes.set(socket.id, now);
    room.chat = [
      ...room.chat,
      { id: randomUUID(), senderId: socket.id, name: member.name, message, createdAt: new Date(now).toISOString(), ...(spectator ? { spectator: true } : {}) },
    ].slice(-ROOM_CHAT_LIMIT);
    ack({ ok: true, data: undefined });
    emitRoomUpdate(room);
  });

  socket.on("disconnect", () => {
    roomChatTimes.delete(socket.id);
    adminFailureTimes.delete(socket.id);
    removeWaitingMember(socket.id);
  });
});

/** 仅供测试：直接把某个房间的对局标记为结束并发起继续投票。 */
export const testHooks = {
  finishGame(code: string): void {
    const room = rooms.get(code);
    if (!room?.game) throw new Error("no game");
    room.game = { ...room.game, phase: "finished" as const, finalResult: finalScores(room.game) };
    clearGameTimers(room);
    startRematchVote(room);
    emitRoomUpdate(room);
  },
  /** 用指定种子重开当前对局，方便测试固定开局。 */
  reseed(code: string, seed: number): void {
    const room = rooms.get(code);
    if (!room) throw new Error("no room");
    room.game = newGame(room, seed);
    updateTurnTimer(room);
    emitRoomUpdate(room);
  },
  /** 让当前这一步立即超时。 */
  expireTurn(code: string): void {
    const room = rooms.get(code);
    if (!room) throw new Error("no room");
    expireTurn(room);
  },
  /** 把房间的对局换成指定局面（预览局面工厂造的），测插入选择、计时用。座位 id 要和房间成员的 playerId 对上。 */
  setGame(code: string, game: GameState): void {
    const room = rooms.get(code);
    if (!room) throw new Error("no room");
    clearGameTimers(room);
    room.game = game;
    room.status = "playing";
    updateTurnTimer(room);
    emitRoomUpdate(room);
  },
  /** 现在的截止时间和计时键（测「别人交牌不重置倒计时」用）。 */
  turnInfo(code: string): { deadline: number; key: string } | null {
    const room = rooms.get(code);
    return room?.turn ? { deadline: room.turn.deadline, key: room.turn.key } : null;
  },
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 3016);
  httpServer.listen(port, () => {
    console.log(`Wonders server listening on http://localhost:${port}`);
  });
}
