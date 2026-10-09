/**
 * 规则核对 · 奇迹和插入步骤：规则书 §2.4、§4.1b，补充 §1.1 核对表、TC7、TC12、E-T5–E-T9、E-T11，
 * §5 U3（第 6 轮顺序）、U5、U6、U7，README 默认规则表 #5、#7、#9、#10。
 */
import { describe, expect, it } from "vitest";
import {
  apply,
  buildScene,
  card,
  discardBuildOptions,
  paymentOptions,
  scoreBreakdown,
  shieldsOf,
  type GameState,
} from "@wonders/game";
import { act, builtNames, handId, P, round } from "./helpers.js";

const stageOpts = (s: GameState, i: number) => paymentOptions(s, P(i), { stage: true });

describe("奇迹阶段：按顺序、每阶段一次、垫下去的牌保密且不算建筑（规则书 §4.1b，TC7）", () => {
  it("阶段 1（2 石）付不起时不能跳过去建阶段 2（3 木），即使阶段 2 付得起", () => {
    const s = buildScene({
      age: 1,
      round: 6,
      players: [
        { wonder: "giza", built: ["Lumber Yard", "Forest Cave", "Tree Farm"], coins: 0, hand: ["Altar", "Theater"] },
        { wonder: "babylon" },
        { wonder: "rhodes" },
        { wonder: "olympia" },
        { wonder: "ephesus" },
        { wonder: "alexandria" },
      ],
    });
    expect(stageOpts(s, 0).options).toEqual([]);
    expect(() => act(s, 0, { wonder: "Altar" })).toThrow();
  });

  it("建满了（金字塔 A 三阶段）就不能再建", () => {
    const s = buildScene({ age: 3, round: 6, players: [{ wonder: "giza", stages: 3, coins: 20, hand: ["Gardens", "Senate"] }, { wonder: "babylon" }, { wonder: "rhodes" }] });
    const info = stageOpts(s, 0);
    expect(info.options).toEqual([]);
    expect(info.reason).toBeTruthy();
    expect(() => act(s, 0, { wonder: "Gardens" })).toThrow();
  });

  it("垫奇迹付的是奇迹板的成本：金字塔 A 阶段 1 = 2 石；垫下的牌进 stageCards，不进城、不进弃牌堆、不算颜色", () => {
    const s = buildScene({ age: 1, round: 6, players: [{ wonder: "giza", built: ["Stone Pit"], coins: 0, hand: ["Stockade", "Altar"] }, { wonder: "babylon" }, { wonder: "rhodes" }] });
    const o = stageOpts(s, 0).options[0]!;
    expect([o.kind, o.total]).toEqual(["own", 0]);
    const stockade = handId(s, 0, "Stockade");
    const dc = s.discardCount;
    const t = round(s, { 0: { wonder: "Stockade" } });
    const p = t.players[0]!;
    expect(p.stages).toBe(1);
    expect(p.stageCards).toContain(stockade);
    expect(p.built).not.toContain(stockade);
    expect(shieldsOf(p)).toBe(0); // 栅栏垫下去不给盾
    expect(t.discardCount).toBe(dc + 2 + 3); // 两位邻居各弃 1 张 + 三人各作废 1 张
    expect(scoreBreakdown(t, P(0)).wonder).toBe(3);
  });

  it("E-T5 罗德岛 A：有伐木场，阶段 1（2 木）还缺 1 木要买；阶段 2（3 砖）建成后盾 +2", () => {
    const s = buildScene({ age: 1, round: 6, players: [{ wonder: "rhodes", built: ["Lumber Yard"], coins: 5, hand: ["Altar", "Theater"] }, { wonder: "olympia" }, { wonder: "giza", built: ["Timber Yard"] }] });
    const info = stageOpts(s, 0);
    expect(info.options.length).toBeGreaterThan(0);
    for (const o of info.options) expect(o.left + o.right).toBe("W");
    const r2 = buildScene({ age: 1, round: 6, players: [{ wonder: "rhodes", stages: 2, hand: ["Altar", "Theater"] }, { wonder: "olympia" }, { wonder: "giza" }] });
    expect(shieldsOf(r2.players[0]!)).toBe(2);
  });

  it("以弗所 A 阶段 2：立即 +9 金；以弗所 B 阶段 1：+4 金、2 分", () => {
    const a = buildScene({ age: 1, round: 5, players: [{ wonder: "ephesus", stages: 1, built: ["Lumber Yard", "Timber Yard"], coins: 0, hand: ["Altar", "Theater", "Baths"] }, { wonder: "olympia" }, { wonder: "giza" }] });
    const a1 = round(a, { 0: { wonder: "Altar" } });
    expect(a1.players[0]!.stages).toBe(2);
    expect(a1.players[0]!.coins).toBe(9);
    const b = buildScene({ age: 1, round: 5, players: [{ wonder: "ephesus", side: "B", built: ["Stone Pit", "Timber Yard"], coins: 1, hand: ["Altar", "Theater", "Baths"] }, { wonder: "olympia" }, { wonder: "rhodes" }] });
    const t = round(b, { 0: { wonder: "Altar" } });
    expect(t.players[0]!.stages).toBe(1);
    expect(t.players[0]!.coins).toBe(1 + 4);
    expect(scoreBreakdown(t, P(0)).wonder).toBe(2);
  });
});

