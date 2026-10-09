/**
 * 七大奇迹服务器：同时出牌的房间流程、计时（别人交牌 / 撤回不重置倒计时）、超时由人机替还没出的人出、插入选择、
 * 原昵称回座、每个真人收到的数据里没有别人的暗牌、开房选项。
 */
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  buildScene,
  legalActions,
  scene,
  type AckResponse,
  type ClientToServerEvents,
  type GameCommand,
  type GameState,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type ServerToClientEvents,
} from "@wonders/game";

// 人机立刻行动；计时用 testHooks.expireTurn 手动触发，所以这里给一个很长的时限，避免测试中途自己超时。
process.env.BOT_DELAY_SCALE = "0";
process.env.TURN_MS = "600000";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
/** 每个客户端收到的所有房间更新（抓包检查用）。 */
const received = new Map<TestSocket, LobbyRoomSnapshot[]>();
let serverUrl = "";
let server: typeof import("../src/index.js");
let nameSeq = 0;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    received.set(client, []);
    client.on("room:updated", (room) => {
      latest.set(client, room);
      received.get(client)!.push(room);
    });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

const nick = (prefix: string) => `${prefix}${(nameSeq += 1)}`;

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 20_000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = latest.get(client);
    if (current && test(current)) {
      resolve(current);
      return;
    }
    const timer = setTimeout(() => {
      client.off("room:updated", handler);
      reject(new Error("等不到想要的房间状态"));
    }, timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

function seatOf(client: TestSocket): string {
  return latest.get(client)?.members.find((member) => member.id === client.id)?.playerId ?? "";
}

const command = (client: TestSocket, cmd: GameCommand) => call<LobbyRoomSnapshot>((ack) => client.emit("game:command", cmd, ack));

/** 建一个 n 人房，全是真人，开局。 */
async function table(n = 3, options?: object): Promise<{ code: string; players: TestSocket[] }> {
  const host = await connect();
  const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: n, ...(options ? { options } : {}) } as never, ack));
  if (!created.ok) throw new Error(created.error);
  const players = [host];
  for (let seat = 1; seat < n; seat += 1) {
    const client = await connect();
    const joined = await call<LobbyRoomSnapshot>((ack) => client.emit("room:join", { name: nick("玩家"), code: created.data.code }, ack));
    if (!joined.ok) throw new Error(joined.error);
    players.push(client);
  }
  const started = await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack));
  if (!started.ok) throw new Error(started.error);
  for (const client of players) await updateWhere(client, (room) => room.game !== undefined);
  return { code: created.data.code, players };
}

/** 换成预览局面工厂造的局面（座位 id p1… 和房间成员对上）。 */
function inject(code: string, game: GameState): void {
  server.testHooks.setGame(code, game);
}

