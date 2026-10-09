/**
 * 七大奇迹人机（「普通」难度）。
 *
 * 输入必须是这个座位视角的状态（redactGameForViewer(game, playerId) 之后的），只用自己看得到的信息：
 * 自己的手牌、所有人公开的城（建筑、奇迹阶段数、金币、军事标记），哈利卡纳苏斯挑牌那一步才看得到弃牌堆。
 *
 * 思路（大白话）：
 * - 每轮把手里每张牌的三种用法（建造 / 垫奇迹 / 弃牌换 3 金）都估一个「折合分数」，挑最大的；
 * - 折合分数 = 这一手直接得的分（蓝卡、奇迹分、科技增量、军事输赢变化、金币）
 *   + 对以后的帮助（资源卡：以后的奇迹阶段和后面时代的牌要用、两邻又不卖的最值钱；免费链；贸易折扣）
 *   − 付的钱（付给邻居的钱等于送对手分，多扣一点）；
 * - 看一眼下家（这一轮把手牌交给谁）：拿走一张对下家特别值钱的牌（垫奇迹或弃掉）也算分；第 6 轮不用看；
 * - 付款在引擎给的方案里挑：先看总价，一样贵时少付给领先的邻居。
 * 每一步同时给一句玩家听得懂的理由（教程的「提示」按钮用）。
 */
import { ageCards, card, GUILDS, wonder as wonderDef, wonderStages } from "./cards.js";
import {
  canChain,
  countFor,
  hasBuiltName,
  hasDiscount,
  leftOf,
  playerIndex,
  productionSlots,
  rightOf,
  scienceCounts,
  shieldsOf,
} from "./city.js";
import { DISCARD_COINS, discardBuildOptions, pendingActors, ROUNDS_PER_AGE, VICTORY_POINTS } from "./engine.js";
import { scienceScore, scorePlayer } from "./score.js";
import { paymentOptions } from "./trade.js";
import {
  RESOURCE_NAMES,
  SCIENCE_NAMES,
  WONDER_KEYS,
  type Age,
  type CardDef,
  type CardId,
  type CountWhat,
  type GameCommand,
  type GameState,
  type PaymentOption,
  type PlayAction,
  type PlayerState,
  type Resource,
  type Scope,
  type ScienceSymbol,
  type StageEffect,
  type WonderKey,
  type WonderSide,
} from "./types.js";

// ---------------------------------------------------------------------------
// 可调参数（「调弱一点」时改这里，见交接报告）
// ---------------------------------------------------------------------------

export interface BotTuning {
  /** 下个时代每种牌作为「以后可能要建」的权重；再下个时代乘 farFactor。 */
  cardWeight: number;
  farFactor: number;
  /** 奇迹各阶段作为资源需求的权重（下一层、再下一层……）。 */
  stageWeights: number[];
  /** 缺一份资源而且两邻都不卖，折合几金的代价。 */
  missingPenalty: number;
  /** 凑一个目标的代价平滑封顶在「这个目标值的分 × 3 金 × capScale」。 */
  capScale: number;
  /** 付给邻居的每金额外扣多少分（送对手分）。 */
  neighborTax: number;
  /** 金币的流动性：手里钱少时每金额外值多少分（Age I/II），最多算到几金。 */
  liquidity: number;
  liquidityCap: number;
  /** 免费链：Age I / Age II 每能链出一张值几分（下标是时代）。 */
  chainBonus: number[];
  /** 科技：「以后还会拿到的绿卡」按任选符号算的比例，和各时代预计还能拿几张（下标是时代）。 */
  scienceFuture: number;
  scienceFutureCards: number[];
  /** 截牌：下家能拿到的最好那张的价值，按这个比例算进来（0 = 不截牌）。 */
  denial: number;
  /** 奇迹阶段晚点建也行（只要还有垫的牌），所以离结束还远时略打折扣。 */
  deferStage: number;
  /** 奥林匹亚 A 的免费建造留着的价值（本时代还有后面几轮时）。 */
  olympiaKeep: number;
}

/** 「普通」难度的参数。调弱时改这里（比如 denial 改 0、cardWeight 减半），模拟脚本 sim-wonders.ts 复测。 */
export const BOT_TUNING: BotTuning = {
  cardWeight: 0.3,
  farFactor: 0.6,
  stageWeights: [1.0, 0.75, 0.55, 0.45],
  missingPenalty: 6,
  capScale: 1,
  neighborTax: 0.17,
  liquidity: 0.25,
  liquidityCap: 4,
  chainBonus: [0, 1.0, 0.8],
  scienceFuture: 0.5,
  scienceFutureCards: [0, 3, 2, 1],
  denial: 0.35,
  deferStage: 0.8,
  olympiaKeep: 1.5,
};

let T: BotTuning = BOT_TUNING;

/** 现在用的参数（模拟脚本调参用）。 */
export function currentTuning(): BotTuning {
  return T;
}

