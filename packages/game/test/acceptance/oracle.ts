/**
 * 规则核对（背靠背）用的独立规则模型：只依据规则书、补充文件 §2.4 / §2.5 的卡表和奇迹板 JSON（fixtures/），
 * 不读、不复用引擎的实现。用来和引擎的结果对照（计分、军事、价格、能不能买）。
 */
import cardsJson from "./fixtures/cards.json";
import wondersJson from "./fixtures/wonders.json";

export type Color = "brown" | "gray" | "blue" | "yellow" | "red" | "green" | "purple";
export interface FxEffect {
  type: string;
  res?: string;
  options?: string;
  sellable?: boolean;
  n?: number;
  symbol?: string;
  from?: string[];
  what?: string[];
  scope?: string[];
  coinsNow?: number;
  vpEnd?: number;
}
export interface FxCard {
  id: string;
  age: 1 | 2 | 3;
  color: Color;
  name: string;
  zh: string;
  cost: string;
  coin: number;
  chainFrom: string[];
  chainTo: string[];
  minPlayers: number | null;
  guild: boolean;
  effect: FxEffect;
}
export interface FxStage {
  cost: string;
  effects: FxEffect[];
}
export interface FxWonder {
  key: string;
  name: string;
  zh: string;
  start: string;
  sides: { A: FxStage[]; B: FxStage[] };
}

export const FX_CARDS: FxCard[] = cardsJson as unknown as FxCard[];
export const FX_WONDERS: FxWonder[] = wondersJson as unknown as FxWonder[];
const BY_ID = new Map(FX_CARDS.map((c) => [c.id, c]));

export function fx(id: string): FxCard {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`夹具里没有这张卡：${id}`);
  return c;
}
export function fxWonder(key: string): FxWonder {
  const w = FX_WONDERS.find((x) => x.key === key);
  if (!w) throw new Error(`夹具里没有这块奇迹：${key}`);
  return w;
}
export const sortRes = (s: string) => [...s].sort((a, b) => "WCSOGLP".indexOf(a) - "WCSOGLP".indexOf(b)).join("");

/** 和引擎 PlayerState 兼容的最小结构。 */
export interface City {
  wonder: string | null;
  side: "A" | "B";
  stages: number;
  built: readonly string[];
  coins: number;
  tokens: readonly { value: number; age?: number; vs?: string }[];
}

export const leftIdx = (i: number, n: number) => (i + 1) % n;
export const rightIdx = (i: number, n: number) => (i - 1 + n) % n;

export function builtStages(p: City): FxStage[] {
  if (!p.wonder) return [];
  return fxWonder(p.wonder).sides[p.side].slice(0, p.stages);
}
export function stageEffects(p: City): FxEffect[] {
  return builtStages(p).flatMap((s) => s.effects);
}

export function shields(p: City): number {
  let s = 0;
  for (const id of p.built) {
    const c = fx(id);
    if (c.effect.type === "shields") s += c.effect.n ?? 0;
  }
  for (const e of stageEffects(p)) if (e.type === "shields") s += e.n ?? 0;
  return s;
}

/** 邻居能买的产出：起始资源 + 棕 / 灰卡（每份一个槽，二选一卡是多字母槽）。 */
export function sellableSlots(p: City): string[] {
  const slots: string[] = [];
  if (p.wonder) slots.push(fxWonder(p.wonder).start);
  for (const id of p.built) {
    const c = fx(id);
    if (c.color !== "brown" && c.color !== "gray") continue;
    if (c.effect.type === "produce") for (const r of c.effect.res ?? "") slots.push(r);
    if (c.effect.type === "produceChoice") slots.push(c.effect.options ?? "");
  }
  return slots;
}
/** 自己能用的全部产出（加上商队旅馆、广场、亚历山大的阶段）。 */
export function ownSlots(p: City): string[] {
  const slots = sellableSlots(p);
  for (const id of p.built) {
    const c = fx(id);
    if (c.color === "yellow" && c.effect.type === "produceChoice") slots.push(c.effect.options ?? "");
  }
  for (const e of stageEffects(p)) if (e.type === "produceChoice") slots.push(e.options ?? "");
  return slots;
}

/** units 的每一份能不能各对上一个槽（二选一卡每回合只算一种）。 */
export function cover(units: string, slots: readonly string[]): boolean {
  const u = [...units];
  const used = new Array(slots.length).fill(false);
  const go = (k: number): boolean => {
    if (k === u.length) return true;
    for (let j = 0; j < slots.length; j++) {
      if (!used[j] && slots[j]!.includes(u[k]!)) {
        used[j] = true;
        if (go(k + 1)) return true;
        used[j] = false;
      }
    }
    return false;
  };
  return go(0);
}

