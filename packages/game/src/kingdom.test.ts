import { describe, expect, it } from "vitest";
import { DOMINOES, domino } from "./dominoes.js";
import { castleKingdom, key, legalPlacements, placeInto, placementError, rank, regions, scoreKingdom } from "./kingdom.js";
import { TERRAINS, type Kingdom, type ScoreBreakdown, type Terrain } from "./types.js";

/** 按行写王国：每格 "W"、"W1"、"C"（城堡）或 "."（空），行列从 top/left 开始编号。 */
function grid(rows: string[], top: number, left: number): Kingdom {
  const kingdom: Kingdom = {};
  rows.forEach((line, i) => {
    line.trim().split(/\s+/).forEach((code, j) => {
      if (code === ".") return;
      const k = key(top + i, left + j);
      if (code === "C") kingdom[k] = { t: "castle", c: 0, d: 0 };
      else kingdom[k] = { t: code[0] as Terrain, c: code.length > 1 ? Number(code.slice(1)) : 0, d: 99 };
    });
  });
  return kingdom;
}

/** 规则书例 1 的「王国 A」。 */
const KINGDOM_A = [
  "W  W1 W  F  F",
  "W  L  L1 F1 F",
  "G2 G  C  F  M2",
  "G  S  S  L  M",
  "S1 S  W  L  L",
];

const rules = { size: 5, middleKingdom: false, harmony: false };

describe("骨牌数据", () => {
  it("48 张，按地形的格数和皇冠数和规则书 2.1 的表一致", () => {
    expect(DOMINOES).toHaveLength(48);
    const cells: Record<Terrain, number[]> = { W: [0, 0, 0, 0], F: [0, 0, 0, 0], L: [0, 0, 0, 0], G: [0, 0, 0, 0], S: [0, 0, 0, 0], M: [0, 0, 0, 0] };
    for (const d of DOMINOES) for (const h of [d.a, d.b]) cells[h.t][h.c]! += 1;
    expect(cells).toEqual({
      W: [21, 5, 0, 0],
      F: [16, 6, 0, 0],
      L: [12, 6, 0, 0],
      G: [10, 2, 2, 0],
      S: [6, 2, 2, 0],
      M: [1, 1, 3, 1],
    });
    const crowns = DOMINOES.reduce((sum, d) => sum + d.a.c + d.b.c, 0);
    expect(crowns).toBe(39);
    expect(TERRAINS).toHaveLength(6);
    expect(domino(48)).toEqual({ n: 48, a: { t: "W", c: 0 }, b: { t: "M", c: 3 } });
  });
});

describe("放置规则", () => {
  it("TC1 城堡是万能格；斜着挨不算", () => {
    const k = castleKingdom();
    expect(placementError(k, domino(13), { a: { r: 0, c: 1 }, b: { r: 0, c: 2 } }, 5)).toBeNull();
    const placed = placeInto(k, domino(13), { a: { r: 0, c: 1 }, b: { r: 0, c: 2 } });
    expect(placed[key(0, 1)]).toMatchObject({ t: "W" });
    expect(placed[key(0, 2)]).toMatchObject({ t: "F" });
    expect(placementError(k, domino(13), { a: { r: 1, c: 1 }, b: { r: 1, c: 2 } }, 5)).not.toBeNull();
  });

  it("TC2 地形匹配", () => {
    const k = placeInto(castleKingdom(), domino(3), { a: { r: 0, c: 1 }, b: { r: 0, c: 2 } });
    expect(placementError(k, domino(7), { a: { r: 1, c: 1 }, b: { r: 1, c: 2 } }, 5)).not.toBeNull();
    expect(placementError(k, domino(17), { a: { r: 1, c: 1 }, b: { r: 1, c: 2 } }, 5)).toBeNull();
  });

  it("TC3 5×5 尺寸限制", () => {
    let k = placeInto(castleKingdom(), domino(1), { a: { r: 0, c: 1 }, b: { r: 0, c: 2 } });
    k = placeInto(k, domino(2), { a: { r: 0, c: 3 }, b: { r: 0, c: 4 } });
    expect(placementError(k, domino(13), { a: { r: 0, c: -1 }, b: { r: 1, c: -1 } }, 5)).toMatch("5×5");
    expect(placementError(k, domino(13), { a: { r: 1, c: 0 }, b: { r: 2, c: 0 } }, 5)).toBeNull();
  });

  it("两格要相邻、不能盖住已有的格子", () => {
    const k = castleKingdom();
    expect(placementError(k, domino(1), { a: { r: 0, c: 1 }, b: { r: 1, c: 2 } }, 5)).not.toBeNull();
    expect(placementError(k, domino(1), { a: { r: 0, c: 0 }, b: { r: 0, c: 1 } }, 5)).not.toBeNull();
  });

  it("TC5 被迫弃牌：只剩两格且接不上", () => {
    const k = grid(KINGDOM_A, -2, -2);
    delete k[key(2, 1)];
    delete k[key(2, 2)];
    expect(legalPlacements(k, domino(12), 5)).toEqual([]);
    expect(placementError(k, domino(12), { a: { r: 2, c: 1 }, b: { r: 2, c: 2 } }, 5)).not.toBeNull();
    expect(placementError(k, domino(46), { a: { r: 2, c: 1 }, b: { r: 2, c: 2 } }, 5)).toBeNull();
    const placed = placeInto(k, domino(46), { a: { r: 2, c: 1 }, b: { r: 2, c: 2 } });
    const mine = regions(placed).find((region) => region.t === "M")!;
    expect(mine.cells).toHaveLength(3);
    expect(mine.crowns).toBe(4);
    expect(mine.points).toBe(12);
  });

  it("只剩一个空格时什么都放不下", () => {
    const k = grid(KINGDOM_A, -2, -2);
    delete k[key(2, 2)];
    for (const d of DOMINOES) expect(legalPlacements(k, d, 5)).toEqual([]);
  });

  it("legalPlacements 的顺序：A 端行、列从小到大，再按 右→下→左→上", () => {
    const list = legalPlacements(castleKingdom(), domino(1), 5);
    expect(list.length).toBeGreaterThan(0);
    for (let i = 1; i < list.length; i += 1) {
      const p = list[i - 1]!.a;
      const q = list[i]!.a;
      expect(p.r < q.r || (p.r === q.r && p.c <= q.c)).toBe(true);
    }
    // 城堡四周 4 格 × 每格朝外的方向都合法
    expect(list.every((p) => placementError(castleKingdom(), domino(1), p, 5) === null)).toBe(true);
  });
});