/** 模拟脚本调参用：临时换一套参数跑 fn。 */
export function withTuning<R>(tuning: Partial<BotTuning>, fn: () => R): R {
  const saved = T;
  T = { ...saved, ...tuning };
  try {
    return fn();
  } finally {
    T = saved;
  }
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

/** 人机的一步：命令 + 一句理由（教程「提示」按钮直接显示 reason）。 */
export interface BotDecision {
  readonly command: GameCommand;
  readonly reason: string;
}

/**
 * 人机替 playerId 想一步。view 必须是 redactGameForViewer(game, playerId) 的结果。
 * 不该它行动时（不在 pendingActors 里，比如这一轮已经交了）返回 null。
 */
export function botDecision(view: GameState, playerId: string): BotDecision | null {
  if (!pendingActors(view).includes(playerId)) return null;
  const me = playerIndex(view, playerId);
  if (me < 0) return null;
  switch (view.phase) {
    case "wonders":
      return chooseWonder(view, me);
    case "discardBuild":
      return chooseDiscardBuild(view, me);
    case "play":
    case "seventh":
      return choosePlay(view, me);
    default:
      return null;
  }
}

/** 服务器、托管、超时用：只要命令。 */
export function botCommand(view: GameState, playerId: string): GameCommand | null {
  return botDecision(view, playerId)?.command ?? null;
}

/** 教程「提示」按钮用（和 botDecision 一样）：人机会怎么出、为什么。 */
export const botHint = botDecision;

// ---------------------------------------------------------------------------
// 资源模型：估「以后要建的东西」还得花多少钱买资源
// ---------------------------------------------------------------------------

const RES_INDEX: Record<string, number> = { W: 0, C: 1, S: 2, O: 3, G: 4, L: 5, P: 6 };
const RES_LETTERS = ["W", "C", "S", "O", "G", "L", "P"] as const;

function maskOf(opts: string): number {
  let mask = 0;
  for (const letter of opts) mask |= 1 << RES_INDEX[letter]!;
  return mask;
}

interface Seller {
  /** 每种资源的固定产出份数。 */
  readonly fixed: readonly number[];
  /** 多选一产出（位掩码）。 */
  readonly choices: readonly number[];
}

interface CityModel {
  readonly fixed: readonly number[];
  readonly choices: readonly number[];
  readonly left: Seller;
  readonly right: Seller;
  /** 从左 / 右邻买每种资源是不是 1 金（位掩码）。 */
  readonly discLeft: number;
  readonly discRight: number;
}

function sellerOf(player: PlayerState): Seller {
  const fixed = [0, 0, 0, 0, 0, 0, 0];
  const choices: number[] = [];
  for (const slot of productionSlots(player)) {
    if (!slot.sellable) continue;
    if (slot.opts.length === 1) fixed[RES_INDEX[slot.opts]!]! += 1;
    else choices.push(maskOf(slot.opts));
  }
  return { fixed, choices };
}

function discountMask(player: PlayerState, side: "left" | "right"): number {
  let mask = 0;
  for (const letter of RES_LETTERS) if (hasDiscount(player, side, letter)) mask |= 1 << RES_INDEX[letter]!;
  return mask;
}

function cityModel(view: GameState, index: number): CityModel {
  const player = view.players[index]!;
  const fixed = [0, 0, 0, 0, 0, 0, 0];
  const choices: number[] = [];
  for (const slot of productionSlots(player)) {
    if (slot.opts.length === 1) fixed[RES_INDEX[slot.opts]!]! += 1;
    else choices.push(maskOf(slot.opts));
  }
  return {
    fixed,
    choices,
    left: sellerOf(view.players[leftOf(view, index)]!),
    right: sellerOf(view.players[rightOf(view, index)]!),
    discLeft: discountMask(player, "left"),
    discRight: discountMask(player, "right"),
  };
}

interface Extra {
  readonly fixed?: string;
  readonly choice?: string;
  readonly discLeft?: string;
  readonly discRight?: string;
}

/** 加上一些产出 / 折扣之后的模型（估一张资源卡、贸易站、奇迹阶段的价值用）。 */
function withExtra(model: CityModel, extra: Extra): CityModel {
  const fixed = [...model.fixed];
  for (const letter of extra.fixed ?? "") fixed[RES_INDEX[letter]!]! += 1;
  const choices = extra.choice ? [...model.choices, maskOf(extra.choice)] : model.choices;
  return {
    ...model,
    fixed,
    choices,
    discLeft: model.discLeft | maskOf(extra.discLeft ?? ""),
    discRight: model.discRight | maskOf(extra.discRight ?? ""),
  };
}

/** 一份成本：每种资源要几份。 */
type CostVec = readonly number[];

function costVec(cost: string): number[] {
  const vec = [0, 0, 0, 0, 0, 0, 0];
  for (const letter of cost) vec[RES_INDEX[letter]!]! += 1;
  return vec;
}

/**
 * 凑这份成本还要花多少（折合金币，含「付给邻居等于送分」）：先用固定产出，再用多选一产出（二分图匹配），
 * 剩下的逐份向两邻买（便宜的一家；一样便宜先找右邻），两邻都不卖的按 missingPenalty 算。
 */
function shortfall(model: CityModel, need: CostVec): number {
  const units: number[] = [];
  for (let r = 0; r < 7; r += 1) {
    const rest = need[r]! - model.fixed[r]!;
    for (let k = 0; k < rest; k += 1) units.push(r);
  }
  if (units.length === 0) return 0;
  let missing = units;
  if (model.choices.length > 0) {
    const owner = new Array<number>(model.choices.length).fill(-1);
    const tryUnit = (u: number, seen: boolean[]): boolean => {
      const bit = 1 << units[u]!;
      for (let s = 0; s < model.choices.length; s += 1) {
        if (seen[s] || !(model.choices[s]! & bit)) continue;
        seen[s] = true;
        if (owner[s] === -1 || tryUnit(owner[s]!, seen)) {
          owner[s] = u;
          return true;
        }
      }
      return false;
    };
    for (let u = 0; u < units.length; u += 1) tryUnit(u, new Array<boolean>(model.choices.length).fill(false));
    const matched = new Set(owner.filter((u) => u >= 0));
    missing = units.filter((_, u) => !matched.has(u));
  }
  if (missing.length === 0) return 0;
  const leftFixed = [...model.left.fixed];
  const rightFixed = [...model.right.fixed];
  const leftUsed = new Array<boolean>(model.left.choices.length).fill(false);
  const rightUsed = new Array<boolean>(model.right.choices.length).fill(false);
  const take = (seller: Seller, fixed: number[], used: boolean[], r: number): boolean => {
    if (fixed[r]! > 0) {
      fixed[r]! -= 1;
      return true;
    }
    for (let s = 0; s < seller.choices.length; s += 1) {
      if (!used[s] && seller.choices[s]! & (1 << r)) {
        used[s] = true;
        return true;
      }
    }
    return false;
  };
  const tax = 1 + 3 * T.neighborTax;
  let coins = 0;
  for (const r of missing) {
    const priceLeft = model.discLeft & (1 << r) ? 1 : 2;
    const priceRight = model.discRight & (1 << r) ? 1 : 2;
    const leftFirst = priceLeft < priceRight;
    let bought = false;
    for (const side of leftFirst ? (["left", "right"] as const) : (["right", "left"] as const)) {
      const ok = side === "left" ? take(model.left, leftFixed, leftUsed, r) : take(model.right, rightFixed, rightUsed, r);
      if (ok) {
        coins += (side === "left" ? priceLeft : priceRight) * tax;
        bought = true;
        break;
      }
    }
    if (!bought) coins += T.missingPenalty;
  }
  return coins;
}

interface Target {
  readonly need: CostVec;
  readonly weight: number;
  /** 理由里怎么说这个目标（「你的奇迹第二层」或者卡名）。 */
  readonly label: string;
  readonly stage: boolean;
  readonly cost: string;
  /** 这个目标大概值几金（3 金 1 分）：凑资源的代价最多算到这么多，再贵就不建了。 */
  readonly cap: number;
}

/** 某个时代、某个人数用到的牌，每个名字一张（同名成本一样）；Age III 含全部行会。 */
const DISTINCT = new Map<string, CardDef[]>();
function distinctCards(age: Age, n: number): CardDef[] {
  const key = `${age}:${n}`;
  let list = DISTINCT.get(key);
  if (!list) {
    const seen = new Set<string>();
    list = [];
    const pool = age === 3 ? [...ageCards(age, n), ...GUILDS] : ageCards(age, n);
    for (const def of pool) {
      if (seen.has(def.name)) continue;
      seen.add(def.name);
      list.push(def);
    }
    DISTINCT.set(key, list);
  }
  return list;
}

/** 估目标值几分（只用来给「凑资源的代价」封顶）：蓝卡看分数，其余按 3 分；奇迹阶段看分数，能力按 4 分。 */
function roughCardValue(def: CardDef): number {
  if (def.effect.type === "vp") return def.effect.n;
  if (def.guild) return 4;
  return 3;
}

function roughStageValue(effects: readonly StageEffect[]): number {
  let value = 0;
  for (const effect of effects) {
    if (effect.type === "vp") value += effect.n;
    else if (effect.type === "coins") value += effect.n / 3;
    else value += 3;
  }
  return Math.max(3, value);
}

const STAGE_ORD = ["一", "二", "三", "四"];
const stageName = (k: number) => `第${STAGE_ORD[k] ?? k + 1}层`;

/** 这座城以后可能要凑资源的东西：奇迹剩下的阶段、本时代以后几轮和后面时代的牌。 */
function targetsFor(view: GameState, index: number, ctx: Ctx): Target[] {
  const player = view.players[index]!;
  const out: Target[] = [];
  if (ctx.playsAfter <= 0) return out;
  const stages = wonderStages(player.wonder!, player.side);
  for (let k = player.stages; k < stages.length; k += 1) {
    const order = k - player.stages;
    const time = Math.min(1, ctx.playsAfter / (2 + 2 * order));
    const weight = (T.stageWeights[order] ?? 0.4) * time;
    if (weight <= 0) continue;
    out.push({ need: costVec(stages[k]!.cost), weight, label: `你的奇迹${stageName(k)}`, stage: true, cost: stages[k]!.cost, cap: 3 * roughStageValue(stages[k]!.effects) * T.capScale });
  }
  const n = view.players.length;
  const addAge = (age: Age, weight: number) => {
    if (weight <= 0) return;
    for (const def of distinctCards(age, n)) {
      if (!def.cost) continue;
      if (hasBuiltName(player, def.name) || canChain(player, def.id)) continue;
      const w = def.guild ? weight * ((n + 2) / 10) : weight;
      out.push({ need: costVec(def.cost), weight: w, label: def.zh, stage: false, cost: def.cost, cap: 3 * roughCardValue(def) * T.capScale });
    }
  };
  addAge(view.age, T.cardWeight * (ctx.roundsAfter / 5));
  if (view.age < 3) addAge((view.age + 1) as Age, T.cardWeight);
  if (view.age < 2) addAge(3, T.cardWeight * T.farFactor);
  return out;
}

/** 目标总的「还要花多少」（折合分数，越大越差）和每个目标各自的数（找理由用）。 */
function burden(model: CityModel, targets: readonly Target[]): { total: number; each: number[] } {
  let total = 0;
  const each: number[] = [];
  for (const target of targets) {
    // 越贵越接近上限（再贵就不建了，损失的是这个目标本身的价值）
    const cost = (target.cap * (1 - Math.exp(-shortfall(model, target.need) / target.cap)) * target.weight) / 3;
    each.push(cost);
    total += cost;
  }
  return { total, each };
}

// ---------------------------------------------------------------------------
// 局面上下文
// ---------------------------------------------------------------------------

interface Ctx {
  readonly view: GameState;
  readonly me: number;
  readonly n: number;
  readonly age: Age;
  /** 这一手之后本时代还有几轮（第 7 张是 0）。 */
  readonly roundsAfter: number;
  /** 这一手之后整局还有几手。 */
  readonly playsAfter: number;
  /** 邻居在本时代还能出几手（同时出牌的这一轮也算）。 */
  readonly neighborPlaysLeft: number;
  /** 下家（这一轮手牌交给谁）；第 6 轮、第 7 张是 null。 */
  readonly down: number | null;
}

function makeCtx(view: GameState, me: number): Ctx {
  const n = view.players.length;
  const inPlay = view.phase === "play";
  const roundsAfter = inPlay ? ROUNDS_PER_AGE - view.round : 0;
  const playsAfter = roundsAfter + ROUNDS_PER_AGE * (3 - view.age);
  const down = inPlay && roundsAfter > 0 ? (view.direction === "left" ? leftOf(view, me) : rightOf(view, me)) : null;
  return { view, me, n, age: view.age, roundsAfter, playsAfter, neighborPlaysLeft: inPlay ? roundsAfter + 1 : 0, down };
}

/** 金币折合分数：每 3 金 1 分，手头钱少时多一点（要买资源）；整局最后一手只按终局的 3 金 1 分算。 */
function coinUtil(coins: number, ctx: Ctx): number {
  if (ctx.playsAfter <= 0) return Math.floor(coins / 3);
  const liquidity = ctx.age === 3 ? T.liquidity * 0.5 * Math.min(1, ctx.roundsAfter / 4) : T.liquidity;
  return coins / 3 + liquidity * Math.min(coins, T.liquidityCap);
}

// ---------------------------------------------------------------------------
// 军事
// ---------------------------------------------------------------------------

function outcome(margin: number, age: Age): number {
  return margin > 0 ? VICTORY_POINTS[age] : margin < 0 ? -1 : 0;
}

/** 和一个邻居比盾的期望：本时代结束那次算满（邻居还可能再出一张红卡），后面的时代按领先程度略算一点。 */
function militaryVs(mine: number, theirs: number, ctx: Ctx): number {
  const add = ctx.age;
  const q = Math.min(0.6, 0.15 * ctx.neighborPlaysLeft);
  const margin = mine - theirs;
  let value = (1 - q) * outcome(margin, ctx.age) + q * outcome(margin - add, ctx.age);
  for (let age = ctx.age + 1; age <= 3; age += 1) {
    const swing = (VICTORY_POINTS[age as Age] + 1) / 2;
    value += 0.3 * swing * Math.max(-1, Math.min(1, margin / (2 * age)));
  }
  return value;
}

function militaryGain(ctx: Ctx, index: number, shields: number): number {
  if (shields <= 0) return 0;
  const view = ctx.view;
  const mine = shieldsOf(view.players[index]!);
  let gain = 0;
  for (const other of [leftOf(view, index), rightOf(view, index)]) {
    const theirs = shieldsOf(view.players[other]!);
    gain += militaryVs(mine + shields, theirs, ctx) - militaryVs(mine, theirs, ctx);
  }
  return gain;
}

function militaryText(ctx: Ctx, index: number, shields: number): string {
  const view = ctx.view;
  const mine = shieldsOf(view.players[index]!);
  const parts: string[] = [];
  const word = (m: number) => (m > 0 ? "赢" : m < 0 ? "输" : "平");
  for (const [other, name] of [[leftOf(view, index), "左邻"], [rightOf(view, index), "右邻"]] as const) {
    const theirs = shieldsOf(view.players[other]!);
    const before = word(mine - theirs);
    const after = word(mine + shields - theirs);
    if (before !== after) parts.push(`对${name}从${before}变${after}`);
  }
  if (parts.length > 0) return `军事${parts.join("、")}`;
  const lead = Math.min(...[leftOf(view, index), rightOf(view, index)].map((other) => mine + shields - shieldsOf(view.players[other]!)));
  return lead > 0 ? `比两边邻居都多 ${lead} 盾以上，邻居不容易追上` : "军事别落后太多";
}

// ---------------------------------------------------------------------------
// 科技
// ---------------------------------------------------------------------------

type SciCounts = { compass: number; gear: number; tablet: number; wild: number };

/** 科技的折合分数：现在的分和「以后再拿几张绿卡（按任选算）」的分各占一部分。 */
function sciValue(counts: SciCounts, ctx: Ctx): number {
  const now = scienceScore(counts, counts.wild).score;
  const future = ctx.age === 3 ? Math.round(ctx.roundsAfter * 0.25) : (T.scienceFutureCards[ctx.age] ?? 0);
  if (future <= 0 || ctx.playsAfter <= 0) return now;
  const projected = scienceScore(counts, counts.wild + future).score;
  return (1 - T.scienceFuture) * now + T.scienceFuture * projected;
}

function addSymbol(counts: SciCounts, symbol: ScienceSymbol | "any"): SciCounts {
  const after = { ...counts };
  if (symbol === "any") after.wild += 1;
  else after[symbol] += 1;
  return after;
}

function scienceGain(ctx: Ctx, index: number, symbol: ScienceSymbol | "any"): { value: number; now: number } {
  const before = scienceCounts(ctx.view.players[index]!);
  const after = addSymbol(before, symbol);
  const now = scienceScore(after, after.wild).score - scienceScore(before, before.wild).score;
  return { value: sciValue(after, ctx) - sciValue(before, ctx), now };
}

function scienceWhy(ctx: Ctx, index: number, symbol: ScienceSymbol | "any", now: number): string {
  const before = scienceCounts(ctx.view.players[index]!);
  const after = addSymbol(before, symbol);
  const sets = (c: SciCounts) => {
    const best = scienceScore(c, c.wild).best;
    return Math.min(best.compass, best.gear, best.tablet);
  };
  if (sets(after) > sets(before)) return `凑齐圆规、齿轮、石板一套，科技分 +${now}`;
  if (symbol === "any") return `任选科技符号，科技分 +${now}`;
  const name = SCIENCE_NAMES[symbol];
  if (after[symbol] >= 2) return `第 ${after[symbol]} 个${name}，科技分 +${now}`;
  return `多一个${name}，科技分 +${now}，以后凑成套越攒越值钱`;
}

// ---------------------------------------------------------------------------
// 一张牌建进城里值多少
// ---------------------------------------------------------------------------

interface Valued {
  readonly value: number;
  /** 理由的主体（不含付款）。 */
  readonly why: string;
}

interface CityEval {
  readonly ctx: Ctx;
  readonly index: number;
  readonly model: CityModel;
  readonly targets: Target[];
  readonly base: { total: number; each: number[] };
}

function cityEval(ctx: Ctx, index: number): CityEval {
  const model = cityModel(ctx.view, index);
  const targets = targetsFor(ctx.view, index, ctx);
  return { ctx, index, model, targets, base: burden(model, targets) };
}

function resNames(res: string): string {
  return [...new Set(res)].map((letter) => RESOURCE_NAMES[letter as Resource]).join("、");
}

/** 多了一些产出 / 折扣以后，以后要花的钱少了多少（折合分数），以及最受益的那个目标。 */
function productionGain(ev: CityEval, extra: Extra): { value: number; best: Target | null } {
  if (ev.targets.length === 0) return { value: 0, best: null };
  const after = burden(withExtra(ev.model, extra), ev.targets);
  let best: Target | null = null;
  let bestScore = 0;
  ev.targets.forEach((target, k) => {
    const drop = ev.base.each[k]! - after.each[k]!;
    // 奇迹阶段最确定，理由优先说它；牌按受益多少
    const score = drop * (target.stage ? 2 : 1);
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = target;
    }
  });
  return { value: ev.base.total - after.total, best };
}

