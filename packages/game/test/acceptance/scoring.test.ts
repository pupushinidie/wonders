/**
 * 规则核对 · 计分和军事：规则书 §4.3、§5、§6，TC2、TC3、TC9、TC10、TC11、TC12，补充 E10、E14、E-T2，
 * §2.5 copyGuild 说明，README 默认规则表 #14。
 */
import { describe, expect, it } from "vitest";
import { buildScene, card, scene, scienceScore, scoreBreakdown, type GameState, type ScenePlayerSpec } from "@wonders/game";
import { oracleScore, science } from "./oracle.js";
import { P, round } from "./helpers.js";

const fin = (players: ScenePlayerSpec[]): GameState => buildScene({ age: 3, round: 6, phase: "finished", players });
const guildPts = (s: GameState, i: number, name: string, copied = false) => {
  const d = scoreBreakdown(s, P(i)).guildDetail.find((g) => card(g.card).name === name && g.copied === copied);
  if (!d) throw new Error(`座位 ${i} 没有 ${name}（copied=${copied}）`);
  return d.points;
};

describe("科技计分（TC2、E10、E-T2）", () => {
  const sc = (c: number, g: number, t: number, w = 0) => scienceScore({ compass: c, gear: g, tablet: t }, w).score;

  it("TC2：3/2/1 = 21；2/2/2 = 26；4/0/0 = 16；3/3/3 = 48；0/0/0 = 0；6 个同符号 = 36", () => {
    expect([sc(3, 2, 1), sc(2, 2, 2), sc(4, 0, 0), sc(3, 3, 3), sc(0, 0, 0), sc(6, 0, 0), sc(0, 5, 0)]).toEqual([21, 26, 16, 48, 0, 36, 25]);
  });

  it("E10：3/2/1 加 1 个任选符号，最优是 31（3/2/2），不是原文的 26", () => {
    const r = scienceScore({ compass: 3, gear: 2, tablet: 1 }, 1);
    expect(r.score).toBe(31);
    expect(r.best).toEqual({ compass: 3, gear: 2, tablet: 2 });
  });

  it("E-T2：任选符号要枚举（贪心会错）", () => {
    expect(sc(2, 2, 2, 1)).toBe(31);
    expect(sc(0, 0, 0, 1)).toBe(1);
    expect(sc(4, 0, 0, 1)).toBe(25);
    expect(sc(1, 1, 0, 1)).toBe(10);
    expect(sc(2, 1, 0, 2)).toBe(18); // 贪心补最少 16、补最多 17
    expect(sc(4, 4, 4, 2)).toBe(96); // 6/4/4；平均分成 5/5/4 只有 94
    expect(sc(3, 3, 0, 2)).toBe(36);
  });

  it("0–6 张 × 0–2 个任选符号，全部和独立枚举的结果一致", () => {
    const bad: string[] = [];
    for (let c = 0; c <= 6; c++)
      for (let g = 0; g <= 6; g++)
        for (let t = 0; t <= 6; t++)
          for (let w = 0; w <= 2; w++) if (sc(c, g, t, w) !== science(c, g, t, w)) bad.push(`${c}/${g}/${t}+${w}`);
    expect(bad).toEqual([]);
  });

  it("巴比伦 A 科技阶段 + 科学家行会 = 2 个任选符号：圆规 2、齿轮 1 → 18（3/1/1）", () => {
    const s = fin([
      { wonder: "babylon", stages: 2, built: ["Scientists Guild", "Apothecary", "Dispensary", "Workshop"] },
      { wonder: "giza" },
      { wonder: "rhodes" },
    ]);
    const b = scoreBreakdown(s, P(0));
    expect(b.science).toBe(18);
    expect(b.scienceDetail.wild).toBe(2);
    expect(b.scienceDetail.best).toEqual({ compass: 3, gear: 1, tablet: 1 });
    expect(guildPts(s, 0, "Scientists Guild")).toBe(0); // 科学家的分算进科技
  });
});

