/**
 * 规则核对 · 建造和付款：规则书 §4.1、§4.2，补充 E2、E12、E17，TC4、TC5、TC6、E-T3、E-T4、E-T10、E-T12、E-T13，
 * README 默认规则表 #6（U4）、#11（U10）、#16。
 */
import { describe, expect, it } from "vitest";
import { apply, buildScene, card, paymentOptions, priceOf, shieldsOf, tradeCombos, type GameState } from "@wonders/game";
import { act, builtNames, handId, P, round } from "./helpers.js";

const opts = (s: GameState, i: number, name: string) => paymentOptions(s, P(i), { card: handId(s, i, name) });
const combos = (s: GameState, i: number, cost: string) => tradeCombos(s, i, cost).map((c) => `${c.left}|${c.right}|${c.leftCost}|${c.rightCost}`).sort();

describe("TC4 买资源", () => {
  const base = (coins: number, extra: string[] = []) =>
    buildScene({
      age: 3,
      round: 5,
      players: [
        { wonder: "giza", built: ["Lumber Yard", "Glassworks", ...extra], coins, hand: ["University", "Gardens", "Palace"] },
        { wonder: "olympia" }, // 左邻：产木
        { wonder: "ephesus" }, // 右邻：产纸
      ],
    });

  it("大学（2 木 + 1 玻 + 1 纸）：自产 1 木 1 玻，左邻买 1 木、右邻买 1 纸，各付 2 金", () => {
    const s = base(4);
    const info = opts(s, 0, "University");
    expect(info.options.length).toBe(1);
    const o = info.options[0]!;
    expect([o.kind, o.left, o.right, o.leftCost, o.rightCost, o.bankCost, o.total]).toEqual(["trade", "W", "P", 2, 2, 0, 4]);
    const s1 = round(s, { 0: { build: "University" } });
    expect(builtNames(s1, 0)).toContain("University");
    expect(s1.players[0]!.coins).toBe(0);
    expect(s1.players[1]!.coins).toBe(3 + 3 + 2); // 弃牌 3 + 卖木 2
    expect(s1.players[2]!.coins).toBe(3 + 3 + 2);
  });

  it("0 金：大学建不了（被拒绝），但这张牌还能拿去建奇迹（奇迹成本自己产得出）", () => {
    const s = base(0, ["Stone Pit"]);
    const info = opts(s, 0, "University");
    expect(info.options).toEqual([]);
    expect(info.reason).toBeTruthy();
    expect(() => act(s, 0, { build: "University" })).toThrow();
    expect(() => act(s, 0, { build: "University", trade: { left: "W", right: "P" } })).toThrow();
    const s1 = round(s, { 0: { wonder: "University" } });
    expect(s1.players[0]!.stages).toBe(1);
    expect(s1.players[0]!.built).not.toContain(handId(s, 0, "University"));
  });
});

