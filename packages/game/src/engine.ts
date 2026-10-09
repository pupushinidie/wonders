import { buildAgeDeck, card, isCardId, isResString, sortRes, wonderStages } from "./cards.js";
import {
  countFor,
  freeBuildAvailable,
  hasBuiltName,
  hasStageEffect,
  leftOf,
  neighborOf,
  playerIndex,
  rightOf,
  shieldsOf,
} from "./city.js";
import { createRng, type Rng } from "./rng.js";
import { finalScores } from "./score.js";
import { paymentOptions } from "./trade.js";
import {
  DEFAULT_OPTIONS,
  WONDER_KEYS,
  type Age,
  type CardId,
  type CardPlayOptions,
  type Config,
  type GameCommand,
  type GameEvent,
  type GameOptions,
  type GameState,
  type PlannedPlay,
  type PlayerState,
  type RevealedPlay,
  type Side,
  type StageEffect,
  type WonderKey,
  type WonderSide,
} from "./types.js";

/** 每个时代几轮。 */
export const ROUNDS_PER_AGE = 6;
/** 开局金币。 */
export const START_COINS = 3;
/** 弃牌换几金。 */
export const DISCARD_COINS = 3;
/** 各时代的胜仗标记。 */
export const VICTORY_POINTS: Record<Age, number> = { 1: 1, 2: 3, 3: 5 };

export function defaultConfig(playerCount: number, options: Partial<GameOptions> = {}): Config {
  return {
    playerCount,
    randomSides: options.randomSides ?? DEFAULT_OPTIONS.randomSides,
    chooseWonders: options.chooseWonders ?? DEFAULT_OPTIONS.chooseWonders,
    roundSec: 60,
    choiceSec: 20,
    wonderPickSec: 30,
  };
}

/** 传牌方向：Age I、III 传左邻，Age II 传右邻（和人数无关）。 */
export function passDirection(age: Age): Side {
  return age === 2 ? "right" : "left";
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

/** 开局时可以指定的东西（预览局面、教程用）：每人的奇迹和面、预先排好的各时代手牌。 */
export interface GameSetup {
  readonly wonders?: readonly { readonly wonder: WonderKey; readonly side: WonderSide }[];
  readonly stacked?: Partial<Record<Age, CardId[][]>>;
}

function emptyPlayer(player: NewPlayer): PlayerState {
  return {
    id: player.id,
    name: player.name,
    wonder: null,
    side: "A",
    stages: 0,
    stageCards: [],
    built: [],
    coins: START_COINS,
    tokens: [],
    hand: [],
    handCount: 0,
    submitted: false,
    play: null,
    freeBuildUsed: false,
  };
}

/**
 * 开局：每人 3 金。随机分奇迹（默认全员 A 面，开了 randomSides 每人随机面）然后发 Age I；
 * 开了 chooseWonders 时先按座位顺序轮流挑奇迹（从随机一位开始，往左邻方向轮），挑完再发牌。
 */
export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  options: Partial<GameOptions> = {},
  setup: GameSetup = {},
): GameState {
  if (players.length < 3 || players.length > 7) throw new Error("需要 3–7 位玩家才能开始。");
  const config = defaultConfig(players.length, options);
  const rng = createRng(seed);
  const state: GameState = {
    config,
    phase: "play",
    players: players.map(emptyPlayer),
    age: 1,
    round: 0,
    direction: "left",
    step: 0,
    pending: null,
    discardBuildDue: null,
    chooseOrder: [],
    chooser: 0,
    discard: [],
    discardCount: 0,
    lastReveal: [],
    events: [],
    version: 0,
    seed,
    log: [],
  };
  if (setup.stacked) state.stacked = structuredClone(setup.stacked);
  const events: GameEvent[] = [];
  if (setup.wonders) {
    if (setup.wonders.length !== players.length) throw new Error("指定的奇迹数和人数不一样。");
    setup.wonders.forEach((entry, index) => {
      state.players[index]!.wonder = entry.wonder;
      state.players[index]!.side = entry.side;
    });
    events.push({ type: "WondersAssigned", assignments: assignments(state) });
    startAge(state, 1, rng, events);
  } else if (config.chooseWonders) {
    const first = rng.int(players.length);
    state.phase = "wonders";
    state.chooseOrder = players.map((_, offset) => (first + offset) % players.length);
    state.chooser = 0;
    state.step = 1;
  } else {
    const keys = rng.shuffle(WONDER_KEYS).slice(0, players.length);
    state.players.forEach((player, index) => {
      player.wonder = keys[index]!;
      player.side = config.randomSides && rng.int(2) === 1 ? "B" : "A";
    });
    events.push({ type: "WondersAssigned", assignments: assignments(state) });
    startAge(state, 1, rng, events);
  }
  state.events = events;
  state.rngState = rng.state;
  syncCounts(state);
  return state;
}

