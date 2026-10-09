import type { Cell, Domino, Half, Kingdom, Placement, Pos, Region, ScoreBreakdown, Terrain } from "./types.js";

export const key = (r: number, c: number): string => `${r},${c}`;

export function parseKey(value: string): Pos {
  const [r, c] = value.split(",").map(Number);
  return { r: r!, c: c! };
}

/** 方向：右、下、左、上（超时自动放置同分时按这个顺序取第一个）。 */
export const DIRS: readonly Pos[] = [
  { r: 0, c: 1 },
  { r: 1, c: 0 },
  { r: 0, c: -1 },
  { r: -1, c: 0 },
];

export function castleKingdom(): Kingdom {
  return { [key(0, 0)]: { t: "castle", c: 0, d: 0 } };
}

export interface Bounds {
  minR: number;
  maxR: number;
  minC: number;
  maxC: number;
}

export function bounds(kingdom: Kingdom): Bounds {
  let minR = 0;
  let maxR = 0;
  let minC = 0;
  let maxC = 0;
  for (const k of Object.keys(kingdom)) {
    const { r, c } = parseKey(k);
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  return { minR, maxR, minC, maxC };
}

/** 这一端放在 p 时有没有「接上」：上下左右有城堡或同地形的格子。 */
function connects(kingdom: Kingdom, p: Pos, half: Half): boolean {
  for (const d of DIRS) {
    const cell = kingdom[key(p.r + d.r, p.c + d.c)];
    if (cell && (cell.t === "castle" || cell.t === half.t)) return true;
  }
  return false;
}

function adjacent(a: Pos, b: Pos): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

/** 放置合法返回 null，否则返回原因（给玩家看的中文）。 */
export function placementError(kingdom: Kingdom, dom: Domino, placement: Placement, size: number, box: Bounds = bounds(kingdom)): string | null {
  const { a, b } = placement;
  if (![a.r, a.c, b.r, b.c].every(Number.isInteger)) return "位置不对。";
  if (!adjacent(a, b)) return "骨牌的两格要上下或左右挨着。";
  if (kingdom[key(a.r, a.c)] || kingdom[key(b.r, b.c)]) return "这里已经有东西了。";
  if (!connects(kingdom, a, dom.a) && !connects(kingdom, b, dom.b)) {
    return "至少有一格要挨着城堡或同一种地形。";
  }
  const rows = Math.max(box.maxR, a.r, b.r) - Math.min(box.minR, a.r, b.r) + 1;
  const cols = Math.max(box.maxC, a.c, b.c) - Math.min(box.minC, a.c, b.c) + 1;
  if (rows > size || cols > size) return `王国不能超出 ${size}×${size}。`;
  return null;
}

/**
 * 所有合法放法。顺序：A 端行号、列号从小到大，再按方向 右→下→左→上（超时自动放置靠这个顺序打破同分）。
 */
export function legalPlacements(kingdom: Kingdom, dom: Domino, size: number): Placement[] {
  const box = bounds(kingdom);
  const result: Placement[] = [];
  for (let r = box.maxR - size; r <= box.minR + size; r += 1) {
    for (let c = box.maxC - size; c <= box.minC + size; c += 1) {
      if (kingdom[key(r, c)]) continue;
      for (const d of DIRS) {
        const placement = { a: { r, c }, b: { r: r + d.r, c: c + d.c } };
        if (placementError(kingdom, dom, placement, size, box) === null) result.push(placement);
      }
    }
  }
  return result;
}

export function hasLegalPlacement(kingdom: Kingdom, dom: Domino, size: number): boolean {
  return legalPlacements(kingdom, dom, size).length > 0;
}

/** 放进去以后的新王国（不改原来的）。 */
export function placeInto(kingdom: Kingdom, dom: Domino, placement: Placement): Kingdom {
  const cellA: Cell = { t: dom.a.t, c: dom.a.c, d: dom.n };
  const cellB: Cell = { t: dom.b.t, c: dom.b.c, d: dom.n };
  return { ...kingdom, [key(placement.a.r, placement.a.c)]: cellA, [key(placement.b.r, placement.b.c)]: cellB };
}

/** 同地形、上下左右连通的区域。城堡不属于任何区域，也不把两边连起来。 */
export function regions(kingdom: Kingdom): Region[] {
  const seen = new Set<string>();
  const result: Region[] = [];
  const keys = Object.keys(kingdom).sort((x, y) => {
    const p = parseKey(x);
    const q = parseKey(y);
    return p.r - q.r || p.c - q.c;
  });
  for (const start of keys) {
    const first = kingdom[start]!;
    if (first.t === "castle" || seen.has(start)) continue;
    const t = first.t as Terrain;
    const cells: Pos[] = [];
    let crowns = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const k = stack.pop()!;
      const p = parseKey(k);
      cells.push(p);
      crowns += kingdom[k]!.c;
      for (const d of DIRS) {
        const nk = key(p.r + d.r, p.c + d.c);
        if (!seen.has(nk) && kingdom[nk]?.t === t) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
    cells.sort((p, q) => p.r - q.r || p.c - q.c);
    result.push({ t, cells, crowns, points: cells.length * crowns });
  }
  return result;
}

/** 区域分（不含奖励）。 */
export function baseScore(kingdom: Kingdom): number {
  return regions(kingdom).reduce((sum, region) => sum + region.points, 0);
}

/** 城堡在不在中心：所有已放的格子离城堡的行差、列差都 ≤ (size − 1) / 2（没拼满也算）。 */
export function isCentered(kingdom: Kingdom, size: number): boolean {
  const half = (size - 1) / 2;
  const box = bounds(kingdom);
  return box.minR >= -half && box.maxR <= half && box.minC >= -half && box.maxC <= half;
}

export interface ScoreRules {
  readonly size: number;
  readonly middleKingdom: boolean;
  readonly harmony: boolean;
}

/** 一个王国的完整计分。 */
export function scoreKingdom(player: string, kingdom: Kingdom, discarded: number, rules: ScoreRules): ScoreBreakdown {
  const list = regions(kingdom);
  const base = list.reduce((sum, region) => sum + region.points, 0);
  const middle = rules.middleKingdom && isCentered(kingdom, rules.size) ? 10 : 0;
  const full = Object.keys(kingdom).length === rules.size * rules.size;
  const harmony = rules.harmony && full && discarded === 0 ? 5 : 0;
  return {
    player,
    regions: list,
    base,
    middle,
    harmony,
    total: base + middle + harmony,
    largest: list.reduce((max, region) => Math.max(max, region.cells.length), 0),
    crowns: list.reduce((sum, region) => sum + region.crowns, 0),
  };
}

/** 胜者：总分最高；平局比最大区域格数，再比皇冠总数，还平就并列。 */
export function rank(scores: readonly ScoreBreakdown[]): string[] {
  const better = (x: ScoreBreakdown, y: ScoreBreakdown) =>
    x.total !== y.total ? x.total - y.total : x.largest !== y.largest ? x.largest - y.largest : x.crowns - y.crowns;
  let best: ScoreBreakdown[] = [];
  for (const score of scores) {
    if (best.length === 0) best = [score];
    else {
      const diff = better(score, best[0]!);
      if (diff > 0) best = [score];
      else if (diff === 0) best.push(score);
    }
  }
  return best.map((score) => score.player);
}
