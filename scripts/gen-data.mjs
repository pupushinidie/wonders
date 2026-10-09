// 把 data/cards.json、data/wonders.json（补充文件 §2.4、§2.5 原样）生成 packages/game/src/data.ts。
// 改了 JSON 就跑：node scripts/gen-data.mjs（单测 data.test.ts 会核对两边一致）。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cards = JSON.parse(readFileSync(resolve(root, "data/cards.json"), "utf8"));
const wonders = JSON.parse(readFileSync(resolve(root, "data/wonders.json"), "utf8"));
const out = `// 由 scripts/gen-data.mjs 从 data/*.json 生成，不要手改。
import type { CardDef, WonderDef } from "./types.js";

/** 148 张时代卡（补充文件 §2.4）。 */
export const CARDS: readonly CardDef[] = ${JSON.stringify(cards, null, 1)} as unknown as readonly CardDef[];

/** 7 块奇迹板 × A/B 两面（补充文件 §2.5）。 */
export const WONDERS: readonly WonderDef[] = ${JSON.stringify(wonders, null, 1)} as unknown as readonly WonderDef[];
`;
writeFileSync(resolve(root, "packages/game/src/data.ts"), out);
console.log(`写好 data.ts：${cards.length} 张卡、${wonders.length} 块奇迹板`);