function assignments(state: GameState) {
  return state.players.map((player) => ({ player: player.id, wonder: player.wonder!, side: player.side }));
}

/** 发一个时代的牌：每人 7 张（教程可以预先指定 stacked）。 */
function startAge(state: GameState, age: Age, rng: Rng, events: GameEvent[]): void {
  const n = state.players.length;
  const stacked = state.stacked?.[age];
  let hands: CardId[][];
  if (stacked) {
    if (stacked.length !== n || stacked.some((hand) => hand.length !== 7)) throw new Error(`Age ${age} 预先指定的手牌要每人 7 张。`);
    hands = stacked.map((hand) => [...hand]);
  } else {
    const deck = buildAgeDeck(age, n, rng);
    hands = state.players.map((_, index) => deck.slice(index * 7, index * 7 + 7));
  }
  state.age = age;
  state.round = 1;
  state.direction = passDirection(age);
  state.phase = "play";
  state.pending = null;
  state.discardBuildDue = null;
  state.step += 1;
  state.players.forEach((player, index) => {
    player.hand = hands[index]!;
    player.freeBuildUsed = false;
    player.submitted = false;
    player.play = null;
  });
  events.push({ type: "AgeStarted", age, direction: state.direction });
  events.push({ type: "RoundStarted", age, round: 1 });
}

function syncCounts(state: GameState): void {
  for (const player of state.players) player.handCount = player.hand.length;
  state.discardCount = state.discard.length;
}

/** 现在在等谁行动（服务器排计时、安排人机用）：出牌阶段是还没交的人，插入选择、挑奇迹是那一个人。 */
export function pendingActors(state: GameState): string[] {
  switch (state.phase) {
    case "wonders": {
      const index = state.chooseOrder[state.chooser];
      return index === undefined ? [] : [state.players[index]!.id];
    }
    case "play":
      return state.players.filter((player) => !player.submitted).map((player) => player.id);
    case "seventh":
    case "discardBuild":
      return state.pending ? [state.pending.player] : [];
    default:
      return [];
  }
}

/** 手里每张牌三种用法各自能不能做、怎么付（出牌阶段和巴比伦第 7 张都能用）。 */
export function playOptions(state: GameState, playerId: string): CardPlayOptions[] {
  const index = playerIndex(state, playerId);
  if (index < 0) return [];
  return state.players[index]!.hand.map((id) => ({
    card: id,
    build: paymentOptions(state, playerId, { card: id }),
    wonder: paymentOptions(state, playerId, { stage: true }),
    discard: true as const,
  }));
}

/** 哈利卡纳苏斯现在能从弃牌堆免费建的牌（去掉同名已建的）。 */
export function discardBuildOptions(state: GameState, playerId: string): CardId[] {
  const index = playerIndex(state, playerId);
  if (index < 0) return [];
  const player = state.players[index]!;
  return state.discard.filter((id) => !hasBuiltName(player, card(id).name));
}

/** 校验一手出牌，补全付款方案。 */
function planPlay(state: GameState, index: number, command: Extract<GameCommand, { type: "PLAY" }>): PlannedPlay {
  const player = state.players[index]!;
  if (!isCardId(command.card) || !player.hand.includes(command.card)) throw new Error("这张牌不在你手里。");
  if (command.action === "discard") return { card: command.card, action: "discard", payment: null };
  if (command.action !== "build" && command.action !== "wonder") throw new Error("用法只能是建造、建奇迹或弃牌。");
  const info = paymentOptions(state, player.id, command.action === "build" ? { card: command.card } : { stage: true });
  if (info.options.length === 0) throw new Error(`${info.reason ?? "付不起。"}可以拿去弃掉换 ${DISCARD_COINS} 金。`);
  if (command.olympia === true) {
    if (command.action !== "build") throw new Error("奥林匹亚的免费建造只能用来建手里的建筑。");
    const olympia = info.options.find((option) => option.kind === "olympia");
    if (!olympia) {
      if (info.options.some((option) => option.kind === "chain")) throw new Error("这张能免费链，不用奥林匹亚的免费建造。");
      throw new Error("奥林匹亚的免费建造现在用不了。");
    }
    return { card: command.card, action: "build", payment: olympia };
  }
  if (command.trade !== undefined) {
    const trade = command.trade;
    if (!trade || !isResString(trade.left) || !isResString(trade.right)) throw new Error("买资源方案的格式不对。");
    const left = sortRes(trade.left);
    const right = sortRes(trade.right);
    const match = info.options.find((option) => option.kind !== "olympia" && option.left === left && option.right === right);
    if (!match) throw new Error("这个买资源方案不行（邻居没有可卖的、买多了，或者钱不够）。");
    return { card: command.card, action: command.action, payment: match };
  }
  return { card: command.card, action: command.action, payment: info.options.find((option) => option.isDefault)! };
}

