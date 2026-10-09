/**
 * 规则核对 · 数据：卡表、奇迹板和补充文件 §2.4 / §2.5 逐字段一致；勘误 E1–E9、E13、E15；
 * 按人数的牌堆构成（规则书 §2.1、补充 §2.3、TC1、E-T14）。
 */
import { describe, expect, it } from "vitest";
import { ageCards, buildAgeDeck, card, CARDS, createRng, GUILDS, wonderStages, WONDERS, type Age } from "@wonders/game";
import { FX_CARDS, FX_WONDERS, fx, sortRes } from "./oracle.js";

const names = (age: number, color?: string) =>
  [...new Set(FX_CARDS.filter((c) => c.age === age && (!color || c.color === color)).map((c) => c.name))].sort();

describe("数据：148 张卡逐张和补充文件 §2.4 一致", () => {
  it("一共 148 张，id 和补充文件一一对应", () => {
    expect(CARDS.length).toBe(148);
    expect(new Set(CARDS.map((c) => c.id))).toEqual(new Set(FX_CARDS.map((c) => c.id)));
  });

  it("每张卡的时代、颜色、名字、成本、金币、免费链、人数标记、效果都一致", () => {
    const diffs: string[] = [];
    for (const f of FX_CARDS) {
      const c = card(f.id);
      const same =
        c.age === f.age &&
        c.color === f.color &&
        c.name === f.name &&
        sortRes(c.cost) === sortRes(f.cost) &&
        c.coin === f.coin &&
        [...c.chainFrom].sort().join("|") === [...f.chainFrom].sort().join("|") &&
        c.minPlayers === f.minPlayers &&
        c.guild === f.guild;
      if (!same) diffs.push(f.id);
      const e = c.effect as unknown as Record<string, unknown>;
      const fe = f.effect as unknown as Record<string, unknown>;
      for (const k of Object.keys(fe)) {
        const a = e[k];
        const b = fe[k];
        const norm = (v: unknown) =>
          typeof v === "string" && /^[WCSOGLP]+$/.test(v) ? sortRes(v) : Array.isArray(v) ? [...v].sort().join("|") : v;
        if (norm(a) !== norm(b)) diffs.push(`${f.id}.effect.${k}: 引擎 ${JSON.stringify(a)} / 补充 ${JSON.stringify(b)}`);
      }
    }
    expect(diffs).toEqual([]);
  });
});

describe("数据：奇迹板和补充文件 §2.5 一致", () => {
  it("7 块 × A/B：起始资源、每一阶段的成本和效果", () => {
    expect(WONDERS.length).toBe(7);
    const diffs: string[] = [];
    for (const w of FX_WONDERS) {
      const ew = WONDERS.find((x) => x.key === w.key);
      if (!ew) {
        diffs.push(`缺 ${w.key}`);
        continue;
      }
      if (ew.start !== w.start) diffs.push(`${w.key} 起始资源 ${ew.start} ≠ ${w.start}`);
      for (const side of ["A", "B"] as const) {
        const es = wonderStages(w.key as never, side);
        const fs = w.sides[side];
        if (es.length !== fs.length) diffs.push(`${w.key}${side} 阶段数 ${es.length} ≠ ${fs.length}`);
        fs.forEach((st, k) => {
          const e = es[k];
          if (!e) return;
          if (sortRes(e.cost) !== sortRes(st.cost)) diffs.push(`${w.key}${side}${k + 1} 成本 ${e.cost} ≠ ${st.cost}`);
          const norm = (x: unknown) => {
            const o = { ...(x as Record<string, unknown>) };
            for (const key of Object.keys(o)) {
              const v = o[key];
              if (typeof v === "string" && /^[WCSOGLP]+$/.test(v)) o[key] = sortRes(v);
              if (Array.isArray(v)) o[key] = [...v].sort();
            }
            return JSON.stringify(Object.keys(o).sort().map((kk) => [kk, o[kk]]));
          };
          const ee = [...e.effects].map(norm).sort();
          const fe = [...st.effects].map(norm).sort();
          if (JSON.stringify(ee) !== JSON.stringify(fe)) diffs.push(`${w.key}${side}${k + 1} 效果 ${ee} ≠ ${fe}`);
        });
      }
    }
    expect(diffs).toEqual([]);
  });
});

