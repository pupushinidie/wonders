/**
 * 规则书没写死、按补充文件 §5 推荐默认值（U3–U12）处理的地方，以及引擎本身的规矩（撤回、计时键、纯函数、自选奇迹……）。
 */
import { describe, expect, it } from "vitest";
import {
  apply,
  applyCommand,
  applyTimeout,
  autoCommand,
  buildScene,
  card,
  createGame,
  discardBuildOptions,
  legalActions,
  normalizeCommand,
  paymentOptions,
  pendingActors,
  playTo,
  scene,
  scoreBreakdown,
  WONDER_KEYS,
  type GameState,
} from "../src/index.js";
import { act, deepFreeze, inHand, names, play, player, round } from "./helpers.js";

const total = (state: GameState) => state.players.reduce((sum, entry) => sum + entry.coins, 0);

describe("第 6 轮的先后和插入选择（U3、U4、U6、U7）", () => {
  it("U3：同一轮巴比伦打第 7 张、哈利卡纳苏斯建成能力阶段 → 先巴比伦，再作废，再哈利卡纳苏斯挑（能挑到巴比伦弃的第 7 张和作废的牌），最后军事", () => {
    let state = buildScene({
      age: 1,
      round: 6,
      players: [
        { wonder: "babylon", side: "B", stages: 2, hand: ["Altar", "Stockade"] },
        { wonder: "halicarnassus", stages: 1, built: ["Ore Vein", "Clay Pit", "Mine"], hand: ["Theater", "Baths"] },
        { wonder: "giza", hand: ["Pawnshop", "Barracks"] },
      ],
    });
    state = round(state, { p1: { card: "Altar", action: "discard" }, p2: { card: "Theater", action: "wonder" }, p3: { card: "Pawnshop", action: "discard" } });
    expect(state.phase).toBe("seventh");
    expect(state.discardBuildDue).toBe("p2");
    expect(pendingActors(state)).toEqual(["p1"]);
    expect(() => act(state, "p2", { type: "DISCARD_BUILD", card: null })).toThrow();
    state = play(state, "p1", { card: "Stockade", action: "discard" });
    expect(state.phase).toBe("discardBuild");
    expect(state.pending).toEqual({ type: "discardBuild", player: "p2" });
    expect(state.age).toBe(1);
    // 弃牌堆：甲弃的祭坛、丙弃的当铺、甲第 7 张弃的栅栏、乙作废的浴场、丙作废的兵营
    expect(names(state.discard).sort()).toEqual(["Altar", "Barracks", "Baths", "Pawnshop", "Stockade"]);
    expect(state.events.map((event) => event.type)).toEqual(["SeventhPlayed", "CardsBurned", "DiscardBuildPending"]);
    state = act(state, "p2", { type: "DISCARD_BUILD", card: state.discard.find((id) => card(id).name === "Stockade")! });
    expect(state.events.map((event) => event.type)).toEqual(["BuiltFromDiscard", "MilitaryResolved", "AgeStarted", "RoundStarted"]);
    expect(player(state, "p2").tokens.map((token) => token.value)).toEqual([1, 1]);
  });

  it("U4：巴比伦第 7 张用第 6 轮结算完以后的金币（含第 6 轮收入），邻居第 6 轮刚建的卡也能买", () => {
    let state = buildScene({
      age: 1,
      round: 6,
      players: [
        { wonder: "babylon", side: "B", stages: 2, coins: 0, hand: ["Altar", "Stockade"] },
        { wonder: "giza", hand: ["Lumber Yard", "Baths"] },
        { wonder: "rhodes", hand: ["Pawnshop", "Barracks"] },
      ],
    });
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Stockade") }).reason).toContain("凑不齐");
    state = round(state, { p1: { card: "Altar", action: "discard" }, p2: { card: "Lumber Yard", action: "build" } });
    expect(state.phase).toBe("seventh");
    expect(player(state, "p1").coins).toBe(3);
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Stockade") }).options[0]).toMatchObject({ left: "W", leftCost: 2 });
    state = play(state, "p1", { card: "Stockade", action: "build" });
    expect(names(player(state, "p1").built)).toEqual(["Stockade"]);
    expect(player(state, "p1").coins).toBe(1);
    expect(player(state, "p2").coins).toBe(5);
  });

  it("U6：第 ① 步建的葡萄园不算之后哈利卡纳苏斯从弃牌堆建的棕卡；巴比伦第 7 张本身是葡萄园时按那一刻的数量算", () => {
    let state = buildScene({
      age: 2,
      round: 6,
      players: [
        { wonder: "giza", coins: 0, built: ["Lumber Yard"], hand: ["Vineyard", "Temple"] },
        { wonder: "halicarnassus", stages: 1, built: ["Foundry", "Ore Vein"], hand: ["Aqueduct", "Statue"] },
        { wonder: "rhodes", hand: ["Walls", "Library"] },
      ],
      discard: ["Sawmill"],
    });
    state = round(state, { p1: { card: "Vineyard", action: "build" }, p2: { card: "Aqueduct", action: "wonder" } });
    // 甲 1 棕，乙（左邻）矿脉 + 铸造厂 2 棕，丙 0 → 3 金
    expect(state.lastReveal.find((entry) => entry.player === "p1")!.gained).toBe(3);
    state = act(state, "p2", { type: "DISCARD_BUILD", card: state.discard.find((id) => card(id).name === "Sawmill")! });
    expect(player(state, "p1").coins).toBe(3);

    let babylon = buildScene({
      age: 2,
      round: 6,
      players: [
        { wonder: "babylon", side: "B", stages: 2, coins: 0, built: ["Lumber Yard"], hand: ["Temple", "Vineyard"] },
        { wonder: "giza", built: ["Clay Pool"], hand: ["Sawmill", "Statue"] },
        { wonder: "rhodes", hand: ["Foundry", "Library"] },
      ],
    });
    babylon = round(babylon, { p1: { card: "Temple", action: "discard" }, p2: { card: "Sawmill", action: "build" }, p3: { card: "Foundry", action: "build" } });
    babylon = play(babylon, "p1", { card: "Vineyard", action: "build" });
    // 甲 1 + 乙（粘土池 + 锯木厂）2 + 丙（铸造厂）1 = 4
    expect(babylon.events.find((event) => event.type === "SeventhPlayed")).toMatchObject({ play: { gained: 4 } });
  });

  it("U7：弃牌堆里没有能建的（只剩同名建过的）→ 能力作废、不等他；有能建的也可以主动放弃", () => {
    let state = buildScene({
      age: 2,
      round: 2,
      players: [
        { wonder: "halicarnassus", stages: 1, built: ["Foundry", "Ore Vein", "Temple"], hand: ["Aqueduct", "Statue", "Walls", "School", "Sawmill", "Bazar"] },
        { wonder: "giza", hand: ["Temple", "Library", "Courthouse", "Glassworks@2", "Press@2", "Loom@2"] },
        { wonder: "rhodes", hand: ["Quarry", "Brickyard", "Foundry", "Sawmill", "Forum", "Caravansery"] },
      ],
    });
    // 乙弃神庙（甲建过同名），丙建采石场 → 弃牌堆只有一张神庙
    state = round(state, {
      p1: { card: "Aqueduct", action: "wonder" },
      p2: { card: "Temple", action: "discard" },
      p3: { card: "Quarry", action: "build" },
    });
    expect(discardBuildOptions(state, "p1")).toEqual([]);
    expect(state.phase).toBe("play");
    expect(state.round).toBe(3);
    expect(state.events.find((event) => event.type === "BuiltFromDiscard")).toMatchObject({ player: "p1", card: null });

    let pass = buildScene({ age: 2, round: 2, phase: "discardBuild", pending: 0, players: [{ wonder: "halicarnassus", stages: 2 }, { wonder: "giza" }, { wonder: "rhodes" }], discard: ["Altar"] });
    expect(() => act(pass, "p1", { type: "DISCARD_BUILD", card: "a1_lumber_yard_3p" })).toThrow(/弃牌堆里没有/);
    pass = act(pass, "p1", { type: "DISCARD_BUILD", card: null });
    expect(pass.discard).toHaveLength(1);
    expect(pass.round).toBe(3);
  });

  it("哈利卡纳苏斯不能挑同名建过的；挑的牌建成时的金币照拿（酒馆 +5）", () => {
    const state = buildScene({
      age: 2,
      round: 3,
      phase: "discardBuild",
      pending: 0,
      players: [{ wonder: "halicarnassus", stages: 2, built: ["Altar"], coins: 1, hand: ["Walls", "School", "Sawmill", "Bazar"] }, { wonder: "giza" }, { wonder: "rhodes" }],
      discard: ["Altar", "Tavern"],
    });
    expect(names(discardBuildOptions(state, "p1"))).toEqual(["Tavern"]);
    expect(() => act(state, "p1", { type: "DISCARD_BUILD", card: state.discard[0]! })).toThrow(/同名/);
    const next = act(state, "p1", { type: "DISCARD_BUILD", card: state.discard[1]! });
    expect(player(next, "p1").coins).toBe(6);
  });

  it("哈利卡纳苏斯 B：每建一个阶段都能挑一次", () => {
    let state = buildScene({
      age: 2,
      players: [
        { wonder: "halicarnassus", side: "B", built: ["Ore Vein", "Foundry", "Brickyard", "Clay Pool"] },
        { wonder: "giza" },
        { wonder: "rhodes" },
      ],
      discard: ["Altar", "Theater", "Baths"],
    });
    for (let stage = 1; stage <= 2; stage += 1) {
      state = round(state, { p1: { card: player(state, "p1").hand[0]!, action: "wonder" } });
      expect(state.phase).toBe("discardBuild");
      state = act(state, "p1", { type: "DISCARD_BUILD", card: discardBuildOptions(state, "p1")[0]! });
    }
    expect(player(state, "p1").stages).toBe(2);
    expect(scoreBreakdown(state, "p1").wonder).toBe(3);
  });
});

