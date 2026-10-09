import type { DayPalette } from "./day-theme";

/**
 * 白天版调色表（多米诺王国，和沙丘赛驼、花砖物语、车票之旅同一套暖棕色）。
 * 深色底、面板、按钮 → 白底浅色；深色像素描边保留；浅色字 → 深色字。
 * 地形格、国王、按钮里的金色红色这些内容色不换；牌桌上的面板跟着变成浅色（场景换成白天那张）。
 */
export const palette: DayPalette = {
  files: ["app-pixel.css", "kd.css"],
  colors: {
    "#120e0b": "#ffffff", // 底色、输入框
    "#18120e": "#faf8f4", // 底色的棋盘纹
    "#231a14": "#faf6ee", // 面板
    "#2e2319": "#f0e8da", // 面板 2、分隔线
    "#3d2e22": "#ebe1cf", // 普通按钮、分隔线
    "#241d16": "#fbf3df", // 管理员区
    "#3a2c10": "#fcefc6", // 金色字的底（选中项、状态牌、轮到谁）
    "#070504": "#33261b", // 像素描边
    "#6a4f37": "#ffffff", // 面板亮边
    "#0c0907": "#dccdb5", // 面板暗边
    "#8a6a48": "#ffffff", // 按钮亮边
    "#150f0b": "#c4b090", // 按钮暗边
  },
  text: {
    "#f1ece0": "#2b2118",
    "#b09d84": "#76624c",
    "#7a6650": "#b3a28a", // 输入框占位字
    "#120e0b": "#120e0b", // 金色小牌上的深色字不换
  },
  values: {
    // 不能点的按钮：夜间是压暗，白底上压暗成了泥色，改成褪成浅灰
    "grayscale(0.6) brightness(0.7)": "grayscale(0.85) brightness(1.15)",
  },
  textShadows: {
    // 大标题的投影：夜间是黑色，白底上换成浅金色
    "calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--edge)": "calc(var(--px) * 2) calc(var(--px) * 2) 0 #f0d890",
  },
  textVarColors: {
    "--gold": "#94650a",
    "--gold-2": "#94650a",
    "--ok": "#1f8a45",
    "--bad": "#d1303f",
  },
  // 骨牌上的「已放 / 弃掉」小牌保持深底浅字
  keep: [".kd-slot-state", ".kd-discard-badge"],
};