describe("TC5 交易折扣（东 / 西贸易站、市场）", () => {
  const westScene = (withPost: boolean) =>
    buildScene({
      age: 2,
      round: 6,
      players: [
        { wonder: "giza", built: withPost ? ["West Trading Post"] : [], coins: 5, hand: ["Aqueduct", "Statue"] },
        { wonder: "babylon", built: ["Quarry"] },
        { wonder: "rhodes" },
      ],
    });

  it("有西贸易站：从左邻买 2 份原料 = 2 金；没有时 = 4 金", () => {
    const a = opts(westScene(true), 0, "Aqueduct").options[0]!;
    expect([a.left, a.leftCost, a.total]).toEqual(["SS", 2, 2]);
    const b = opts(westScene(false), 0, "Aqueduct").options[0]!;
    expect([b.left, b.leftCost, b.total]).toEqual(["SS", 4, 4]);
  });

  it("东贸易站 = 右邻原料 1 金，西贸易站 = 左邻原料 1 金（补充 §1.3）", () => {
    const s = buildScene({
      age: 1,
      round: 6,
      players: [
        { wonder: "halicarnassus", built: ["East Trading Post"], hand: ["Stockade", "Barracks"] },
        { wonder: "olympia" }, // 左邻 木
        { wonder: "rhodes", built: ["Lumber Yard"] }, // 右邻 木、矿
      ],
    });
    expect(combos(s, 0, "W")).toEqual(["|W|0|1", "W||2|0"].sort());
    expect(priceOf(s.players[0]!, "right", "W")).toBe(1);
    expect(priceOf(s.players[0]!, "left", "W")).toBe(2);
    // 默认方案取最便宜的：向右邻买
    const d = opts(s, 0, "Stockade").options[0]!;
    expect([d.isDefault, d.left, d.right, d.total]).toEqual([true, "", "W", 1]);
  });

  it("市场：从两邻买制成品都是 1 金，原料不打折", () => {
    const s = buildScene({
      age: 1,
      round: 6,
      players: [
        { wonder: "giza", built: ["Marketplace"], hand: ["Workshop", "Apothecary"] },
        { wonder: "alexandria" }, // 左邻 玻
        { wonder: "halicarnassus" }, // 右邻 布
      ],
    });
    const w = opts(s, 0, "Workshop").options[0]!;
    expect([w.left, w.leftCost]).toEqual(["G", 1]);
    const a = opts(s, 0, "Apothecary").options[0]!;
    expect([a.right, a.rightCost]).toEqual(["L", 1]);
    expect(priceOf(s.players[0]!, "left", "W")).toBe(2);
    expect(priceOf(s.players[0]!, "right", "O")).toBe(2);
  });

  it("E-T10 奥林匹亚 B 阶段 1 + 东贸易站：从右邻买石 = 1 金（不叠加成 0）；左邻原料也是 1 金；左邻玻璃 = 2 金", () => {
    const s = buildScene({
      age: 1,
      round: 6,
      players: [
        { wonder: "olympia", side: "B", stages: 1, built: ["East Trading Post"], hand: ["Baths", "Workshop"] },
        { wonder: "alexandria", built: ["Ore Vein"] }, // 左邻 玻、矿
        { wonder: "giza" }, // 右邻 石
      ],
    });
    expect(combos(s, 0, "S")).toEqual(["|S|0|1"]);
    expect(combos(s, 0, "O")).toEqual(["O||1|0"]);
    expect(combos(s, 0, "G")).toEqual(["G||2|0"]);
    const b = opts(s, 0, "Baths").options[0]!;
    expect([b.right, b.rightCost, b.total]).toEqual(["S", 1, 1]);
  });
});

describe("二选一卡、两邻同时买、卖家照用（规则书 §4.2）", () => {
  it("买家选二选一卡的一种，卖家同一轮自己用另一种：两人都建成", () => {
    const s = buildScene({
      age: 1,
      round: 6,
      players: [
        { wonder: "giza", hand: ["Stockade", "Altar"] },
        { wonder: "babylon", built: ["Timber Yard"], hand: ["Baths", "Theater"] }, // 木材场 石/木
        { wonder: "rhodes" },
      ],
    });
    expect(combos(s, 0, "W")).toEqual(["W||2|0"]);
    let t = act(s, 0, { build: "Stockade", trade: { left: "W", right: "" } });
    t = act(t, 1, { build: "Baths" });
    t = round(t);
    expect(t.age).toBe(2);
    expect(builtNames(t, 0)).toContain("Stockade");
    expect(builtNames(t, 1)).toEqual(["Timber Yard", "Baths"]);
    expect(t.players[1]!.coins).toBe(3 + 2);
  });

  it("左右两邻同一轮买同一张卡的同一份资源：都能买到，卖家收两份钱", () => {
    const s = buildScene({
      age: 2,
      round: 6,
      players: [
        { wonder: "rhodes", built: ["Ore Vein"], hand: ["Statue", "Courthouse"] }, // 雕像 木矿矿
        { wonder: "babylon", built: ["Timber Yard"] }, // 座位 0 的左邻、座位 2 的右邻
        { wonder: "ephesus", hand: ["School", "Temple"] }, // 学校 木纸
      ],
    });
    let t = act(s, 0, { build: "Statue", trade: { left: "W", right: "" } });
    t = act(t, 2, { build: "School", trade: { left: "", right: "W" } });
    t = round(t);
    expect(builtNames(t, 0)).toContain("Statue");
    expect(builtNames(t, 2)).toContain("School");
    expect(t.players[1]!.coins).toBe(3 + 3 + 4);
  });
});

