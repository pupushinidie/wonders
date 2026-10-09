/**
 * 预览局面工厂（对外接口）：界面的预览页、教程、验收（含背靠背的规则核对）都用它造局面，不用真打一局。
 *
 * - buildScene(spec)：按参数造任意一个精确局面（座位、奇迹和面、已建阶段、城里的卡、金币、军事标记、手牌、弃牌堆、
 *   阶段、谁已经交了牌……），造出来的是完整的服务端状态，可以直接接着 apply。
 * - playTo({ players, age, round, seed })：从开局用保底动作一路打到指定时代、指定轮的出牌阶段（真实对局）。
 * - scene(name, opts)：按名字造常见局面，名字和说明见 SCENES。
 * - previewRoom(game, opts)：把局面包成 LobbyRoomSnapshot（指定视角、谁离线 / 托管 / 是人机、倒计时），给预览页渲染整张牌桌。
 */
import { ageCards, card, CARDS, findCard, GUILDS, wonderStages } from "./cards.js";
import { apply, autoCommand, createGame, defaultConfig, passDirection, pendingActors, ROUNDS_PER_AGE } from "./engine.js";
import { createRng } from "./rng.js";
import { redactGameForViewer } from "./redact.js";
import type { LobbyMember, LobbyRoomSnapshot } from "./roomTypes.js";
import { finalScores } from "./score.js";
import {
  WONDER_KEYS,
  type Age,
  type CardColor,
  type CardId,
  type GameCommand,
  type GameEvent,
  type GameOptions,
  type GameState,
  type MilitaryToken,
  type PlayerState,
  type WonderKey,
  type WonderSide,
} from "./types.js";

/** 一位玩家的局面。牌可以写 id（"a2_library_3p"）、英文名（"Library"）、中文名（"图书馆"），同名多张用「名字@时代」区分（"Loom@2"）。 */
export interface ScenePlayerSpec {
  /** 默认 p1、p2……（按座位）。 */
  readonly id?: string;
  /** 默认 玩家1、玩家2……（座位 0 叫「我」）。 */
  readonly name?: string;
  readonly wonder: WonderKey;
  /** 默认 A。 */
  readonly side?: WonderSide;
  /** 已建的奇迹阶段数，默认 0。垫在下面的牌不写就自动从没用过的牌里挑。 */
  readonly stages?: number;
  readonly stageCards?: readonly string[];
  /** 已建成的建筑（同名不能两张）。 */
  readonly built?: readonly string[];
  /** 默认 3。 */
  readonly coins?: number;
  /** 军事标记：写数字（1 / 3 / 5 / −1，时代按数值推，方向左右交替）或者完整的 MilitaryToken。 */
  readonly tokens?: readonly (number | MilitaryToken)[];
  /** 手牌。出牌阶段不写就从这个时代、这个人数的牌堆里没用过的牌自动发（张数 = 8 − 轮数）。 */
  readonly hand?: readonly string[];
  /** 奥林匹亚 A 的免费建造这个时代已经用过。 */
  readonly freeBuildUsed?: boolean;
  /** 已经交了的牌（card 写手牌里的 id 或名字；按座位顺序依次 apply，所有人都交了会立刻结算）。 */
  readonly play?: GameCommand & { type: "PLAY" };
}

export interface SceneSpec {
  /** 3–7 位，按座位顺序（顺时针：座位 i 的左邻是 i + 1）。 */
  readonly players: readonly ScenePlayerSpec[];
  /** 默认 1。 */
  readonly age?: Age;
  /** 默认 1（1–6）。 */
  readonly round?: number;
  /**
   * 默认 play。seventh：巴比伦打第 7 张（pending 那位要有巴比伦 B 阶段 2、手里 1 张）；
   * discardBuild：哈利卡纳苏斯挑弃牌（弃牌堆要有能建的）；finished：终局（自动算分数）。
   */
  readonly phase?: "play" | "seventh" | "discardBuild" | "finished";
  /** seventh / discardBuild 在等谁（座位下标或 id）。 */
  readonly pending?: number | string;
  /** seventh 阶段：巴比伦打完第 7 张后哈利卡纳苏斯是否还要挑弃牌（座位下标或 id）。 */
  readonly discardBuildDue?: number | string;
  /** 弃牌堆。 */
  readonly discard?: readonly string[];
  readonly options?: Partial<GameOptions>;
  /** 随机数种子（后面的时代发牌用），默认 1。 */
  readonly seed?: number;
  /** 预先排好后面时代的手牌（教程用）：{ 2: [[7 张], [7 张], …] }。 */
  readonly stacked?: Partial<Record<Age, readonly (readonly string[])[]>>;
  /** 直接放进 state.events 的事件（预览动画用）。 */
  readonly events?: readonly GameEvent[];
}

