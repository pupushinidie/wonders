import { CARDS, WONDERS } from "./data.js";
import type { Rng } from "./rng.js";
import {
  RESOURCES,
  type Age,
  type CardDef,
  type CardId,
  type Resource,
  type WonderDef,
  type WonderKey,
  type WonderSide,
  type WonderStageDef,
} from "./types.js";

export { CARDS, WONDERS };

const BY_ID = new Map<CardId, CardDef>(CARDS.map((card) => [card.id, card]));
const WONDER_BY_KEY = new Map<WonderKey, WonderDef>(WONDERS.map((wonder) => [wonder.key, wonder]));

/** 按 id 取卡；没有这张卡就抛错。 */
export function card(id: CardId): CardDef {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`没有这张牌：${id}`);
  return found;
}

export function isCardId(id: unknown): id is CardId {
  return typeof id === "string" && BY_ID.has(id);
}

export function wonder(key: WonderKey): WonderDef {
  const found = WONDER_BY_KEY.get(key);
  if (!found) throw new Error(`没有这块奇迹板：${key}`);
  return found;
}

/** 某块奇迹板某一面的阶段。 */
export function wonderStages(key: WonderKey, side: WonderSide): readonly WonderStageDef[] {
  return wonder(key).sides[side];
}

/** 资源串排成固定顺序（W C S O G L P），用来比较「买了什么」。 */
export function sortRes(res: string): string {
  return [...res].sort((a, b) => RESOURCES.indexOf(a as Resource) - RESOURCES.indexOf(b as Resource)).join("");
}

/** 资源串是否只含合法的资源字母。 */
export function isResString(value: unknown): value is string {
  return typeof value === "string" && [...value].every((letter) => (RESOURCES as readonly string[]).includes(letter));
}

/** 某个时代、某个人数要用的非行会卡（人数标记 ≤ 人数）。 */
export function ageCards(age: Age, playerCount: number): CardDef[] {
  return CARDS.filter((entry) => entry.age === age && !entry.guild && entry.minPlayers !== null && entry.minPlayers <= playerCount);
}

/** 10 张行会。 */
export const GUILDS: readonly CardDef[] = CARDS.filter((entry) => entry.guild);

/**
 * 洗好一个时代的牌堆（7 × 人数张）：按人数标记剔除；Age III 先随机留「人数 + 2」张行会混进去，
 * 没留下的行会不进状态、任何视角都看不到（规则书 §2.1，补充 E-T14）。
 */
export function buildAgeDeck(age: Age, playerCount: number, rng: Rng): CardId[] {
  const base = ageCards(age, playerCount).map((entry) => entry.id);
  const guilds = age === 3 ? rng.shuffle(GUILDS.map((entry) => entry.id)).slice(0, playerCount + 2) : [];
  const deck = rng.shuffle([...base, ...guilds]);
  if (deck.length !== 7 * playerCount) throw new Error(`Age ${age} 牌堆 ${deck.length} 张，不等于 7 × ${playerCount}`);
  return deck;
}

/**
 * 按名字或 id 找卡（预览局面、测试用）：先认 id；再认英文名或中文名（可以写「名字@时代」，比如 "Loom@2"），
 * 取 exclude 里没有的第一张。找不到就抛错。
 */
export function findCard(ref: string, exclude: ReadonlySet<CardId> = new Set()): CardId {
  if (BY_ID.has(ref)) {
    if (exclude.has(ref)) throw new Error(`这张牌已经用过了：${ref}`);
    return ref;
  }
  const [name, ageText] = ref.split("@");
  const age = ageText ? Number(ageText) : undefined;
  const lower = name!.trim().toLowerCase();
  const match = CARDS.find(
    (entry) =>
      (entry.name.toLowerCase() === lower || entry.zh === name!.trim()) &&
      (age === undefined || entry.age === age) &&
      !exclude.has(entry.id),
  );
  if (!match) throw new Error(`找不到还没用过的牌：${ref}`);
  return match.id;
}