describe("军事结算（规则书 §4.3，TC3，E14）", () => {
  it("TC3 Age II：甲 3 盾 vs 左邻 5 盾（−1）、vs 右邻 2 盾（+3）→ 净 +2；罗德岛的盾算进去", () => {
    const s = buildScene({
      age: 2,
      round: 6,
      players: [
        { wonder: "giza", built: ["Stockade", "Walls"] },
        { wonder: "babylon", built: ["Barracks", "Stables", "Archery Range"] },
        { wonder: "rhodes", stages: 2 }, // 2 盾来自奇迹
      ],
    });
    const t = round(s);
    expect(t.age).toBe(3);
    const tok = (i: number) => t.players[i]!.tokens.filter((k) => k.age === 2).map((k) => `${k.vs}:${k.value}`).sort();
    expect(tok(0)).toEqual(["left:-1", "right:3"]);
    expect(tok(1)).toEqual(["left:3", "right:3"]);
    expect(tok(2)).toEqual(["left:-1", "right:-1"]);
    const ev = t.events.find((e) => e.type === "MilitaryResolved");
    expect(ev).toBeTruthy();
    if (ev && ev.type === "MilitaryResolved") {
      expect(ev.age).toBe(2);
      const r0 = ev.results.find((r) => r.player === P(0))!;
      expect([r0.shields, r0.left, r0.right]).toEqual([3, -1, 3]);
    }
    expect(scoreBreakdown(t, P(0)).military).toBe(2);
  });

  it("盾一样多：双方都不拿标记；Age I 胜 +1、Age III 胜 +5", () => {
    const a1 = round(buildScene({ age: 1, round: 6, players: [{ wonder: "giza", built: ["Stockade"] }, { wonder: "babylon", built: ["Barracks"] }, { wonder: "olympia" }] }));
    expect(a1.players[0]!.tokens.map((k) => `${k.vs}:${k.value}`)).toEqual(["right:1"]);
    expect(a1.players[1]!.tokens.map((k) => `${k.vs}:${k.value}`)).toEqual(["left:1"]);
    const a3 = buildScene({ age: 3, round: 6, players: [{ wonder: "giza", built: ["Arsenal"] }, { wonder: "babylon" }, { wonder: "olympia" }] });
    const f = round(a3);
    expect(f.phase).toBe("finished");
    expect(f.players[0]!.tokens.filter((k) => k.age === 3).map((k) => k.value)).toEqual([5, 5]);
  });

  it("E14 全胜 +18、全败 −6", () => {
    const s = fin([
      { wonder: "giza", tokens: [1, 1, 3, 3, 5, 5] },
      { wonder: "babylon", tokens: [-1, -1, -1, -1, -1, -1] },
      { wonder: "rhodes" },
    ]);
    expect(scoreBreakdown(s, P(0)).military).toBe(18);
    expect(scoreBreakdown(s, P(1)).military).toBe(-6);
  });
});