describe("勘误 E1–E9、E13、E15（数据）", () => {
  it("E1 灰卡只在 Age I 和 Age II，各 3 种；Age III 没有棕卡和灰卡", () => {
    const gray = CARDS.filter((c) => c.color === "gray");
    expect(new Set(gray.map((c) => c.age))).toEqual(new Set([1, 2]));
    expect([...new Set(gray.filter((c) => c.age === 1).map((c) => c.name))].sort()).toEqual(["Glassworks", "Loom", "Press"]);
    expect([...new Set(gray.filter((c) => c.age === 2).map((c) => c.name))].sort()).toEqual(["Glassworks", "Loom", "Press"]);
    expect(gray.filter((c) => c.age === 1).map((c) => c.minPlayers).sort()).toEqual([3, 3, 3, 6, 6, 6]);
    expect(gray.filter((c) => c.age === 2).map((c) => c.minPlayers).sort()).toEqual([3, 3, 3, 5, 5, 5]);
    expect(CARDS.filter((c) => c.age === 3 && (c.color === "brown" || c.color === "gray"))).toEqual([]);
  });

  it("E2 Age I 六张二选一原料卡全部要 1 金", () => {
    const choice = CARDS.filter((c) => c.age === 1 && c.effect.type === "produceChoice");
    expect([...new Set(choice.map((c) => c.name))].sort()).toEqual(
      ["Clay Pit", "Excavation", "Forest Cave", "Mine", "Timber Yard", "Tree Farm"].sort(),
    );
    for (const c of choice) expect(c.coin, c.name).toBe(1);
  });

  it("E3 神庙 3 分（1 木 + 1 砖 + 1 玻，祭坛免费链）", () => {
    for (const c of CARDS.filter((x) => x.name === "Temple")) {
      expect(c.effect).toEqual({ type: "vp", n: 3 });
      expect(sortRes(c.cost)).toBe("WCG");
      expect(c.chainFrom).toEqual(["Altar"]);
    }
  });

  it("E4 马厩 2 盾；Age II 四张红卡都是 2 盾", () => {
    const red2 = CARDS.filter((c) => c.age === 2 && c.color === "red");
    expect([...new Set(red2.map((c) => c.name))].sort()).toEqual(["Archery Range", "Stables", "Training Ground", "Walls"]);
    for (const c of red2) expect(c.effect, c.name).toEqual({ type: "shields", n: 2 });
  });

  it("E5 补上攻城工坊：Age III 红卡 3 盾，1 木 + 3 砖，实验室免费链，3+ / 5+ 两张；红卡共 11 种", () => {
    const sw = CARDS.filter((c) => c.name === "Siege Workshop");
    expect(sw.map((c) => c.minPlayers).sort()).toEqual([3, 5]);
    for (const c of sw) {
      expect(c.age).toBe(3);
      expect(c.color).toBe("red");
      expect(c.effect).toEqual({ type: "shields", n: 3 });
      expect(sortRes(c.cost)).toBe("WCCC");
      expect(c.chainFrom).toEqual(["Laboratory"]);
    }
    expect(new Set(CARDS.filter((c) => c.color === "red").map((c) => c.name)).size).toBe(11);
    expect(CARDS.filter((c) => c.age === 3).length).toBe(50);
  });

  it("E6 罗德岛 A 面：2 木 → 3 分；3 砖 → 2 盾；4 矿 → 7 分", () => {
    const st = wonderStages("rhodes", "A");
    expect(st.map((s) => sortRes(s.cost))).toEqual(["WW", "CCC", "OOOO"]);
    expect(st[1]!.effects).toEqual([{ type: "shields", n: 2 }]);
  });

  it("E7 亚历山大 B 面阶段 3 是 3 石（没有玻璃）", () => {
    expect(sortRes(wonderStages("alexandria", "B")[2]!.cost)).toBe("SSS");
  });

  it("E8 奥林匹亚 A 面阶段 3 是 2 矿", () => {
    expect(sortRes(wonderStages("olympia", "A")[2]!.cost)).toBe("OO");
  });

  it("E9 奥林匹亚 B 面阶段 2 是 2 石 → 5 分", () => {
    const s = wonderStages("olympia", "B")[1]!;
    expect(sortRes(s.cost)).toBe("SS");
    expect(s.effects).toEqual([{ type: "vp", n: 5 }]);
  });

  it("E13 金字塔 A 面阶段 2 没有能力，是 5 分", () => {
    expect(wonderStages("giza", "A")[1]!.effects).toEqual([{ type: "vp", n: 5 }]);
  });

  it("E15 科技符号归属：圆规 = 药房/诊所/学社/学院；齿轮 = 工坊/实验室/天文台/书斋；石板 = 写字间/图书馆/学校/大学", () => {
    const sym = (s: string) =>
      [...new Set(CARDS.filter((c) => c.effect.type === "science" && (c.effect as { symbol: string }).symbol === s).map((c) => c.name))].sort();
    expect(sym("compass")).toEqual(["Academy", "Apothecary", "Dispensary", "Lodge"]);
    expect(sym("gear")).toEqual(["Laboratory", "Observatory", "Study", "Workshop"]);
    expect(sym("tablet")).toEqual(["Library", "School", "Scriptorium", "University"]);
  });

  it("E12 广场有两个免费链来源（东贸易站或西贸易站）", () => {
    for (const c of CARDS.filter((x) => x.name === "Forum")) expect([...c.chainFrom].sort()).toEqual(["East Trading Post", "West Trading Post"]);
  });

  it("规则书 §2.3：Age I / II / III 的卡名分布（蓝卡分数、红卡盾数）", () => {
    expect(names(1, "blue")).toEqual(["Altar", "Baths", "Pawnshop", "Theater"]);
    expect(names(3, "blue")).toEqual(["Gardens", "Palace", "Pantheon", "Senate", "Town Hall"]);
    const vp = (n: string) => (CARDS.find((c) => c.name === n)!.effect as { n: number }).n;
    expect([vp("Palace"), vp("Pantheon"), vp("Senate"), vp("Town Hall"), vp("Gardens"), vp("Aqueduct"), vp("Statue"), vp("Courthouse")]).toEqual([
      8, 7, 6, 6, 5, 5, 4, 4,
    ]);
    expect(GUILDS.length).toBe(10);
    expect(GUILDS.every((g) => g.age === 3 && g.color === "purple" && g.minPlayers === null)).toBe(true);
  });
});