function sellsLetter(player: PlayerState, letter: string): boolean {
  return productionSlots(player).some((slot) => slot.sellable && slot.opts.includes(letter));
}

function productionWhy(ev: CityEval, res: string, best: Target | null): string {
  const view = ev.ctx.view;
  const left = view.players[leftOf(view, ev.index)]!;
  const right = view.players[rightOf(view, ev.index)]!;
  const letters = [...new Set(res)];
  const useful = best ? letters.filter((letter) => best.cost.includes(letter)) : letters;
  const shown = useful.length > 0 ? useful : letters;
  const nobody = shown.filter((letter) => !sellsLetter(left, letter) && !sellsLetter(right, letter));
  let what: string;
  if (best && best.stage) {
    const units = [...best.cost].filter((letter) => shown.includes(letter)).length;
    what = `${best.label}要 ${units} ${resNames(shown.join(""))}`;
  } else if (best) {
    what = `以后的${best.label}要${resNames(shown.join(""))}`;
  } else {
    what = `多产${resNames(res)}`;
  }
  if (nobody.length > 0) return `${what}，两边邻居都不产${resNames(nobody.join(""))}`;
  return `${what}，自己产就不用向邻居买`;
}

const SCOPE_NAMES: Record<Scope, string> = { left: "左邻", self: "自己", right: "右邻" };