describe("哈利卡纳苏斯：从弃牌堆免费建（TC7、E-T6、E-T7、U7，README #9、#10）", () => {
  const tc7 = () =>
    buildScene({
      age: 1,
      round: 3,
      discard: ["Stockade", "Guard Tower"],
      players: [
        { wonder: "halicarnassus", stages: 1, built: ["Ore Vein", "Clay Pit"], coins: 5, hand: ["Altar", "Theater", "Baths", "Workshop", "Scriptorium"] },
        { wonder: "babylon" },
        { wonder: "rhodes" }, // 右邻产矿
      ],
    });

  it("TC7 第 3 轮建成 A 阶段 2：回合结束翻弃牌堆挑 1 张免费建，可选本轮刚弃的牌；挑完才传牌", () => {
    const s = tc7();
    const p1card = s.players[1]!.hand[0]!;
    const p2card = s.players[2]!.hand[0]!;
    const altar = handId(s, 0, "Altar");
    let t = round(s, { 0: { wonder: "Altar" } });
    expect(t.players[0]!.stages).toBe(2);
    expect(t.phase).toBe("discardBuild");
    expect(t.pending).toEqual({ type: "discardBuild", player: P(0) });
    expect(t.round).toBe(3);
    const optsIds = discardBuildOptions(t, P(0));
    const stockade = optsIds.find((id) => card(id).name === "Stockade")!;
    expect(stockade).toBeTruthy();
    expect(optsIds).toContain(p1card);
    expect(optsIds).toContain(p2card);
    expect(optsIds).not.toContain(altar); // 垫奇迹的牌不在弃牌堆
    // 别人这时不能出牌
    expect(() => apply(t, P(1), { type: "PLAY", card: t.players[1]!.hand[0]!, action: "discard" })).toThrow();
    const coins = t.players[0]!.coins;
    const dc = t.discardCount;
    t = apply(t, P(0), { type: "DISCARD_BUILD", card: stockade }).state;
    expect(t.players[0]!.built).toContain(stockade);
    expect(t.players[0]!.coins).toBe(coins);
    expect(t.discardCount).toBe(dc - 1);
    expect(t.phase).toBe("play");
    expect(t.round).toBe(4);
    for (const p of t.players) expect(p.hand.length).toBe(4);
  });

  it("挑弃牌堆里没有的牌被拒绝；可以放弃（card: null），放弃后照常传牌进下一轮", () => {
    const s = tc7();
    let t = round(s, { 0: { wonder: "Altar" } });
    const theater = handId(s, 0, "Theater");
    expect(() => apply(t, P(0), { type: "DISCARD_BUILD", card: theater })).toThrow(); // 在手里、不在弃牌堆
    expect(() => apply(t, P(1), { type: "DISCARD_BUILD", card: null })).toThrow(); // 不是他挑
    t = apply(t, P(0), { type: "DISCARD_BUILD", card: null }).state;
    expect(t.phase).toBe("play");
    expect(t.round).toBe(4);
  });

  it("同名建过的弃牌不能选（7 人局：栅栏 3+ / 7+ 两张）", () => {
    const s7 = buildScene({
      age: 2,
      round: 3,
      discard: ["Stockade"],
      players: [
        { wonder: "halicarnassus", stages: 1, built: ["Stockade", "Ore Vein", "Foundry"], coins: 5, hand: ["Aqueduct", "Temple", "Statue", "Courthouse", "Walls"] },
        { wonder: "babylon" },
        { wonder: "rhodes" },
        { wonder: "olympia" },
        { wonder: "ephesus" },
        { wonder: "alexandria" },
        { wonder: "giza" },
      ],
    });
    const dupe = s7.discard.find((id) => card(id).name === "Stockade")!;
    expect(dupe).toBeTruthy();
    expect(s7.players[0]!.built).not.toContain(dupe);
    const t = round(s7, { 0: { wonder: "Aqueduct" } });
    expect(t.phase).toBe("discardBuild");
    expect(discardBuildOptions(t, P(0))).not.toContain(dupe);
    expect(() => apply(t, P(0), { type: "DISCARD_BUILD", card: dupe })).toThrow();
  });

  it("U7 弃牌堆空：能力作废，不进挑牌步骤，直接下一轮", () => {
    const s = buildScene({
      age: 1,
      round: 5,
      players: [
        { wonder: "halicarnassus", stages: 1, built: ["Clay Pit"], coins: 5, hand: ["Altar", "Theater", "Baths"] },
        { wonder: "rhodes", hand: ["Lumber Yard", "Stone Pit", "Clay Pool"] },
        { wonder: "olympia", built: ["Ore Vein"], hand: ["Loom", "Press", "Glassworks"] },
      ],
    });
    expect(s.discardCount).toBe(0);
    let t = act(s, 0, { wonder: "Altar", trade: { left: "O", right: "O" } });
    t = act(t, 1, { build: "Lumber Yard" });
    t = act(t, 2, { build: "Loom" });
    expect(t.players[0]!.stages).toBe(2);
    expect(t.phase).toBe("play");
    expect(t.round).toBe(6);
    expect(t.pending).toBeNull();
  });

  it("E-T7 Age II 第 6 轮建成阶段 2：可以挑本轮作废的牌（含自己作废的）；挑来的城墙计入本时代军事", () => {
    const s = buildScene({
      age: 2,
      round: 6,
      players: [
        { wonder: "halicarnassus", stages: 1, built: ["Ore Vein", "Foundry"], hand: ["Statue", "Courthouse"] },
        { wonder: "babylon", hand: ["Walls", "Temple"] },
        { wonder: "rhodes" },
      ],
    });
    const walls = handId(s, 1, "Walls");
    const courthouse = handId(s, 0, "Courthouse");
    let t = round(s, { 0: { wonder: "Statue" }, 1: { discard: "Temple" } });
    expect(t.phase).toBe("discardBuild");
    expect(t.age).toBe(2);
    const o = discardBuildOptions(t, P(0));
    expect(o).toContain(walls);
    expect(o).toContain(courthouse);
    t = apply(t, P(0), { type: "DISCARD_BUILD", card: walls }).state;
    expect(t.age).toBe(3);
    expect(shieldsOf(t.players[0]!)).toBe(2);
    const age2 = t.players[0]!.tokens.filter((k) => k.age === 2).map((k) => k.value).sort();
    expect(age2).toEqual([3, 3]);
    for (const i of [1, 2]) expect(t.players[i]!.tokens.filter((k) => k.age === 2).map((k) => k.value)).toContain(-1);
  });

  it("E-T6 商会 + 哈利卡纳苏斯：建商会 2 灰 +4 金；之后从弃牌堆建玻璃厂不再给商会金币；终局 3 灰 → 商会 6 分", () => {
    let s = buildScene({
      age: 3,
      round: 2,
      discard: ["Glassworks"],
      players: [
        {
          wonder: "halicarnassus",
          stages: 1,
          built: ["Loom", "Press", "Clay Pool", "Clay Pit", "Ore Vein", "Foundry"],
          coins: 3,
          hand: ["Chamber of Commerce", "Gardens", "Town Hall", "Senate", "Pantheon", "Palace"],
        },
        { wonder: "babylon" },
        { wonder: "rhodes" },
        { wonder: "olympia" },
      ],
    });
    s = round(s, { 0: { build: "Chamber of Commerce" } });
    expect(s.players[0]!.coins).toBe(3 + 4);
    s = round(s); // 第 3 轮：都弃牌
    expect(s.players[0]!.coins).toBe(7 + 3);
    s = round(s, { 0: { type: "PLAY", card: s.players[0]!.hand[0]!, action: "wonder" } });
    expect(s.phase).toBe("discardBuild");
    const glass = discardBuildOptions(s, P(0)).find((id) => card(id).name === "Glassworks")!;
    expect(card(glass).age).toBe(1);
    const coins = s.players[0]!.coins;
    s = apply(s, P(0), { type: "DISCARD_BUILD", card: glass }).state;
    expect(s.players[0]!.coins).toBe(coins);
    while (s.phase === "play") s = round(s);
    expect(s.phase).toBe("finished");
    const me = s.finalResult!.scores[0]!;
    expect(me.commerce).toBe(6);
  });
});