function tokenOf(entry: number | MilitaryToken, position: number): MilitaryToken {
  if (typeof entry !== "number") return entry;
  const age: Age = entry === 5 ? 3 : entry === 3 ? 2 : 1;
  return { age, value: entry, vs: position % 2 === 0 ? "left" : "right" };
}

function seatIndex(state: GameState, ref: number | string | undefined): number {
  if (ref === undefined) return -1;
  if (typeof ref === "number") return ref;
  return state.players.findIndex((player) => player.id === ref);
}

/** 按参数造一个精确局面（完整的服务端状态，可以直接 apply）。牌不够、同名重复、手牌张数不对都会抛错。 */
export function buildScene(spec: SceneSpec): GameState {
  const n = spec.players.length;
  if (n < 3 || n > 7) throw new Error("需要 3–7 位玩家。");
  const age: Age = spec.age ?? 1;
  const round = spec.round ?? 1;
  if (round < 1 || round > ROUNDS_PER_AGE) throw new Error("轮数是 1–6。");
  const phase = spec.phase ?? "play";
  const used = new Set<CardId>();
  const take = (ref: string) => {
    const id = findCard(ref, used);
    used.add(id);
    return id;
  };
  const wonders = new Set<WonderKey>();
  const players: PlayerState[] = spec.players.map((entry, index) => {
    if (!(WONDER_KEYS as readonly string[]).includes(entry.wonder)) throw new Error(`没有这块奇迹板：${entry.wonder}`);
    if (wonders.has(entry.wonder)) throw new Error(`奇迹重复：${entry.wonder}`);
    wonders.add(entry.wonder);
    const side = entry.side ?? "A";
    const stages = entry.stages ?? 0;
    if (stages < 0 || stages > wonderStages(entry.wonder, side).length) throw new Error(`${entry.wonder} ${side} 面没有 ${stages} 个阶段。`);
    const built = (entry.built ?? []).map(take);
    const names = built.map((id) => card(id).name);
    if (new Set(names).size !== names.length) throw new Error(`座位 ${index} 建了同名的建筑。`);
    return {
      id: entry.id ?? `p${index + 1}`,
      name: entry.name ?? (index === 0 ? "我" : `玩家${index + 1}`),
      wonder: entry.wonder,
      side,
      stages,
      stageCards: (entry.stageCards ?? []).map(take),
      built,
      coins: entry.coins ?? 3,
      tokens: (entry.tokens ?? []).map(tokenOf),
      hand: [],
      handCount: 0,
      submitted: false,
      play: null,
      freeBuildUsed: entry.freeBuildUsed ?? false,
    };
  });
  // 手牌：写了的先占上
  spec.players.forEach((entry, index) => {
    if (entry.hand) players[index]!.hand = entry.hand.map(take);
  });
  const discard = (spec.discard ?? []).map(take);
  const stacked = spec.stacked
    ? (Object.fromEntries(Object.entries(spec.stacked).map(([key, hands]) => [key, hands!.map((hand) => hand.map(take))])) as Partial<Record<Age, CardId[][]>>)
    : undefined;
  // 没写的手牌：从这个时代、这个人数的牌里没用过的发
  const handSize = phase === "play" ? 8 - round : phase === "seventh" ? 1 : 0;
  const pool = [...ageCards(age, n).map((entry) => entry.id), ...(age === 3 ? GUILDS.map((entry) => entry.id) : [])].filter((id) => !used.has(id));
  spec.players.forEach((entry, index) => {
    if (entry.hand || phase !== "play") return;
    const hand = pool.splice(0, handSize);
    if (hand.length < handSize) throw new Error("牌不够自动发手牌了。");
    hand.forEach((id) => used.add(id));
    players[index]!.hand = hand;
  });
  if (phase === "play" && players.some((player) => player.hand.length !== handSize)) {
    throw new Error(`第 ${round} 轮每人手里应该是 ${handSize} 张。`);
  }
  // 垫奇迹的牌：没写的从没用过的牌里补
  const leftovers = CARDS.map((entry) => entry.id).filter((id) => !used.has(id));
  players.forEach((player) => {
    while (player.stageCards.length < player.stages) {
      const id = leftovers.shift();
      if (!id) throw new Error("牌不够垫奇迹了。");
      used.add(id);
      player.stageCards.push(id);
    }
    if (player.stageCards.length !== player.stages) throw new Error(`${player.id} 垫在奇迹下的牌数和已建阶段数不一样。`);
  });

  const config = defaultConfig(n, spec.options);
  const seed = spec.seed ?? 1;
  let state: GameState = {
    config,
    phase: phase === "finished" ? "finished" : phase,
    players,
    age,
    round,
    direction: passDirection(age),
    step: 1,
    pending: null,
    discardBuildDue: null,
    chooseOrder: [],
    chooser: 0,
    discard,
    discardCount: discard.length,
    lastReveal: [],
    events: [...(spec.events ?? [])],
    version: 0,
    seed,
    rngState: createRng(seed).state,
    log: [],
  };
  if (stacked) state.stacked = stacked;
  for (const player of state.players) player.handCount = player.hand.length;

  if (phase === "seventh" || phase === "discardBuild") {
    const pending = seatIndex(state, spec.pending);
    const who = state.players[pending];
    if (!who) throw new Error("seventh / discardBuild 要写 pending（在等谁）。");
    state.pending = { type: phase, player: who.id };
    if (phase === "seventh" && who.hand.length !== 1) throw new Error("巴比伦打第 7 张时手里应该正好 1 张。");
    const due = seatIndex(state, spec.discardBuildDue);
    if (phase === "seventh" && due >= 0) state.discardBuildDue = state.players[due]!.id;
  }
  if (phase === "finished") {
    state.finalResult = finalScores(state);
    state.events = [...state.events, { type: "GameEnded", result: state.finalResult }];
  }
  // 已经交了的牌
  spec.players.forEach((entry, index) => {
    if (!entry.play) return;
    if (state.phase !== "play") throw new Error("只有出牌阶段能预先交牌。");
    const hand = state.players[index]!.hand;
    const ref = entry.play.card;
    const [name, ageText] = ref.split("@");
    const cardId =
      hand.find((id) => id === ref) ??
      hand.find((id) => {
        const def = card(id);
        return (def.name.toLowerCase() === name!.toLowerCase() || def.zh === name) && (!ageText || def.age === Number(ageText));
      });
    if (!cardId) throw new Error(`${state.players[index]!.id} 手里没有 ${ref}，不能预先交。`);
    state = apply(state, state.players[index]!.id, { ...entry.play, card: cardId }).state;
  });
  return state;
}