describe("行会（规则书 §5.7，TC9，补充 §2.2 说明）", () => {
  it("TC9 船主：自己 2 棕 + 1 灰 + 1 紫（船主自己）= 4", () => {
    const s = fin([{ wonder: "giza", built: ["Shipowners Guild", "Lumber Yard", "Ore Vein", "Loom"] }, { wonder: "babylon", built: ["Clay Pool"] }, { wonder: "rhodes" }]);
    expect(guildPts(s, 0, "Shipowners Guild")).toBe(4);
  });

  it("TC9 工匠：两邻共 3 灰 = 6（自己的灰不算）", () => {
    const s = fin([
      { wonder: "giza", built: ["Craftsmens Guild", "Loom"] },
      { wonder: "babylon", built: ["Glassworks", "Press"] },
      { wonder: "rhodes", built: ["Loom@2"] },
    ]);
    expect(guildPts(s, 0, "Craftsmens Guild")).toBe(6);
  });

  it("TC9 军事家：两邻共 2 个败仗标记 = 2（自己的不算）", () => {
    const s = fin([
      { wonder: "giza", built: ["Strategists Guild"], tokens: [-1] },
      { wonder: "babylon", tokens: [-1, 1] },
      { wonder: "rhodes", tokens: [-1, 3] },
    ]);
    expect(guildPts(s, 0, "Strategists Guild")).toBe(2);
  });

  it("TC9 建筑师：两邻 + 自己共 5 个奇迹阶段 = 5", () => {
    const s = fin([{ wonder: "giza", stages: 1, built: ["Builders Guild"] }, { wonder: "babylon", stages: 2 }, { wonder: "rhodes", stages: 2 }]);
    expect(guildPts(s, 0, "Builders Guild")).toBe(5);
  });

  it("密探：两邻的红卡（罗德岛的盾不算，自己的红卡不算）", () => {
    const s = fin([
      { wonder: "giza", built: ["Spies Guild", "Stockade"] },
      { wonder: "rhodes", stages: 2, built: ["Barracks"] },
      { wonder: "babylon", built: ["Walls", "Guard Tower"] },
    ]);
    expect(guildPts(s, 0, "Spies Guild")).toBe(3);
  });

  it("法官、工人、商人、哲学家：只数两邻（奇迹起始资源不算棕卡）", () => {
    const mag = fin([{ wonder: "giza", built: ["Magistrates Guild", "Altar"] }, { wonder: "babylon", built: ["Baths", "Temple"] }, { wonder: "rhodes", built: ["Palace"] }]);
    expect(guildPts(mag, 0, "Magistrates Guild")).toBe(3);
    const wor = fin([{ wonder: "giza", built: ["Workers Guild", "Lumber Yard"] }, { wonder: "babylon", built: ["Stone Pit", "Sawmill"] }, { wonder: "rhodes" }]);
    expect(guildPts(wor, 0, "Workers Guild")).toBe(2);
    const tra = fin([{ wonder: "giza", built: ["Traders Guild", "Tavern"] }, { wonder: "babylon", built: ["Marketplace", "Vineyard"] }, { wonder: "rhodes", built: ["Haven"] }]);
    expect(guildPts(tra, 0, "Traders Guild")).toBe(3);
    const phi = fin([{ wonder: "giza", built: ["Philosophers Guild", "Workshop"] }, { wonder: "babylon", built: ["Library"] }, { wonder: "rhodes", built: ["Lodge", "Study"] }]);
    expect(guildPts(phi, 0, "Philosophers Guild")).toBe(3);
  });

  it("4 人局：对面座位不是邻居，行会不数它", () => {
    const s = fin([
      { wonder: "giza", built: ["Workers Guild"] },
      { wonder: "babylon", built: ["Lumber Yard"] },
      { wonder: "rhodes", built: ["Stone Pit", "Clay Pool", "Ore Vein"] },
      { wonder: "olympia", built: ["Clay Pit"] },
    ]);
    expect(guildPts(s, 0, "Workers Guild")).toBe(2);
  });
});

describe("奥林匹亚 B 阶段 3：终局复制一位邻居的行会（TC12，§2.5 说明，README #14）", () => {
  it("按奥林匹亚自己的两邻算分，不影响原主人", () => {
    const s = fin([
      { wonder: "olympia", side: "B", stages: 3, built: ["Stockade", "Barracks", "Guard Tower"] },
      { wonder: "babylon", built: ["Spies Guild", "Walls", "Stables"] },
      { wonder: "rhodes", built: ["Archery Range"] },
    ]);
    const b = scoreBreakdown(s, P(0));
    expect(card(b.copiedGuild!).name).toBe("Spies Guild");
    expect(guildPts(s, 0, "Spies Guild", true)).toBe(3); // 我的两邻：左 2 张红 + 右 1 张红
    expect(b.guilds).toBe(3);
    expect(guildPts(s, 1, "Spies Guild")).toBe(4); // 原主人：两邻 3 + 1
  });

  it("两邻都有行会时挑总分最高的那张", () => {
    const s = fin([
      { wonder: "olympia", side: "B", stages: 3 },
      { wonder: "babylon", built: ["Spies Guild", "Walls", "Altar", "Baths", "Temple", "Palace", "Senate"] },
      { wonder: "rhodes", built: ["Magistrates Guild"] },
    ]);
    const b = scoreBreakdown(s, P(0));
    expect(card(b.copiedGuild!).name).toBe("Magistrates Guild");
    expect(b.guilds).toBe(5);
  });

  it("复制科学家行会 = 多 1 个任选符号；邻居都没有行会时不得分；对面的行会不能复制", () => {
    const sci = fin([{ wonder: "olympia", side: "B", stages: 3, built: ["Workshop", "Apothecary"] }, { wonder: "babylon", built: ["Scientists Guild"] }, { wonder: "rhodes" }]);
    expect(scoreBreakdown(sci, P(0)).science).toBe(10);
    const none = fin([{ wonder: "olympia", side: "B", stages: 3 }, { wonder: "babylon" }, { wonder: "rhodes" }]);
    expect(scoreBreakdown(none, P(0)).copiedGuild).toBeNull();
    expect(scoreBreakdown(none, P(0)).guilds).toBe(0);
    const far = fin([{ wonder: "olympia", side: "B", stages: 3 }, { wonder: "babylon" }, { wonder: "rhodes", built: ["Magistrates Guild"] }, { wonder: "giza", built: ["Altar"] }]);
    expect(scoreBreakdown(far, P(0)).copiedGuild).toBeNull();
  });

  it("阶段 3 没建时不复制", () => {
    const s = fin([{ wonder: "olympia", side: "B", stages: 2 }, { wonder: "babylon", built: ["Magistrates Guild"] }, { wonder: "rhodes", built: ["Altar"] }]);
    expect(scoreBreakdown(s, P(0)).copiedGuild).toBeNull();
  });
});