describe("不能卖的产出：商队旅馆、广场、亚历山大的阶段（规则书 §4.2、§2.4 注）", () => {
  const s = buildScene({
    age: 2,
    round: 6,
    players: [
      { wonder: "giza", built: ["Ore Vein", "Clay Pit"], coins: 9, hand: ["Statue", "Dispensary"] },
      { wonder: "alexandria", stages: 2, built: ["Caravansery", "Forum"] }, // 左邻：只有起始玻璃能卖
      { wonder: "rhodes" },
    ],
  });

  it("左邻的商队旅馆、亚历山大 A 阶段 2 产的木买不到：雕像建不了，硬塞买法被拒绝", () => {
    expect(combos(s, 0, "W")).toEqual([]);
    expect(opts(s, 0, "Statue").options).toEqual([]);
    expect(() => act(s, 0, { build: "Statue", trade: { left: "W", right: "" } })).toThrow();
  });

  it("左邻的广场产的制成品买不到，但亚历山大的起始玻璃能买", () => {
    expect(combos(s, 0, "G")).toEqual(["G||2|0"]);
    expect(combos(s, 0, "L")).toEqual([]);
    expect(combos(s, 0, "P")).toEqual([]);
    const d = opts(s, 0, "Dispensary").options[0]!;
    expect([d.left, d.leftCost]).toEqual(["G", 2]);
  });

  it("商队旅馆自己能用：有商队旅馆 + 两份矿就能自产建雕像", () => {
    const t = buildScene({
      age: 2,
      round: 6,
      players: [{ wonder: "giza", built: ["Caravansery", "Ore Vein", "Clay Pit"], coins: 0, hand: ["Statue", "Dispensary"] }, { wonder: "babylon" }, { wonder: "rhodes" }],
    });
    const o = opts(t, 0, "Statue").options[0]!;
    expect([o.kind, o.total]).toEqual(["own", 0]);
  });
});

describe("E2 / E-T3 二选一原料卡要付 1 金给银行", () => {
  const sc = (coins: number) =>
    buildScene({ age: 1, round: 6, players: [{ wonder: "giza", coins, hand: ["Clay Pit", "Altar"] }, { wonder: "babylon" }, { wonder: "rhodes" }] });

  it("0 金：黏土坑建不了", () => {
    expect(opts(sc(0), 0, "Clay Pit").options).toEqual([]);
    expect(() => act(sc(0), 0, { build: "Clay Pit" })).toThrow();
  });

  it("1 金：能建，付 1 金给银行，建完 0 金", () => {
    const o = opts(sc(1), 0, "Clay Pit").options[0]!;
    expect([o.kind, o.bankCost, o.total]).toEqual(["own", 1, 1]);
    const t = round(sc(1), { 0: { build: "Clay Pit" } });
    expect(builtNames(t, 0)).toContain("Clay Pit");
    expect(t.players[0]!.coins).toBe(0);
  });
});

describe("E17 / E-T12 本轮新赚的钱本轮不能用", () => {
  it("甲回合开始 1 金，左邻同一轮向甲买 2 份石（甲该收 4 金）：甲这轮仍买不起图书馆，下一轮有 5 金", () => {
    const s = buildScene({
      age: 2,
      round: 6,
      players: [
        { wonder: "giza", built: ["Stone Pit"], coins: 1, hand: ["Library", "Press@2"] },
        { wonder: "babylon", built: ["Loom"], coins: 6, hand: ["Aqueduct", "Temple"] },
        { wonder: "rhodes", built: ["Quarry"] },
      ],
    });
    // 左邻先交：向右邻（甲）买 2 石、向左邻买 1 石，共 6 金
    let t = act(s, 1, { build: "Aqueduct", trade: { left: "S", right: "SS" } });
    expect(paymentOptions(t, P(0), { card: handId(t, 0, "Library") }).options).toEqual([]);
    expect(() => act(t, 0, { build: "Library" })).toThrow();
    expect(() => act(t, 0, { build: "Library", trade: { left: "L", right: "" } })).toThrow();
    t = act(t, 0, { build: "Press" });
    t = round(t);
    expect(builtNames(t, 1)).toContain("Aqueduct");
    expect(t.players[0]!.coins).toBe(5);
    expect(t.players[1]!.coins).toBe(0);
    expect(t.players[2]!.coins).toBe(3 + 2 + 3);
  });

  it("卖家本轮刚收的钱也不能用来付自己卡上的金币：0 金的人卖了资源，同一轮还是建不了要 1 金的卡", () => {
    const s = buildScene({
      age: 1,
      round: 6,
      players: [
        { wonder: "giza", coins: 0, hand: ["Timber Yard", "Altar"] },
        { wonder: "olympia", coins: 3, hand: ["Baths", "Theater"] }, // 左邻向甲买石
        { wonder: "rhodes" },
      ],
    });
    const t = act(s, 1, { build: "Baths", trade: { left: "", right: "S" } });
    expect(() => act(t, 0, { build: "Timber Yard" })).toThrow();
  });
});