/** 从开局用保底动作（autoCommand）一路打到指定时代、指定轮的出牌阶段。返回的状态里 events 是最后一步的事件。 */
export function playTo(opts: { players?: number; age?: Age; round?: number; seed?: number; options?: Partial<GameOptions> } = {}): GameState {
  const n = opts.players ?? 4;
  const age = opts.age ?? 1;
  const round = opts.round ?? 1;
  let state = createGame(
    Array.from({ length: n }, (_, index) => ({ id: `p${index + 1}`, name: index === 0 ? "我" : `玩家${index + 1}` })),
    opts.seed ?? 7,
    { ...opts.options, chooseWonders: false },
  );
  for (let guard = 0; guard < 2000; guard += 1) {
    if (state.phase === "play" && state.age === age && state.round === round) return state;
    if (state.phase === "finished") break;
    const actor = pendingActors(state)[0]!;
    state = apply(state, actor, autoCommand(state, actor)!).state;
  }
  throw new Error(`打不到 Age ${age} 第 ${round} 轮。`);
}

/** 按颜色配额从剩下的牌里挑（同名不重复），fullCities 用。 */
function fillCity(pool: CardId[], quotas: Partial<Record<CardColor, number>>, taken: Set<CardId>): CardId[] {
  const out: CardId[] = [];
  const names = new Set<string>();
  for (const [color, count] of Object.entries(quotas) as [CardColor, number][]) {
    let left = count;
    for (const id of pool) {
      if (left === 0) break;
      const def = card(id);
      if (taken.has(id) || def.color !== color || names.has(def.name)) continue;
      taken.add(id);
      names.add(def.name);
      out.push(id);
      left -= 1;
    }
  }
  return out;
}

