/**
 * 规则书 §9 测试用例（规则书#1–#14，按补充 §1.4 复算过的数字）和补充文件新增用例（补充#E-T1–#E-T14）。
 * 局面都用预览局面工厂 buildScene 造。座位顺时针：p1 的左邻是 p2，右邻是最后一位。
 */
import { describe, expect, it } from "vitest";
import {
  apply,
  autoCommand,
  buildAgeDeck,
  buildScene,
  card,
  createGame,
  createRng,
  GUILDS,
  paymentOptions,
  pendingActors,
  redactGameForViewer,
  scienceScore,
  scoreBreakdown,
  shieldsOf,
  type GameState,
} from "../src/index.js";
import { act, inHand, names, play, player, round } from "./helpers.js";

/** 把剩下的轮次都弃牌打完，直到这个时代结束（或终局）。 */
function finishAge(state: GameState): GameState {
  const age = state.age;
  let next = state;
  while (next.phase !== "finished" && next.age === age) {
    if (next.phase === "play") next = round(next);
    else {
      const actor = pendingActors(next)[0]!;
      next = act(next, actor, autoCommand(next, actor)!);
    }
  }
  return next;
}

describe("规则书 §9 测试用例", () => {
  it("规则书#1 时代与轮数：3 人局每人 7 张、6 轮，第 6 轮每人 2 张、打 1 弃 1，时代结束手牌清空", () => {
    let state = createGame([{ id: "a", name: "甲" }, { id: "b", name: "乙" }, { id: "c", name: "丙" }], 11);
    expect(state.players.map((entry) => entry.hand.length)).toEqual([7, 7, 7]);
    const dealt = new Set(state.players.flatMap((entry) => entry.hand));
    expect(dealt.size).toBe(21);
    expect([...dealt].every((id) => card(id).age === 1 && card(id).minPlayers === 3)).toBe(true);
    for (let r = 1; r <= 5; r += 1) {
      expect(state.round).toBe(r);
      expect(state.players.map((entry) => entry.hand.length)).toEqual([8 - r, 8 - r, 8 - r]);
      state = round(state);
    }
    expect(state.round).toBe(6);
    expect(state.players.map((entry) => entry.hand.length)).toEqual([2, 2, 2]);
    const discardBefore = state.discard.length;
    state = round(state);
    // 3 张弃掉换钱 + 3 张作废
    expect(state.discard.length).toBe(discardBefore + 6);
    expect(state.age).toBe(2);
    expect(state.round).toBe(1);
    expect(state.players.map((entry) => entry.hand.length)).toEqual([7, 7, 7]);
  });

  it("规则书#2 科技计分：3/2/1 = 21，2/2/2 = 26，4/0/0 = 16，3/3/3 = 48，0/0/0 = 0；3/2/1 + 巴比伦任选 1 个 = 31（勘误 E10）", () => {
    const s = (compass: number, gear: number, tablet: number, wild = 0) => scienceScore({ compass, gear, tablet }, wild).score;
    expect(s(3, 2, 1)).toBe(21);
    expect(s(2, 2, 2)).toBe(26);
    expect(s(4, 0, 0)).toBe(16);
    expect(s(3, 3, 3)).toBe(48);
    expect(s(0, 0, 0)).toBe(0);
    expect(s(3, 2, 1, 1)).toBe(31);
    expect(scienceScore({ compass: 3, gear: 2, tablet: 1 }, 1).best).toEqual({ compass: 3, gear: 2, tablet: 2 });
    // 真的局面：巴比伦 A 阶段 2（任选符号）+ 3 圆规 2 齿轮 1 石板
    const state = buildScene({
      age: 3,
      round: 6,
      phase: "finished",
      players: [
        { wonder: "babylon", stages: 2, built: ["Apothecary", "Dispensary", "Lodge", "Workshop", "Laboratory", "Scriptorium"] },
        { wonder: "giza" },
        { wonder: "rhodes" },
      ],
    });
    expect(scoreBreakdown(state, "p1").science).toBe(31);
    expect(state.finalResult!.scores[0]!.scienceDetail).toMatchObject({ compass: 3, gear: 2, tablet: 1, wild: 1, best: { compass: 3, gear: 2, tablet: 2 } });
  });

  it("规则书#3 军事结算：Age II 甲 3 盾，左邻 5 盾（−1），右邻 2 盾（+3），本时代净 +2；盾数相等双方都不拿", () => {
    let state = buildScene({
      age: 2,
      round: 6,
      players: [
        { wonder: "giza", built: ["Stockade", "Walls"] },
        { wonder: "olympia", built: ["Barracks", "Training Ground", "Archery Range"] },
        { wonder: "ephesus", built: ["Guard Tower", "Stables", "Walls"] },
        { wonder: "alexandria", built: ["Stockade", "Barracks"] },
      ],
    });
    expect(state.players.map(shieldsOf)).toEqual([3, 5, 5, 2]);
    state = round(state);
    expect(player(state, "p1").tokens).toEqual([
      { age: 2, value: -1, vs: "left" },
      { age: 2, value: 3, vs: "right" },
    ]);
    expect(scoreBreakdown(state, "p1").military).toBe(2);
    // 乙（5）和丙（5）平：乙只拿到对甲的 +3
    expect(player(state, "p2").tokens).toEqual([{ age: 2, value: 3, vs: "right" }]);
    const military = state.events.find((event) => event.type === "MilitaryResolved");
    expect(military).toMatchObject({ age: 2, results: [{ player: "p1", shields: 3, left: -1, right: 3 }, { player: "p2", shields: 5, left: 0, right: 3 }, {}, {}] });
  });

  it("规则书#3 全胜终局 +18，全败 −6", () => {
    let state = buildScene({
      age: 3,
      round: 6,
      players: [
        { wonder: "giza", built: ["Fortifications"], tokens: [1, 1, 3, 3] },
        { wonder: "olympia", tokens: [-1, -1, -1, -1] },
        { wonder: "ephesus", built: ["Stockade"] },
        { wonder: "alexandria" },
      ],
    });
    state = round(state);
    expect(state.phase).toBe("finished");
    expect(state.finalResult!.scores[0]!.military).toBe(18);
    expect(state.finalResult!.scores[1]!.military).toBe(-6);
  });

  it("规则书#4 资源购买：大学（2 木 + 1 玻 + 1 纸），自产 1 木 1 玻，左邻买 1 木、右邻买 1 纸各 2 金；0 金时建不了这张，但能拿去建自己产得出的奇迹阶段", () => {
    const setup = (coins: number) =>
      buildScene({
        age: 3,
        round: 1,
        players: [
          { wonder: "giza", built: ["Lumber Yard", "Glassworks", "Stone Pit"], coins, hand: ["University", "Palace", "Senate", "Arsenal", "Lodge", "Gardens", "Study"] },
          { wonder: "olympia" },
          { wonder: "rhodes" },
          { wonder: "ephesus" },
        ],
      });
    let state = setup(4);
    const options = paymentOptions(state, "p1", { card: inHand(state, "p1", "University") }).options;
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ kind: "trade", left: "W", right: "P", leftCost: 2, rightCost: 2, total: 4, isDefault: true });
    state = round(state, { p1: { card: "University", action: "build" } });
    expect(names(player(state, "p1").built)).toContain("University");
    expect(player(state, "p1").coins).toBe(0);
    expect(player(state, "p2").coins).toBe(3 + 3 + 2); // 弃牌 3 + 卖木 2
    expect(player(state, "p4").coins).toBe(3 + 3 + 2);

    const broke = setup(0);
    const info = paymentOptions(broke, "p1", { card: inHand(broke, "p1", "University") });
    expect(info.options).toHaveLength(0);
    expect(info.reason).toContain("钱不够");
    expect(() => play(broke, "p1", { card: "University", action: "build" })).toThrow(/钱不够/);
    // 金字塔 A 阶段 1 = 2 石：起始石 + 采石坑，不用花钱
    const built = round(broke, { p1: { card: "University", action: "wonder" } });
    expect(player(built, "p1").stages).toBe(1);
  });

  it("规则书#5 交易折扣：西贸易站从左邻买 2 份原料 = 2 金；市场从任一邻居买制成品 1 金；二选一卡买家选一种、卖家同一轮自己照用另一种", () => {
    let state = buildScene({
      age: 2,
      round: 1,
      players: [
        { wonder: "ephesus", built: ["West Trading Post", "Marketplace", "Lumber Yard"], hand: ["Statue", "School", "Walls", "Sawmill", "Bazar", "Aqueduct", "Temple"] },
        { wonder: "rhodes", built: ["Ore Vein", "Press"] },
        { wonder: "giza" },
        { wonder: "alexandria", built: ["Press"] },
      ],
    });
    // 雕像 1 木 + 2 矿：左邻（罗德岛起始矿 + 矿脉）两份矿，西贸易站每份 1 金
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Statue") }).options[0]).toMatchObject({ left: "OO", right: "", leftCost: 2, total: 2 });
    // 学校 1 木 + 1 纸：自己有纸（以弗所起始），不用买；换成看市场：书斋没有，这里直接查价格
    const school = paymentOptions(state, "p1", { card: inHand(state, "p1", "School") }).options;
    expect(school[0]!.kind).toBe("own");

    // 二选一：甲向乙买木（乙的林场木/砖），乙同一轮用林场的砖建瞭望塔
    state = buildScene({
      age: 1,
      round: 1,
      players: [
        { wonder: "ephesus", hand: ["Stockade", "Altar", "Theater", "Baths", "Ore Vein", "Clay Pool", "Loom"] },
        { wonder: "halicarnassus", built: ["Tree Farm"], hand: ["Guard Tower", "Barracks", "Workshop", "Scriptorium", "Press", "Glassworks", "Tavern"] },
        { wonder: "giza", hand: ["Lumber Yard", "Stone Pit", "Apothecary", "East Trading Post", "West Trading Post", "Marketplace", "Timber Yard"] },
      ],
    });
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Stockade") }).options.map((option) => [option.left, option.right])).toEqual([["W", ""]]);
    state = round(state, { p1: { card: "Stockade", action: "build" }, p2: { card: "Guard Tower", action: "build" } });
    expect(names(player(state, "p1").built)).toEqual(["Stockade"]);
    expect(names(player(state, "p2").built)).toEqual(["Tree Farm", "Guard Tower"]);
    expect(player(state, "p2").coins).toBe(3 + 2);
  });

  it("规则书#5 市场：两邻都卖纸时制成品都是 1 金，默认向右邻买（U10）", () => {
    const state = buildScene({
      age: 2,
      round: 1,
      players: [
        { wonder: "giza", built: ["Marketplace", "Lumber Yard"], hand: ["School", "Statue", "Walls", "Sawmill", "Bazar", "Aqueduct", "Temple"] },
        { wonder: "rhodes", built: ["Press"] },
        { wonder: "olympia" },
        { wonder: "ephesus" },
      ],
    });
    const options = paymentOptions(state, "p1", { card: inHand(state, "p1", "School") }).options;
    expect(options.map((option) => [option.left, option.right, option.total, option.isDefault])).toEqual([
      ["", "P", 1, true],
      ["P", "", 1, false],
    ]);
  });

  it("规则书#6 免费链：Age I 建了写字间 → Age II 图书馆免费；没建要付 2 石 + 1 布；建过图书馆再拿到只能弃或垫奇迹", () => {
    const state = buildScene({
      age: 2,
      round: 1,
      players: [
        { wonder: "giza", built: ["Scriptorium"], coins: 0, hand: ["Library", "Walls", "School", "Sawmill", "Temple", "Statue", "Bazar"] },
        { wonder: "olympia", built: ["Stone Pit", "Loom"], hand: ["Library", "Courthouse", "Aqueduct", "Quarry", "Glassworks", "Press", "Forum"] },
        { wonder: "rhodes", hand: ["Laboratory", "Dispensary", "Archery Range", "Caravansery", "Vineyard", "Foundry", "Brickyard"] },
      ],
    });
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Library") }).options).toEqual([
      { kind: "chain", left: "", right: "", leftCost: 0, rightCost: 0, bankCost: 0, total: 0, isDefault: true },
    ]);
    // 乙：自己有 1 石（采石坑）+ 1 布（织布机），奥林匹亚起始木；缺 1 石要买（左邻罗德岛没石，右邻金字塔起始石）
    expect(paymentOptions(state, "p2", { card: inHand(state, "p2", "Library") }).options[0]).toMatchObject({ kind: "trade", right: "S", rightCost: 2 });
    const next = round(state, { p1: { card: "Library", action: "build" } });
    expect(player(next, "p1").coins).toBe(0);
    expect(names(player(next, "p1").built)).toContain("Library");
  });

  it("规则书#6 同名卡：建过图书馆，再拿到图书馆不能建（拒绝），能弃牌或垫奇迹", () => {
    const state = buildScene({
      age: 2,
      round: 1,
      players: [
        { wonder: "giza", built: ["Library@2", "Stone Pit"], hand: ["Library", "Walls", "School", "Sawmill", "Temple", "Statue", "Bazar"] },
        { wonder: "olympia" },
        { wonder: "rhodes" },
      ],
    });
    const info = paymentOptions(state, "p1", { card: inHand(state, "p1", "Library") });
    expect(info.options).toHaveLength(0);
    expect(info.reason).toContain("同名");
    expect(() => play(state, "p1", { card: "Library", action: "build" })).toThrow(/同名/);
    expect(play(state, "p1", { card: "Library", action: "wonder" }).players[0]!.submitted).toBe(true);
    expect(play(state, "p1", { card: "Library", action: "discard" }).players[0]!.submitted).toBe(true);
  });

  it("规则书#7 建奇迹：哈利卡纳苏斯 A 阶段 2（3 矿）建成，这一轮结束立刻从弃牌堆挑一张免费建；其他人等他", () => {
    let state = buildScene({
      age: 2,
      round: 3,
      players: [
        { wonder: "halicarnassus", stages: 1, built: ["Ore Vein", "Foundry"], coins: 0 },
        { wonder: "giza" },
        { wonder: "rhodes" },
        { wonder: "olympia" },
      ],
      discard: ["Temple", "Tavern"],
    });
    const p2HandBefore = player(state, "p2").hand;
    state = round(state, { p1: { card: player(state, "p1").hand[0]!, action: "wonder" } });
    expect(state.phase).toBe("discardBuild");
    expect(state.pending).toEqual({ type: "discardBuild", player: "p1" });
    expect(pendingActors(state)).toEqual(["p1"]);
    expect(state.round).toBe(3); // 还没传牌
    expect(() => apply(state, "p2", { type: "PLAY", card: player(state, "p2").hand[0]!, action: "discard" })).toThrow();
    // 弃牌堆含这一轮其他三人刚弃的牌
    expect(state.discard).toHaveLength(5);
    state = act(state, "p1", { type: "DISCARD_BUILD", card: state.discard.find((id) => card(id).name === "Temple")! });
    expect(names(player(state, "p1").built)).toContain("Temple");
    expect(player(state, "p1").coins).toBe(0); // 免费
    expect(state.phase).toBe("play");
    expect(state.round).toBe(4);
    // Age II 传右邻：p1 拿到左邻 p2 的牌
    expect(player(state, "p1").hand).toHaveLength(4);
    expect(p2HandBefore.filter((id) => player(state, "p1").hand.includes(id))).toHaveLength(4);
  });

  it("规则书#7 阶段按顺序：建奇迹永远是下一阶段；没建阶段 1 时付的是阶段 1 的成本；建满后拒绝", () => {
    const fresh = buildScene({
      players: [{ wonder: "halicarnassus", built: ["Ore Vein", "Clay Pit"], coins: 0 }, { wonder: "giza" }, { wonder: "rhodes" }],
    });
    // 哈利卡纳苏斯 A 阶段 1 = 2 砖：自己只有黏土坑 1 份砖、邻居都不卖砖 → 建不了（不能跳去建阶段 2 的 3 矿）
    expect(paymentOptions(fresh, "p1", { stage: true }).reason).toContain("砖");
    const full = buildScene({ players: [{ wonder: "giza", stages: 3 }, { wonder: "olympia" }, { wonder: "rhodes" }] });
    expect(paymentOptions(full, "p1", { stage: true }).reason).toContain("建满");
    expect(() => play(full, "p1", { card: player(full, "p1").hand[0]!, action: "wonder" })).toThrow(/建满/);
  });

  it("规则书#7 垫在奇迹下的牌保密、不计入任何计分", () => {
    const state = buildScene({
      phase: "finished",
      age: 3,
      round: 6,
      players: [{ wonder: "giza", stages: 1, stageCards: ["Palace"] }, { wonder: "olympia" }, { wonder: "rhodes" }],
    });
    const score = state.finalResult!.scores[0]!;
    expect(score.civilian).toBe(0);
    expect(score.wonder).toBe(3);
    expect(redactGameForViewer(state, "p2").players[0]!.stageCards).toEqual([]);
    expect(redactGameForViewer(state, "p1").players[0]!.stageCards).toHaveLength(1);
  });

  it("规则书#8 弃牌换钱：任何牌都能弃 +3 金；第 6 轮作废的那张不给钱", () => {
    let state = buildScene({
      round: 6,
      players: [
        { wonder: "giza", coins: 0, hand: ["Altar", "Theater"] },
        { wonder: "olympia", coins: 0, hand: ["Baths", "Pawnshop"] },
        { wonder: "rhodes", coins: 0, hand: ["Tavern", "Stockade"] },
      ],
    });
    state = round(state);
    expect(state.players.map((entry) => entry.coins)).toEqual([3, 3, 3]);
    expect(state.discard).toHaveLength(6);
    expect(state.events.some((event) => event.type === "CardsBurned")).toBe(true);
  });

  it("规则书#9 行会计分：船主 2 棕 + 1 灰 + 1 紫 = 4；工匠两邻 3 灰 = 6；军事家两邻 2 个败仗 = 2；建筑师两邻 + 自己 5 个阶段 = 5", () => {
    const state = buildScene({
      phase: "finished",
      age: 3,
      round: 6,
      players: [
        { wonder: "giza", stages: 2, built: ["Lumber Yard", "Clay Pool", "Loom", "Shipowners Guild"] },
        { wonder: "olympia", built: ["Craftsmens Guild"], tokens: [-1] },
        { wonder: "rhodes", stages: 2, built: ["Glassworks", "Press", "Strategists Guild"] },
        { wonder: "ephesus", stages: 1, built: ["Builders Guild"], tokens: [-1, 1] },
      ],
    });
    const guild = (seat: number, name: string) => state.finalResult!.scores[seat]!.guildDetail.find((entry) => card(entry.card).name === name)!.points;
    expect(guild(0, "Shipowners Guild")).toBe(4);
    expect(guild(1, "Craftsmens Guild")).toBe(6); // 左邻丙 2 灰 + 右邻甲 1 灰
    expect(guild(2, "Strategists Guild")).toBe(2); // 左邻丁 1 败 + 右邻乙 1 败
    expect(guild(3, "Builders Guild")).toBe(5); // 自己 1 + 左邻甲 2 + 右邻丙 2
  });

  it("规则书#10 金币与终局：14 金 = 4 分；总分相同金币多的赢；金币也一样就并列", () => {
    const end = (coins: number[]) =>
      buildScene({
        phase: "finished",
        age: 3,
        round: 6,
        players: [
          { wonder: "giza", coins: coins[0]!, built: ["Altar"] },
          { wonder: "olympia", coins: coins[1]!, built: ["Theater"] },
          { wonder: "rhodes", coins: coins[2]! },
        ],
      });
    expect(end([14, 0, 0]).finalResult!.scores[0]!.coins).toBe(4);
    const byCoins = end([4, 5, 0]); // 甲 2 + 1 = 3，乙 2 + 1 = 3，乙金币多
    expect(byCoins.finalResult!.scores.map((entry) => entry.total)).toEqual([3, 3, 0]);
    expect(byCoins.finalResult!.winners).toEqual(["p2"]);
    expect(byCoins.finalResult!.scores.map((entry) => entry.rank)).toEqual([2, 1, 3]);
    const tie = end([5, 5, 0]);
    expect(tie.finalResult!.winners).toEqual(["p1", "p2"]);
    expect(tie.finalResult!.scores.map((entry) => entry.rank)).toEqual([1, 1, 3]);
  });

  it("规则书#11 / 补充#E-T6 商会 + 哈利卡纳苏斯：2 灰建商会 +4 金；之后从弃牌堆建玻璃厂不再给商会金币；终局 3 灰 → 商会 6 分", () => {
    let state = buildScene({
      age: 3,
      round: 2,
      players: [
        {
          wonder: "halicarnassus",
          stages: 1,
          coins: 0,
          built: ["Press@1", "Loom@1", "Brickyard", "Foundry", "Ore Vein"],
          hand: ["Chamber of Commerce", "Palace", "Senate", "Arsenal", "Lodge", "Gardens"],
        },
        { wonder: "giza" },
        { wonder: "rhodes" },
        { wonder: "olympia" },
      ],
      discard: ["Glassworks@1"],
    });
    state = round(state, { p1: { card: "Chamber of Commerce", action: "build" } });
    expect(player(state, "p1").coins).toBe(4);
    state = round(state); // 第 3 轮 p1 弃牌 +3
    expect(player(state, "p1").coins).toBe(7);
    state = round(state, { p1: { card: player(state, "p1").hand[0]!, action: "wonder" } }); // 第 4 轮建阶段 2（3 矿）
    expect(state.phase).toBe("discardBuild");
    const glass = state.discard.find((id) => card(id).name === "Glassworks")!;
    state = act(state, "p1", { type: "DISCARD_BUILD", card: glass });
    expect(player(state, "p1").coins).toBe(7);
    expect(state.events.find((event) => event.type === "BuiltFromDiscard")).toMatchObject({ card: glass, gained: 0 });
    state = finishAge(state);
    expect(state.phase).toBe("finished");
    expect(state.finalResult!.scores[0]!.commerce).toBe(6);
  });

  it("规则书#12 罗德岛 A 阶段 2：+2 盾计入每次军事比较（密探只数红卡不数盾）", () => {
    let state = buildScene({
      age: 1,
      round: 6,
      players: [
        { wonder: "rhodes", stages: 2 },
        { wonder: "olympia", built: ["Stockade"] },
        { wonder: "giza", built: ["Barracks"] },
      ],
    });
    expect(shieldsOf(player(state, "p1"))).toBe(2);
    state = round(state);
    expect(player(state, "p1").tokens.map((token) => token.value)).toEqual([1, 1]);
  });

  it("规则书#12 奥林匹亚 B 阶段 3：终局复制邻居 1 张行会，按自己的视角算分，不影响原主人", () => {
    const state = buildScene({
      phase: "finished",
      age: 3,
      round: 6,
      players: [
        { wonder: "olympia", side: "B", stages: 3, built: ["Altar"] },
        { wonder: "giza", built: ["Magistrates Guild", "Stockade"] },
        { wonder: "rhodes", built: ["Theater", "Baths", "Pawnshop"] },
        { wonder: "ephesus", built: ["Spies Guild", "Temple"] },
      ],
    });
    const olympia = state.finalResult!.scores[0]!;
    // 法官（两邻蓝卡）：奥林匹亚的两邻是乙（0 蓝）和丁（1 蓝）= 1；密探（两邻红卡）：乙 1 红、丁 0 = 1；一样高取左邻的法官
    expect(olympia.copiedGuild).not.toBeNull();
    expect(olympia.guilds).toBe(1);
    // 原主人照常：乙的法官 = 丙 3 蓝 + 甲 1 蓝 = 4
    expect(state.finalResult!.scores[1]!.guildDetail).toEqual([{ card: player(state, "p2").built[0], points: 4, copied: false }]);
  });

  it("规则书#13 传牌方向：Age I 向左、Age II 向右、Age III 向左；7 人局每个时代 6 轮后手牌清空", () => {
    let state = createGame(Array.from({ length: 7 }, (_, index) => ({ id: `p${index + 1}`, name: `${index}` })), 3);
    for (const [age, direction] of [[1, "left"], [2, "right"], [3, "left"]] as const) {
      expect(state.age).toBe(age);
      expect(state.direction).toBe(direction);
      for (let r = 1; r <= 6; r += 1) {
        const before = state.players.map((entry) => entry.hand);
        const played = state.players.map((entry) => entry.hand[0]!);
        state = round(state);
        if (r < 6) {
          state.players.forEach((entry, index) => {
            // 传左邻：我拿到右邻（index − 1）的牌；传右邻：我拿到左邻（index + 1）的牌
            const from = direction === "left" ? (index + 6) % 7 : (index + 1) % 7;
            expect(entry.hand).toEqual(before[from]!.filter((id) => id !== played[from]));
          });
        }
      }
      if (age < 3) expect(state.age).toBe(age + 1);
    }
    expect(state.phase).toBe("finished");
    expect(state.players.every((entry) => entry.hand.length === 0)).toBe(true);
  });

  it("规则书#14 校验：不在手里的牌、不存在的牌、亮牌后（插入选择时）出牌、阶段建满、同名、钱不够都拒绝", () => {
    const state = buildScene({
      age: 2,
      round: 1,
      players: [
        { wonder: "giza", built: ["Library@2"], coins: 0, hand: ["Library", "Walls", "School", "Sawmill", "Temple", "Statue", "Bazar"] },
        { wonder: "olympia" },
        { wonder: "rhodes" },
      ],
    });
    expect(() => apply(state, "p1", { type: "PLAY", card: "no_such_card", action: "discard" })).toThrow(/不在你手里/);
    expect(() => apply(state, "p1", { type: "PLAY", card: player(state, "p2").hand[0]!, action: "discard" })).toThrow(/不在你手里/);
    expect(() => play(state, "p1", { card: "Library", action: "build" })).toThrow(/同名/);
    expect(() => play(state, "p1", { card: "Statue", action: "build" })).toThrow(/弃掉换 3 金/);
    expect(() => apply(state, "p1", { type: "PLAY", card: player(state, "p1").hand[0]!, action: "steal" as never })).toThrow();
    expect(() => apply(state, "nobody", { type: "PLAY", card: player(state, "p1").hand[0]!, action: "discard" })).toThrow();
    expect(() => apply(state, "p1", { type: "DISCARD_BUILD", card: null })).toThrow();
    // 交了以后再交：要先撤回
    const submitted = play(state, "p1", { card: "Walls", action: "discard" });
    expect(() => play(submitted, "p1", { card: "School", action: "discard" })).toThrow(/撤回/);
    // 亮牌后（巴比伦打第 7 张时）其他人不能出牌
    const seventh = buildScene({
      round: 6,
      phase: "seventh",
      pending: 0,
      players: [{ wonder: "babylon", side: "B", stages: 2, hand: ["Altar"] }, { wonder: "giza", hand: ["Theater"] }, { wonder: "rhodes", hand: ["Baths"] }],
    });
    expect(() => play(seventh, "p2", { card: "Theater", action: "discard" })).toThrow(/现在不能出牌/);
  });
});