/** perCount 建成那一刻数到几个（自己这张也算进去，比如灯塔数黄卡、船主数紫卡）。 */
function countAfter(ctx: Ctx, index: number, def: CardDef, what: readonly CountWhat[], scope: readonly Scope[]): number {
  let count = countFor(ctx.view, index, what, scope);
  if (scope.includes("self") && what.includes(def.color)) count += 1;
  return count;
}

/** 行会 / Age III 黄卡在本时代剩下几轮里还可能多数到几个。 */
function growth(ctx: Ctx, what: readonly CountWhat[], scope: readonly Scope[]): number {
  const p: Record<string, number> = { blue: 0.2, yellow: 0.12, red: 0.15, green: 0.15, purple: 0.1, brown: 0, gray: 0, stage: 0.15 };
  let total = 0;
  for (const where of scope) {
    for (const item of what) {
      if (item === "defeat") total += where === "self" ? 0 : 0.5;
      else total += (p[item] ?? 0) * ctx.roundsAfter;
    }
  }
  return total;
}

/** 建这张牌进 ev 那座城值多少（不算付款）。 */
function buildValue(ev: CityEval, id: CardId): Valued {
  const ctx = ev.ctx;
  const def = card(id);
  const effect = def.effect;
  const player = ctx.view.players[ev.index]!;
  let value = 0;
  let why = "";
  switch (effect.type) {
    case "produce": {
      const gain = productionGain(ev, { fixed: effect.res });
      value = gain.value;
      why = productionWhy(ev, effect.res, gain.best);
      break;
    }
    case "produceChoice": {
      const gain = productionGain(ev, { choice: effect.options });
      value = gain.value;
      why = productionWhy(ev, effect.options, gain.best) + (effect.sellable ? "" : "（邻居买不走）");
      break;
    }
    case "vp":
      value = effect.n;
      why = `直接 +${effect.n} 分`;
      break;
    case "shields":
      value = militaryGain(ctx, ev.index, effect.n);
      why = `+${effect.n} 盾，${militaryText(ctx, ev.index, effect.n)}`;
      break;
    case "science": {
      const gain = scienceGain(ctx, ev.index, effect.symbol);
      value = gain.value;
      why = scienceWhy(ctx, ev.index, effect.symbol, gain.now);
      break;
    }
    case "coins":
      value = coinUtil(player.coins + effect.n, ctx) - coinUtil(player.coins, ctx);
      why = `马上拿 ${effect.n} 金`;
      break;
    case "tradeDiscount": {
      const extra = { discLeft: effect.from.includes("left") ? effect.res : "", discRight: effect.from.includes("right") ? effect.res : "" };
      value = productionGain(ev, extra).value + (ctx.playsAfter > 0 ? 0.3 : 0);
      const sideText = effect.from.length === 2 ? "两边邻居" : effect.from[0] === "left" ? "左邻" : "右邻";
      why = `以后向${sideText}买${effect.res.length === 4 ? "原料" : "制成品"}只要 1 金`;
      break;
    }
    case "perCount": {
      const count = countAfter(ctx, ev.index, def, effect.what, effect.scope);
      const coinsNow = (effect.coinsNow ?? 0) * count;
      const coinValue = coinsNow > 0 ? coinUtil(player.coins + coinsNow, ctx) - coinUtil(player.coins, ctx) : 0;
      const vpNow = (effect.vpEnd ?? 0) * count;
      const vpLater = (effect.vpEnd ?? 0) * growth(ctx, effect.what, effect.scope) * 0.6;
      value = coinValue + vpNow + vpLater;
      const scopeText = effect.scope.map((where) => SCOPE_NAMES[where]).join("和");
      if (def.guild) why = `按${scopeText}现在的城算已经值 ${vpNow} 分`;
      else if (coinsNow > 0 && vpNow > 0) why = `马上拿 ${coinsNow} 金，终局还有 ${vpNow} 分`;
      else if (coinsNow > 0) why = `马上拿 ${coinsNow} 金`;
      else why = `终局 ${vpNow} 分`;
      break;
    }
  }
  // 免费链：以后还能免费链出的牌
  if (ctx.age < 3 && def.chainTo.length > 0) {
    const later = distinctCards((ctx.age + 1) as Age, ctx.n);
    const links = def.chainTo.filter((name) => later.some((entry) => entry.name === name) && !hasBuiltName(player, name));
    if (links.length > 0) {
      value += (T.chainBonus[ctx.age] ?? 0) * links.length;
      const zh = links.map((name) => later.find((entry) => entry.name === name)!.zh).join("、");
      why += `${why ? "；" : ""}以后能免费链出${zh}`;
    }
  }
  return { value, why };
}