describe("七大奇迹房间", () => {
  beforeAll(async () => {
    server = await import("../src/index.js");
    await new Promise<void>((resolve, reject) => {
      server.httpServer.once("error", reject);
      server.httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });

  it("房间只能 3–7 人；不到 3 人不能开局；开房选项只认随机 A/B 面、自选奇迹", async () => {
    const host = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 2 } as never, ack))).ok).toBe(false);
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 8 } as never, ack))).ok).toBe(false);
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 4 }, ack));
    expect(created.ok && created.data.options).toEqual({ randomSides: false, chooseWonders: false });
    expect((await call<void>((ack) => host.emit("room:settings", { randomSides: true, chooseWonders: "yes" as never }, ack))).ok).toBe(true);
    expect((await updateWhere(host, (room) => room.options.randomSides)).options).toEqual({ randomSides: true, chooseWonders: false });
    expect((await call<void>((ack) => host.emit("room:add-bot", ack))).ok).toBe(true);
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack))).ok).toBe(false);
    expect((await call<void>((ack) => host.emit("room:add-bot", ack))).ok).toBe(true);
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack))).ok).toBe(true);
    await call<void>((ack) => host.emit("room:dissolve", ack));
  });

  it("交牌、撤回不重置这一轮的倒计时；全员交齐立刻结算、换下一轮才重新计时", async () => {
    const { code, players } = await table(3);
    const [a, b, c] = players as [TestSocket, TestSocket, TestSocket];
    const first = server.testHooks.turnInfo(code)!;
    expect(latest.get(a)!.turnRemainingMs).toBeGreaterThan(0);
    const handOf = (client: TestSocket) => latest.get(client)!.game!.players.find((player) => player.id === seatOf(client))!.hand;
    expect((await command(a, { type: "PLAY", card: handOf(a)[0]!, action: "discard" })).ok).toBe(true);
    expect(server.testHooks.turnInfo(code)).toEqual(first);
    expect((await command(a, { type: "UNDO" })).ok).toBe(true);
    expect(server.testHooks.turnInfo(code)).toEqual(first);
    expect((await command(a, { type: "PLAY", card: handOf(a)[1]!, action: "discard" })).ok).toBe(true);
    expect((await command(b, { type: "PLAY", card: handOf(b)[0]!, action: "discard" })).ok).toBe(true);
    expect(server.testHooks.turnInfo(code)).toEqual(first);
    // 已交的人改不了，得先撤回
    expect((await command(a, { type: "PLAY", card: handOf(a)[0]!, action: "discard" })).ok).toBe(false);
    expect((await command(c, { type: "PLAY", card: handOf(c)[0]!, action: "discard" })).ok).toBe(true);
    const next = server.testHooks.turnInfo(code)!;
    expect(next.key).not.toBe(first.key);
    expect((await updateWhere(a, (room) => room.game!.round === 2)).game!.players.every((player) => !player.submitted)).toBe(true);
  });

  it("到点：已经交了的照交的出，还没交的由人机替他出（记一次超时）；连续两次超时转托管", async () => {
    const { code, players } = await table(3);
    const [a, b] = players as [TestSocket, TestSocket, TestSocket];
    const mine = latest.get(a)!.game!.players.find((player) => player.id === seatOf(a))!.hand[2]!;
    expect((await command(a, { type: "PLAY", card: mine, action: "discard" })).ok).toBe(true);
    server.testHooks.expireTurn(code);
    const after = await updateWhere(a, (room) => room.game!.round === 2);
    const timedOut = received.get(a)!.flatMap((room) => room.game?.events ?? []).filter((event) => event.type === "TurnTimedOut").map((event) => event.player);
    expect(timedOut.sort()).toEqual([seatOf(b), seatOf(players[2]!)].sort());
    expect(after.game!.lastReveal.find((play) => play.player === seatOf(a))).toMatchObject({ action: "discard", card: mine });
    // 第二次超时：b、c 转托管，之后由人机替他们出，不再记超时
    server.testHooks.expireTurn(code);
    const auto = await updateWhere(a, (room) => room.members.filter((member) => member.auto).length === 2);
    expect(auto.members.find((member) => member.id === a.id)!.auto).toBeUndefined();
    // a 自己出：b、c 由人机代打，马上进下一轮
    const handA = auto.game!.players.find((player) => player.id === seatOf(a))!.hand;
    const round = auto.game!.round;
    expect(await command(a, { type: "PLAY", card: handA[0]!, action: "discard" })).toMatchObject({ ok: true });
    await updateWhere(a, (room) => room.game!.round === round + 1);
    // 托管中的 b 已经由人机交了牌；b 自己动一下（撤回）就取消托管
    await updateWhere(b, (room) => room.game!.round === round + 1 && room.game!.players.find((player) => player.id === seatOf(b))!.submitted);
    expect(await command(b, { type: "UNDO" })).toMatchObject({ ok: true });
    expect((await updateWhere(b, (room) => room.members.find((member) => member.id === b.id)!.auto === undefined)).members.length).toBe(3);
  });

  it("插入选择（巴比伦第 7 张）：只等他一个人、只有他能出，其他人出牌被拒；到点由人机替他出", async () => {
    const { code, players } = await table(3);
    const [a, b] = players as [TestSocket, TestSocket, TestSocket];
    inject(code, scene("babylonSeventh"));
    const seventh = await updateWhere(a, (room) => room.game!.phase === "seventh");
    expect(seventh.game!.pending).toEqual({ type: "seventh", player: "p1" });
    expect(seventh.turnRemainingMs).toBeGreaterThan(0);
    const p1 = players.find((client) => seatOf(client) === "p1")!;
    const other = players.find((client) => seatOf(client) === "p2")!;
    const otherHand = latest.get(other)!.game!.players.find((player) => player.id === "p2")!.hand;
    expect((await command(other, { type: "PLAY", card: otherHand[0] ?? "x", action: "discard" })).ok).toBe(false);
    const key = server.testHooks.turnInfo(code)!.key;
    server.testHooks.expireTurn(code);
    const done = await updateWhere(p1, (room) => room.game!.phase !== "seventh");
    expect(server.testHooks.turnInfo(code)!.key).not.toBe(key);
    expect(received.get(p1)!.flatMap((room) => room.game?.events ?? []).some((event) => event.type === "TurnTimedOut" && event.player === "p1")).toBe(true);
    expect(done.game!.age).toBe(2);
    void a;
    void b;
  });

  it("插入选择（哈利卡纳苏斯挑弃牌）：弃牌堆只发给他本人", async () => {
    const { code, players } = await table(4);
    inject(code, scene("halicarnassus"));
    for (const client of players) await updateWhere(client, (room) => room.game!.phase === "discardBuild");
    const hal = players.find((client) => seatOf(client) === "p1")!;
    expect(latest.get(hal)!.game!.discard.length).toBeGreaterThan(0);
    for (const client of players.filter((entry) => entry !== hal)) expect(latest.get(client)!.game!.discard).toEqual([]);
    const pick = legalActions(latest.get(hal)!.game!, "p1").find((action) => action.type === "DISCARD_BUILD" && action.card !== null)!;
    expect((await command(hal, pick)).ok).toBe(true);
    const after = await updateWhere(hal, (room) => room.game!.phase === "play");
    expect(after.game!.discard).toEqual([]);
  });

  it("掉线的人交过的牌还算数；用原昵称回来坐回原座位", async () => {
    const { code, players } = await table(3);
    const [a, b, c] = players as [TestSocket, TestSocket, TestSocket];
    const name = latest.get(b)!.members.find((member) => member.id === b.id)!.name;
    const seat = seatOf(b);
    const handB = latest.get(b)!.game!.players.find((player) => player.id === seat)!.hand;
    expect((await command(b, { type: "PLAY", card: handB[0]!, action: "discard" })).ok).toBe(true);
    b.disconnect();
    await updateWhere(a, (room) => room.members.find((member) => member.playerId === seat)!.connected === false);
    expect(latest.get(a)!.game!.players.find((player) => player.id === seat)!.submitted).toBe(true);
    const back = await connect();
    const rejoined = await call<LobbyRoomSnapshot>((ack) => back.emit("room:join", { name, code }, ack));
    expect(rejoined.ok && rejoined.data.members.find((member) => member.id === back.id)).toMatchObject({ playerId: seat, connected: true });
    expect(rejoined.ok && rejoined.data.game!.players.find((player) => player.id === seat)!.hand).toEqual(handB);
    void c;
  });

  it("抓包：一整局里每个真人收到的每一条更新，都没有别人的手牌、交的牌、垫奇迹的牌、种子；整局打完能再来一局", async () => {
    const { code, players } = await table(4);
    // 每个人每轮：能建就建（第一个建造），否则看情况垫奇迹或弃牌
    const stops = players.map((client) => {
      let sentFor = "";
      const handler = (room: LobbyRoomSnapshot) => {
        const game = room.game;
        if (!game || game.phase === "finished") return;
        const actions = legalActions(game, seatOf(client));
        const key = `${game.version}`;
        if (actions.length === 0 || sentFor === key) return;
        sentFor = key;
        const pick = (game.round + game.age) % 3 === 0
          ? actions.find((action) => action.type === "PLAY" && action.action === "wonder")
          : actions.find((action) => action.type === "PLAY" && action.action === "build");
        client.emit("game:command", pick ?? actions[0]!, () => {});
      };
      client.on("room:updated", handler);
      handler(latest.get(client)!);
      return () => client.off("room:updated", handler);
    });
    const finished = await updateWhere(players[0]!, (room) => room.game?.phase === "finished", 60_000);
    stops.forEach((stop) => stop());
    expect(finished.game!.finalResult!.winners.length).toBeGreaterThan(0);
    // 抓包检查：别人的暗牌从来没发给我
    for (const client of players) {
      const me = seatOf(client);
      for (const room of received.get(client)!) {
        const game = room.game;
        if (!game) continue;
        const json = JSON.stringify(room);
        for (const key of ['"seed"', '"rngState"', '"log"', '"stacked"']) expect(json.includes(key)).toBe(false);
        for (const player of game.players) {
          if (player.id === me) continue;
          expect(player.hand).toEqual([]);
          expect(player.play).toBeNull();
          expect(player.stageCards).toEqual([]);
        }
        if (!(game.phase === "discardBuild" && game.pending?.player === me)) expect(game.discard).toEqual([]);
      }
    }
    // 再来一局
    for (const client of players) expect((await call<void>((ack) => client.emit("room:rematch", true, ack))).ok).toBe(true);
    const again = await updateWhere(players[0]!, (room) => room.game !== undefined && room.game.phase === "play" && room.game.age === 1 && !room.rematch);
    expect(again.game!.players).toHaveLength(4);
    void code;
  }, 90_000);

  it("首页列表：分数是局中实时分，isActive 是还没交牌的人", async () => {
    const { code, players } = await table(3);
    inject(code, buildScene({ age: 2, round: 1, players: [{ wonder: "giza", built: ["Altar", "Baths"] }, { wonder: "rhodes" }, { wonder: "olympia" }] }));
    const lobby = await new Promise<PublicRoomSummary[]>((resolve) => players[0]!.emit("lobby:get", (response) => resolve(response.ok ? response.data : [])));
    const mine = lobby.find((room) => room.players.length === 3 && room.players[0]!.score === 6 && room.status === "playing");
    expect(mine).toBeDefined();
    expect(mine!.players.every((player) => player.isActive)).toBe(true);
  });
});