describe("出牌、撤回、计时键", () => {
  it("交了可以撤回再改；全员交齐才结算；交牌和撤回都不改 step（计时键），换轮才改；version 每步 +1", () => {
    let state = buildScene({ players: [{ wonder: "giza" }, { wonder: "olympia" }, { wonder: "rhodes" }] });
    const step = state.step;
    const first = player(state, "p1").hand[0]!;
    state = act(state, "p1", { type: "PLAY", card: first, action: "discard" });
    expect(player(state, "p1").submitted).toBe(true);
    expect(player(state, "p1").play).toEqual({ card: first, action: "discard", payment: null });
    expect(state.step).toBe(step);
    expect(pendingActors(state)).toEqual(["p2", "p3"]);
    const version = state.version;
    state = act(state, "p1", { type: "UNDO" });
    expect(state.version).toBe(version + 1);
    expect(player(state, "p1").submitted).toBe(false);
    expect(state.events).toEqual([{ type: "Withdrawn", player: "p1" }]);
    expect(state.step).toBe(step);
    expect(() => act(state, "p1", { type: "UNDO" })).toThrow(/撤回/);
    state = act(state, "p2", { type: "PLAY", card: player(state, "p2").hand[0]!, action: "discard" });
    state = act(state, "p3", { type: "PLAY", card: player(state, "p3").hand[0]!, action: "discard" });
    expect(state.round).toBe(1);
    expect(state.step).toBe(step);
    state = act(state, "p1", { type: "PLAY", card: player(state, "p1").hand[1]!, action: "discard" });
    expect(state.round).toBe(2);
    expect(state.step).toBe(step + 1);
    expect(state.events.map((event) => event.type)).toEqual(["Submitted", "Revealed", "HandsPassed", "RoundStarted"]);
  });

  it("trade 不给就用默认方案；给了要和某个合法方案完全一样（多买、买不卖的、格式不对都拒绝）", () => {
    const state = buildScene({
      age: 2,
      players: [
        { wonder: "giza", built: ["Lumber Yard"], coins: 10, hand: ["Statue", "School", "Walls", "Sawmill", "Bazar", "Aqueduct", "Temple"] },
        { wonder: "rhodes", built: ["Caravansery"] },
        { wonder: "olympia" },
        { wonder: "ephesus", built: ["Ore Vein"] },
      ],
    });
    // 雕像 1 木 2 矿：左邻罗德岛起始矿（商队旅馆不卖），右邻以弗所矿脉 → 左右各 1 矿
    const options = paymentOptions(state, "p1", { card: inHand(state, "p1", "Statue") }).options;
    expect(options.map((option) => [option.left, option.right])).toEqual([["O", "O"]]);
    const submitted = play(state, "p1", { card: "Statue", action: "build" });
    expect(player(submitted, "p1").play!.payment).toMatchObject({ left: "O", right: "O", total: 4 });
    expect(() => play(state, "p1", { card: "Statue", action: "build", trade: { left: "OO", right: "" } })).toThrow(/买资源方案不行/);
    expect(() => play(state, "p1", { card: "Statue", action: "build", trade: { left: "O", right: "OW" } })).toThrow(/买资源方案不行/);
    expect(() => play(state, "p1", { card: "Statue", action: "build", trade: { left: "X", right: "" } })).toThrow(/格式/);
    expect(play(state, "p1", { card: "Statue", action: "build", trade: { left: "O", right: "O" } }).players[0]!.submitted).toBe(true);
  });

  it("商队旅馆、广场、亚历山大的自选资源自己能用、邻居买不到", () => {
    const state = buildScene({
      age: 2,
      players: [
        { wonder: "giza", hand: ["Statue", "School", "Walls", "Sawmill", "Bazar", "Aqueduct", "Temple"] },
        { wonder: "alexandria", stages: 2, built: ["Forum"] },
        { wonder: "rhodes" },
        { wonder: "olympia", built: ["Caravansery"] },
      ],
    });
    // 神庙 1 木 1 砖 1 玻：木只有右邻奥林匹亚起始（商队旅馆不卖），砖谁都不卖（亚历山大的阶段、商队旅馆都不卖）→ 凑不齐
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Temple") }).reason).toContain("凑不齐");
    // 亚历山大自己：阶段 2 任选原料 + 广场任选制成品 + 起始玻璃 → 神庙（木砖玻）缺一份原料
    const alex = buildScene({
      age: 2,
      players: [
        { wonder: "alexandria", stages: 2, built: ["Forum", "Clay Pool"], hand: ["Temple", "Statue", "School", "Walls", "Sawmill", "Bazar", "Aqueduct"] },
        { wonder: "giza" },
        { wonder: "rhodes" },
      ],
    });
    expect(paymentOptions(alex, "p1", { card: inHand(alex, "p1", "Temple") }).options[0]!.kind).toBe("own");
  });

  it("两个邻居同一轮向同一个人买同一份资源都可以；卖家照用；钱都到卖家手里", () => {
    let state = buildScene({
      players: [
        { wonder: "giza", hand: ["Barracks", "Altar", "Theater", "Baths", "Lumber Yard", "Clay Pool", "Loom"] },
        { wonder: "rhodes", hand: ["Guard Tower", "Ore Vein", "Workshop", "Scriptorium", "Press", "Glassworks", "Tavern"] },
        { wonder: "olympia", hand: ["Barracks", "Clay Pit", "Apothecary", "East Trading Post", "West Trading Post", "Marketplace", "Timber Yard"] },
      ],
    });
    // 3 人：甲的左邻是乙（罗德岛，起始矿），丙的右邻也是乙
    const before = total(state);
    state = round(state, {
      p1: { card: "Barracks", action: "build", trade: { left: "O", right: "" } },
      p3: { card: "Barracks", action: "build", trade: { left: "", right: "O" } },
      p2: { card: "Ore Vein", action: "build" },
    });
    expect(player(state, "p2").coins).toBe(3 + 4);
    expect(player(state, "p1").coins).toBe(1);
    expect(player(state, "p3").coins).toBe(1);
    expect(total(state)).toBe(before);
  });

  it("建成时拿的金币：酒馆 5；集市 2/灰卡（自己 + 两邻）；港口 1/棕卡；灯塔 1/黄卡（含自己）；竞技场 3/奇迹阶段；以弗所 A2 +9；罗德岛 B1 +3", () => {
    const gained = (spec: Parameters<typeof buildScene>[0], seat: string, cardName: string | null, action: "build" | "wonder" = "build") => {
      const state = buildScene(spec);
      const next = round(state, { [seat]: { card: cardName ?? player(state, seat).hand[0]!, action } });
      return next.lastReveal.find((entry) => entry.player === seat)!.gained;
    };
    const base = [{ wonder: "giza" as const }, { wonder: "rhodes" as const }, { wonder: "olympia" as const }];
    expect(gained({ players: [{ wonder: "giza", hand: ["Tavern", "Altar", "Theater", "Baths", "Lumber Yard", "Clay Pool", "Loom"] }, base[1]!, base[2]!] }, "p1", "Tavern")).toBe(5);
    expect(
      gained({ age: 2, players: [{ wonder: "giza", built: ["Loom@1"], hand: ["Bazar", "Temple", "Aqueduct", "School", "Walls", "Statue", "Sawmill"] }, { wonder: "rhodes", built: ["Press@1", "Glassworks@1"] }, { wonder: "olympia", built: ["Loom@2"] }] }, "p1", "Bazar"),
    ).toBe(8);
    expect(gained({ age: 3, players: [{ wonder: "giza", built: ["Lumber Yard", "Ore Vein", "Loom", "Forum"], hand: ["Haven", "Palace", "Senate", "Arsenal", "Lodge", "Gardens", "Study"] }, base[1]!, base[2]!] }, "p1", "Haven")).toBe(2);
    expect(gained({ age: 3, players: [{ wonder: "giza", built: ["Tavern", "Caravansery", "Glassworks"], hand: ["Lighthouse", "Palace", "Senate", "Arsenal", "Lodge", "Gardens", "Study"] }, base[1]!, base[2]!] }, "p1", "Lighthouse")).toBe(3);
    expect(gained({ age: 3, players: [{ wonder: "giza", stages: 2, built: ["Stone Pit", "Quarry", "Ore Vein"], hand: ["Arena", "Palace", "Senate", "Arsenal", "Lodge", "Gardens", "Study"] }, base[1]!, base[2]!] }, "p1", "Arena")).toBe(6);
    expect(gained({ players: [{ wonder: "ephesus", stages: 1, built: ["Lumber Yard", "Timber Yard"] }, base[0]!, base[1]!] }, "p1", null, "wonder")).toBe(9);
    expect(gained({ players: [{ wonder: "rhodes", side: "B", built: ["Stone Pit", "Timber Yard", "Excavation"] }, base[0]!, base[2]!] }, "p1", null, "wonder")).toBe(3);
  });

  it("卡牌引用要在手里：gained 用 buildScene 自动发的手牌时也能用名字指定", () => {
    const state = buildScene({ players: [{ wonder: "giza", hand: ["Altar", "Theater", "Baths", "Pawnshop", "Lumber Yard", "Clay Pool", "Loom"] }, { wonder: "rhodes" }, { wonder: "olympia" }] });
    expect(inHand(state, "p1", "祭坛")).toBe(inHand(state, "p1", "Altar"));
  });
});