// ---------------------------------------------------------------------------
// 奇迹阶段值多少
// ---------------------------------------------------------------------------

function stageEffectValue(ev: CityEval, effects: readonly StageEffect[]): Valued {
  const ctx = ev.ctx;
  const player = ctx.view.players[ev.index]!;
  let value = 0;
  const parts: string[] = [];
  const agesLeft = 3 - ctx.age;
  for (const effect of effects) {
    switch (effect.type) {
      case "vp":
        value += effect.n;
        parts.push(`+${effect.n} 分`);
        break;
      case "coins":
        value += coinUtil(player.coins + effect.n, ctx) - coinUtil(player.coins, ctx);
        parts.push(`+${effect.n} 金`);
        break;
      case "shields":
        value += militaryGain(ctx, ev.index, effect.n);
        parts.push(`+${effect.n} 盾`);
        break;
      case "produceChoice":
        value += productionGain(ev, { choice: effect.options }).value;
        parts.push(`每轮多产 1 份${resNames(effect.options)}`);
        break;
      case "produce":
        value += productionGain(ev, { fixed: effect.res }).value;
        parts.push(`多产${resNames(effect.res)}`);
        break;
      case "tradeDiscount":
        value += productionGain(ev, { discLeft: effect.res, discRight: effect.res }).value;
        parts.push("以后向两边买原料只要 1 金");
        break;
      case "science": {
        const gain = scienceGain(ctx, ev.index, effect.symbol);
        value += gain.value;
        parts.push(`任选科技符号（科技分 +${gain.now}）`);
        break;
      }
      case "playSeventhCard":
        value += 2.2 * (agesLeft + 1);
        parts.push("以后每个时代第 6 轮两张牌都能打");
        break;
      case "freeBuildOncePerAge":
        value += 3 * agesLeft + (ctx.roundsAfter >= 1 ? 2.5 : 0);
        parts.push("每个时代能免费建 1 张");
        break;
      case "buildFromDiscard": {
        const pile = ctx.view.discardCount;
        value += Math.min(6, 1 + 0.25 * pile) + (ctx.age - 1);
        parts.push(`这一轮结束从弃牌堆免费建 1 张（现在有 ${pile} 张）`);
        break;
      }
      case "copyGuild":
        value += ctx.age === 3 ? 4 : 3.5;
        parts.push("终局复制邻居 1 张行会");
        break;
      default:
        break;
    }
  }
  return { value, why: parts.join("、") };
}