describe("巴比伦 B 阶段 2：第 6 轮打第 7 张（E-T8，U3）", () => {
  const e8 = () =>
    buildScene({
      age: 1,
      round: 6,
      players: [
        {
          wonder: "babylon",
          side: "B",
          stages: 1,
          built: ["Lumber Yard", "Timber Yard", "Glassworks", "Clay Pool", "Clay Pit", "Press"],
          coins: 3,
          hand: ["Altar", "Barracks"],
        },
        { wonder: "olympia" },
        { wonder: "rhodes" },
      ],
    });
  const toSeventh = () => {
    const s = e8();
    const t = round(s, { 0: { wonder: "Altar" } });
    return { s, t };
  };

  it("第 6 张建成阶段 2 → 同一轮马上打第 7 张；其他人等；别人的第 7 张作废、不给钱", () => {
    const { s, t } = toSeventh();
    expect(t.players[0]!.stages).toBe(2);
    expect(t.phase).toBe("seventh");
    expect(t.pending).toEqual({ type: "seventh", player: P(0) });
    expect(t.players[0]!.hand.length).toBe(1);
    // U3：② 巴比伦打第 7 张时，别人的第 7 张还没作废（③ 才进弃牌堆）
    for (const i of [1, 2]) expect(t.players[i]!.coins).toBe(s.players[i]!.coins + 3);
    expect(() => apply(t, P(1), { type: "PLAY", card: s.players[1]!.hand[1]!, action: "discard" })).toThrow();
    const dc = t.discardCount;
    const u = act(t, 0, { discard: "Barracks" });
    for (const i of [1, 2]) {
      expect(u.players[i]!.coins).toBe(s.players[i]!.coins + 3); // 作废不给钱
      expect(u.players[i]!.hand.length).toBe(7); // 已经是 Age II 的新手牌
    }
    expect(u.discardCount).toBe(dc + 1 + 2); // 巴比伦弃的第 7 张 + 两人作废的第 7 张
  });

  it("(a) 第 7 张付费建造", () => {
    const { t } = toSeventh();
    const u = act(t, 0, { build: "Barracks" });
    expect(builtNames(u, 0)).toContain("Barracks");
    expect(u.age).toBe(2);
    expect(u.phase).toBe("play");
  });

  it("(b) 第 7 张弃掉 +3 金", () => {
    const { t } = toSeventh();
    const c = t.players[0]!.coins;
    const u = act(t, 0, { discard: "Barracks" });
    expect(u.players[0]!.coins).toBe(c + 3);
    expect(u.age).toBe(2);
  });

  it("(c) 第 7 张建阶段 3（3 砖 + 1 纸）", () => {
    const { t } = toSeventh();
    const u = act(t, 0, { wonder: "Barracks" });
    expect(u.players[0]!.stages).toBe(3);
    expect(u.age).toBe(2);
  });

  it("没建阶段 2 的巴比伦 B：第 7 张直接作废、不给钱", () => {
    const s = e8();
    const c = s.players[0]!.coins;
    const t = round(s, { 0: { discard: "Altar" } });
    expect(t.phase).toBe("play");
    expect(t.age).toBe(2);
    expect(t.players[0]!.coins).toBe(c + 3);
  });

  it("每个时代都能打：Age II 第 6 轮（阶段 2 早就建好）也进第 7 张", () => {
    const s = buildScene({ age: 2, round: 6, players: [{ wonder: "babylon", side: "B", stages: 2, hand: ["Temple", "Statue"] }, { wonder: "olympia" }, { wonder: "rhodes" }] });
    const t = round(s);
    expect(t.phase).toBe("seventh");
  });

  it("U3：同一轮巴比伦第 7 张弃掉 → 哈利卡纳苏斯在后面挑弃牌，可以挑到这张；然后才比军事", () => {
    const s = buildScene({
      age: 1,
      round: 6,
      players: [
        { wonder: "babylon", side: "B", stages: 2, hand: ["Altar", "Stockade"] },
        { wonder: "halicarnassus", stages: 1, built: ["Ore Vein", "Clay Pit"], coins: 5, hand: ["Theater", "Baths"] },
        { wonder: "rhodes" }, // 座位 1 的左邻，产矿
      ],
    });
    const stockade = handId(s, 0, "Stockade");
    const baths = handId(s, 1, "Baths");
    let t = act(s, 0, { build: "Altar" });
    t = act(t, 1, { wonder: "Theater", trade: { left: "O", right: "" } });
    t = round(t);
    expect(t.phase).toBe("seventh");
    expect(t.discardBuildDue).toBe(P(1));
    t = act(t, 0, { discard: "Stockade" });
    expect(t.phase).toBe("discardBuild");
    expect(t.pending).toEqual({ type: "discardBuild", player: P(1) });
    const o = discardBuildOptions(t, P(1));
    expect(o).toContain(stockade);
    expect(o).toContain(baths); // 自己作废的那张也能挑
    t = apply(t, P(1), { type: "DISCARD_BUILD", card: stockade }).state;
    expect(t.age).toBe(2);
    // 栅栏计入 Age I 军事：座位 1 有 1 盾，两邻都 0
    expect(t.players[1]!.tokens.filter((k) => k.age === 1).map((k) => k.value).sort()).toEqual([1, 1]);
  });
});