/** 从 side 邻居买 res 是否 1 金（东 / 西贸易站、市场、奥林匹亚 B1）。 */
export function discount(p: City, side: "left" | "right", res: string): boolean {
  const effects: FxEffect[] = [...p.built.map((id) => fx(id).effect), ...stageEffects(p)];
  return effects.some((e) => e.type === "tradeDiscount" && (e.from ?? []).includes(side) && (e.res ?? "").includes(res));
}
export function price(p: City, side: "left" | "right", res: string): number {
  return discount(p, side, res) ? 1 : 2;
}

export function colorCount(p: City, color: string): number {
  return p.built.filter((id) => fx(id).color === color).length;
}

export function countFor(players: readonly City[], i: number, what: readonly string[], scope: readonly string[]): number {
  const n = players.length;
  let total = 0;
  for (const s of scope) {
    const j = s === "self" ? i : s === "left" ? leftIdx(i, n) : rightIdx(i, n);
    const p = players[j]!;
    for (const w of what) {
      if (w === "defeat") total += p.tokens.filter((t) => t.value < 0).length;
      else if (w === "stage") total += p.stages;
      else total += colorCount(p, w);
    }
  }
  return total;
}

/** 科技分：枚举任选符号的所有分法取最高。 */
export function science(c: number, g: number, t: number, wild: number): number {
  const base = (a: number, b: number, d: number) => a * a + b * b + d * d + 7 * Math.min(a, b, d);
  let best = 0;
  for (let x = 0; x <= wild; x++) for (let y = 0; x + y <= wild; y++) best = Math.max(best, base(c + x, g + y, t + (wild - x - y)));
  return best;
}

export interface OracleScore {
  military: number;
  coins: number;
  wonder: number;
  civilian: number;
  science: number;
  commerce: number;
  guilds: number;
  total: number;
}

function scienceAndGuilds(players: readonly City[], i: number, extraGuild: string | null) {
  const p = players[i]!;
  const sym = { compass: 0, gear: 0, tablet: 0 } as Record<string, number>;
  let wild = 0;
  for (const id of p.built) {
    const e = fx(id).effect;
    if (e.type === "science") {
      if (e.symbol === "any") wild++;
      else sym[e.symbol!]!++;
    }
  }
  for (const e of stageEffects(p)) if (e.type === "science" && e.symbol === "any") wild++;
  let guilds = 0;
  const guildCards = p.built.filter((id) => fx(id).color === "purple");
  if (extraGuild) guildCards.push(extraGuild);
  for (const id of guildCards) {
    const e = fx(id).effect;
    if (e.type === "science") {
      if (id === extraGuild) wild++;
      continue;
    }
    if (e.type === "perCount") guilds += countFor(players, i, e.what ?? [], e.scope ?? []) * (e.vpEnd ?? 0);
  }
  return { science: science(sym.compass!, sym.gear!, sym.tablet!, wild), guilds };
}

/** 一位玩家的七项分数（奥林匹亚 B3 在两邻已建的行会里取让总分最高的那张）。 */
export function oracleScore(players: readonly City[], i: number): OracleScore {
  const p = players[i]!;
  const n = players.length;
  const military = p.tokens.reduce((a, t) => a + t.value, 0);
  const coins = Math.floor(p.coins / 3);
  let wonder = 0;
  for (const e of stageEffects(p)) if (e.type === "vp") wonder += e.n ?? 0;
  let civilian = 0;
  let commerce = 0;
  for (const id of p.built) {
    const c = fx(id);
    if (c.color === "blue" && c.effect.type === "vp") civilian += c.effect.n ?? 0;
    if (c.color === "yellow" && c.effect.type === "perCount" && c.effect.vpEnd)
      commerce += countFor(players, i, c.effect.what ?? [], c.effect.scope ?? []) * c.effect.vpEnd;
  }
  let best = scienceAndGuilds(players, i, null);
  if (stageEffects(p).some((e) => e.type === "copyGuild")) {
    const cands = [...players[leftIdx(i, n)]!.built, ...players[rightIdx(i, n)]!.built].filter((id) => fx(id).color === "purple");
    for (const g of cands) {
      const r = scienceAndGuilds(players, i, g);
      if (r.science + r.guilds > best.science + best.guilds) best = r;
    }
  }
  const total = military + coins + wonder + civilian + best.science + commerce + best.guilds;
  return { military, coins, wonder, civilian, science: best.science, commerce, guilds: best.guilds, total };
}

/** 某个时代结束时的军事标记（按座位）：和左邻、右邻分别比。 */
export function militaryTokens(players: readonly City[], age: 1 | 2 | 3): { left: number; right: number }[] {
  const win = { 1: 1, 2: 3, 3: 5 }[age];
  const n = players.length;
  return players.map((p, i) => {
    const me = shields(p);
    const cmp = (j: number) => {
      const o = shields(players[j]!);
      return me > o ? win : me < o ? -1 : 0;
    };
    return { left: cmp(leftIdx(i, n)), right: cmp(rightIdx(i, n)) };
  });
}