describe("开局、自选奇迹、纯函数、超时", () => {
  it("3–7 人才能开局；默认随机分奇迹、全员 A 面、每人 3 金 7 张；randomSides 时 A/B 都会出现", () => {
    const people = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `p${index + 1}`, name: `${index}` }));
    expect(() => createGame(people(2))).toThrow(/3–7/);
    expect(() => createGame(people(8))).toThrow(/3–7/);
    for (const n of [3, 4, 5, 6, 7]) {
      const state = createGame(people(n), n);
      expect(new Set(state.players.map((entry) => entry.wonder)).size).toBe(n);
      expect(state.players.every((entry) => entry.side === "A" && entry.coins === 3 && entry.hand.length === 7)).toBe(true);
      expect(state.phase).toBe("play");
      expect(state.events.map((event) => event.type)).toEqual(["WondersAssigned", "AgeStarted", "RoundStarted"]);
    }
    const sides = new Set<string>();
    for (let seed = 0; seed < 30; seed += 1) for (const entry of createGame(people(7), seed, { randomSides: true }).players) sides.add(entry.side);
    expect([...sides].sort()).toEqual(["A", "B"]);
  });

  it("自选奇迹：从随机一位开始按座位轮流挑（每换一人 step +1），挑过的不能再挑，挑完才发 Age I 的牌", () => {
    let state = createGame([{ id: "a", name: "甲" }, { id: "b", name: "乙" }, { id: "c", name: "丙" }], 5, { chooseWonders: true });
    expect(state.phase).toBe("wonders");
    expect(state.players.every((entry) => entry.hand.length === 0 && entry.wonder === null)).toBe(true);
    const order = state.chooseOrder.map((index) => state.players[index]!.id);
    expect(new Set(order).size).toBe(3);
    // 按座位顺序：每个人后面是他的左邻
    expect(state.chooseOrder.every((index, position) => position === 0 || index === (state.chooseOrder[position - 1]! + 1) % 3)).toBe(true);
    expect(pendingActors(state)).toEqual([order[0]]);
    expect(() => act(state, order[1]!, { type: "CHOOSE_WONDER", wonder: "giza", side: "A" })).toThrow(/还没轮到/);
    const step = state.step;
    state = act(state, order[0]!, { type: "CHOOSE_WONDER", wonder: "giza", side: "B" });
    expect(state.step).toBe(step + 1);
    expect(() => act(state, order[1]!, { type: "CHOOSE_WONDER", wonder: "giza", side: "A" })).toThrow(/有人挑/);
    expect(() => act(state, order[1]!, { type: "CHOOSE_WONDER", wonder: "atlantis" as never, side: "A" })).toThrow();
    state = act(state, order[1]!, { type: "CHOOSE_WONDER", wonder: "rhodes", side: "A" });
    state = act(state, order[2]!, { type: "CHOOSE_WONDER", wonder: "babylon", side: "B" });
    expect(state.phase).toBe("play");
    expect(state.age).toBe(1);
    expect(state.players.every((entry) => entry.hand.length === 7)).toBe(true);
    expect(state.players.find((entry) => entry.id === order[0])).toMatchObject({ wonder: "giza", side: "B" });
  });

  it("apply 不改输入（深冻结的状态打完一整局）；同一种子、同一串命令得到同一局", () => {
    const people = Array.from({ length: 5 }, (_, index) => ({ id: `p${index + 1}`, name: `${index}` }));
    const run = () => {
      let state = deepFreeze(createGame(people, 99));
      const commands: string[] = [];
      while (state.phase !== "finished") {
        const actor = pendingActors(state)[0]!;
        const command = autoCommand(state, actor)!;
        commands.push(JSON.stringify(command));
        state = deepFreeze(apply(state, actor, command).state);
      }
      return { state, commands };
    };
    const a = run();
    const b = run();
    expect(a.commands).toEqual(b.commands);
    expect(a.state.finalResult).toEqual(b.state.finalResult);
  });

  it("保底动作和超时：autoCommand 总是合法；applyTimeout 加 TurnTimedOut、动作序列记 timeout；人机给的命令不合法时换成保底动作", () => {
    let state = playTo({ players: 4, age: 2, round: 3, seed: 3 });
    const legal = legalActions(state, "p2").map((command) => JSON.stringify(command));
    expect(legal).toContain(JSON.stringify(autoCommand(state, "p2")));
    const timed = applyTimeout(state, "p2", { type: "PLAY", card: "not_a_card", action: "build" });
    expect(timed.events[0]).toEqual({ type: "TurnTimedOut", player: "p2" });
    expect(timed.log!.at(-1)).toMatchObject({ player: "p2", timeout: true });
    expect(player(timed, "p2").submitted).toBe(true);
    const quiet = applyTimeout(state, "p3", null, false);
    expect(quiet.events.some((event) => event.type === "TurnTimedOut")).toBe(false);
    // 不该他行动时什么都不做
    state = act(state, "p1", autoCommand(state, "p1")!);
    expect(autoCommand(state, "p1")).toBeNull();
    expect(applyTimeout(state, "p1")).toBe(state);
  });

  it("legalActions 每一条都能 apply；不含 UNDO；不该他行动时为空", () => {
    const states = [
      playTo({ players: 3, age: 1, round: 2, seed: 8 }),
      playTo({ players: 6, age: 3, round: 4, seed: 4 }),
      scene("allActions"),
      scene("olympiaFree"),
      scene("babylonSeventh"),
      scene("halicarnassus"),
      scene("chooseWonders"),
      scene("submitted"),
    ];
    for (const state of states) {
      for (const actor of state.players.map((entry) => entry.id)) {
        const actions = legalActions(state, actor);
        expect(actions.some((action) => action.type === "UNDO")).toBe(false);
        if (!pendingActors(state).includes(actor)) expect(actions).toEqual([]);
        else expect(actions.length).toBeGreaterThan(0);
        for (const command of actions) expect(() => apply(state, actor, command)).not.toThrow();
      }
    }
  });

  it("奥林匹亚复制的船主行会不算奥林匹亚城里的紫卡（默认规则表 #15）；复制科学家行会 = 多 1 个任选符号", () => {
    const ship = buildScene({
      phase: "finished",
      age: 3,
      round: 6,
      players: [
        { wonder: "olympia", side: "B", stages: 3, built: ["Lumber Yard", "Loom", "Spies Guild"] },
        { wonder: "giza", built: ["Shipowners Guild"] },
        { wonder: "rhodes" },
      ],
    });
    const olympia = ship.finalResult!.scores[0]!;
    // 复制船主：自己 1 棕 + 1 灰 + 1 紫（密探）= 3；复制来的不算紫卡
    expect(olympia.copiedGuild).toBe(player(ship, "p2").built[0]);
    expect(olympia.guildDetail.find((entry) => entry.copied)!.points).toBe(3);
    const sci = buildScene({
      phase: "finished",
      age: 3,
      round: 6,
      players: [
        { wonder: "olympia", side: "B", stages: 3, built: ["Apothecary", "Workshop"] },
        { wonder: "giza", built: ["Scientists Guild"] },
        { wonder: "rhodes" },
      ],
    });
    expect(sci.finalResult!.scores[0]!).toMatchObject({ science: 10, copiedGuild: player(sci, "p2").built[0] });
    expect(sci.finalResult!.scores[0]!.scienceDetail.wild).toBe(1);
    // 邻居都没有行会：不得分
    const none = buildScene({ phase: "finished", age: 3, round: 6, players: [{ wonder: "olympia", side: "B", stages: 3 }, { wonder: "giza" }, { wonder: "rhodes" }] });
    expect(none.finalResult!.scores[0]!).toMatchObject({ guilds: 0, copiedGuild: null });
  });

  it("终局计分商业：港口 1/棕、灯塔 1/黄（含自己）、商会 2/灰、竞技场 1/阶段；七项相加等于总分", () => {
    const state = buildScene({
      phase: "finished",
      age: 3,
      round: 6,
      players: [
        { wonder: "giza", stages: 2, coins: 7, built: ["Lumber Yard", "Ore Vein", "Loom", "Tavern", "Haven", "Lighthouse", "Chamber of Commerce", "Arena"] },
        { wonder: "rhodes" },
        { wonder: "olympia" },
      ],
    });
    const score = state.finalResult!.scores[0]!;
    expect(score.commerce).toBe(2 + 5 + 2 + 2);
    expect(score.military + score.coins + score.wonder + score.civilian + score.science + score.commerce + score.guilds).toBe(score.total);
    expect(WONDER_KEYS).toHaveLength(7);
  });
});