// ---------------------------------------------------------------------------
// 付款
// ---------------------------------------------------------------------------

interface Boosts {
  readonly left: number;
  readonly right: number;
}

/** 一种付款方案折合几分（≤ 0）：自己少的钱 + 付给邻居的钱等于送对手分（领先的邻居多扣一点）。 */
function paymentValue(ctx: Ctx, option: PaymentOption, boosts: Boosts): number {
  if (option.kind === "olympia") return ctx.roundsAfter >= 1 ? -T.olympiaKeep : 0;
  const coins = ctx.view.players[ctx.me]!.coins;
  return (
    coinUtil(coins - option.total, ctx) -
    coinUtil(coins, ctx) -
    T.neighborTax * (option.leftCost * (1 + boosts.left) + option.rightCost * (1 + boosts.right))
  );
}

function bestPayment(ctx: Ctx, options: readonly PaymentOption[], boosts: Boosts): { option: PaymentOption; value: number } | null {
  let best: { option: PaymentOption; value: number } | null = null;
  for (const option of options) {
    const value = paymentValue(ctx, option, boosts);
    if (!best || value > best.value + 1e-9) best = { option, value };
  }
  return best;
}

function describe(res: string): string {
  const counts = new Map<string, number>();
  for (const letter of res) counts.set(letter, (counts.get(letter) ?? 0) + 1);
  return [...counts].map(([letter, count]) => `${count} ${RESOURCE_NAMES[letter as Resource]}`).join(" + ");
}

