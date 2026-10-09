import type { Domino, Half, Terrain } from "./types.js";

/**
 * 48 张骨牌，按规则书 2.2 的表。记法「地形 + 皇冠数」，例如 M3 = 3 个皇冠的矿山。
 * 规则书和两份公开数据逐张核对过（见规则书第 12 节）。
 */
const RAW: readonly [string, string][] = [
  ["W", "W"], ["W", "W"], ["F", "F"], ["F", "F"], ["F", "F"], ["F", "F"], ["L", "L"], ["L", "L"],
  ["L", "L"], ["G", "G"], ["G", "G"], ["S", "S"], ["W", "F"], ["W", "L"], ["W", "G"], ["W", "S"],
  ["F", "L"], ["F", "G"], ["W1", "F"], ["W1", "L"], ["W1", "G"], ["W1", "S"], ["W1", "M"], ["F1", "W"],
  ["F1", "W"], ["F1", "W"], ["F1", "W"], ["F1", "L"], ["F1", "G"], ["L1", "W"], ["L1", "W"], ["L1", "F"],
  ["L1", "F"], ["L1", "F"], ["L1", "F"], ["W", "G1"], ["L", "G1"], ["W", "S1"], ["G", "S1"], ["M1", "W"],
  ["W", "G2"], ["L", "G2"], ["W", "S2"], ["G", "S2"], ["M2", "W"], ["S", "M2"], ["S", "M2"], ["W", "M3"],
];

function half(code: string): Half {
  return { t: code[0] as Terrain, c: code.length > 1 ? Number(code.slice(1)) : 0 };
}

export const DOMINOES: readonly Domino[] = RAW.map(([a, b], index) => ({ n: index + 1, a: half(a), b: half(b) }));

export function domino(n: number): Domino {
  const found = DOMINOES[n - 1];
  if (!found) throw new Error(`没有 ${n} 号骨牌。`);
  return found;
}