describe("命令白名单（首发验收 I8）", () => {
  it("normalizeCommand 只留已知字段、字符串限长；不认识的返回 null", () => {
    expect(normalizeCommand({ type: "PLAY", card: "a1_altar_3p", action: "build", trade: { left: "W", right: "", extra: 1 }, olympia: false, player: "p2", junk: "x" })).toEqual({
      type: "PLAY",
      card: "a1_altar_3p",
      action: "build",
      trade: { left: "W", right: "" },
    });
    expect(normalizeCommand({ type: "PLAY", card: "a1_altar_3p", action: "build", olympia: true })).toEqual({ type: "PLAY", card: "a1_altar_3p", action: "build", olympia: true });
    expect(normalizeCommand({ type: "UNDO", junk: "x".repeat(1000) })).toEqual({ type: "UNDO" });
    expect(normalizeCommand({ type: "CHOOSE_WONDER", wonder: "giza", side: "B", x: 1 })).toEqual({ type: "CHOOSE_WONDER", wonder: "giza", side: "B" });
    expect(normalizeCommand({ type: "DISCARD_BUILD", card: null, x: 1 })).toEqual({ type: "DISCARD_BUILD", card: null });
    for (const bad of [null, undefined, "PLAY", 3, [], { type: "HACK" }, { type: "PLAY", card: "x".repeat(65), action: "build" }, { type: "PLAY", card: "a", action: "steal" },
      { type: "PLAY", card: "a", action: "build", trade: "WW" }, { type: "PLAY", card: "a", action: "build", trade: { left: "W".repeat(17), right: "" } },
      { type: "PLAY", card: "a", action: "build", olympia: "yes" }, { type: "CHOOSE_WONDER", wonder: 5, side: "A" }, { type: "DISCARD_BUILD", card: 7 }]) {
      expect(normalizeCommand(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("applyCommand 记进动作序列的是重建后的命令；畸形命令拒绝", () => {
    const state = buildScene({ players: [{ wonder: "giza" }, { wonder: "olympia" }, { wonder: "rhodes" }] });
    const card = player(state, "p1").hand[0]!;
    const next = applyCommand(state, "p1", { type: "PLAY", card, action: "discard", junk: "x".repeat(10_000) } as never);
    expect(next.log!.at(-1)).toEqual({ player: "p1", command: { type: "PLAY", card, action: "discard" } });
    expect(JSON.stringify(next).includes("xxxx")).toBe(false);
    expect(() => applyCommand(state, "p1", { type: "PLAY", card: { evil: true }, action: "discard" } as never)).toThrow(/格式/);
  });
});