function paymentWhy(option: PaymentOption): string {
  if (option.kind === "chain") return "（免费链，不用付）";
  if (option.kind === "olympia") return "（用奥林匹亚的免费建造）";
  const parts: string[] = [];
  if (option.left) parts.push(`向左邻买 ${describe(option.left)} 付 ${option.leftCost} 金`);
  if (option.right) parts.push(`向右邻买 ${describe(option.right)} 付 ${option.rightCost} 金`);
  if (option.bankCost > 0) parts.push(`付银行 ${option.bankCost} 金`);
  return parts.length > 0 ? `（${parts.join("，")}）` : "";
}

/** 邻居是别人里分最高的、又比我高时，付钱给他多扣一点。 */
function leaderBoosts(ctx: Ctx): Boosts {
  const view = ctx.view;
  const totals = view.players.map((_, index) => scorePlayer(view, index).total);
  const top = Math.max(...totals.filter((_, index) => index !== ctx.me));
  const boost = (index: number) => (totals[index]! >= top && top > totals[ctx.me]! ? 0.5 : 0);
  return { left: boost(leftOf(view, ctx.me)), right: boost(rightOf(view, ctx.me)) };
}

// ---------------------------------------------------------------------------
// 下家能拿到什么（截牌）
// ---------------------------------------------------------------------------

/** 下家建这张牌大概值多少（建过同名的、凑不齐资源、钱不够的算 0）。 */
function valueForNeighbor(ev: CityEval, id: CardId): number {
  const player = ev.ctx.view.players[ev.index]!;
  const def = card(id);
  if (hasBuiltName(player, def.name)) return 0;
  let pay = 0;
  if (!canChain(player, id)) {
    const short = shortfall(ev.model, costVec(def.cost));
    if (short >= T.missingPenalty) return 0;
    const coinsNeeded = short / (1 + 3 * T.neighborTax) + def.coin;
    if (coinsNeeded > player.coins + 0.01) return 0;
    pay = (short + def.coin) / 3;
  }
  return Math.max(0, buildValue(ev, id).value - pay);
}

// ---------------------------------------------------------------------------
// 出牌（含巴比伦第 7 张）
// ---------------------------------------------------------------------------

interface Candidate {
  readonly card: CardId;
  readonly action: PlayAction;
  readonly payment: PaymentOption | null;
  readonly value: number;
  readonly why: string;
}

function choosePlay(view: GameState, me: number): BotDecision | null {
  const player = view.players[me]!;
  if (player.hand.length === 0 || !player.wonder) return null;
  const ctx = makeCtx(view, me);
  const ev = cityEval(ctx, me);
  const boosts = leaderBoosts(ctx);

  // 截牌：拿走某张以后，下家从剩下的牌里能拿到的最好那张值多少
  const denialOf = new Map<CardId, number>();
  let downValues: Map<CardId, number> | null = null;
  if (ctx.down !== null && T.denial > 0) {
    const downCtx: Ctx = { ...ctx, me: ctx.down };
    const downEv = cityEval(downCtx, ctx.down);
    downValues = new Map(player.hand.map((id) => [id, valueForNeighbor(downEv, id)]));
    for (const id of player.hand) {
      let best = 0;
      for (const other of player.hand) if (other !== id) best = Math.max(best, downValues.get(other)!);
      denialOf.set(id, -T.denial * best);
    }
  }

  // 奇迹下一层（垫哪张牌都一样）
  const stageInfo = paymentOptions(view, player.id, { stage: true });
  let stage: { value: number; why: string; option: PaymentOption } | null = null;
  if (stageInfo.options.length > 0) {
    const effects = wonderStages(player.wonder, player.side)[player.stages]!.effects;
    const effectValue = stageEffectValue(ev, effects);
    const pay = bestPayment(ctx, stageInfo.options, boosts)!;
    const defer = ctx.playsAfter >= 3 ? T.deferStage : ctx.playsAfter >= 1 ? T.deferStage / 2 : 0;
    stage = { value: effectValue.value - defer + pay.value, why: effectValue.why, option: pay.option };
  }

  const candidates: Candidate[] = [];
  const discardValue = coinUtil(player.coins + DISCARD_COINS, ctx) - coinUtil(player.coins, ctx);
  for (const id of player.hand) {
    const denial = denialOf.get(id) ?? 0;
    const info = paymentOptions(view, player.id, { card: id });
    if (info.options.length > 0) {
      const built = buildValue(ev, id);
      const pay = bestPayment(ctx, info.options, boosts)!;
      candidates.push({ card: id, action: "build", payment: pay.option, value: built.value + pay.value + denial, why: built.why });
    }
    if (stage) candidates.push({ card: id, action: "wonder", payment: stage.option, value: stage.value + denial, why: stage.why });
    candidates.push({ card: id, action: "discard", payment: null, value: discardValue + denial, why: "" });
  }
  let best = candidates[0]!;
  for (const candidate of candidates) if (candidate.value > best.value + 1e-9) best = candidate;

  const command: GameCommand =
    best.action === "discard"
      ? { type: "PLAY", card: best.card, action: "discard" }
      : best.payment!.kind === "olympia"
        ? { type: "PLAY", card: best.card, action: "build", olympia: true }
        : { type: "PLAY", card: best.card, action: best.action, trade: { left: best.payment!.left, right: best.payment!.right } };
  lastCandidates = candidates;
  return { command, reason: playReason(ctx, best, candidates, downValues) };
}