describe("奥林匹亚 A 阶段 2：每时代免费建 1 张手牌（E-T9，U5，README #7）", () => {
  it("Age II 第 1 轮免费建水道桥（不付 3 石、0 金）；同一时代之后再用被拒绝", () => {
    const s = buildScene({
      age: 2,
      round: 1,
      players: [
        { wonder: "olympia", stages: 2, coins: 0, hand: ["Aqueduct", "Statue", "Courthouse", "Temple", "Walls", "Library", "School"] },
        { wonder: "babylon" },
        { wonder: "rhodes" },
      ],
    });
    const info = paymentOptions(s, P(0), { card: handId(s, 0, "Aqueduct") });
    expect(info.options.map((o) => o.kind)).toEqual(["olympia"]);
    expect(info.options[0]!.isDefault).toBe(true);
    let t = round(s, { 0: { build: "Aqueduct", olympia: true } });
    expect(builtNames(t, 0)).toContain("Aqueduct");
    expect(t.players[0]!.coins).toBe(0);
    expect(t.players[0]!.freeBuildUsed).toBe(true);
    for (const id of t.players[0]!.hand) {
      expect(paymentOptions(t, P(0), { card: id }).options.some((o) => o.kind === "olympia")).toBe(false);
    }
    expect(() => apply(t, P(0), { type: "PLAY", card: t.players[0]!.hand[0]!, action: "build", olympia: true })).toThrow();
    t = round(t); // 第 2 轮
    expect(t.players[0]!.freeBuildUsed).toBe(true);
    expect(() => apply(t, P(0), { type: "PLAY", card: t.players[0]!.hand[0]!, action: "build", olympia: true })).toThrow();
  });

  it("第 6 轮能用；到了 Age III 又能用一次", () => {
    const s = buildScene({ age: 2, round: 6, players: [{ wonder: "olympia", stages: 2, coins: 0, hand: ["Statue", "Courthouse"] }, { wonder: "babylon" }, { wonder: "rhodes" }] });
    let t = round(s, { 0: { build: "Statue", olympia: true } });
    expect(builtNames(t, 0)).toContain("Statue");
    expect(t.age).toBe(3);
    expect(t.players[0]!.freeBuildUsed).toBe(false);
    const any = t.players[0]!.hand.some((id) => paymentOptions(t, P(0), { card: id }).options.some((o) => o.kind === "olympia"));
    expect(any).toBe(true);
  });

  it("能免费链的牌：只给免费链方案，olympia: true 被拒绝；走链不扣次数", () => {
    const s = buildScene({ age: 2, round: 5, players: [{ wonder: "olympia", stages: 2, built: ["Baths"], coins: 0, hand: ["Aqueduct", "Statue", "Courthouse"] }, { wonder: "babylon" }, { wonder: "rhodes" }] });
    expect(paymentOptions(s, P(0), { card: handId(s, 0, "Aqueduct") }).options.map((o) => o.kind)).toEqual(["chain"]);
    expect(() => act(s, 0, { build: "Aqueduct", olympia: true })).toThrow();
    const t = round(s, { 0: { build: "Aqueduct" } });
    expect(builtNames(t, 0)).toContain("Aqueduct");
    expect(t.players[0]!.freeBuildUsed).toBe(false);
  });

  it("不能用来建奇迹阶段：付不起阶段 3 时 olympia: true 也被拒绝", () => {
    const s = buildScene({ age: 2, round: 6, players: [{ wonder: "olympia", stages: 2, coins: 0, hand: ["Statue", "Courthouse"] }, { wonder: "babylon" }, { wonder: "giza" }] });
    expect(stageOpts(s, 0).options).toEqual([]);
    expect(() => apply(s, P(0), { type: "PLAY", card: handId(s, 0, "Statue"), action: "wonder", olympia: true })).toThrow();
  });

  it("同名照样不能建（奥林匹亚免费也不行）", () => {
    const s = buildScene({ age: 2, round: 6, players: [{ wonder: "olympia", stages: 2, built: ["Loom"], coins: 0, hand: ["Loom@2", "Courthouse"] }, { wonder: "babylon" }, { wonder: "rhodes" }] });
    const loom = s.players[0]!.hand.find((id) => card(id).name === "Loom")!;
    expect(paymentOptions(s, P(0), { card: loom }).options).toEqual([]);
    expect(() => apply(s, P(0), { type: "PLAY", card: loom, action: "build", olympia: true })).toThrow();
  });
});