/** 一手出牌落到城里：扣钱、放牌、记下付给邻居的钱（本轮之后才到账）。返回公开记录的骨架。 */
function placePlay(state: GameState, index: number, play: PlannedPlay, income: number[]): Omit<RevealedPlay, "gained" | "income"> & { stageNo?: number } {
  const player = state.players[index]!;
  player.hand = player.hand.filter((id) => id !== play.card);
  const payment = play.payment;
  const base = {
    player: player.id,
    action: play.action,
    card: play.card,
    via: payment?.kind ?? null,
    bought: { left: payment?.left ?? "", right: payment?.right ?? "" },
    paidLeft: payment?.leftCost ?? 0,
    paidRight: payment?.rightCost ?? 0,
    paidBank: payment?.bankCost ?? 0,
  };
  if (play.action === "discard") {
    state.discard.push(play.card);
    return base;
  }
  player.coins -= payment!.total;
  if (player.coins < 0) throw new Error("金币不够。");
  income[leftOf(state, index)]! += payment!.leftCost;
  income[rightOf(state, index)]! += payment!.rightCost;
  if (play.action === "build") {
    if (payment!.kind === "olympia") player.freeBuildUsed = true;
    player.built.push(play.card);
    return base;
  }
  player.stageCards.push(play.card);
  player.stages += 1;
  return { ...base, stage: player.stages, stageNo: player.stages };
}

/** 建成一张卡那一刻拿的金币（酒馆、葡萄园、集市、港口、灯塔、商会、竞技场），按此刻城里的数量算。 */
function buildCoins(state: GameState, index: number, cardId: CardId): number {
  const effect = card(cardId).effect;
  if (effect.type === "coins") return effect.n;
  if (effect.type === "perCount" && effect.coinsNow) return effect.coinsNow * countFor(state, index, effect.what, effect.scope);
  return 0;
}

function stageEffectsAt(player: PlayerState, stageNo: number): readonly StageEffect[] {
  return wonderStages(player.wonder!, player.side)[stageNo - 1]!.effects;
}

/** 建成奇迹阶段那一刻拿的金币（以弗所、罗德岛 B）。 */
function stageCoins(player: PlayerState, stageNo: number): number {
  let coins = 0;
  for (const effect of stageEffectsAt(player, stageNo)) if (effect.type === "coins") coins += effect.n;
  return coins;
}

/** 所有人交齐：同时亮牌、结算（U3 第 ① 步），然后接着走插入选择 / 传牌 / 时代结束。 */
function resolveRound(state: GameState, events: GameEvent[], rng: Rng): void {
  const income = state.players.map(() => 0);
  const placed = state.players.map((player, index) => placePlay(state, index, player.play!, income));
  // 先把所有人的牌都放好，再算「建成时」的金币：葡萄园 / 集市要算邻居同一轮刚建的卡
  const gained = state.players.map(() => 0);
  let discardBuilder: string | null = null;
  placed.forEach((entry, index) => {
    const player = state.players[index]!;
    if (entry.action === "discard") gained[index] = DISCARD_COINS;
    else if (entry.action === "build") gained[index] = buildCoins(state, index, entry.card!);
    else {
      gained[index] = stageCoins(player, entry.stageNo!);
      if (stageEffectsAt(player, entry.stageNo!).some((effect) => effect.type === "buildFromDiscard")) discardBuilder = player.id;
    }
  });
  const reveal: RevealedPlay[] = placed.map((entry, index) => {
    const { stageNo: _stageNo, ...rest } = entry;
    return { ...rest, gained: gained[index]!, income: income[index]! };
  });
  state.players.forEach((player, index) => {
    player.coins += gained[index]! + income[index]!;
    player.submitted = false;
    player.play = null;
  });
  state.lastReveal = reveal;
  events.push({ type: "Revealed", age: state.age, round: state.round, plays: reveal });
  afterReveal(state, events, rng, discardBuilder);
}