describe("计分", () => {
  it("TC6 王国 A：25 分，最大区域 5，皇冠 8；中央 35；中央 + 和谐 40", () => {
    const k = grid(KINGDOM_A, -2, -2);
    const plain = scoreKingdom("p", k, 0, rules);
    expect(plain.total).toBe(25);
    expect(plain.largest).toBe(5);
    expect(plain.crowns).toBe(8);
    expect(scoreKingdom("p", k, 0, { ...rules, middleKingdom: true }).total).toBe(35);
    expect(scoreKingdom("p", k, 0, { size: 5, middleKingdom: true, harmony: true }).total).toBe(40);
    // 有弃牌就没有和谐
    expect(scoreKingdom("p", k, 1, { size: 5, middleKingdom: true, harmony: true }).total).toBe(35);
    // (2,0) 改成单独的森林：0 皇冠的区域不得分，总分不变
    const changed = { ...k, [key(2, 0)]: { t: "F" as const, c: 0, d: 99 } };
    expect(scoreKingdom("p", changed, 0, rules).total).toBe(25);
  });

  it("TC6 区域明细和规则书一致", () => {
    const list = regions(grid(KINGDOM_A, -2, -2));
    const summary = list.map((region) => `${region.t}${region.cells.length}x${region.crowns}`).sort();
    expect(summary).toEqual(["F5x1", "G3x2", "L2x1", "L3x0", "M2x2", "S4x1", "W1x0", "W4x1"].sort());
  });

  it("TC7 例 2：城堡隔开的区域，放一张把两片连起来", () => {
    const k = grid([". M3 M", "M2 C M"], -1, -1);
    expect(scoreKingdom("p", k, 0, rules).total).toBe(11);
    expect(placementError(k, domino(23), { a: { r: -2, c: -1 }, b: { r: -1, c: -1 } }, 5)).toBeNull();
    const placed = placeInto(k, domino(23), { a: { r: -2, c: -1 }, b: { r: -1, c: -1 } });
    expect(scoreKingdom("p", placed, 0, rules).total).toBe(26);
  });

  it("TC14 中央王国：没拼满也算；城堡不在中心不算", () => {
    const k = grid(KINGDOM_A, -2, -2);
    delete k[key(2, 1)];
    delete k[key(2, 2)];
    const s = scoreKingdom("p", k, 1, { size: 5, middleKingdom: true, harmony: true });
    expect(s.middle).toBe(10);
    expect(s.harmony).toBe(0);
    const shifted = grid(["C", "W", "W", "W", "W"], 0, 0);
    expect(scoreKingdom("p", shifted, 0, { size: 5, middleKingdom: true, harmony: false }).middle).toBe(0);
  });

  it("强力对决：中心 = 3 格以内，拼满 49 格才有和谐", () => {
    const k = grid(["W W W W W W C"], 0, -6);
    expect(scoreKingdom("p", k, 0, { size: 7, middleKingdom: true, harmony: true }).middle).toBe(0);
    const centered = grid(["W W W C W W W"], 0, -3);
    const s = scoreKingdom("p", centered, 0, { size: 7, middleKingdom: true, harmony: true });
    expect(s.middle).toBe(10);
    expect(s.harmony).toBe(0);
  });
});

describe("TC15 平局判定", () => {
  const s = (player: string, total: number, largest: number, crowns: number): ScoreBreakdown => ({
    player,
    regions: [],
    base: total,
    middle: 0,
    harmony: 0,
    total,
    largest,
    crowns,
  });
  it("比最大区域、再比皇冠、还平就并列", () => {
    expect(rank([s("P1", 25, 5, 8), s("P2", 25, 6, 7)])).toEqual(["P2"]);
    expect(rank([s("P1", 25, 5, 8), s("P2", 25, 5, 9)])).toEqual(["P2"]);
    expect(rank([s("P1", 25, 5, 8), s("P2", 25, 5, 8)])).toEqual(["P1", "P2"]);
    expect(rank([s("P1", 30, 1, 1), s("P2", 25, 9, 9)])).toEqual(["P1"]);
  });
  it("最大区域把 0 皇冠的区域也算进去", () => {
    const k = grid(["W W W W W", "W W C F1 F"], -1, -2);
    expect(scoreKingdom("p", k, 0, rules).largest).toBe(7);
  });
});
