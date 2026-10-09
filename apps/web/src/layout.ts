/**
 * 牌桌尺寸计算。地形原图有 32px 和 16px 两套（16px 是 32px 缩小一半），格子只按原图的整数倍显示：
 * 32px 那套显示成 32 / 64 / 96 / 128，16px 那套显示成 48 / 80 / 112 这些中间尺寸。
 * 一个屏幕上所有格子用同一套原图；16px 那套细节少很多，只在能把自己的王国放大 1.5 倍以上时才用（手机）。
 *
 * 自己的王国显示一块 (边长 + 2)² 的格子：已经拼好的部分外加两圈能放的位置（一张骨牌最远伸出两格），
 * 所以 5×5 的王国用 7×7 的框、7×7 的用 9×9 的框，整局框的大小不变。
 *
 * 桌面版在几种摆法里挑：自己的王国最大优先，其次两排骨牌大，再次对手的王国大，最后能不能放下右边的侧栏。
 * - 三列：自己的王国 | 两排骨牌 | 对手（竖着一列）
 * - 两列：自己的王国 | 上面两排骨牌、下面对手（横着一排）
 * 自己的名牌和按钮可以在王国上下（stack），也可以在王国右边（beside，省高度）。
 */
import { useLayoutEffect, useRef, useState } from "react";

export interface Layout {
  readonly mobile: boolean;
  /** 原图：32 或 16。 */
  readonly art: 32 | 16;
  /** 自己王国的格子边长。 */
  readonly c: number;
  /** 两排骨牌里格子的边长。 */
  readonly rc: number;
  /** 对手王国的格子边长。 */
  readonly oc: number;
  /** 两排骨牌左右并排（否则上下叠）。 */
  readonly rowsSide: boolean;
  /** 自己的名牌和按钮在王国右边（否则在上下）。 */
  readonly mineBeside: boolean;
  /** 两列摆法：两排骨牌和对手叠在右边一栏，对手横着排。 */
  readonly twoCols: boolean;
  /** 右边显示状态、记录、聊天栏（否则收进抽屉）。 */
  readonly side: boolean;
}

/** 桌面版各部分固定的尺寸（和 kd.css 对应）。 */
const TABLE_PAD = 12;
const PAD = 12;
const GAP = 12;
const MINE_HEAD = 34;
const MINE_CTRL = 48;
const INFO_W = 180;
const INFO_MIN_H = 260;
const ROW_HEAD = 20;
const SLOT_GAP = 6;
const NUM_W = 32;
const OPP_HEAD = 24;
const OPP_MIN_W = 184;
export const SIDE_W = 300;

/** art 的整数倍，从大到小，在 [min, max] 之间。 */
const multiples = (art: number, max: number, min = 32) => {
  const list: number[] = [];
  for (let size = Math.floor(max / art) * art; size >= min; size -= art) list.push(size);
  return list;
};
/** 自己王国的格子：16px 那套只用 32 的倍数以外的尺寸（32 的倍数用 32px 原图更细）。 */
const mineSizes = (art: number, max: number) => multiples(art, max).filter((size) => art === 32 || size % 32 !== 0);

export const kingFor = (rc: number) => Math.max(32, Math.floor(rc / 32) * 32);

interface Box { w: number; h: number }

/** 一列骨牌（4 张竖着排）：标题 + 4 格（编号、骨牌、国王，每格上下左右 2px）。 */
const rowColumn = (rc: number): Box => ({
  w: NUM_W + 8 + 2 * rc + 8 + kingFor(rc) + 4 + 2 * PAD,
  h: ROW_HEAD + 6 + 4 * (rc + 4) + 3 * SLOT_GAP + 2 * 10,
});
const rowsBox = (rc: number, side: boolean): Box => {
  const column = rowColumn(rc);
  return side ? { w: 2 * column.w + GAP, h: column.h } : { w: column.w, h: 2 * column.h + GAP };
};
const oppBox = (size: number, oc: number): Box => ({ w: Math.max(size * oc + 2 * PAD, OPP_MIN_W), h: OPP_HEAD + 8 + size * oc + 2 * 10 });

interface Fit {
  c: number;
  rc: number;
  oc: number;
  rowsSide: boolean;
  mineBeside: boolean;
  twoCols: boolean;
}

/** 先比自己的王国，再比两排骨牌（挑牌要看清），再比对手的王国；都一样时名牌放右边的好（能显示操作说明）。 */
const better = (a: Fit, b: Fit | null) =>
  !b || a.c > b.c || (a.c === b.c && (a.rc > b.rc || (a.rc === b.rc && (a.oc > b.oc || (a.oc === b.oc && a.mineBeside && !b.mineBeside)))));

