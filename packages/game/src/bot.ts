import { domino } from "./dominoes.js";
import { pickRow, selectableSlots } from "./engine.js";
import { baseScore, bounds, DIRS, key, legalPlacements, placeInto } from "./kingdom.js";
import type { Config, Domino, GameCommand, GameState, Kingdom, Placement } from "./types.js";

/**
 * 人机（「普通」难度）：一步贪心 + 几条形状上的经验，只看公开信息（吃 redactGameForViewer 之后的状态）。
 *
 * 放置：每种合法放法估一个值 = 放下后的区域分 + 形状分，取最高的。形状分：
 * - 死格：王国框里再也填不上的空格（四周没有能一起放骨牌的空格），每个扣分；
 * - 有皇冠的区域旁边还留着空位，加一点（以后还能往里接）；
 * - 开了中央王国：王国偏出中心扣分。
 * 选牌：每张可选骨牌按「能放出的最好值 − 现在的值」估，再加上越靠前（下一轮越早行动）越好的一点分。
 */

const DEAD_CELL = 1.6;
const GROWTH = 0.12;
const OFF_CENTER = 4;
const ORDER = 0.35;
const NO_ROOM = -6;

/** 王国最后会落在哪些格子里：每个方向还能扩展多少。 */
function frame(kingdom: Kingdom, size: number) {
  const box = bounds(kingdom);
  return {
    minR: box.maxR - size + 1,
    maxR: box.minR + size - 1,
    minC: box.maxC - size + 1,
    maxC: box.minC + size - 1,
    box,
  };
}

function shapeValue(kingdom: Kingdom, config: Config): number {
  const f = frame(kingdom, config.size);
  const free = (r: number, c: number) => r >= f.minR && r <= f.maxR && c >= f.minC && c <= f.maxC && !kingdom[key(r, c)];
  let value = 0;
  // 死格：现有边框里、四周都没有空邻居的空格
  for (let r = f.box.minR; r <= f.box.maxR; r += 1) {
    for (let c = f.box.minC; c <= f.box.maxC; c += 1) {
      if (!free(r, c)) continue;
      if (!DIRS.some((d) => free(r + d.r, c + d.c))) value -= DEAD_CELL;
    }
  }
  // 有皇冠的格子旁边的空位：区域还能长
  const counted = new Set<string>();
  for (const [k, cell] of Object.entries(kingdom)) {
    if (cell.t === "castle") continue;
    const [r, c] = k.split(",").map(Number) as [number, number];
    const crowns = regionCrowns(kingdom, r, c);
    if (crowns === 0) continue;
    for (const d of DIRS) {
      const nk = key(r + d.r, c + d.c);
      if (!counted.has(`${cell.t}:${nk}`) && free(r + d.r, c + d.c)) {
        counted.add(`${cell.t}:${nk}`);
        value += GROWTH * crowns;
      }
    }
  }
  if (config.middleKingdom) {
    const half = (config.size - 1) / 2;
    const { box } = f;
    if (box.minR < -half || box.maxR > half || box.minC < -half || box.maxC > half) value -= OFF_CENTER;
  }
  return value;
}

const crownCache = new WeakMap<Kingdom, Map<string, number>>();

/** (r, c) 所在区域的皇冠数（同一个王国里缓存）。 */
function regionCrowns(kingdom: Kingdom, r: number, c: number): number {
  let cache = crownCache.get(kingdom);
  if (!cache) {
    cache = new Map();
    crownCache.set(kingdom, cache);
  }
  const start = key(r, c);
  const hit = cache.get(start);
  if (hit !== undefined) return hit;
  const t = kingdom[start]!.t;
  const seen = new Set([start]);
  const stack = [start];
  let crowns = 0;
  while (stack.length > 0) {
    const k = stack.pop()!;
    crowns += kingdom[k]!.c;
    const [y, x] = k.split(",").map(Number) as [number, number];
    for (const d of DIRS) {
      const nk = key(y + d.r, x + d.c);
      if (!seen.has(nk) && kingdom[nk]?.t === t) {
        seen.add(nk);
        stack.push(nk);
      }
    }
  }
  for (const k of seen) cache.set(k, crowns);
  return crowns;
}

export function evaluate(kingdom: Kingdom, config: Config): number {
  return baseScore(kingdom) + shapeValue(kingdom, config);
}

/** 这张骨牌的最好放法和放下后的估值；放不下返回 null。 */
export function bestPlacement(kingdom: Kingdom, dom: Domino, config: Config): { placement: Placement; value: number } | null {
  let best: { placement: Placement; value: number } | null = null;
  for (const placement of legalPlacements(kingdom, dom, config.size)) {
    const value = evaluate(placeInto(kingdom, dom, placement), config);
    if (!best || value > best.value) best = { placement, value };
  }
  return best;
}

export function botCommand(state: GameState, playerId: string): GameCommand | null {
  if (state.phase === "finished") return null;
  const me = state.players.findIndex((player) => player.id === playerId);
  if (me < 0 || state.currentPlayer !== me) return null;
  const player = state.players[me]!;
  const { config } = state;

  if (state.step === "place") {
    const slot = state.current[state.active]!;
    const best = bestPlacement(player.kingdom, domino(slot.n), config);
    return best ? { type: "PLACE", a: best.placement.a, b: best.placement.b } : { type: "DISCARD" };
  }

  const row = pickRow(state);
  const options = selectableSlots(state);
  if (options.length === 0) return null;
  // 2 人局还有一个没放的国王时，它的骨牌也会先进王国：按它的最好放法先放进去再估
  let kingdom = player.kingdom;
  if (state.phase === "playing") {
    for (let index = state.active + 1; index < state.current.length; index += 1) {
      const slot = state.current[index]!;
      if (slot.king?.player !== me || slot.resolved) continue;
      const best = bestPlacement(kingdom, domino(slot.n), config);
      if (best) kingdom = placeInto(kingdom, domino(slot.n), best.placement);
    }
  }
  const now = evaluate(kingdom, config);
  const lastPicks = state.deckCount === 0 || (state.deckCount === undefined && state.deck.length === 0);
  let bestSlot = options[0]!;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const index of options) {
    const dom = domino(row[index]!.n);
    const best = bestPlacement(kingdom, dom, config);
    // 越靠前的骨牌下一轮越早行动；牌堆空了以后下一轮只放不选，顺序就无所谓了
    const order = lastPicks ? 0 : ORDER * (row.length - 1 - index);
    const value = (best ? best.value - now : NO_ROOM) + order;
    if (value > bestValue) {
      bestValue = value;
      bestSlot = index;
    }
  }
  return { type: "PICK", slot: bestSlot };
}