describe("E17 / E-T13 邻居本轮刚建的资源本轮买不到；贸易站下一轮才打折", () => {
  it("右邻本轮建伐木场，甲本轮买不到木；下一轮能买", () => {
    const s = buildScene({
      age: 1,
      round: 5,
      players: [
        { wonder: "giza", hand: ["Stockade", "Altar", "Theater"] },
        { wonder: "babylon" },
        { wonder: "rhodes", hand: ["Lumber Yard", "Baths", "Clay Pool"] },
      ],
    });
    let t = act(s, 2, { build: "Lumber Yard" });
    expect(combos(t, 0, "W")).toEqual([]);
    expect(opts(t, 0, "Stockade").options).toEqual([]);
    expect(() => act(t, 0, { build: "Stockade", trade: { left: "", right: "W" } })).toThrow();
    t = round(t, { 0: { build: "Altar" } });
    expect(t.round).toBe(6);
    expect(combos(t, 0, "W")).toEqual(["|W|0|2"]);
  });

  it("第 5 轮建西贸易站，第 6 轮向左邻买木才是 1 金", () => {
    const s = buildScene({
      age: 1,
      round: 5,
      players: [
        { wonder: "giza", hand: ["West Trading Post", "Altar", "Theater"] },
        { wonder: "olympia" }, // 左邻 木
        { wonder: "rhodes", hand: ["Stockade", "Baths", "Clay Pool"] },
      ],
    });
    expect(combos(s, 0, "W")).toEqual(["W||2|0"]);
    let t = act(s, 0, { build: "West Trading Post" });
    expect(combos(t, 0, "W")).toEqual(["W||2|0"]); // 交了还没亮：仍按回合开始时的城算
    t = round(t, { 2: { discard: "Baths" } });
    expect(t.round).toBe(6);
    expect(combos(t, 0, "W")).toEqual(["W||1|0"]);
    const o = opts(t, 0, "Stockade").options[0]!;
    expect([o.left, o.leftCost]).toEqual(["W", 1]);
  });
});

describe("README #11（U10）两邻都卖、一样便宜时默认向右邻买；#16 不能多买", () => {
  const s = buildScene({
    age: 1,
    round: 6,
    players: [
      { wonder: "olympia", hand: ["Baths", "Altar"] },
      { wonder: "giza" }, // 左邻 石
      { wonder: "halicarnassus", built: ["Stone Pit"] }, // 右邻 石
    ],
  });

  it("浴场缺 1 石：两个方案，默认向右邻买", () => {
    const info = opts(s, 0, "Baths");
    expect(info.options.length).toBe(2);
    const [d, other] = info.options;
    expect([d!.isDefault, d!.left, d!.right]).toEqual([true, "", "S"]);
    expect([other!.isDefault, other!.left, other!.right]).toEqual([false, "S", ""]);
    // 不给 trade 就用默认方案：右邻收钱
    const t = round(s, { 0: { build: "Baths" } });
    expect(t.players[2]!.coins).toBe(3 + 2 + 3);
    expect(t.players[1]!.coins).toBe(3 + 3);
  });

  it("开工拍板「一次提交买资源方案」：指定向左邻买（非默认），结算时钱给左邻", () => {
    const t = round(s, { 0: { build: "Baths", trade: { left: "S", right: "" } } });
    expect(t.players[1]!.coins).toBe(3 + 3 + 2);
    expect(t.players[2]!.coins).toBe(3 + 3);
  });

  it("自己产得出还硬要买（多买）、向不产这种资源的邻居买、钱不够的买法：都被拒绝", () => {
    const g = buildScene({ age: 1, round: 6, players: [{ wonder: "giza", coins: 1, hand: ["Baths", "Altar"] }, { wonder: "olympia" }, { wonder: "rhodes" }] });
    expect(() => act(g, 0, { build: "Baths", trade: { left: "", right: "S" } })).toThrow();
    expect(() => act(s, 0, { build: "Altar", trade: { left: "S", right: "" } })).toThrow();
    const poor = buildScene({ age: 1, round: 6, players: [{ wonder: "olympia", coins: 1, hand: ["Baths", "Altar"] }, { wonder: "giza" }, { wonder: "rhodes" }] });
    expect(() => act(poor, 0, { build: "Baths", trade: { left: "S", right: "" } })).toThrow();
    expect(() => act(poor, 0, { build: "Baths", trade: { left: "", right: "O" } })).toThrow();
  });
});