let lastCandidates: readonly Candidate[] = [];

/** 调试 / 调参用：出牌阶段每个（牌，用法）的折合分数，从高到低。 */
export function botExplain(view: GameState, playerId: string): { card: string; action: PlayAction; value: number; why: string }[] {
  lastCandidates = [];
  botDecision(view, playerId);
  return [...lastCandidates]
    .sort((a, b) => b.value - a.value)
    .map((candidate) => ({ card: card(candidate.card).zh, action: candidate.action, value: Math.round(candidate.value * 100) / 100, why: candidate.why }));
}

function playReason(ctx: Ctx, best: Candidate, candidates: readonly Candidate[], downValues: Map<CardId, number> | null): string {
  const view = ctx.view;
  const player = view.players[ctx.me]!;
  const zh = card(best.card).zh;
  // 拿走的这张对下家比他第二好的牌高出一截，才提截牌
  let denialNote = "";
  if (downValues && ctx.down !== null) {
    const taken = downValues.get(best.card) ?? 0;
    const others = [...downValues.entries()].filter(([id]) => id !== best.card).map(([, v]) => v);
    const second = others.length > 0 ? Math.max(...others) : 0;
    if (taken - second >= 2.5) denialNote = `；也不让下家${view.players[ctx.down]!.name}拿到它（对他值 ${Math.round(taken)} 分左右）`;
  }
  if (best.action === "build") {
    const tail = view.phase === "seventh" ? "（第 7 张）" : "";
    return `建${zh}${tail}：${best.why || "这一手最划算"}${paymentWhy(best.payment!)}${denialNote}。`;
  }
  if (best.action === "wonder") {
    const stageNo = stageName(player.stages);
    return `把${zh}垫到奇迹下面，建${stageNo}：${best.why}${paymentWhy(best.payment!)}${denialNote}。`;
  }
  const canBuild = candidates.some((candidate) => candidate.action !== "discard");
  let why: string;
  if (!canBuild) why = "手里的牌都建不了，先攒钱";
  else if (player.coins <= 1) why = "手头没钱了，先攒钱买资源";
  else if (ctx.playsAfter <= 0) why = "最后一手，换 3 金正好 1 分";
  else why = "手里这几张对你都不划算";
  return `弃${zh}换 3 金：${why}${denialNote}。`;
}

// ---------------------------------------------------------------------------
// 哈利卡纳苏斯：从弃牌堆挑一张免费建
// ---------------------------------------------------------------------------

function chooseDiscardBuild(view: GameState, me: number): BotDecision {
  const options = discardBuildOptions(view, view.players[me]!.id);
  if (options.length === 0) return { command: { type: "DISCARD_BUILD", card: null }, reason: "弃牌堆里没有能建的牌。" };
  // 这一步在本轮结算之后：本时代剩下的轮数按「下一轮还没打」算；不用截牌
  const ctx: Ctx = { ...makeCtx({ ...view, phase: "play" }, me), down: null };
  const ev = cityEval(ctx, me);
  let best: { id: CardId; value: Valued } | null = null;
  for (const id of options) {
    const value = buildValue(ev, id);
    if (!best || value.value > best.value.value + 1e-9) best = { id, value };
  }
  return {
    command: { type: "DISCARD_BUILD", card: best!.id },
    reason: `从弃牌堆免费建${card(best!.id).zh}：${best!.value.why || "弃牌堆里最划算的一张"}。`,
  };
}

// ---------------------------------------------------------------------------
// 自选奇迹：挑板和面
// ---------------------------------------------------------------------------

/**
 * 人机打各块板、各面的平均成绩比全场平均高几分（sim-wonders.ts 的 boards 自对弈测出来的），
 * 挑最高的；差不多时按座位错开一点，免得每局都一样。
 */
export const WONDER_RATING: Record<WonderKey, Record<WonderSide, number>> = {
  giza: { A: 0, B: 0 },
  rhodes: { A: 0, B: 0 },
  alexandria: { A: 0, B: 0 },
  ephesus: { A: 0, B: 0 },
  babylon: { A: 0, B: 0 },
  olympia: { A: 0, B: 0 },
  halicarnassus: { A: 0, B: 0 },
};

const WONDER_PITCH: Record<WonderKey, string> = {
  giza: "三层都是分，资源要求简单",
  rhodes: "起始产矿，盾多，军事好打",
  alexandria: "起始产玻璃，能自产原料",
  ephesus: "起始产纸，能一口气拿很多金币",
  babylon: "起始产砖，能拿任选科技符号",
  olympia: "起始产木，能免费建牌或者买原料打折",
  halicarnassus: "起始产布，能从弃牌堆免费建牌",
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 2 ** 32;
}

function chooseWonder(view: GameState, me: number): BotDecision {
  const taken = new Set(view.players.map((player) => player.wonder).filter((key): key is WonderKey => key !== null));
  const salt = `${view.players[me]!.id}:${view.players.length}:${view.chooser}`;
  let best: { wonder: WonderKey; side: WonderSide; score: number } | null = null;
  for (const wonder of WONDER_KEYS) {
    if (taken.has(wonder)) continue;
    for (const side of ["A", "B"] as const) {
      const score = WONDER_RATING[wonder][side] + 0.6 * hash(`${salt}:${wonder}:${side}`);
      if (!best || score > best.score) best = { wonder, side, score };
    }
  }
  const pick = best!;
  return {
    command: { type: "CHOOSE_WONDER", wonder: pick.wonder, side: pick.side },
    reason: `挑${wonderDef(pick.wonder).zh}（${pick.side} 面）：${WONDER_PITCH[pick.wonder]}。`,
  };
}
