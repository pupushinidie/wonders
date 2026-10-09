import { domino } from "./dominoes.js";
import { baseScore, castleKingdom, legalPlacements, placeInto, placementError, rank, scoreKingdom } from "./kingdom.js";
import { createRng, type Rng } from "./rng.js";
import {
  PLAYER_COLORS,
  type Config,
  type FinalResult,
  type GameCommand,
  type GameEvent,
  type GameOptions,
  type GameState,
  type King,
  type Placement,
  type Slot,
} from "./types.js";

/** 每排几张骨牌（所有人数都是 4）。 */
export const LINE_SIZE = 4;

export function defaultConfig(playerCount: number, options: Partial<GameOptions> = {}): Config {
  const mighty = playerCount === 2 && options.mighty === true;
  return {
    playerCount,
    size: mighty ? 7 : 5,
    mighty,
    middleKingdom: options.middleKingdom ?? false,
    harmony: options.harmony ?? false,
    kingsPerPlayer: playerCount === 2 ? 2 : 1,
    pickTimeoutSec: 45,
    placeTimeoutSec: 90,
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

/** 从牌堆顶抽一排，按编号从小到大排好。 */
function drawLine(state: GameState): Slot[] {
  const drawn = state.deck.splice(0, LINE_SIZE).sort((x, y) => x - y);
  return drawn.map((n) => ({ n, king: null, resolved: false, pre: null }));
}

/**
 * 开局：洗牌（2 人默认局随机移出 24 张），翻第一排，定开局选牌顺序。
 * 3–4 人：所有国王随机排序；2 人：随机先手 A，顺序 A → B → B → A。
 */
export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  options: Partial<GameOptions> = {},
): GameState {
  if (players.length < 2 || players.length > 4) throw new Error("需要 2–4 位玩家才能开始。");
  const config = defaultConfig(players.length, options);
  const rng = createRng(seed);
  const shuffled = rng.shuffle(Array.from({ length: 48 }, (_, index) => index + 1));
  const twoShort = players.length === 2 && !config.mighty;
  const deck = twoShort ? shuffled.slice(0, 24) : shuffled;
  const setAside = twoShort ? shuffled.slice(24) : [];

  let pickOrder: King[];
  if (players.length === 2) {
    const first = rng.int(2);
    const second = 1 - first;
    pickOrder = [
      { player: first, idx: 0 },
      { player: second, idx: 0 },
      { player: second, idx: 1 },
      { player: first, idx: 1 },
    ];
  } else {
    pickOrder = rng.shuffle(players.map((_, index) => index)).map((player) => ({ player, idx: 0 as const }));
  }

  const state: GameState = {
    config,
    phase: "picking",
    players: players.map((player, index) => ({
      id: player.id,
      name: player.name,
      color: PLAYER_COLORS[index]!,
      kingdom: castleKingdom(),
      discarded: [],
      score: 0,
    })),
    currentPlayer: pickOrder[0]!.player,
    active: 0,
    step: "pick",
    pickOrder,
    current: [],
    next: [],
    round: 0,
    totalRounds: deck.length / LINE_SIZE,
    turn: 1,
    removed: [],
    events: [],
    version: 0,
    deck,
    setAside,
    seed,
  };
  state.current = drawLine(state);
  state.rngState = rng.state;
  return state;
}

function playerIndex(state: GameState, playerId: string): number {
  return state.players.findIndex((player) => player.id === playerId);
}

/** 这位玩家当前排里最早一张还没放（也没弃）的骨牌的位置；没有就是 −1。提前放置只能放这一张。 */
export function pendingSlot(state: GameState, player: number): number {
  if (state.phase !== "playing") return -1;
  return state.current.findIndex((slot) => slot.king?.player === player && !slot.resolved);
}

/** 正在行动的国王要选牌的那一排（开局选第一排，之后选新排）。 */
export function pickRow(state: GameState): Slot[] {
  return state.phase === "picking" ? state.current : state.next;
}

function freeSlots(row: readonly Slot[]): number[] {
  return row.flatMap((slot, index) => (slot.king ? [] : [index]));
}

function doPlace(state: GameState, slotIndex: number, placement: Placement, pre: boolean, events: GameEvent[]): void {
  const slot = state.current[slotIndex]!;
  const player = state.players[slot.king!.player]!;
  const dom = domino(slot.n);
  const error = placementError(player.kingdom, dom, placement, state.config.size);
  if (error) throw new Error(error);
  const scoreBefore = player.score;
  player.kingdom = placeInto(player.kingdom, dom, { a: { r: placement.a.r, c: placement.a.c }, b: { r: placement.b.r, c: placement.b.c } });
  player.score = baseScore(player.kingdom);
  slot.resolved = true;
  slot.pre = null;
  events.push({ type: "Placed", player: player.id, n: slot.n, a: placement.a, b: placement.b, pre, scoreBefore, scoreAfter: player.score });
}

function doDiscard(state: GameState, slotIndex: number, events: GameEvent[]): void {
  const slot = state.current[slotIndex]!;
  const player = state.players[slot.king!.player]!;
  player.discarded.push(slot.n);
  slot.resolved = true;
  slot.pre = null;
  events.push({ type: "Discarded", player: player.id, n: slot.n });
}

function doPick(state: GameState, slotIndex: number, auto: boolean, events: GameEvent[]): void {
  const row = pickRow(state);
  const target = row[slotIndex];
  if (!Number.isInteger(slotIndex) || !target) throw new Error("没有这张骨牌。");
  if (target.king) throw new Error("这张骨牌已经有国王了。");
  const king = state.phase === "picking" ? state.pickOrder[state.active]! : state.current[state.active]!.king!;
  target.king = { player: king.player, idx: king.idx };
  events.push({ type: "Picked", player: state.players[king.player]!.id, n: target.n, auto });
  state.active += 1;
}

/** 3 人局：一排里没人选的骨牌弃掉。 */
function removeLeftovers(state: GameState, row: Slot[], events: GameEvent[]): Slot[] {
  const kept: Slot[] = [];
  for (const slot of row) {
    if (slot.king) kept.push(slot);
    else {
      state.removed.push(slot.n);
      events.push({ type: "LeftoverRemoved", n: slot.n });
    }
  }
  return kept;
}

function startRound(state: GameState, events: GameEvent[]): void {
  state.round += 1;
  state.active = 0;
  state.next = state.deck.length > 0 ? drawLine(state) : [];
  events.push({ type: "RoundStarted", round: state.round, last: state.next.length === 0, revealed: state.next.map((slot) => slot.n) });
}

function finishGame(state: GameState, events: GameEvent[]): void {
  const { size, middleKingdom, harmony } = state.config;
  const scores = state.players.map((player) =>
    scoreKingdom(player.id, player.kingdom, player.discarded.length, { size, middleKingdom, harmony }),
  );
  for (const score of scores) state.players.find((player) => player.id === score.player)!.score = score.total;
  const result: FinalResult = { scores, winners: rank(scores) };
  state.phase = "finished";
  state.currentPlayer = -1;
  state.finalResult = result;
  events.push({ type: "GameEnded", result });
}

/**
 * 推进到下一个需要真人做决定的地方：
 * - 只剩一张可选时自动选；
 * - 轮到的国王已经提前放好了，直接生效；
 * - 轮到的国王没有任何合法放法，自动弃掉；
 * - 一排的国王都行动完，换排、翻新排或者结束。
 */
function settle(state: GameState, events: GameEvent[]): void {
  for (let guard = 0; guard < 1000; guard += 1) {
    if (state.phase === "finished") return;
    if (state.phase === "picking") {
      if (state.active >= state.pickOrder.length) {
        if (state.config.playerCount === 3) state.current = removeLeftovers(state, state.current, events);
        state.phase = "playing";
        startRound(state, events);
        continue;
      }
      state.currentPlayer = state.pickOrder[state.active]!.player;
      state.step = "pick";
      const free = freeSlots(state.current);
      if (free.length === 1) {
        doPick(state, free[0]!, true, events);
        continue;
      }
      return;
    }

    // playing
    if (state.active >= state.current.length) {
      if (state.next.length === 0) {
        finishGame(state, events);
        return;
      }
      if (state.config.playerCount === 3) state.next = removeLeftovers(state, state.next, events);
      state.current = state.next.map((slot) => ({ n: slot.n, king: slot.king, resolved: false, pre: null }));
      state.next = [];
      startRound(state, events);
      continue;
    }
    const slot = state.current[state.active]!;
    state.currentPlayer = slot.king!.player;
    if (!slot.resolved) {
      state.step = "place";
      const player = state.players[slot.king!.player]!;
      if (slot.pre && slot.pre !== "hidden") {
        try {
          doPlace(state, state.active, slot.pre, true, events);
        } catch {
          slot.pre = null; // 不会发生（别人改不了你的王国），保险起见退回到放置这一步
          return;
        }
        continue;
      }
      if (legalPlacements(player.kingdom, domino(slot.n), state.config.size).length === 0) {
        doDiscard(state, state.active, events);
        continue;
      }
      return;
    }
    if (state.next.length === 0) {
      state.active += 1;
      continue;
    }
    state.step = "pick";
    const free = freeSlots(state.next);
    if (free.length <= 1) {
      if (free.length === 1) doPick(state, free[0]!, true, events);
      else state.active += 1;
      continue;
    }
    return;
  }
  throw new Error("对局推进出错。");
}

function stepSignature(state: GameState): string {
  return `${state.phase}:${state.round}:${state.active}:${state.step}`;
}

/** 规则引擎主入口：校验并执行一个命令，返回新状态和事件。不修改传入的 state。 */
export function apply(state: GameState, playerId: string, command: GameCommand, _rng?: Rng): { state: GameState; events: GameEvent[] } {
  if (state.phase === "finished") throw new Error("对局已经结束。");
  const me = playerIndex(state, playerId);
  if (me < 0) throw new Error("你不在这局里。");
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  const before = stepSignature(next);
  const myTurn = next.currentPlayer === me;

  switch (command?.type) {
    case "PICK": {
      if (!myTurn) throw new Error("还没轮到你。");
      if (next.step !== "pick") throw new Error("先把脚下的骨牌放进王国，再选下一张。");
      doPick(next, command.slot, false, events);
      break;
    }
    case "PLACE": {
      if (next.phase !== "playing") throw new Error("现在还不能放骨牌。");
      const placement: Placement = { a: { r: command.a?.r, c: command.a?.c }, b: { r: command.b?.r, c: command.b?.c } };
      if (myTurn && next.step === "place") {
        doPlace(next, next.active, placement, false, events);
      } else {
        // 提前放置：只能放自己最早一张还没放的骨牌，轮到时生效；之前可以改。
        const index = pendingSlot(next, me);
        if (index < 0) throw new Error("你这一轮没有要放的骨牌了。");
        const slot = next.current[index]!;
        const error = placementError(next.players[me]!.kingdom, domino(slot.n), placement, next.config.size);
        if (error) throw new Error(error);
        slot.pre = placement;
      }
      break;
    }
    case "CANCEL_PRE": {
      const index = pendingSlot(next, me);
      const slot = index >= 0 ? next.current[index] : undefined;
      if (!slot?.pre) throw new Error("没有提前放好的骨牌。");
      slot.pre = null;
      break;
    }
    case "DISCARD": {
      if (!myTurn || next.phase !== "playing" || next.step !== "place") throw new Error("还没轮到你放骨牌。");
      const slot = next.current[next.active]!;
      if (legalPlacements(next.players[me]!.kingdom, domino(slot.n), next.config.size).length > 0) {
        throw new Error("还有地方能放，不能弃掉。");
      }
      doDiscard(next, next.active, events);
      break;
    }
    default:
      throw new Error("未知的行动。");
  }

  settle(next, events);
  if (stepSignature(next) !== before) next.turn += 1;
  next.version += 1;
  next.events = events;
  return { state: next, events };
}

/** 服务端用：执行命令并记进动作序列（同一种子重放这串动作就能复现整局）。 */
export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  const { state: next } = apply(state, playerId, command);
  next.log = [...(state.log ?? []), { player: playerId, command }];
  return next;
}