describe("商业终局分（规则书 §5.6，TC11）", () => {
  it("港口 1/棕、灯塔 1/黄（含自己）、商会 2/灰、竞技场 1/奇迹阶段：2 + 5 + 2 + 2 = 11", () => {
    const s = fin([
      { wonder: "giza", stages: 2, built: ["Haven", "Lighthouse", "Chamber of Commerce", "Arena", "Lumber Yard", "Ore Vein", "Loom", "Tavern"] },
      { wonder: "babylon" },
      { wonder: "rhodes" },
      { wonder: "olympia" },
    ]);
    expect(scoreBreakdown(s, P(0)).commerce).toBe(11);
  });

  it("TC11 商会终局 3 灰 → 6 分", () => {
    const s = fin([{ wonder: "giza", built: ["Chamber of Commerce", "Loom", "Press", "Glassworks"] }, { wonder: "babylon" }, { wonder: "rhodes" }, { wonder: "olympia" }]);
    expect(scoreBreakdown(s, P(0)).commerce).toBe(6);
  });
});

describe("终局七项和胜负（规则书 §5、§6，TC10）", () => {
  it("七项逐项：军事 3、金币 4（14 金）、奇迹 15、文明 10、科技 10、商业 1、行会 3 = 46", () => {
    const s = fin([
      {
        wonder: "giza",
        stages: 3,
        coins: 14,
        tokens: [1, 3, -1],
        built: ["Altar", "Palace", "Workshop", "Apothecary", "Scriptorium", "Lighthouse", "Workers Guild"],
      },
      { wonder: "babylon", built: ["Lumber Yard", "Stone Pit"] },
      { wonder: "rhodes", built: ["Clay Pool"] },
    ]);
    const b = scoreBreakdown(s, P(0));
    expect([b.military, b.coins, b.wonder, b.civilian, b.science, b.commerce, b.guilds, b.total]).toEqual([3, 4, 15, 10, 10, 1, 3, 46]);
    expect(b.coinsHeld).toBe(14);
    expect(s.finalResult!.winners).toEqual([P(0)]);
    expect(s.finalResult!.scores[0]!.total).toBe(46);
    expect(oracleScore(s.players, 0).total).toBe(46);
  });

  it("TC10 总分一样比金币：14 金胜 12 金（都是 4 分）；金币也一样就并列、名次相同", () => {
    const a = fin([{ wonder: "giza", coins: 14 }, { wonder: "rhodes", coins: 12 }, { wonder: "babylon", coins: 0 }]);
    expect(a.finalResult!.winners).toEqual([P(0)]);
    expect(a.finalResult!.scores.map((x) => x.rank)).toEqual([1, 2, 3]);
    const b = fin([{ wonder: "giza", coins: 14 }, { wonder: "rhodes", coins: 14 }, { wonder: "babylon", coins: 0 }]);
    expect([...b.finalResult!.winners].sort()).toEqual([P(0), P(1)]);
    expect(b.finalResult!.scores.map((x) => x.rank)).toEqual([1, 1, 3]);
  });

  it("预览局面 final / finalTie：引擎的七项分数和独立计分逐项一致", () => {
    for (const name of ["final", "finalTie"] as const) {
      const s = scene(name);
      expect(s.phase).toBe("finished");
      s.finalResult!.scores.forEach((sc, i) => {
        const o = oracleScore(s.players, i);
        expect([sc.military, sc.coins, sc.wonder, sc.civilian, sc.science, sc.commerce, sc.guilds, sc.total], `${name} 座位 ${i}`).toEqual([
          o.military,
          o.coins,
          o.wonder,
          o.civilian,
          o.science,
          o.commerce,
          o.guilds,
          o.total,
        ]);
      });
    }
    const tie = scene("finalTie").finalResult!;
    expect([...tie.winners].sort()).toEqual([P(0), P(2)]);
  });
});