describe("建成时拿金币的黄卡（规则书 §2.3 注、E-T11、TC11）", () => {
  it("E-T11 葡萄园：自己 3 棕 + 左邻 2 棕和本轮刚建的锯木厂 + 右邻 1 棕和本轮刚建的铸造厂 = 8 金", () => {
    const s = buildScene({
      age: 2,
      round: 6,
      players: [
        { wonder: "giza", built: ["Lumber Yard", "Stone Pit", "Clay Pool"], hand: ["Vineyard", "Temple"] },
        { wonder: "babylon", built: ["Ore Vein", "Clay Pit"], hand: ["Sawmill", "Statue"] },
        { wonder: "rhodes", built: ["Timber Yard"], hand: ["Foundry", "Courthouse"] },
      ],
    });
    const t = round(s, { 0: { build: "Vineyard" }, 1: { build: "Sawmill" }, 2: { build: "Foundry" } });
    expect(t.players[0]!.coins).toBe(3 + 8);
    expect(t.players[1]!.coins).toBe(3 - 1);
  });

  it("集市：2 金 / 灰卡（自己 + 两邻，含邻居本轮刚建的；对面的不算），交牌顺序不影响", () => {
    const mk = () =>
      buildScene({
        age: 2,
        round: 6,
        players: [
          { wonder: "giza", built: ["Loom"], hand: ["Bazar", "Temple"] },
          { wonder: "babylon", hand: ["Glassworks@2", "Statue"] }, // 左邻本轮建玻璃厂
          { wonder: "rhodes", built: ["Glassworks"] }, // 对面，不算
          { wonder: "olympia", built: ["Press"] }, // 右邻
        ],
      });
    const a = round(mk(), { 0: { build: "Bazar" }, 1: { build: "Glassworks" } });
    expect(a.players[0]!.coins).toBe(3 + 6);
    const b = round(mk(), { 0: { build: "Bazar" }, 1: { build: "Glassworks" } }, [1, 3, 2, 0]);
    expect(b.players[0]!.coins).toBe(3 + 6);
  });

  it("竞技场 3 金 / 已建奇迹阶段；港口 1 金 / 自己的棕卡；灯塔 1 金 / 自己的黄卡（含灯塔自己）；酒馆 +5", () => {
    const arena = buildScene({ age: 3, round: 6, players: [{ wonder: "giza", stages: 2, built: ["Stone Pit", "Ore Vein"], coins: 0, hand: ["Arena", "Gardens"] }, { wonder: "babylon" }, { wonder: "rhodes" }] });
    expect(round(arena, { 0: { build: "Arena" } }).players[0]!.coins).toBe(6);
    const haven = buildScene({ age: 3, round: 6, players: [{ wonder: "giza", built: ["Lumber Yard", "Ore Vein", "Loom"], coins: 0, hand: ["Haven", "Gardens"] }, { wonder: "babylon" }, { wonder: "rhodes" }] });
    expect(round(haven, { 0: { build: "Haven" } }).players[0]!.coins).toBe(2);
    const light = buildScene({ age: 3, round: 6, players: [{ wonder: "giza", built: ["Marketplace", "Vineyard", "Glassworks"], coins: 0, hand: ["Lighthouse", "Gardens"] }, { wonder: "babylon" }, { wonder: "rhodes" }] });
    expect(round(light, { 0: { build: "Lighthouse" } }).players[0]!.coins).toBe(3);
    const tav = buildScene({ age: 1, round: 6, players: [{ wonder: "giza", coins: 0, hand: ["Tavern", "Altar"] }, { wonder: "babylon" }, { wonder: "rhodes" }, { wonder: "olympia" }] });
    expect(round(tav, { 0: { build: "Tavern" } }).players[0]!.coins).toBe(5);
  });

  it("TC11 商会建成时 2 金 / 灰卡（2 灰 → +4）", () => {
    const s = buildScene({ age: 3, round: 6, players: [{ wonder: "giza", built: ["Loom", "Press", "Clay Pool", "Clay Pit"], coins: 0, hand: ["Chamber of Commerce", "Gardens"] }, { wonder: "babylon" }, { wonder: "rhodes" }, { wonder: "olympia" }] });
    expect(round(s, { 0: { build: "Chamber of Commerce" } }).players[0]!.coins).toBe(4);
  });
});