/** 7 位玩家各自一块奇迹（座位 0 到 6 依次 giza … halicarnassus）。 */
const SEVEN: readonly WonderKey[] = WONDER_KEYS;

export interface SceneOptions {
  /** 人数（支持的场景里），默认 4。 */
  readonly players?: number;
  readonly age?: Age;
  readonly round?: number;
  readonly seed?: number;
  /** wonderStage：建第几阶段（1 起）；fullCities：哪一面。 */
  readonly stage?: number;
  readonly wonder?: WonderKey;
  readonly side?: WonderSide;
  /** tradeBoth：有没有折扣（西贸易站 + 市场）。 */
  readonly discount?: boolean;
}

/** 常见局面：名字 → 说明。座位 0（p1，「我」）是主角。 */
export const SCENES = {
  start: "开局：Age I 第 1 轮，谁都还没出牌（players 可选 3–7）",
  chooseWonders: "自选奇迹：前两位已经挑好，轮到第三位",
  midgame: "真实对局打到任意时代任意轮的出牌阶段（players / age / round / seed）",
  allActions: "出牌前：手里有能自己建的、能免费链的、要向两边买的、建不了但能垫奇迹的、同名建过的",
  submitted: "我已经交了牌（可以撤回），还有两位没交",
  lastRound: "Age I 第 6 轮：手里只剩 2 张，打 1 张、另 1 张作废",
  chain: "Age II：我建过写字间，手里的图书馆能免费链",
  tradeBoth: "要向左右两邻都买资源才建得起（discount: true 时有西贸易站 + 市场的折扣）",
  wonderStage: "我要建奇迹第 stage 阶段，资源够（wonder / side / stage 可选）",
  babylonSeventh: "巴比伦 B 打第 7 张：第 6 轮刚结算完，我手里剩 1 张，其他人等我",
  halicarnassus: "哈利卡纳苏斯挑弃牌：弃牌堆里有几张能建的，还有一张同名建过的",
  olympiaFree: "奥林匹亚 A 阶段 2 已建，这个时代的免费建造还没用，手里有贵的牌",
  militaryDone: "Age I 刚结束：军事结算的事件还在，Age II 第 1 轮刚发牌",
  final: "终局：七项都有分（军事、金币、奇迹、文明、科技、商业、行会），含奥林匹亚复制行会、巴比伦任选符号",
  finalTie: "终局并列：座位 0 和 2 总分、金币都一样，并列第一",
  fullCities: "7 人局 Age III 第 6 轮，每人奇迹建满、城里 15 张以上（side 可选 A / B），给界面测 7 人一屏",
} as const;
export type SceneName = keyof typeof SCENES;