/**
 * 超时自动行动（规则书 9.4）：
 * - 选牌：新排里编号最小的空位；
 * - 放置：放下后区域分最高的放法，同分取 legalPlacements 顺序里的第一个；放不下就弃。
 */
export function autoCommand(state: GameState): GameCommand {
  if (state.step === "pick") {
    const free = freeSlots(pickRow(state));
    return { type: "PICK", slot: free[0]! };
  }
  const slot = state.current[state.active]!;
  const player = state.players[state.currentPlayer]!;
  const dom = domino(slot.n);
  let best: Placement | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const placement of legalPlacements(player.kingdom, dom, state.config.size)) {
    const score = baseScore(placeInto(player.kingdom, dom, placement));
    if (score > bestScore) {
      bestScore = score;
      best = placement;
    }
  }
  return best ? { type: "PLACE", a: best.a, b: best.b } : { type: "DISCARD" };
}

/** 回合超时（含断线玩家）：替正在行动的国王做一步。 */
export function timeoutTurn(state: GameState): GameState {
  if (state.phase === "finished") return state;
  const playerId = state.players[state.currentPlayer]!.id;
  const { state: next } = apply(state, playerId, autoCommand(state));
  next.events = [{ type: "TurnTimedOut", player: playerId }, ...next.events];
  next.log = [...(state.log ?? []), { player: playerId, command: { type: "TIMEOUT" } }];
  return next;
}