/** 补充 §2.3 的按人数统计表：[age][n] = { 颜色: 张数 }。 */
const TABLE: Record<number, Record<number, Record<string, number>>> = {
  1: {
    3: { blue: 3, brown: 6, gray: 3, green: 3, red: 3, yellow: 3 },
    4: { blue: 4, brown: 9, gray: 3, green: 4, red: 4, yellow: 4 },
    5: { blue: 5, brown: 12, gray: 3, green: 5, red: 5, yellow: 5 },
    6: { blue: 6, brown: 14, gray: 6, green: 5, red: 5, yellow: 6 },
    7: { blue: 8, brown: 14, gray: 6, green: 6, red: 6, yellow: 9 },
  },
  2: {
    3: { blue: 4, brown: 4, gray: 3, green: 4, red: 3, yellow: 3 },
    4: { blue: 4, brown: 8, gray: 3, green: 5, red: 4, yellow: 4 },
    5: { blue: 5, brown: 8, gray: 6, green: 6, red: 5, yellow: 5 },
    6: { blue: 6, brown: 8, gray: 6, green: 7, red: 7, yellow: 8 },
    7: { blue: 8, brown: 8, gray: 6, green: 8, red: 9, yellow: 10 },
  },
  3: {
    3: { blue: 5, green: 5, red: 3, yellow: 3 },
    4: { blue: 6, green: 6, red: 5, yellow: 5 },
    5: { blue: 8, green: 7, red: 7, yellow: 6 },
    6: { blue: 10, green: 8, red: 8, yellow: 8 },
    7: { blue: 11, green: 10, red: 10, yellow: 9 },
  },
};

describe("按人数的牌堆构成（规则书 §2.1、补充 §2.3、TC1、E-T14）", () => {
  for (const n of [3, 4, 5, 6, 7]) {
    it(`${n} 人：三个时代的非行会卡和补充 §2.3 的颜色分布一致，只含人数标记 ≤ ${n} 的卡`, () => {
      for (const age of [1, 2, 3] as Age[]) {
        const cards = ageCards(age, n);
        const byColor: Record<string, number> = {};
        for (const c of cards) byColor[c.color] = (byColor[c.color] ?? 0) + 1;
        expect(byColor, `Age ${age}`).toEqual(TABLE[age]![n]);
        const expectIds = FX_CARDS.filter((c) => c.age === age && !c.guild && (c.minPlayers ?? 99) <= n).map((c) => c.id).sort();
        expect(cards.map((c) => c.id).sort(), `Age ${age}`).toEqual(expectIds);
      }
      expect(ageCards(1, n).length).toBe(7 * n);
      expect(ageCards(2, n).length).toBe(7 * n);
      expect(ageCards(3, n).length).toBe(7 * n - (n + 2));
    });

    it(`${n} 人：Age I / II 牌堆 = 7×${n} 张；Age III 牌堆 1000 次都是非行会 + 恰好 ${n + 2} 张不同的行会（E-T14）`, () => {
      const rng = createRng(1234 + n);
      for (const age of [1, 2] as Age[]) {
        const deck = buildAgeDeck(age, n, rng);
        expect(deck.length).toBe(7 * n);
        expect([...deck].sort()).toEqual(ageCards(age, n).map((c) => c.id).sort());
      }
      const nonGuild = ageCards(3, n).map((c) => c.id).sort();
      const seen = new Set<string>();
      let bad = 0;
      for (let k = 0; k < 1000; k++) {
        const deck = buildAgeDeck(3, n, rng);
        const guilds = deck.filter((id) => fx(id).guild);
        const others = deck.filter((id) => !fx(id).guild).sort();
        if (deck.length !== 7 * n || guilds.length !== n + 2 || new Set(guilds).size !== n + 2 || others.join() !== nonGuild.join()) bad++;
        for (const g of guilds) seen.add(g);
      }
      expect(bad).toBe(0);
      // 1000 次里每张行会都应该被抽到过（是随机的，不是固定那几张）
      expect(seen.size).toBe(10);
    });
  }

  it("TC1：盒内 Age I 49、Age II 49、Age III 50（40 非行会 + 10 行会）", () => {
    expect(CARDS.filter((c) => c.age === 1).length).toBe(49);
    expect(CARDS.filter((c) => c.age === 2).length).toBe(49);
    expect(CARDS.filter((c) => c.age === 3 && !c.guild).length).toBe(40);
    expect(CARDS.filter((c) => c.age === 3 && c.guild).length).toBe(10);
  });
});