/** 按名字造常见局面。 */
export function scene(name: SceneName, opts: SceneOptions = {}): GameState {
  switch (name) {
    case "start": {
      const n = opts.players ?? 4;
      return createGame(
        Array.from({ length: n }, (_, index) => ({ id: `p${index + 1}`, name: index === 0 ? "我" : `玩家${index + 1}` })),
        opts.seed ?? 7,
      );
    }
    case "chooseWonders": {
      const n = opts.players ?? 4;
      let state = createGame(
        Array.from({ length: n }, (_, index) => ({ id: `p${index + 1}`, name: index === 0 ? "我" : `玩家${index + 1}` })),
        opts.seed ?? 7,
        { chooseWonders: true },
      );
      for (const pick of [{ wonder: "giza", side: "A" }, { wonder: "rhodes", side: "B" }] as const) {
        const actor = pendingActors(state)[0]!;
        state = apply(state, actor, { type: "CHOOSE_WONDER", ...pick }).state;
      }
      return state;
    }
    case "midgame":
      return playTo({ players: opts.players ?? 7, age: opts.age ?? 2, round: opts.round ?? 3, seed: opts.seed ?? 7 });
    case "allActions":
      return buildScene({
        age: 2,
        round: 2,
        players: [
          {
            wonder: "giza",
            built: ["Scriptorium", "Lumber Yard", "Clay Pool", "Loom@1", "Stone Pit", "Glassworks@1"],
            coins: 5,
            // 神庙（1 木 + 1 砖 + 1 玻：自己都有）、图书馆（写字间免费链）、雕像（1 木 + 2 矿：左右邻居各买 1 矿，共 4 金）、
            // 城墙（3 石：自己只有 2 石，两邻都不卖石 → 建不了，但能垫奇迹第 1 阶段 2 石）、织布机 Age II（同名建过）、葡萄园（免费）
            hand: ["Temple", "Library", "Statue", "Walls", "Loom@2", "Vineyard"],
          },
          { wonder: "rhodes", built: ["Clay Pit@1"] },
          { wonder: "babylon", built: ["Timber Yard"] },
          { wonder: "ephesus", built: ["Ore Vein"] },
        ],
      });
    case "submitted": {
      const state = buildScene({
        players: [
          { wonder: "olympia", hand: ["Lumber Yard", "Stone Pit", "Altar", "Theater", "Baths", "Stockade", "Tavern"] },
          { wonder: "halicarnassus", play: { type: "PLAY", card: "Clay Pool", action: "build" }, hand: ["Clay Pool", "Ore Vein", "Loom", "Press", "Workshop", "Apothecary", "Barracks"] },
          { wonder: "alexandria" },
          { wonder: "ephesus" },
        ],
      });
      return apply(state, "p1", { type: "PLAY", card: state.players[0]!.hand[0]!, action: "build" }).state;
    }
    case "lastRound":
      return buildScene({
        round: 6,
        players: [
          { wonder: "giza", built: ["Lumber Yard", "Stone Pit", "Altar", "Stockade", "Press"], stages: 0, coins: 4, hand: ["Baths", "Workshop"] },
          { wonder: "rhodes", built: ["Clay Pool", "Ore Vein", "Barracks", "Theater", "Loom"] },
          { wonder: "babylon", built: ["Timber Yard", "Guard Tower", "Glassworks", "Apothecary"], coins: 2 },
        ],
      });
    case "chain":
      return buildScene({
        age: 2,
        round: 1,
        players: [
          { wonder: "alexandria", built: ["Scriptorium", "Altar", "Lumber Yard", "Stone Pit"], hand: ["Library", "Temple", "Sawmill", "Walls", "School", "Bazar", "Forum"] },
          { wonder: "giza", built: ["Clay Pool", "Ore Vein"] },
          { wonder: "olympia", built: ["Loom", "Timber Yard"] },
        ],
      });
    case "tradeBoth":
      return buildScene({
        age: 2,
        round: 1,
        players: [
          {
            wonder: "ephesus",
            coins: 6,
            built: opts.discount ? ["West Trading Post", "Marketplace", "Stone Pit"] : ["Stone Pit", "Altar"],
            // 法庭：2 砖 + 1 布；砖只有左邻有，布只有右邻有
            hand: ["Courthouse", "Sawmill", "Walls", "School", "Aqueduct", "Stables", "Bazar"],
          },
          { wonder: "babylon", built: ["Clay Pool"] },
          { wonder: "rhodes", built: ["Ore Vein"] },
          { wonder: "halicarnassus", built: ["Lumber Yard"] },
        ],
      });
    case "wonderStage": {
      const wonder = opts.wonder ?? "giza";
      const side = opts.side ?? "A";
      const stages = wonderStages(wonder, side);
      const stage = Math.min(Math.max(opts.stage ?? 1, 1), stages.length);
      // 自己产出这一阶段要的资源：用 Age I / II 的单产卡凑
      const need = stages[stage - 1]!.cost;
      const producers: Record<string, string[]> = {
        W: ["Lumber Yard", "Sawmill"],
        C: ["Clay Pool", "Brickyard"],
        S: ["Stone Pit", "Quarry"],
        O: ["Ore Vein", "Foundry"],
        G: ["Glassworks@1", "Glassworks@2"],
        L: ["Loom@1", "Loom@2"],
        P: ["Press@1", "Press@2"],
      };
      const built: string[] = [];
      for (const letter of new Set(need)) {
        const count = [...need].filter((entry) => entry === letter).length;
        built.push(...producers[letter]!.slice(0, count > 1 ? 2 : 1));
      }
      const others = WONDER_KEYS.filter((key) => key !== wonder).slice(0, 3);
      return buildScene({
        age: 2,
        round: 3,
        players: [
          { wonder, side, stages: stage - 1, built, coins: 8 },
          ...others.map((key) => ({ wonder: key })),
        ],
      });
    }
    case "babylonSeventh":
      return buildScene({
        age: 1,
        round: 6,
        phase: "seventh",
        pending: 0,
        players: [
          { wonder: "babylon", side: "B", stages: 2, built: ["Loom", "Lumber Yard", "Glassworks", "Clay Pool", "Press"], coins: 5, hand: ["Altar"] },
          { wonder: "giza", built: ["Stone Pit", "Ore Vein", "Theater", "Stockade"] },
          { wonder: "olympia", built: ["Timber Yard", "Baths", "Barracks", "Tavern"] },
        ],
        discard: ["Guard Tower", "Workshop"],
      });
    case "halicarnassus":
      return buildScene({
        age: 2,
        round: 3,
        phase: "discardBuild",
        pending: 0,
        players: [
          { wonder: "halicarnassus", stages: 2, built: ["Clay Pool", "Ore Vein", "Loom@1", "Altar", "Glassworks@1"], coins: 2, hand: [] },
          { wonder: "giza", built: ["Stone Pit", "Lumber Yard"], hand: [] },
          { wonder: "rhodes", built: ["Clay Pit", "Theater"], hand: [] },
          { wonder: "olympia", built: ["Timber Yard", "Press@1"], hand: [] },
        ],
        // 玻璃厂 Age II 和自己建过的同名，不能建；其余都能建
        discard: ["Tavern", "Workshop", "Glassworks@2", "Walls", "Temple", "Baths"],
      });
    case "olympiaFree":
      return buildScene({
        age: 3,
        round: 2,
        players: [
          {
            wonder: "olympia",
            stages: 2,
            built: ["Lumber Yard", "Stone Pit", "Quarry", "Altar", "Temple"],
            coins: 2,
            hand: ["Palace", "Pantheon", "Senate", "Fortifications", "Arsenal", "Lodge"],
          },
          { wonder: "giza" },
          { wonder: "babylon" },
          { wonder: "alexandria" },
        ],
      });
    case "militaryDone":
      return playTo({ players: opts.players ?? 4, age: 2, round: 1, seed: opts.seed ?? 7 });
    case "final":
      return buildScene({
        phase: "finished",
        age: 3,
        round: 6,
        players: [
          {
            wonder: "babylon",
            stages: 3,
            coins: 10,
            tokens: [1, 3, -1, 5, 5],
            built: [
              "Lumber Yard", "Clay Pool", "Loom@1", "Workshop", "Scriptorium", "Altar",
              "Laboratory", "Library", "Temple", "Caravansery", "Stables",
              "Observatory", "Lighthouse", "Palace", "Shipowners Guild",
            ],
          },
          {
            wonder: "olympia",
            side: "B",
            stages: 3,
            coins: 7,
            tokens: [-1, 3, 5],
            built: ["Ore Vein", "Stone Pit", "Glassworks@1", "Baths", "Barracks", "Aqueduct", "Walls", "Quarry", "Arena", "Fortifications", "Gardens", "Strategists Guild"],
          },
          {
            wonder: "rhodes",
            stages: 2,
            coins: 4,
            tokens: [1, -1, 3, -1, 5],
            built: ["Timber Yard", "Stockade", "Guard Tower", "Training Ground", "Archery Range", "Circus", "Arsenal", "Siege Workshop", "Spies Guild"],
          },
          {
            wonder: "giza",
            stages: 3,
            coins: 13,
            tokens: [-1, -1, -1],
            built: ["Clay Pit", "Press@1", "Tavern", "Marketplace", "Forum", "Vineyard", "Haven", "Chamber of Commerce", "Town Hall", "Senate", "Traders Guild"],
          },
        ],
      });
    case "finalTie":
      return buildScene({
        phase: "finished",
        age: 3,
        round: 6,
        players: [
          { wonder: "giza", stages: 1, coins: 6, tokens: [1, 3], built: ["Lumber Yard", "Altar", "Stockade", "Apothecary", "Temple", "Aqueduct"] },
          { wonder: "rhodes", stages: 0, coins: 2, built: ["Clay Pool", "Ore Vein"] },
          { wonder: "babylon", stages: 1, coins: 6, tokens: [1, 3], built: ["Lumber Yard", "Altar", "Stockade", "Apothecary", "Temple", "Aqueduct"] },
          { wonder: "ephesus", stages: 0, coins: 2, built: ["Stone Pit", "Press"] },
        ],
      });
    case "fullCities": {
      const side = opts.side ?? "A";
      const taken = new Set<CardId>();
      // 先发手牌：Age III 每人 2 张
      const age3 = [...ageCards(3, 7).map((entry) => entry.id), ...GUILDS.map((entry) => entry.id)];
      const hands = SEVEN.map(() => {
        const hand = age3.filter((id) => !taken.has(id)).slice(0, 2);
        hand.forEach((id) => taken.add(id));
        return hand;
      });
      const pool = CARDS.map((entry) => entry.id);
      const extra = (key: WonderKey) => (side === "B" && (key === "halicarnassus" || key === "babylon") ? 2 : 0);
      const cities = SEVEN.map((key) =>
        fillCity(pool, { brown: 3, gray: 2, blue: 3 + extra(key), yellow: 2, red: 2, green: 2 + extra(key) / 2, purple: 1 }, taken),
      );
      return buildScene({
        age: 3,
        round: 6,
        players: SEVEN.map((key, index) => ({
          wonder: key,
          side,
          stages: wonderStages(key, side).length,
          built: cities[index]!,
          coins: 4 + index,
          tokens: [1, 3, -1, 5].slice(0, 1 + (index % 4)),
          hand: hands[index]!,
        })),
      });
    }
    default:
      throw new Error(`没有这个场景：${String(name)}`);
  }
}