describe("TC6 免费链和同名卡（规则书 §4.1，E12，E-T4）", () => {
  it("Age I 建过写字间：Age II 图书馆免费（0 金也行，不付资源）", () => {
    const s = buildScene({ age: 2, round: 6, players: [{ wonder: "giza", built: ["Scriptorium"], coins: 0, hand: ["Library", "Courthouse"] }, { wonder: "babylon" }, { wonder: "rhodes" }] });
    const info = opts(s, 0, "Library");
    expect(info.options.length).toBe(1);
    expect([info.options[0]!.kind, info.options[0]!.total]).toEqual(["chain", 0]);
    const t = round(s, { 0: { build: "Library" } });
    expect(builtNames(t, 0)).toContain("Library");
    expect(t.players[0]!.coins).toBe(0);
  });

  it("没建写字间：图书馆要付资源（0 金又产不出 → 建不了）", () => {
    const s = buildScene({ age: 2, round: 6, players: [{ wonder: "giza", coins: 0, hand: ["Library", "Courthouse"] }, { wonder: "babylon" }, { wonder: "rhodes" }] });
    expect(opts(s, 0, "Library").options).toEqual([]);
  });

  it("E12 广场：只建过东贸易站也能免费链", () => {
    const s = buildScene({ age: 2, round: 6, players: [{ wonder: "giza", built: ["East Trading Post"], coins: 0, hand: ["Forum", "Courthouse"] }, { wonder: "babylon" }, { wonder: "rhodes" }] });
    expect(opts(s, 0, "Forum").options.map((o) => o.kind)).toEqual(["chain"]);
  });

  it("E-T4 攻城工坊：建过实验室免费、盾 +3；没建实验室的人要付 1 木 + 3 砖", () => {
    const s = buildScene({
      age: 3,
      round: 6,
      players: [
        { wonder: "giza", built: ["Laboratory", "Clay Pit"], coins: 0, hand: ["Siege Workshop", "Gardens"] },
        { wonder: "babylon", coins: 10, hand: ["Siege Workshop", "Senate"] },
        { wonder: "rhodes", built: ["Lumber Yard", "Clay Pool"] },
        { wonder: "olympia" },
        { wonder: "ephesus" },
      ],
    });
    expect(opts(s, 0, "Siege Workshop").options.map((o) => o.kind)).toEqual(["chain"]);
    const other = opts(s, 1, "Siege Workshop").options;
    expect(other.length).toBeGreaterThan(0);
    expect(other.every((o) => o.kind !== "chain" && o.total > 0)).toBe(true);
    const t = round(s, { 0: { build: "Siege Workshop" } });
    expect(shieldsOf(t.players[0]!)).toBe(3);
    expect(t.players[0]!.coins).toBe(0);
  });

  it("同名不能建两张：Age I 建过织布机，Age II 的织布机只能垫奇迹或弃掉", () => {
    const s = buildScene({ age: 2, round: 6, players: [{ wonder: "giza", built: ["Loom", "Stone Pit"], hand: ["Loom@2", "Courthouse"] }, { wonder: "babylon" }, { wonder: "rhodes" }] });
    const loom = s.players[0]!.hand.find((id) => card(id).name === "Loom")!;
    expect(card(loom).age).toBe(2);
    const info = paymentOptions(s, P(0), { card: loom });
    expect(info.options).toEqual([]);
    expect(info.reason).toBeTruthy();
    expect(() => apply(s, P(0), { type: "PLAY", card: loom, action: "build" })).toThrow();
    const w = round(s, { 0: { type: "PLAY", card: loom, action: "wonder" } });
    expect(w.players[0]!.stages).toBe(1);
    const d = round(s, { 0: { type: "PLAY", card: loom, action: "discard" } });
    expect(d.players[0]!.coins).toBe(3 + 3);
  });
});

describe("README #6（U4）巴比伦第 7 张：用第 6 轮结算完以后的金币和折扣", () => {
  it("回合开始 0 金；第 6 轮右邻向我买砖 +2、我刚建了西贸易站 → 第 7 张向左邻买木只要 1 金", () => {
    const s = buildScene({
      age: 1,
      round: 6,
      players: [
        { wonder: "babylon", side: "B", stages: 2, coins: 0, hand: ["West Trading Post", "Stockade"] },
        { wonder: "olympia" }, // 左邻 木
        { wonder: "rhodes", hand: ["Guard Tower", "Altar"] }, // 右邻（座位 2 的左邻是座位 0）买砖
      ],
    });
    let t = act(s, 0, { build: "West Trading Post" });
    t = act(t, 2, { build: "Guard Tower", trade: { left: "C", right: "" } });
    t = round(t);
    expect(t.phase).toBe("seventh");
    expect(t.pending).toEqual({ type: "seventh", player: P(0) });
    expect(t.players[0]!.coins).toBe(2);
    const o = paymentOptions(t, P(0), { card: handId(t, 0, "Stockade") }).options[0]!;
    expect([o.left, o.leftCost]).toEqual(["W", 1]);
    t = act(t, 0, { build: "Stockade" });
    expect(builtNames(t, 0)).toContain("Stockade");
    expect(t.players[0]!.coins).toBe(1);
  });
});