/**
 * 发给客户端的视角：牌堆和 2 人局移出的骨牌只给张数；别人提前放好的位置只显示「已放好」；
 * 删掉种子、随机数状态、动作序列。
 */
export function redactGameForViewer(state: GameState, viewerId: string): GameState {
  const { deck, setAside, seed: _seed, rngState: _rngState, log: _log, ...rest } = state;
  const viewer = playerIndex(state, viewerId);
  const current = state.current.map((slot) =>
    slot.pre && slot.king?.player !== viewer ? { ...slot, pre: "hidden" as const } : slot,
  );
  return { ...rest, current, deck: [], setAside: [], deckCount: deck.length, setAsideCount: setAside.length };
}

/** 正在行动的人现在能做的所有命令（不含提前放置）；不是他的回合返回空数组。测试和陪玩脚本用。 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  if (state.phase === "finished" || state.players[state.currentPlayer]?.id !== playerId) return [];
  if (state.step === "pick") return selectableSlots(state).map((slot) => ({ type: "PICK", slot }));
  const slot = state.current[state.active]!;
  const options = legalPlacements(state.players[state.currentPlayer]!.kingdom, domino(slot.n), state.config.size);
  return options.length > 0 ? options.map((placement) => ({ type: "PLACE", a: placement.a, b: placement.b })) : [{ type: "DISCARD" }];
}

/** 新排或第一排里还能选的位置（界面高亮用）。 */
export function selectableSlots(state: GameState): number[] {
  return state.step === "pick" && state.phase !== "finished" ? freeSlots(pickRow(state)) : [];
}

export { createRng };