describe("U6 葡萄园只算同时结算的那一步；亚历山大的阶段产出自己能用", () => {
  it("葡萄园在第 ① 步算：邻居巴比伦之后用第 7 张建的锯木厂不追加", () => {
    const s = buildScene({
      age: 2,
      round: 6,
      players: [
        { wonder: "giza", built: ["Lumber Yard"], hand: ["Vineyard", "Temple"] },
        { wonder: "babylon", side: "B", stages: 2, built: ["Ore Vein"], hand: ["Statue", "Sawmill"] },
        { wonder: "rhodes", built: ["Clay Pool"] },
      ],
    });
    let t = round(s, { 0: { build: "Vineyard" }, 1: { discard: "Statue" } });
    expect(t.phase).toBe("seventh");
    expect(t.players[0]!.coins).toBe(3 + 3);
    t = act(t, 1, { build: "Sawmill" });
    expect(builtNames(t, 1)).toContain("Sawmill");
    expect(t.players[0]!.coins).toBe(3 + 3);
  });

  it("第 7 张本身是葡萄园：按那一刻的数量算（含第 ① 步邻居刚建的锯木厂）", () => {
    const s = buildScene({
      age: 2,
      round: 6,
      players: [
        { wonder: "giza", built: ["Lumber Yard"], hand: ["Sawmill", "Temple"] },
        { wonder: "babylon", side: "B", stages: 2, built: ["Ore Vein"], hand: ["Statue", "Vineyard"] },
        { wonder: "rhodes", built: ["Clay Pool"] },
      ],
    });
    let t = round(s, { 0: { build: "Sawmill" }, 1: { discard: "Statue" } });
    expect(t.players[1]!.coins).toBe(6);
    t = act(t, 1, { build: "Vineyard" });
    expect(t.players[1]!.coins).toBe(6 + 4); // 自己 1 + 左邻 1 + 右邻 2
  });

  it("亚历山大 A 阶段 2（任选原料）、B 阶段 2（任选制成品）自己能用", () => {
    const a = buildScene({ age: 1, round: 6, players: [{ wonder: "alexandria", stages: 2, coins: 0, hand: ["Stockade", "Barracks"] }, { wonder: "giza" }, { wonder: "babylon" }] });
    expect(paymentOptions(a, P(0), { card: handId(a, 0, "Stockade") }).options[0]!.kind).toBe("own");
    const b = buildScene({ age: 1, round: 6, players: [{ wonder: "alexandria", side: "B", stages: 2, coins: 0, hand: ["Apothecary", "Scriptorium"] }, { wonder: "giza" }, { wonder: "babylon" }] });
    expect(paymentOptions(b, P(0), { card: handId(b, 0, "Apothecary") }).options[0]!.kind).toBe("own");
    expect(paymentOptions(b, P(0), { card: handId(b, 0, "Scriptorium") }).options[0]!.kind).toBe("own");
  });
});