/** 亮牌结算之后：第 1–5 轮 → 哈利卡纳苏斯挑牌 → 传牌；第 6 轮 → 巴比伦第 7 张 → 作废 → 哈利卡纳苏斯 → 军事（U3）。 */
function afterReveal(state: GameState, events: GameEvent[], rng: Rng, discardBuilder: string | null): void {
  if (state.round < ROUNDS_PER_AGE) {
    if (discardBuilder && openDiscardBuild(state, discardBuilder, events)) return;
    nextRound(state, events);
    return;
  }
  const babylon = state.players.find((player) => hasStageEffect(player, "playSeventhCard") && player.hand.length === 1);
  if (babylon) {
    state.phase = "seventh";
    state.pending = { type: "seventh", player: babylon.id };
    state.discardBuildDue = discardBuilder;
    state.step += 1;
    events.push({ type: "SeventhPending", player: babylon.id });
    return;
  }
  burnAndContinue(state, events, rng, discardBuilder);
}

/** 第 6 轮剩下的牌作废进弃牌堆（不给钱），然后哈利卡纳苏斯挑牌，再比军事。 */
function burnAndContinue(state: GameState, events: GameEvent[], rng: Rng, discardBuilder: string | null): void {
  const burned: string[] = [];
  for (const player of state.players) {
    if (player.hand.length === 0) continue;
    state.discard.push(...player.hand);
    player.hand = [];
    burned.push(player.id);
  }
  events.push({ type: "CardsBurned", players: burned });
  state.discardBuildDue = null;
  if (discardBuilder && openDiscardBuild(state, discardBuilder, events)) return;
  endAge(state, events, rng);
}

/** 哈利卡纳苏斯开始挑弃牌；弃牌堆里一张能建的都没有就直接作废（返回 false）。 */
function openDiscardBuild(state: GameState, playerId: string, events: GameEvent[]): boolean {
  const options = discardBuildOptions(state, playerId);
  if (options.length === 0) {
    events.push({ type: "BuiltFromDiscard", player: playerId, card: null, gained: 0 });
    return false;
  }
  state.phase = "discardBuild";
  state.pending = { type: "discardBuild", player: playerId };
  state.step += 1;
  events.push({ type: "DiscardBuildPending", player: playerId, options: options.length });
  return true;
}

/** 第 1–5 轮结束：按本时代方向传牌，开始下一轮。 */
function nextRound(state: GameState, events: GameEvent[]): void {
  const hands = state.players.map((player) => player.hand);
  state.players.forEach((_, index) => {
    // 传给左邻：我拿到右邻的牌；传给右邻：我拿到左邻的牌
    const from = state.direction === "left" ? rightOf(state, index) : leftOf(state, index);
    state.players[index]!.hand = hands[from]!;
  });
  events.push({ type: "HandsPassed", direction: state.direction });
  state.round += 1;
  state.phase = "play";
  state.pending = null;
  state.step += 1;
  events.push({ type: "RoundStarted", age: state.age, round: state.round });
}

/** 时代结束：和左右邻居比盾牌，然后发下一个时代的牌或者终局。 */
function endAge(state: GameState, events: GameEvent[], rng: Rng): void {
  const shields = state.players.map((player) => shieldsOf(player));
  const win = VICTORY_POINTS[state.age];
  const results = state.players.map((player, index) => {
    const outcome = (side: Side) => {
      const other = shields[neighborOf(state, index, side)]!;
      const mine = shields[index]!;
      return mine > other ? win : mine < other ? -1 : 0;
    };
    return { player: player.id, shields: shields[index]!, left: outcome("left"), right: outcome("right") };
  });
  results.forEach((result, index) => {
    const player = state.players[index]!;
    if (result.left !== 0) player.tokens.push({ age: state.age, value: result.left, vs: "left" });
    if (result.right !== 0) player.tokens.push({ age: state.age, value: result.right, vs: "right" });
  });
  events.push({ type: "MilitaryResolved", age: state.age, results });
  state.pending = null;
  if (state.age < 3) {
    startAge(state, (state.age + 1) as Age, rng, events);
    return;
  }
  state.phase = "finished";
  state.step += 1;
  state.finalResult = finalScores(state);
  events.push({ type: "GameEnded", result: state.finalResult });
}