/** 在 w × h 的牌桌里，用 art 这套原图，找最好的摆法。 */
function fitTable(w: number, h: number, size: number, opponents: number, art: 32 | 16): Fit | null {
  const box = size + 2;
  for (const c of mineSizes(art, 160)) {
    const grid = box * c;
    const mines = [
      { beside: false, w: grid + 2 * PAD, h: MINE_HEAD + grid + MINE_CTRL + 20 + 2 * PAD },
      { beside: true, w: grid + 2 * PAD + GAP + INFO_W, h: Math.max(grid, INFO_MIN_H) + 2 * PAD },
    ].filter((mine) => mine.h <= h && mine.w <= w);
    let best: Fit | null = null;
    for (const mine of mines) {
      for (const rc of multiples(art, Math.min(c, 96))) {
        for (const rowsSide of [true, false]) {
          const rows = rowsBox(rc, rowsSide);
          if (rows.h > h) continue;
          const ocs = opponents > 0 ? multiples(art, 96, 16) : [0];
          for (const oc of ocs) {
            const opp = oppBox(size, oc);
            // 三列：对手竖着一列
            const vertical = { w: opp.w, h: opponents * opp.h + (opponents - 1) * GAP };
            const threeW = mine.w + GAP + rows.w + (opponents > 0 ? GAP + vertical.w : 0);
            if (threeW <= w && (opponents === 0 || vertical.h <= h)) {
              const fit = { c, rc, oc, rowsSide, mineBeside: mine.beside, twoCols: false };
              if (better(fit, best)) best = fit;
            }
            // 两列：两排骨牌在上，对手横着一排在下
            if (opponents > 0) {
              const horizontal = { w: opponents * opp.w + (opponents - 1) * GAP, h: opp.h };
              const twoW = mine.w + GAP + Math.max(rows.w, horizontal.w);
              const twoH = rows.h + GAP + horizontal.h;
              if (twoW <= w && twoH <= h) {
                const fit = { c, rc, oc, rowsSide, mineBeside: mine.beside, twoCols: true };
                if (better(fit, best)) best = fit;
              }
            }
          }
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** 两套原图里挑一个：16px 那套只在自己的王国能大 1.5 倍以上时才用。 */
function bestFit(w: number, h: number, size: number, opponents: number): (Fit & { art: 32 | 16 }) | null {
  const big = fitTable(w, h, size, opponents, 32);
  const small = fitTable(w, h, size, opponents, 16);
  if (small && (!big || small.c >= big.c * 1.5)) return { ...small, art: 16 };
  return big ? { ...big, art: 32 } : null;
}

export function pickLayout(width: number, height: number, size: number, opponents: number): Layout {
  if (width < 760) {
    // 手机：上下排。两排骨牌各一行（4 张横着），王国按宽度放到最大，对手的小王国放在下面
    const box = size + 2;
    const room = width - 2 * 8 - 2 * 8;
    const fit = (art: 32 | 16) => mineSizes(art, 160).find((c) => box * c <= room) ?? 0;
    const c32 = fit(32);
    const c16 = fit(16);
    const art: 32 | 16 = c16 >= c32 * 1.5 ? 16 : 32;
    const c = Math.max(art === 16 ? c16 : c32, 32);
    const rc = multiples(art, 64).find((size) => 4 * (2 * size + 4) + 16 <= room) ?? 32;
    return { mobile: true, art, c, rc, oc: art, rowsSide: false, mineBeside: false, twoCols: false, side: false };
  }
  const h = height - 2 * TABLE_PAD;
  // 先试带侧栏（状态、分数、记录、聊天一直看得见）；侧栏会让王国变小时，侧栏收进抽屉
  const withSide = width >= 1200 ? bestFit(width - SIDE_W - GAP - 2 * TABLE_PAD, h, size, opponents) : null;
  const without = bestFit(width - 2 * TABLE_PAD, h, size, opponents);
  const pick = withSide && (!without || !better(without, withSide)) ? { ...withSide, side: true } : without ? { ...without, side: false } : null;
  if (!pick) return { mobile: false, art: 32, c: 32, rc: 32, oc: 16, rowsSide: false, mineBeside: false, twoCols: false, side: false };
  return { mobile: false, art: pick.art, c: pick.c, rc: pick.rc, oc: pick.oc, rowsSide: pick.rowsSide, mineBeside: pick.mineBeside, twoCols: pick.twoCols, side: pick.side };
}

export function useLayout(size: number, opponents: number): [React.RefObject<HTMLDivElement | null>, Layout, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 1200, height: 720 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, pickLayout(box.width, box.height, size, opponents), box];
}
