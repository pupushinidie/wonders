import type { PlayerColor, Terrain } from "@wonders/game";

/**
 * 像素美术的地址。图片放在 public/art 下（PixelLab 生成，art/export.py 导出）。
 * 图片地址固定；换图后不会被浏览器缓存挡住，靠服务器给这些文件加 Cache-Control: no-cache。
 *
 * 地形格原图 32×32，只按整数倍显示（32 / 64 / 96 / 128）；同一种地形有几张变体，按骨牌编号挑，
 * 王国里同一种地形不会一模一样地重复。皇冠是代码画的小图标（数量要准），叠在格子左上角。
 */
const ROOT = `${import.meta.env.BASE_URL}art/`;

/** 每种地形有几张变体（和 public/art/terrain 里的文件对应）。 */
export const TERRAIN_VARIANTS: Record<Terrain, number> = { W: 3, F: 3, L: 3, G: 3, S: 3, M: 3 };

/** 地形原图边长。 */
export const TILE_PX = 32;

/** 第 n 张骨牌的哪一端（0 = A 端，1 = B 端）用哪张变体：固定下来，刷新后也一样。px 是用哪套原图（32 或 16）。 */
export function terrainArt(terrain: Terrain, n: number, end: number, px: 32 | 16 = 32): string {
  const count = TERRAIN_VARIANTS[terrain];
  const variant = (n * 7 + end * 3) % count;
  return `${ROOT}terrain${px === 16 ? "16" : ""}/${terrain}-${variant}.png`;
}

export const art = {
  /** 皇冠：9×8 原图，按格子的倍数放大。 */
  crown: `${ROOT}ui/crown.png`,
  castle: (color: PlayerColor, px: 32 | 16 = 32) => `${ROOT}${px === 16 ? "terrain16" : "terrain"}/castle-${color}.png`,
  king: (color: PlayerColor) => `${ROOT}ui/king-${color}.png`,
  sceneNight: `${ROOT}ui/scene-night.png`,
  sceneDay: `${ROOT}ui/scene-day.png`,
};

/** 玩家颜色（城堡、国王、名字前的小方块）。 */
export const PLAYER_HEX: Record<PlayerColor, string> = {
  pink: "#e46aa4",
  yellow: "#f0c43c",
  green: "#5cbf5a",
  blue: "#4d8fe0",
};

/** 场景图（512×288）按整数倍放大铺满一块区域需要的尺寸（CSS background-size）。 */
export function coverSize(width: number, height: number): string {
  const scale = Math.max(1, Math.ceil(Math.max(width / 512, height / 288)));
  return `${512 * scale}px ${288 * scale}px`;
}
