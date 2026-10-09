/**
 * 牌桌尺寸：按浏览器可视区域（innerWidth × innerHeight）算，所有像素图都按原图的整数倍显示。
 *
 * 桌面（宽 ≥ 720）：
 *   顶栏 │ 其他玩家小卡一排（3 人局没有）│ 左邻面板 │ 中栏（自己的奇迹板 + 状态 / 出牌面板，下面 7 列城池）│ 右邻面板 │ 手牌一排（+ 出牌面板）
 *   - 手牌：卡的原始网格 64×96，×3（大屏放得下时）或 ×2。
 *   - 出牌面板：手牌右边放得下（≥ ACT_MIN 宽）就放手牌右边，否则放中栏上半（自己的奇迹板右边）。
 *   - 邻居面板：宽 400 时奇迹插图 ×2（384×144），否则 ×1（192×72）。
 *   - 自己的奇迹板：×2，中栏放不下就 ×1。
 * 手机（宽 < 720）：竖着排，手牌是 2 列列表，出牌面板从底部弹出（见 wd.css 的 .mobile）。
 */
import { useEffect, useState } from "react";

export interface Layout {
  readonly mobile: boolean;
  readonly width: number;
  readonly height: number;
  /** 桌面：外边距、块间距。 */
  readonly pad: number;
  readonly gap: number;
  readonly topH: number;
  /** 其他玩家一排的高度（0 = 没有）。 */
  readonly othersH: number;
  /** 其他玩家小卡上的徽记倍数（32×32 ×1 / ×2）。 */
  readonly emblemN: 1 | 2;
  /** 手牌倍数（卡 64×96 ×N）和卡间距。 */
  readonly handN: 1 | 2 | 3;
  readonly cardGap: number;
  readonly handRowH: number;
  /** 出牌面板在手牌一排（否则在中栏上半）。 */
  readonly actInHand: boolean;
  readonly actW: number;
  readonly nbW: number;
  readonly nbWonderN: 1 | 2;
  readonly myWonderN: 1 | 2;
  readonly middleH: number;
  readonly centerW: number;
  /** 城池卡名条的高度、字号、每列宽。 */
  readonly stripH: number;
  readonly stripFont: 12 | 24;
  readonly cityColW: number;
}

export const ACT_MIN = 420;
/** 奇迹板：插图 192×72 ×N + 阶段格 + 框。 */
export const stageRowH = (n: 1 | 2) => (n === 2 ? 48 : 28);
export const boardH = (n: 1 | 2) => 72 * n + stageRowH(n) + 8;
export const boardW = (n: 1 | 2) => 192 * n + 8;

export function computeLayout(width: number, height: number, players: number): Layout {
  if (width < 720) {
    return {
      mobile: true, width, height, pad: 8, gap: 6, topH: 40, othersH: players > 3 ? 40 : 0, emblemN: 1,
      handN: 1, cardGap: 6, handRowH: 0, actInHand: false, actW: width - 16, nbW: Math.floor((width - 22) / 2), nbWonderN: 1, myWonderN: 1,
      middleH: 0, centerW: width - 16, stripH: 24, stripFont: 12, cityColW: 0,
    };
  }
  const big = width >= 1700 && height >= 900;
  const pad = width >= 1300 ? 12 : 8;
  const gap = width >= 1300 ? 12 : 8;
  const topH = big ? 48 : 40;
  const others = players - 3;
  const othersH = others <= 0 ? 0 : big ? 80 : height >= 760 ? 64 : 56;
  const emblemN: 1 | 2 = big ? 2 : 1;
  // 手牌：大屏试 ×3，放不下（中栏剩不到 400 高）就 ×2
  const tryHand = (n: 2 | 3) => {
    const cardGap = n === 3 ? 12 : 8;
    const handW = 7 * 64 * n + 6 * cardGap;
    const handRowH = 96 * n + 6 * n;
    const middleH = height - topH - othersH - handRowH - 2 * pad - (othersH ? 3 : 2) * gap;
    return { n, cardGap, handW, handRowH, middleH };
  };
  let hand = tryHand(big ? 3 : 2);
  if (hand.n === 3 && hand.middleH < 420) hand = tryHand(2);
  const actRoom = width - 2 * pad - hand.handW - gap;
  const actInHand = actRoom >= ACT_MIN;
  const nbW = big && width >= 1800 ? 408 : 216;
  const nbWonderN: 1 | 2 = nbW >= 400 ? 2 : 1;
  const centerW = width - 2 * pad - 2 * nbW - 2 * gap;
  const middleH = hand.middleH;
  // 自己的奇迹板 ×2 的条件：城池还剩 ≥ 6 条卡名；出牌面板在中栏时右边还要放得下面板
  const statsH = 40;
  const cityMin = (stripH: number) => 24 + 6 * stripH;
  const fits2 = middleH - boardH(2) - statsH - gap >= cityMin(24) && centerW - boardW(2) - gap >= (actInHand ? 360 : 380);
  const myWonderN: 1 | 2 = fits2 ? 2 : 1;
  const cityColW = Math.floor((centerW - 6 * 6) / 7);
  const stripFont: 12 | 24 = cityColW >= 112 ? 24 : 12;
  const stripH = stripFont === 24 ? (big ? 28 : 24) : 20;
  return {
    mobile: false, width, height, pad, gap, topH, othersH, emblemN,
    handN: hand.n, cardGap: hand.cardGap, handRowH: hand.handRowH,
    actInHand, actW: actInHand ? actRoom : centerW - boardW(myWonderN) - gap,
    nbW, nbWonderN, myWonderN, middleH, centerW, stripH, stripFont, cityColW,
  };
}

export function useLayout(players: number): Layout {
  const read = () => computeLayout(window.innerWidth, window.innerHeight, players);
  const [layout, setLayout] = useState(read);
  useEffect(() => {
    const update = () => setLayout(read());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [players]);
  return layout;
}