/** 巴比伦打第 7 张（U3 第 ② 步）：单独一步，按此刻的金币和城算（U4）。 */
function resolveSeventh(state: GameState, index: number, play: PlannedPlay, events: GameEvent[], rng: Rng): void {
  const income = state.players.map(() => 0);
  const entry = placePlay(state, index, play, income);
  const player = state.players[index]!;
  let gained = 0;
  if (entry.action === "discard") gained = DISCARD_COINS;
  else if (entry.action === "build") gained = buildCoins(state, index, entry.card!);
  else gained = stageCoins(player, entry.stageNo!);
  state.players.forEach((other, otherIndex) => {
    other.coins += income[otherIndex]!;
  });
  player.coins += gained;
  const { stageNo: _stageNo, ...rest } = entry;
  const revealed: RevealedPlay = { ...rest, gained, income: 0 };
  state.lastReveal = [...state.lastReveal, revealed];
  events.push({ type: "SeventhPlayed", play: revealed });
  const due = state.discardBuildDue;
  state.pending = null;
  burnAndContinue(state, events, rng, due);
}

/** 哈利卡纳苏斯挑一张弃牌免费建（不付资源也不付金币；建成时的金币照拿）。 */
function resolveDiscardBuild(state: GameState, index: number, cardId: CardId | null, events: GameEvent[], rng: Rng): void {
  const player = state.players[index]!;
  let gained = 0;
  if (cardId !== null) {
    if (!isCardId(cardId) || !state.discard.includes(cardId)) throw new Error("弃牌堆里没有这张牌。");
    if (hasBuiltName(player, card(cardId).name)) throw new Error("已经建过同名的建筑，不能再建。");
    state.discard = state.discard.filter((id) => id !== cardId);
    player.built.push(cardId);
    gained = buildCoins(state, index, cardId);
    player.coins += gained;
  }
  events.push({ type: "BuiltFromDiscard", player: player.id, card: cardId, gained });
  state.pending = null;
  if (state.round < ROUNDS_PER_AGE) nextRound(state, events);
  else endAge(state, events, rng);
}

/**
 * 规则引擎：执行一位玩家的命令，返回新状态和这一步的事件。不改输入；version +1。
 * rng 不给就用状态里存的随机数状态（服务器）；教程可以传按剧本出数的 rng。
 */
export function apply(state: GameState, playerId: string, command: GameCommand, rng?: Rng): { state: GameState; events: GameEvent[] } {
  if (state.phase === "finished") throw new Error("对局已经结束。");
  // 动作序列只追加不修改、上一步的事件这一步会换掉：都不用深拷贝（动作序列跟着新状态走，同一个数组）
  const { log, events: _previousEvents, ...rest } = state;
  const next = structuredClone(rest) as GameState;
  next.events = [];
  if (log) next.log = log;
  const random = rng ?? createRng(next.rngState ?? next.seed ?? 0);
  const index = playerIndex(next, playerId);
  if (index < 0) throw new Error("你不在这局里。");
  const me = next.players[index]!;
  const events: GameEvent[] = [];

  switch (command?.type) {
    case "PLAY": {
      if (next.phase === "play") {
        if (me.submitted) throw new Error("你这一轮已经出过牌了，要改先撤回。");
        me.play = planPlay(next, index, command);
        me.submitted = true;
        events.push({ type: "Submitted", player: me.id });
        if (next.players.every((player) => player.submitted)) resolveRound(next, events, random);
      } else if (next.phase === "seventh" && next.pending?.player === me.id) {
        resolveSeventh(next, index, planPlay(next, index, command), events, random);
      } else {
        throw new Error("现在不能出牌。");
      }
      break;
    }
    case "UNDO": {
      if (next.phase !== "play" || !me.submitted) throw new Error("没有可以撤回的出牌。");
      me.submitted = false;
      me.play = null;
      events.push({ type: "Withdrawn", player: me.id });
      break;
    }
    case "CHOOSE_WONDER": {
      if (next.phase !== "wonders" || next.chooseOrder[next.chooser] !== index) throw new Error("还没轮到你挑奇迹。");
      if (!(WONDER_KEYS as readonly string[]).includes(command.wonder)) throw new Error("没有这块奇迹板。");
      if (command.side !== "A" && command.side !== "B") throw new Error("奇迹板只有 A、B 两面。");
      if (next.players.some((player) => player.wonder === command.wonder)) throw new Error("这块奇迹已经有人挑了。");
      me.wonder = command.wonder;
      me.side = command.side;
      events.push({ type: "WonderChosen", player: me.id, wonder: command.wonder, side: command.side });
      next.chooser += 1;
      next.step += 1;
      if (next.chooser >= next.chooseOrder.length) {
        events.push({ type: "WondersAssigned", assignments: assignments(next) });
        startAge(next, 1, random, events);
      }
      break;
    }
    case "DISCARD_BUILD": {
      if (next.phase !== "discardBuild" || next.pending?.player !== me.id) throw new Error("现在不是你从弃牌堆挑牌。");
      resolveDiscardBuild(next, index, command.card ?? null, events, random);
      break;
    }
    default:
      throw new Error("未知的行动。");
  }

  syncCounts(next);
  next.rngState = random.state;
  next.version += 1;
  next.events = events;
  return { state: next, events };
}