describe("补充文件新增用例 E-T1–E-T14", () => {
  it("补充#E-T1 座位与方向：甲的左邻乙、右邻丁；Age I 后甲拿丁的牌、乙拿甲的牌；Age II 甲拿乙的牌；西贸易站从乙买木 1 金、从丁买 2 金", () => {
    let state = buildScene({
      players: [
        { wonder: "giza", built: ["West Trading Post"], hand: ["Stockade", "Altar", "Theater", "Baths", "Ore Vein", "Clay Pool", "Loom"] },
        { wonder: "olympia" },
        { wonder: "rhodes" },
        { wonder: "halicarnassus", built: ["Lumber Yard"] },
      ],
    });
    const options = paymentOptions(state, "p1", { card: inHand(state, "p1", "Stockade") }).options;
    expect(options.map((option) => [option.left, option.leftCost, option.right, option.rightCost])).toEqual([
      ["W", 1, "", 0],
      ["", 0, "W", 2],
    ]);
    const before = state.players.map((entry) => entry.hand);
    state = round(state);
    expect(player(state, "p1").hand).toEqual(before[3]!.slice(1));
    expect(player(state, "p2").hand).toEqual(before[0]!.slice(1));

    let age2 = buildScene({ age: 2, players: [{ wonder: "giza" }, { wonder: "olympia" }, { wonder: "rhodes" }, { wonder: "halicarnassus" }] });
    const before2 = age2.players.map((entry) => entry.hand);
    age2 = round(age2);
    expect(player(age2, "p1").hand).toEqual(before2[1]!.slice(1));
  });

  it("补充#E-T2 科技最优选择（枚举，不能贪心）", () => {
    const s = (compass: number, gear: number, tablet: number, wild: number) => scienceScore({ compass, gear, tablet }, wild).score;
    expect(s(3, 2, 1, 0)).toBe(21);
    expect(s(3, 2, 1, 1)).toBe(31);
    expect(s(2, 2, 2, 1)).toBe(31);
    expect(s(0, 0, 0, 1)).toBe(1);
    expect(s(4, 0, 0, 1)).toBe(25);
    expect(s(1, 1, 0, 1)).toBe(10);
    expect(s(2, 1, 0, 2)).toBe(18);
    expect(s(4, 4, 4, 2)).toBe(96);
    expect(s(3, 3, 0, 2)).toBe(36);
    // 巴比伦 + 科学家行会 = 2 个任选符号，真的局面里也是 18
    const state = buildScene({
      phase: "finished",
      age: 3,
      round: 6,
      players: [{ wonder: "babylon", stages: 2, built: ["Apothecary", "Lodge", "Workshop", "Scientists Guild"] }, { wonder: "giza" }, { wonder: "rhodes" }],
    });
    expect(state.finalResult!.scores[0]!.science).toBe(18);
    expect(state.finalResult!.scores[0]!.scienceDetail.wild).toBe(2);
  });

  it("补充#E-T3 二选一原料要 1 金：0 金建不了林场，1 金能建、建完 0 金", () => {
    const setup = (coins: number) =>
      buildScene({ players: [{ wonder: "giza", coins, hand: ["Tree Farm", "Altar", "Theater", "Baths", "Ore Vein", "Clay Pool", "Loom"] }, { wonder: "olympia" }, { wonder: "rhodes" }] });
    const broke = setup(0);
    expect(paymentOptions(broke, "p1", { card: inHand(broke, "p1", "Tree Farm") }).reason).toContain("钱不够");
    const rich = round(setup(1), { p1: { card: "Tree Farm", action: "build" } });
    expect(names(player(rich, "p1").built)).toEqual(["Tree Farm"]);
    expect(player(rich, "p1").coins).toBe(0);
  });

  it("补充#E-T4 攻城工坊链：建过实验室免费、盾 +3；没建的要付 1 木 + 3 砖", () => {
    let state = buildScene({
      age: 3,
      players: [
        { wonder: "giza", built: ["Laboratory"], coins: 0, hand: ["Siege Workshop", "Palace", "Senate", "Arsenal", "Lodge", "Gardens", "Study"] },
        { wonder: "babylon", built: ["Brickyard", "Lumber Yard"], hand: ["Siege Workshop", "Pantheon", "Town Hall", "Haven", "Observatory", "Academy", "Circus"] },
        { wonder: "rhodes" },
      ],
    });
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Siege Workshop") }).options[0]!.kind).toBe("chain");
    expect(paymentOptions(state, "p2", { card: inHand(state, "p2", "Siege Workshop") }).options[0]).toMatchObject({ kind: "own", total: 0 });
    state = round(state, { p1: { card: "Siege Workshop", action: "build" } });
    expect(shieldsOf(player(state, "p1"))).toBe(3);
    // 乙没有实验室：自己产 1 木 3 砖（起始砖 + 砖厂 2）才建得起，资源不够就不行
    const poor = buildScene({
      age: 3,
      players: [{ wonder: "giza" }, { wonder: "babylon", built: ["Lumber Yard"], hand: ["Siege Workshop", "Pantheon", "Town Hall", "Haven", "Observatory", "Academy", "Circus"] }, { wonder: "rhodes" }],
    });
    expect(paymentOptions(poor, "p2", { card: inHand(poor, "p2", "Siege Workshop") }).reason).toContain("砖");
  });

  it("补充#E-T5 罗德岛 A 成本：有伐木场时阶段 1（2 木）还要买 1 木；阶段 2 = 3 砖、建成 +2 盾；阶段 3 = 4 矿", () => {
    let state = buildScene({
      players: [
        { wonder: "rhodes", built: ["Lumber Yard"], hand: ["Altar", "Theater", "Baths", "Ore Vein", "Clay Pool", "Loom", "Stockade"] },
        { wonder: "olympia" },
        { wonder: "giza" },
      ],
    });
    expect(paymentOptions(state, "p1", { stage: true }).options[0]).toMatchObject({ kind: "trade", left: "W", leftCost: 2 });
    state = round(state, { p1: { card: "Altar", action: "wonder" } });
    expect(player(state, "p1").stages).toBe(1);
    const second = buildScene({ players: [{ wonder: "rhodes", stages: 1, built: ["Brickyard", "Clay Pool"] }, { wonder: "olympia" }, { wonder: "giza" }] });
    expect(paymentOptions(second, "p1", { stage: true }).options[0]!.kind).toBe("own");
    const built = round(second, { p1: { card: player(second, "p1").hand[0]!, action: "wonder" } });
    expect(shieldsOf(player(built, "p1"))).toBe(2);
    const third = buildScene({ players: [{ wonder: "rhodes", stages: 2, built: ["Foundry", "Ore Vein"] }, { wonder: "olympia" }, { wonder: "giza" }] });
    // 起始矿 + 铸造厂 2 + 矿脉 = 4 矿
    expect(paymentOptions(third, "p1", { stage: true }).options[0]!.kind).toBe("own");
  });

  it("补充#E-T7 哈利卡纳苏斯第 6 轮：Age II 第 6 轮建成阶段 2，乙作废的城墙能挑来免费建，并计入本时代军事", () => {
    let state = buildScene({
      age: 2,
      round: 6,
      players: [
        { wonder: "halicarnassus", stages: 1, built: ["Foundry", "Ore Vein"], hand: ["Aqueduct", "Temple"] },
        { wonder: "giza", hand: ["Walls", "Statue"] },
        { wonder: "rhodes", hand: ["Courthouse", "Vineyard"] },
      ],
    });
    state = round(state, { p1: { card: "Aqueduct", action: "wonder" }, p2: { card: "Statue", action: "discard" }, p3: { card: "Vineyard", action: "discard" } });
    expect(state.phase).toBe("discardBuild");
    expect(state.events.some((event) => event.type === "CardsBurned")).toBe(true);
    const walls = state.discard.find((id) => card(id).name === "Walls")!;
    expect(walls).toBeDefined();
    state = act(state, "p1", { type: "DISCARD_BUILD", card: walls });
    expect(state.age).toBe(3);
    const military = state.events.find((event) => event.type === "MilitaryResolved");
    expect(military).toMatchObject({ age: 2, results: [{ player: "p1", shields: 2, left: 3, right: 3 }, {}, {}] });
  });

  describe("补充#E-T8 巴比伦 B 第 6 轮：用第 6 张建阶段 2，第 7 张可以付费建、弃掉换钱、建阶段 3；别人的第 7 张作废不给钱", () => {
    const setup = () =>
      buildScene({
        age: 1,
        round: 6,
        players: [
          {
            wonder: "babylon",
            side: "B",
            stages: 1,
            coins: 2,
            built: ["Lumber Yard", "Timber Yard", "Glassworks", "Clay Pool", "Clay Pit", "Press"],
            hand: ["Altar", "Tree Farm"],
          },
          { wonder: "giza", coins: 0, hand: ["Theater", "Baths"] },
          { wonder: "rhodes", coins: 0, hand: ["Pawnshop", "Stockade"] },
        ],
      });
    const toSeventh = () => {
      const state = round(setup(), { p1: { card: "Altar", action: "wonder" } });
      expect(state.phase).toBe("seventh");
      expect(state.pending).toEqual({ type: "seventh", player: "p1" });
      expect(pendingActors(state)).toEqual(["p1"]);
      expect(player(state, "p1").stages).toBe(2);
      expect(player(state, "p1").hand.map((id) => card(id).name)).toEqual(["Tree Farm"]);
      return state;
    };

    it("(a) 付费建造：林场付 1 金", () => {
      const state = play(toSeventh(), "p1", { card: "Tree Farm", action: "build" });
      expect(names(player(state, "p1").built)).toContain("Tree Farm");
      expect(player(state, "p1").coins).toBe(1);
      expect(state.age).toBe(2);
    });
    it("(b) 弃掉 +3 金", () => {
      const state = play(toSeventh(), "p1", { card: "Tree Farm", action: "discard" });
      expect(player(state, "p1").coins).toBe(5);
    });
    it("(c) 建阶段 3（3 砖 + 1 纸）", () => {
      const state = play(toSeventh(), "p1", { card: "Tree Farm", action: "wonder" });
      expect(player(state, "p1").stages).toBe(3);
    });
    it("别人的第 7 张作废、不给钱；没建阶段 2 的巴比伦也一样", () => {
      const state = play(toSeventh(), "p1", { card: "Tree Farm", action: "discard" });
      expect(player(state, "p2").coins).toBe(3); // 第 6 张弃牌的 3 金，作废的不给
      expect(player(state, "p3").coins).toBe(3);
      const plain = round(buildScene({
        round: 6,
        players: [{ wonder: "babylon", side: "B", stages: 1, coins: 0, hand: ["Altar", "Tree Farm"] }, { wonder: "giza" }, { wonder: "rhodes" }],
      }));
      expect(plain.phase).toBe("play");
      expect(plain.age).toBe(2);
      expect(player(plain, "p1").coins).toBe(3);
    });
  });

  it("补充#E-T9 奥林匹亚 A：阶段 2 后 Age II 第 1 轮免费建水道桥；同一时代再用拒绝；Age III 又能用；能链的牌走链不扣次数；第 6 轮也能用", () => {
    let state = buildScene({
      age: 2,
      round: 1,
      players: [
        { wonder: "olympia", stages: 2, built: ["Altar"], coins: 0, hand: ["Aqueduct", "Temple", "Walls", "School", "Sawmill", "Statue", "Bazar"] },
        { wonder: "giza" },
        { wonder: "rhodes" },
      ],
    });
    // 神庙能链（祭坛）：只有 chain，没有 olympia；硬要用奥林匹亚会被拒
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Temple") }).options.map((option) => option.kind)).toEqual(["chain"]);
    expect(() => play(state, "p1", { card: "Temple", action: "build", olympia: true })).toThrow(/免费链/);
    // 水道桥 3 石：自己没有，只有奥林匹亚的免费建造
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Aqueduct") }).options).toEqual([
      { kind: "olympia", left: "", right: "", leftCost: 0, rightCost: 0, bankCost: 0, total: 0, isDefault: true },
    ]);
    state = round(state, { p1: { card: "Aqueduct", action: "build", olympia: true } });
    expect(names(player(state, "p1").built)).toContain("Aqueduct");
    expect(player(state, "p1").freeBuildUsed).toBe(true);
    expect(player(state, "p1").coins).toBe(0);
    state = round(state);
    expect(state.round).toBe(3);
    for (const id of player(state, "p1").hand) {
      expect(paymentOptions(state, "p1", { card: id }).options.some((option) => option.kind === "olympia")).toBe(false);
    }
    expect(() => play(state, "p1", { card: player(state, "p1").hand[0]!, action: "build", olympia: true })).toThrow();
    state = finishAge(state);
    expect(state.age).toBe(3);
    expect(player(state, "p1").freeBuildUsed).toBe(false);
    const free = player(state, "p1").hand.find((id) => paymentOptions(state, "p1", { card: id }).options.some((option) => option.kind === "olympia"));
    expect(free).toBeDefined();
    // 第 6 轮也能用
    const last = buildScene({
      age: 3,
      round: 6,
      players: [{ wonder: "olympia", stages: 2, hand: ["Palace", "Pantheon"] }, { wonder: "giza" }, { wonder: "rhodes" }],
    });
    const done = round(last, { p1: { card: "Palace", action: "build", olympia: true } });
    expect(names(player(done, "p1").built)).toContain("Palace");
  });

  it("补充#E-T10 奥林匹亚 B 阶段 1 + 东贸易站：从右邻买石 1 金（不是 0）；从左邻买玻璃 2 金（制成品没折扣）", () => {
    const state = buildScene({
      age: 2,
      players: [
        { wonder: "olympia", side: "B", stages: 1, built: ["East Trading Post"], hand: ["Walls", "Temple", "Aqueduct", "School", "Sawmill", "Statue", "Bazar"] },
        { wonder: "alexandria" },
        { wonder: "rhodes" },
        { wonder: "giza", built: ["Stone Pit", "Quarry"] },
      ],
    });
    // 城墙 3 石：右邻金字塔起始石 + 采石坑 + 采石场 2 → 买 3 石每份 1 金
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Walls") }).options[0]).toMatchObject({ right: "SSS", rightCost: 3 });
    // 神庙 1 木 1 砖 1 玻：木自己有（奥林匹亚起始），砖没人卖 → 换个只缺玻璃的：看价格
    const temple = paymentOptions(state, "p1", { card: inHand(state, "p1", "Temple") });
    expect(temple.reason).toContain("凑不齐");
    const glass = buildScene({
      age: 2,
      players: [
        { wonder: "olympia", side: "B", stages: 1, built: ["East Trading Post", "Clay Pool"], hand: ["Temple", "Walls", "Aqueduct", "School", "Sawmill", "Statue", "Bazar"] },
        { wonder: "alexandria" },
        { wonder: "rhodes" },
        { wonder: "giza" },
      ],
    });
    expect(paymentOptions(glass, "p1", { card: inHand(glass, "p1", "Temple") }).options[0]).toMatchObject({ left: "G", leftCost: 2, total: 2 });
  });

  it("补充#E-T11 葡萄园计入邻城同轮刚建的棕卡：3 + (2 + 1) + (1 + 1) = 8 金", () => {
    let state = buildScene({
      age: 2,
      players: [
        { wonder: "giza", coins: 0, built: ["Lumber Yard", "Clay Pool", "Ore Vein"], hand: ["Vineyard", "Temple", "Aqueduct", "School", "Walls", "Statue", "Bazar"] },
        { wonder: "olympia", built: ["Stone Pit", "Clay Pit"], hand: ["Sawmill", "Courthouse", "Library", "Glassworks", "Press", "Loom", "Forum"] },
        { wonder: "rhodes" },
        { wonder: "babylon", built: ["Timber Yard"], hand: ["Foundry", "Laboratory", "Dispensary", "Archery Range", "Caravansery", "Quarry", "Brickyard"] },
      ],
    });
    state = round(state, { p1: { card: "Vineyard", action: "build" }, p2: { card: "Sawmill", action: "build" }, p4: { card: "Foundry", action: "build" } });
    const reveal = state.lastReveal.find((entry) => entry.player === "p1")!;
    expect(reveal.gained).toBe(8);
    expect(player(state, "p1").coins).toBe(8);
  });

  it("补充#E-T12 当轮收入不能当轮用：甲回合开始 1 金，左邻这一轮向他买 2 份资源，他这一轮还是买不起，下一轮才有 5 金", () => {
    let state = buildScene({
      players: [
        { wonder: "babylon", coins: 1, built: ["Clay Pool"], hand: ["Stockade", "Lumber Yard", "Altar", "Theater", "Baths", "Ore Vein", "Loom"] },
        { wonder: "halicarnassus", coins: 6, hand: ["Guard Tower", "Barracks", "Workshop", "Scriptorium", "Press", "Glassworks", "Tavern"] },
        { wonder: "olympia", hand: ["Stone Pit", "Clay Pit", "Apothecary", "East Trading Post", "West Trading Post", "Marketplace", "Timber Yard"] },
      ],
    });
    // 乙（甲的左邻）垫奇迹：哈利卡纳苏斯 A 阶段 1 = 2 砖，向他的右邻（甲：起始砖 + 粘土池）买 2 砖，甲本该收 4 金
    expect(paymentOptions(state, "p2", { stage: true }).options[0]).toMatchObject({ right: "CC", rightCost: 4 });
    // 甲要建栅栏（1 木）：木只有右邻奥林匹亚有，2 金，甲只有 1 金
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Stockade") }).reason).toContain("钱不够");
    state = play(state, "p2", { card: "Guard Tower", action: "wonder" });
    expect(() => play(state, "p1", { card: "Stockade", action: "build" })).toThrow(/钱不够/);
    state = round(state, { p1: { card: "Lumber Yard", action: "build" } });
    expect(player(state, "p1").coins).toBe(5);
  });

  it("补充#E-T13 邻居本轮刚建的资源本轮买不到：右邻这一轮建伐木场，甲这一轮买不到木，下一轮才行", () => {
    let state = buildScene({
      players: [
        { wonder: "giza", hand: ["Stockade", "Altar", "Theater", "Baths", "Ore Vein", "Clay Pool", "Loom"] },
        { wonder: "rhodes", hand: ["Guard Tower", "Barracks", "Workshop", "Scriptorium", "Press", "Glassworks", "Tavern"] },
        // 丙是甲的右邻；Age I 往左传，丙这一手剩下的牌（含第二张栅栏）下一轮到甲手里
        { wonder: "ephesus", hand: ["Lumber Yard", "Stockade", "Apothecary", "East Trading Post", "West Trading Post", "Marketplace", "Timber Yard"] },
      ],
    });
    state = play(state, "p3", { card: "Lumber Yard", action: "build" });
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Stockade") }).reason).toContain("凑不齐");
    expect(() => play(state, "p1", { card: "Stockade", action: "build" })).toThrow(/凑不齐/);
    state = round(state, { p1: { card: "Altar", action: "discard" } });
    expect(state.round).toBe(2);
    const stockade = inHand(state, "p1", "Stockade");
    expect(paymentOptions(state, "p1", { card: stockade }).options[0]).toMatchObject({ kind: "trade", left: "", right: "W", rightCost: 2 });
  });

  it("补充#E-T14 Age III 牌堆：每种人数 1000 副，非行会按人数标记 + 恰好「人数 + 2」张不同的行会，共 7 × 人数；抽掉的行会不出现在任何视角", () => {
    const guildIds = new Set(GUILDS.map((entry) => entry.id));
    for (const n of [3, 4, 5, 6, 7]) {
      const rng = createRng(1000 + n);
      for (let i = 0; i < 1000; i += 1) {
        const deck = buildAgeDeck(3, n, rng);
        expect(deck.length).toBe(7 * n);
        const guilds = deck.filter((id) => guildIds.has(id));
        expect(new Set(guilds).size).toBe(n + 2);
        expect(deck.filter((id) => !guildIds.has(id)).every((id) => card(id).minPlayers! <= n && card(id).age === 3)).toBe(true);
      }
      // 打到 Age III：状态里（服务端完整状态）只有发出去的那 n + 2 张行会
      let state = createGame(Array.from({ length: n }, (_, index) => ({ id: `p${index + 1}`, name: `${index}` })), 77 + n);
      state = finishAge(finishAge(state));
      expect(state.age).toBe(3);
      const json = JSON.stringify(state);
      const present = [...guildIds].filter((id) => json.includes(`"${id}"`));
      expect(present).toHaveLength(n + 2);
      for (const viewer of state.players) {
        const view = JSON.stringify(redactGameForViewer(state, viewer.id));
        const seen = [...guildIds].filter((id) => view.includes(`"${id}"`));
        expect(seen.every((id) => viewer.hand.includes(id))).toBe(true);
      }
    }
  });
});
