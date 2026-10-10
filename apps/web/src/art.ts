/**
 * 美术素材的地址和尺寸（art/spec.md、art/manifest.json）。所有图都在 public/art 下，占位图和正式图同名同尺寸，
 * 出图阶段直接覆盖，这里不用改。像素图一律整数倍显示（image-rendering: pixelated）。
 */
import { card, type Age, type CardId, type Resource, type WonderKey, type WonderSide } from "@wonders/game";

const BASE = import.meta.env.BASE_URL;
export const artUrl = (path: string) => `${BASE}art/${path}`;

/** 卡名 → 插画文件名：英文名小写、空格换下划线。 */
export const cardSlug = (id: CardId) => card(id).name.toLowerCase().replace(/ /g, "_");

export type IconName =
  | `res-${Resource}`
  | "sci-compass" | "sci-gear" | "sci-tablet" | "sci-any"
  | "shield" | "coin" | "vp" | "chain"
  | "stage-built" | "stage-open"
  | "act-build" | "act-wonder" | "act-sell"
  | "trade" | "trade-left"
  | "eff-any-raw" | "eff-any-goods" | "eff-free-build" | "eff-discard-build" | "eff-seventh" | "eff-copy-guild"
  | "ready" | "waiting"
  | "cat-brown" | "cat-gray" | "cat-blue" | "cat-green" | "cat-yellow" | "cat-red" | "cat-purple";

export type PipName = Resource | "coin" | "shield" | "vp" | "compass" | "gear" | "tablet" | "chain";

export const art = {
  cardArt: (id: CardId) => artUrl(`cards/art/${cardSlug(id)}.png`),
  back: (age: Age) => artUrl(`cards/back-age${age}.png`),
  wonder: (key: WonderKey, side: WonderSide) => artUrl(`wonders/${key}-${side.toLowerCase()}.png`),
  emblem: (key: WonderKey) => artUrl(`wonders/${key}-emblem.png`),
  icon: (name: IconName) => artUrl(`icons/${name}.png`),
  pip: (name: PipName) => artUrl(`pips/pip-${name}.png`),
  token: (value: number) => artUrl(value < 0 ? "tokens/war-loss.png" : `tokens/war-win${value}.png`),
  scene: (theme: "day" | "night", n: 1 | 2) => artUrl(`scene/${theme}-${n}.png`),
  arrow: artUrl("ui/arrow-pass.png"),
  laurel: artUrl("ui/laurel.png"),
  ribbon: artUrl("ui/ribbon.png"),
  cover: artUrl("ui/cover.png"),
  fx: (name: FxName) => artUrl(`fx/${name}.png`),
};

/** 横排帧条（每帧宽高、帧数、每帧毫秒、是否循环），照 art/manifest.json。 */
export const FX = {
  "pass-trail": { w: 48, h: 16, frames: 6, ms: 60, loop: false },
  clash: { w: 32, h: 32, frames: 6, ms: 70, loop: false },
  "token-land": { w: 24, h: 24, frames: 5, ms: 60, loop: false },
  "build-dust": { w: 48, h: 24, frames: 6, ms: 70, loop: false },
  "stage-shine": { w: 32, h: 32, frames: 6, ms: 80, loop: false },
  "coin-spin": { w: 16, h: 16, frames: 6, ms: 70, loop: true },
  fireworks: { w: 64, h: 64, frames: 8, ms: 90, loop: false },
  brazier: { w: 16, h: 24, frames: 6, ms: 120, loop: true },
} as const;
export type FxName = keyof typeof FX;
export const ARROW = { w: 32, h: 16, frames: 4, ms: 150 } as const;

/** 场景按房间码哈希选 1 或 2，切主题时编号不变。 */
export function sceneIndex(code: string): 1 | 2 {
  let hash = 0;
  for (const char of code) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 2) + 1 as 1 | 2;
}

/** 场景 512×288 按能盖满的最小整数倍铺（spec §10）。 */
export function sceneScale(width: number, height: number): number {
  return Math.max(1, Math.ceil(Math.max(width / 512, height / 288)));
}

/** 场景里灯塔的横坐标（原图像素，scene/focus.json）：手机竖屏只露中间一竖条，按它把灯塔摆到屏幕正中。 */
let focusCache: Record<string, number> | null = null;
let focusLoading: Promise<Record<string, number>> | null = null;
export function loadSceneFocus(): Promise<Record<string, number>> {
  if (focusCache) return Promise.resolve(focusCache);
  focusLoading ??= fetch(artUrl("scene/focus.json"))
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}))
    .then((data: Record<string, number>) => (focusCache = data));
  return focusLoading;
}