/** 命令里字符串的长度上限：卡牌 id 最长 30 多个字符，买资源方案一边最多 7 份。 */
const MAX_ID_LENGTH = 64;
const MAX_TRADE_LENGTH = 16;

/**
 * 按白名单重建客户端发来的命令：只留已知字段，类型和长度对才要，不认识的返回 null（服务器回「命令格式不对」）。
 * 多余字段（比如塞进来的大字符串、冒充的 player）一律丢掉；值合不合规则仍由 apply 判断。
 * 服务器收到 game:command 先过它；applyCommand 记进动作序列的也是它的结果。
 */
export function normalizeCommand(raw: unknown): GameCommand | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.length <= max ? value : null);
  switch (input.type) {
    case "PLAY": {
      const cardId = text(input.card, MAX_ID_LENGTH);
      const action = input.action;
      if (cardId === null || (action !== "build" && action !== "wonder" && action !== "discard")) return null;
      let trade: { left: string; right: string } | undefined;
      if (input.trade !== undefined) {
        const raw = input.trade as Record<string, unknown> | null;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
        const left = text(raw.left, MAX_TRADE_LENGTH);
        const right = text(raw.right, MAX_TRADE_LENGTH);
        if (left === null || right === null) return null;
        trade = { left, right };
      }
      if (input.olympia !== undefined && typeof input.olympia !== "boolean") return null;
      return {
        type: "PLAY",
        card: cardId,
        action,
        ...(trade ? { trade } : {}),
        ...(input.olympia === true ? { olympia: true } : {}),
      };
    }
    case "UNDO":
      return { type: "UNDO" };
    case "CHOOSE_WONDER": {
      const key = text(input.wonder, 20);
      const side = text(input.side, 2);
      if (key === null || side === null) return null;
      return { type: "CHOOSE_WONDER", wonder: key as WonderKey, side: side as WonderSide };
    }
    case "DISCARD_BUILD": {
      if (input.card === null) return { type: "DISCARD_BUILD", card: null };
      const cardId = text(input.card, MAX_ID_LENGTH);
      return cardId === null ? null : { type: "DISCARD_BUILD", card: cardId };
    }
    default:
      return null;
  }
}

/** 服务端用：命令先按白名单重建，执行后记进动作序列（只记重建后的命令；同一种子重放这串动作就能复现整局）。 */
export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  const clean = normalizeCommand(command);
  if (!clean) throw new Error("命令格式不对。");
  const { state: next } = apply(state, playerId, clean);
  next.log = [...(state.log ?? []), { player: playerId, command: clean }];
  return next;
}

/**
 * 保底的自动行动（人机还没换成正式策略时，超时、托管都走它；人机阶段会换掉 botCommand，这里留作兜底）：
 * - 出牌 / 巴比伦第 7 张：能建就建总价最低的那张（同价取手里靠前的；奥林匹亚免费算在最后），都建不了就弃第一张换 3 金；
 * - 挑奇迹：还没人挑的第一块（按 WONDER_KEYS 顺序），A 面；
 * - 哈利卡纳苏斯：分数最高的蓝卡，没有蓝卡就弃牌堆里第一张能建的。
 * 不该他行动时返回 null。
 */
