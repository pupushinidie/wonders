import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ageCards, buildAgeDeck, CARDS, createRng, GUILDS, WONDERS, wonderStages, type CardColor } from "../src/index.js";

const root = resolve(__dirname, "../../..");

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

const byName = (name: string) => CARDS.filter((entry) => entry.name === name);

describe("卡表和奇迹板数据（补充文件 §2）", () => {
  it("packages/game/src/data.ts 和 data/*.json 一字不差（改了 JSON 要跑 scripts/gen-data.mjs）", () => {
    expect(JSON.parse(JSON.stringify(CARDS))).toEqual(JSON.parse(readFileSync(resolve(root, "data/cards.json"), "utf8")));
    expect(JSON.parse(JSON.stringify(WONDERS))).toEqual(JSON.parse(readFileSync(resolve(root, "data/wonders.json"), "utf8")));
  });

  it("148 张、75 个卡名、id 不重复；盒内 Age I 49 / Age II 49 / Age III 50（40 + 10 行会）", () => {
    expect(CARDS).toHaveLength(148);
    expect(new Set(CARDS.map((entry) => entry.id)).size).toBe(148);
    // 75 个不同的英文名（织布机、玻璃厂、印刷所 Age I、II 同名算一个）
    expect(new Set(CARDS.map((entry) => entry.name)).size).toBe(75);
    expect(countBy(CARDS, (entry) => String(entry.age))).toEqual({ 1: 49, 2: 49, 3: 50 });
    expect(GUILDS).toHaveLength(10);
  });

  // 补充文件 §2.3 的按人数统计表
  const table: Record<number, Record<number, Partial<Record<CardColor, number>>>> = {
    3: { 1: { blue: 3, brown: 6, gray: 3, green: 3, red: 3, yellow: 3 }, 2: { blue: 4, brown: 4, gray: 3, green: 4, red: 3, yellow: 3 }, 3: { blue: 5, green: 5, red: 3, yellow: 3 } },
    4: { 1: { blue: 4, brown: 9, gray: 3, green: 4, red: 4, yellow: 4 }, 2: { blue: 4, brown: 8, gray: 3, green: 5, red: 4, yellow: 4 }, 3: { blue: 6, green: 6, red: 5, yellow: 5 } },
    5: { 1: { blue: 5, brown: 12, gray: 3, green: 5, red: 5, yellow: 5 }, 2: { blue: 5, brown: 8, gray: 6, green: 6, red: 5, yellow: 5 }, 3: { blue: 8, green: 7, red: 7, yellow: 6 } },
    6: { 1: { blue: 6, brown: 14, gray: 6, green: 5, red: 5, yellow: 6 }, 2: { blue: 6, brown: 8, gray: 6, green: 7, red: 7, yellow: 8 }, 3: { blue: 10, green: 8, red: 8, yellow: 8 } },
    7: { 1: { blue: 8, brown: 14, gray: 6, green: 6, red: 6, yellow: 9 }, 2: { blue: 8, brown: 8, gray: 6, green: 8, red: 9, yellow: 10 }, 3: { blue: 11, green: 10, red: 10, yellow: 9 } },
  };
  for (const n of [3, 4, 5, 6, 7]) {
    it(`规则书#1 / 补充 §2.3：${n} 人局每个时代 7 × ${n} 张，颜色分布对得上`, () => {
      for (const age of [1, 2, 3] as const) {
        const cards = ageCards(age, n);
        expect(countBy(cards, (entry) => entry.color)).toEqual(table[n]![age]);
        const deck = buildAgeDeck(age, n, createRng(n * 10 + age));
        expect(deck).toHaveLength(7 * n);
        expect(new Set(deck).size).toBe(7 * n);
      }
      expect(ageCards(3, n)).toHaveLength(7 * n - (n + 2));
    });
  }

  it("规则书#1：3 人局 Age I 只用 3+ 的牌（21 张）；7 人局 Age III = 40 非行会 + 9 行会", () => {
    expect(ageCards(1, 3).every((entry) => entry.minPlayers === 3)).toBe(true);
    expect(ageCards(1, 3)).toHaveLength(21);
    expect(ageCards(3, 7)).toHaveLength(40);
    const deck = buildAgeDeck(3, 7, createRng(5));
    expect(deck.filter((id) => id.endsWith("_guild"))).toHaveLength(9);
  });

  it("勘误 E1：灰卡只在 Age I（3+、6+）和 Age II（3+、5+），Age III 没有棕卡和灰卡", () => {
    const grays = CARDS.filter((entry) => entry.color === "gray");
    expect(countBy(grays, (entry) => `${entry.age}:${entry.minPlayers}`)).toEqual({ "1:3": 3, "1:6": 3, "2:3": 3, "2:5": 3 });
    expect(CARDS.filter((entry) => entry.age === 3 && (entry.color === "brown" || entry.color === "gray"))).toHaveLength(0);
  });

  it("勘误 E2：Age I 六张二选一原料卡都要 1 金", () => {
    const choice = CARDS.filter((entry) => entry.age === 1 && entry.effect.type === "produceChoice");
    expect(choice.map((entry) => entry.name).sort()).toEqual(["Clay Pit", "Excavation", "Forest Cave", "Mine", "Timber Yard", "Tree Farm"]);
    expect(choice.every((entry) => entry.coin === 1 && entry.cost === "")).toBe(true);
  });

  it("勘误 E3 / E4：神庙 3 分（1 木 1 砖 1 玻，祭坛链）；马厩 2 盾，Age II 红卡全是 2 盾", () => {
    for (const temple of byName("Temple")) {
      expect(temple.effect).toEqual({ type: "vp", n: 3 });
      expect(temple.cost).toBe("WCG");
      expect(temple.chainFrom).toEqual(["Altar"]);
    }
    for (const red of CARDS.filter((entry) => entry.age === 2 && entry.color === "red")) expect(red.effect).toEqual({ type: "shields", n: 2 });
  });

  it("勘误 E5：补上攻城工坊（Age III 红卡，3 盾，1 木 + 3 砖，实验室链，3+ / 5+）", () => {
    const siege = byName("Siege Workshop");
    expect(siege.map((entry) => entry.minPlayers).sort()).toEqual([3, 5]);
    for (const entry of siege) {
      expect(entry).toMatchObject({ age: 3, color: "red", cost: "WCCC", chainFrom: ["Laboratory"], effect: { type: "shields", n: 3 } });
    }
    expect(new Set(CARDS.filter((entry) => entry.color === "red").map((entry) => entry.name)).size).toBe(11);
  });

  it("勘误 E6–E9、E13：罗德岛 A 2 木 / 3 砖 / 4 矿；亚历山大 B3 3 石；奥林匹亚 A3 2 矿、B2 2 石；金字塔 A2 是 5 分没有能力", () => {
    expect(wonderStages("rhodes", "A").map((stage) => stage.cost)).toEqual(["WW", "CCC", "OOOO"]);
    expect(wonderStages("rhodes", "A")[1]!.effects).toEqual([{ type: "shields", n: 2 }]);
    expect(wonderStages("alexandria", "B")[2]!.cost).toBe("SSS");
    expect(wonderStages("olympia", "A")[2]!.cost).toBe("OO");
    expect(wonderStages("olympia", "B")[1]!.cost).toBe("SS");
    expect(wonderStages("giza", "A")[1]!.effects).toEqual([{ type: "vp", n: 5 }]);
    expect(wonderStages("giza", "B")).toHaveLength(4);
  });

  it("勘误 E11 / E12 / E15：采石坑改名；广场两个链来源；科技符号归属", () => {
    expect(byName("Stone Pit")[0]!.zh).toBe("采石坑");
    expect(byName("Quarry")[0]!.zh).toBe("采石场");
    for (const forum of byName("Forum")) expect([...forum.chainFrom].sort()).toEqual(["East Trading Post", "West Trading Post"]);
    const symbolOf = (name: string) => {
      const effect = byName(name)[0]!.effect;
      return effect.type === "science" ? effect.symbol : null;
    };
    for (const name of ["Apothecary", "Dispensary", "Lodge", "Academy"]) expect(symbolOf(name)).toBe("compass");
    for (const name of ["Workshop", "Laboratory", "Observatory", "Study"]) expect(symbolOf(name)).toBe("gear");
    for (const name of ["Scriptorium", "Library", "School", "University"]) expect(symbolOf(name)).toBe("tablet");
  });

  it("免费链数据：chainFrom 和 chainTo 互为反向，链来源都是前一时代的卡", () => {
    for (const entry of CARDS) {
      for (const from of entry.chainFrom) {
        const source = byName(from);
        expect(source.length).toBeGreaterThan(0);
        expect(source.every((other) => other.age === entry.age - 1 && other.chainTo.includes(entry.name))).toBe(true);
      }
    }
  });
});