export interface PreviewRoomOptions {
  /** 从谁的视角看（座位 id），默认 p1；观战用 "" 并设 spectating。 */
  readonly viewer?: string;
  readonly spectating?: boolean;
  /** 这些座位离线 / 托管中 / 是人机。 */
  readonly offline?: readonly string[];
  readonly auto?: readonly string[];
  readonly bots?: readonly string[];
  /** 倒计时剩余毫秒（不给就没有倒计时）。 */
  readonly turnRemainingMs?: number;
  /** 加一条「某人超时，人机替他出了」的事件。 */
  readonly timedOut?: string;
}

/** 把局面包成房间快照（视角已经 redact 过），预览页直接当 room 传给牌桌。 */
export function previewRoom(game: GameState, opts: PreviewRoomOptions = {}): LobbyRoomSnapshot {
  const viewer = opts.spectating ? "" : (opts.viewer ?? game.players[0]!.id);
  const members: LobbyMember[] = game.players.map((player, index) => ({
    id: `socket-${player.id}`,
    playerId: player.id,
    name: player.name,
    isHost: index === 0,
    connected: !(opts.offline ?? []).includes(player.id),
    ...((opts.bots ?? []).includes(player.id) ? { bot: true } : {}),
    ...((opts.auto ?? []).includes(player.id) ? { auto: true } : {}),
  }));
  const view = redactGameForViewer(game, viewer);
  if (opts.timedOut) view.events = [{ type: "TurnTimedOut", player: opts.timedOut }, ...view.events];
  return {
    code: "WONDER",
    spectators: opts.spectating ? [{ id: "socket-spectator", name: "看客" }] : [],
    access: { allowSpectators: true, spectatorsSeeAll: false, open: false },
    capacity: game.players.length as LobbyRoomSnapshot["capacity"],
    options: { randomSides: game.config.randomSides, chooseWonders: game.config.chooseWonders },
    status: "playing",
    members,
    chat: [],
    voice: [],
    game: view,
    ...(opts.turnRemainingMs !== undefined ? { turnRemainingMs: opts.turnRemainingMs } : {}),
  };
}