export function autoCommand(state: GameState, playerId: string): GameCommand | null {
  if (!pendingActors(state).includes(playerId)) return null;
  const index = playerIndex(state, playerId);
  const me = state.players[index]!;
  if (state.phase === "wonders") {
    const free = WONDER_KEYS.find((key) => !state.players.some((player) => player.wonder === key))!;
    return { type: "CHOOSE_WONDER", wonder: free, side: "A" };
  }
  if (state.phase === "discardBuild") {
    const options = discardBuildOptions(state, playerId);
    const vp = (id: CardId) => {
      const effect = card(id).effect;
      return effect.type === "vp" ? effect.n : 0;
    };
    const best = [...options].sort((a, b) => vp(b) - vp(a))[0];
    return { type: "DISCARD_BUILD", card: best ?? null };
  }
  if (me.hand.length === 0) return null;
  let best: { card: CardId; total: number; olympia: boolean; trade: { left: string; right: string } } | null = null;
  for (const id of me.hand) {
    const info = paymentOptions(state, playerId, { card: id });
    const option = info.options.find((candidate) => candidate.isDefault);
    if (!option) continue;
    const olympia = option.kind === "olympia";
    const rank = olympia ? Number.POSITIVE_INFINITY : option.total;
    if (!best || rank < (best.olympia ? Number.POSITIVE_INFINITY : best.total)) {
      best = { card: id, total: option.total, olympia, trade: { left: option.left, right: option.right } };
    }
  }
  if (best) {
    return best.olympia
      ? { type: "PLAY", card: best.card, action: "build", olympia: true }
      : { type: "PLAY", card: best.card, action: "build", trade: best.trade };
  }
  return { type: "PLAY", card: me.hand[0]!, action: "discard" };
}

/**
 * 超时（或者离线、托管）由服务器替某位玩家行动：command 是人机给的（botCommand），不给或者不合法就用 autoCommand。
 * 事件里多一条 TurnTimedOut（timedOut 为 false 时不加，比如离线代打），动作序列记成 timeout。
 */
export function applyTimeout(state: GameState, playerId: string, command?: GameCommand | null, timedOut = true): GameState {
  let result: { state: GameState; events: GameEvent[] } | null = null;
  let used: GameCommand | null = null;
  if (command) {
    try {
      result = apply(state, playerId, command);
      used = command;
    } catch {
      result = null;
    }
  }
  if (!result) {
    used = autoCommand(state, playerId);
    if (!used) return state;
    result = apply(state, playerId, used);
  }
  const next = result.state;
  if (timedOut) next.events = [{ type: "TurnTimedOut", player: playerId }, ...next.events];
  next.log = [...(state.log ?? []), { player: playerId, command: normalizeCommand(used) ?? used!, timeout: true }];
  return next;
}

/**
 * 某位玩家现在能发的所有命令（不含 UNDO）：每张手牌的弃牌、每种建造付款方案（明确写出 trade / olympia）、
 * 每种建奇迹付款方案；哈利卡纳苏斯每张能建的弃牌加放弃；挑奇迹每块剩下的奇迹 × A/B。不该他行动时是空数组。
 * 测试、陪玩脚本、人机用。
 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  if (!pendingActors(state).includes(playerId)) return [];
  const index = playerIndex(state, playerId);
  const me = state.players[index]!;
  if (state.phase === "wonders") {
    return WONDER_KEYS.filter((key) => !state.players.some((player) => player.wonder === key)).flatMap((key) =>
      (["A", "B"] as const).map((side): GameCommand => ({ type: "CHOOSE_WONDER", wonder: key, side })),
    );
  }
  if (state.phase === "discardBuild") {
    return [...discardBuildOptions(state, playerId).map((id): GameCommand => ({ type: "DISCARD_BUILD", card: id })), { type: "DISCARD_BUILD", card: null }];
  }
  const out: GameCommand[] = [];
  const stage = paymentOptions(state, playerId, { stage: true });
  for (const id of me.hand) {
    out.push({ type: "PLAY", card: id, action: "discard" });
    for (const option of paymentOptions(state, playerId, { card: id }).options) {
      out.push(
        option.kind === "olympia"
          ? { type: "PLAY", card: id, action: "build", olympia: true }
          : { type: "PLAY", card: id, action: "build", trade: { left: option.left, right: option.right } },
      );
    }
    for (const option of stage.options) {
      out.push({ type: "PLAY", card: id, action: "wonder", trade: { left: option.left, right: option.right } });
    }
  }
  return out;
}

export { createRng, freeBuildAvailable };
