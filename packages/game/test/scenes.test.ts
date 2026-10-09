/** 预览局面工厂（对外接口）：每个命名局面都能造出来、内容和说明一致；buildScene 的校验；补充 §4.3 教程剧本按引擎走一遍。 */
import { describe, expect, it } from "vitest";
import {
  apply,
  buildScene,
  card,
  legalActions,
  paymentOptions,
  pendingActors,
  playOptions,
  playTo,
  previewRoom,
  scene,
  SCENES,
  scoreBreakdown,
  wonderStages,
  WONDER_KEYS,
  type SceneName,
} from "../src/index.js";
import { inHand, names, player, round } from "./helpers.js";

describe("命名局面", () => {
  it("SCENES 里每个名字都能造出合法局面（在等的人都有合法行动）", () => {
    for (const name of Object.keys(SCENES) as SceneName[]) {
      const state = scene(name);
      expect(state.players.length).toBeGreaterThanOrEqual(3);
      if (state.phase !== "finished") {
        const actors = pendingActors(state);
        expect(actors.length, name).toBeGreaterThan(0);
        for (const actor of actors) expect(legalActions(state, actor).length, name).toBeGreaterThan(0);
      }
    }
  });

  it("start / midgame / playTo：任意人数（3–7）任意时代任意轮", () => {
    for (const players of [3, 4, 5, 6, 7]) expect(scene("start", { players }).players).toHaveLength(players);
    for (const age of [1, 2, 3] as const) {
      for (const round of [1, 3, 6]) {
        const state = scene("midgame", { players: 7, age, round });
        expect([state.phase, state.age, state.round]).toEqual(["play", age, round]);
        expect(state.players.every((entry) => entry.hand.length === 8 - round)).toBe(true);
      }
    }
  });

  it("allActions：手里有自己能建、能免费链、要向两边买、建不了但能垫奇迹、同名建过的", () => {
    const state = scene("allActions");
    const kinds = Object.fromEntries(playOptions(state, "p1").map((entry) => [card(entry.card).name, entry.build.options[0]?.kind ?? entry.build.reason]));
    expect(kinds).toMatchObject({ Temple: "own", Library: "chain", Statue: "trade", Vineyard: "own" });
    expect(kinds.Walls).toContain("凑不齐");
    expect(kinds.Loom).toContain("同名");
    const statue = paymentOptions(state, "p1", { card: inHand(state, "p1", "Statue") }).options[0]!;
    expect([statue.left, statue.right]).toEqual(["O", "O"]);
    expect(paymentOptions(state, "p1", { stage: true }).options[0]!.kind).toBe("own");
  });

  it("tradeBoth：没折扣 6 金（左 2 砖 4 + 右 1 布 2），有折扣 3 金", () => {
    for (const [discount, total] of [[false, 6], [true, 3]] as const) {
      const state = scene("tradeBoth", { discount });
      const option = paymentOptions(state, "p1", { card: inHand(state, "p1", "Courthouse") }).options[0]!;
      expect(option).toMatchObject({ left: "CC", right: "L", total });
    }
  });

  it("wonderStage：每块奇迹每一面的每一阶段都能造出「资源够、马上能建」的局面", () => {
    for (const wonder of WONDER_KEYS) {
      for (const side of ["A", "B"] as const) {
        for (let stage = 1; stage <= wonderStages(wonder, side).length; stage += 1) {
          const state = scene("wonderStage", { wonder, side, stage });
          expect(player(state, "p1").stages).toBe(stage - 1);
          expect(paymentOptions(state, "p1", { stage: true }).options[0]?.kind, `${wonder} ${side} ${stage}`).toBe("own");
        }
      }
    }
  });

  it("babylonSeventh / halicarnassus / olympiaFree / chain / lastRound / submitted / chooseWonders", () => {
    expect(scene("babylonSeventh")).toMatchObject({ phase: "seventh", pending: { type: "seventh", player: "p1" } });
    const hal = scene("halicarnassus");
    expect(hal.phase).toBe("discardBuild");
    expect(names(hal.discard)).toContain("Glassworks");
    const olympia = scene("olympiaFree");
    expect(paymentOptions(olympia, "p1", { card: player(olympia, "p1").hand[0]! }).options.some((option) => option.kind === "olympia")).toBe(true);
    const chain = scene("chain");
    expect(paymentOptions(chain, "p1", { card: inHand(chain, "p1", "Library") }).options[0]!.kind).toBe("chain");
    expect(scene("lastRound").players.every((entry) => entry.hand.length === 2)).toBe(true);
    const submitted = scene("submitted");
    expect(submitted.players.map((entry) => entry.submitted)).toEqual([true, true, false, false]);
    expect(scene("chooseWonders")).toMatchObject({ phase: "wonders", chooser: 2 });
  });

  it("militaryDone：Age I 刚结束，事件里有军事结算，Age II 第 1 轮刚发牌", () => {
    const state = scene("militaryDone");
    expect([state.age, state.round]).toEqual([2, 1]);
    expect(state.events.map((event) => event.type)).toContain("MilitaryResolved");
  });

  it("final：七项都有分；finalTie：两人并列第一", () => {
    const final = scene("final");
    const me = final.finalResult!.scores[0]!;
    for (const key of ["military", "coins", "wonder", "civilian", "science", "commerce", "guilds"] as const) expect(me[key], key).not.toBe(0);
    expect(final.finalResult!.scores.some((entry) => entry.copiedGuild !== null)).toBe(true);
    expect(me.scienceDetail.wild).toBe(1);
    const tie = scene("finalTie");
    expect(tie.finalResult!.winners).toEqual(["p1", "p3"]);
  });

  it("fullCities：7 人局 A / B 两面都能造，每人奇迹建满、城里 15 张以上、牌不重复", () => {
    for (const side of ["A", "B"] as const) {
      const state = scene("fullCities", { side });
      expect(state.players).toHaveLength(7);
      for (const entry of state.players) {
        expect(entry.side).toBe(side);
        expect(entry.stages).toBe(wonderStages(entry.wonder!, side).length);
        expect(entry.built.length).toBeGreaterThanOrEqual(15);
        expect(new Set(entry.built.map((id) => card(id).name)).size).toBe(entry.built.length);
      }
      const all = state.players.flatMap((entry) => [...entry.built, ...entry.stageCards, ...entry.hand]);
      expect(new Set(all).size).toBe(all.length);
      expect(pendingActors(state)).toHaveLength(7);
    }
  });

  it("previewRoom：视角已经 redact、成员的离线 / 托管 / 人机、倒计时、超时事件", () => {
    const game = scene("submitted");
    const room = previewRoom(game, { viewer: "p2", offline: ["p3"], auto: ["p4"], bots: ["p4"], turnRemainingMs: 8000, timedOut: "p3" });
    expect(room.game!.players[0]!.hand).toEqual([]);
    expect(room.game!.players[1]!.hand.length).toBe(7);
    expect(room.members.find((member) => member.playerId === "p3")!.connected).toBe(false);
    expect(room.members.find((member) => member.playerId === "p4")).toMatchObject({ auto: true, bot: true });
    expect(room.turnRemainingMs).toBe(8000);
    expect(room.game!.events[0]).toEqual({ type: "TurnTimedOut", player: "p3" });
    expect("seed" in room.game!).toBe(false);
    const watching = previewRoom(game, { spectating: true });
    expect(watching.spectators).toHaveLength(1);
    expect(watching.game!.players.every((entry) => entry.hand.length === 0)).toBe(true);
  });
});

describe("buildScene 的校验", () => {
  it("同名建两张、牌不够、奇迹重复、手牌张数不对、阶段超了都抛错", () => {
    expect(() => buildScene({ players: [{ wonder: "giza", built: ["Altar", "Altar"] }, { wonder: "rhodes" }, { wonder: "olympia" }] })).toThrow(/同名/);
    expect(() => buildScene({ players: [{ wonder: "giza" }, { wonder: "giza" }, { wonder: "olympia" }] })).toThrow(/重复/);
    expect(() => buildScene({ players: [{ wonder: "giza", hand: ["Altar"] }, { wonder: "rhodes" }, { wonder: "olympia" }] })).toThrow(/7 张/);
    expect(() => buildScene({ players: [{ wonder: "giza", stages: 4 }, { wonder: "rhodes" }, { wonder: "olympia" }] })).toThrow(/阶段/);
    expect(() => buildScene({ players: [{ wonder: "giza", built: ["Palace", "Palace@3", "Palace"] }, { wonder: "rhodes" }, { wonder: "olympia" }] })).toThrow();
    expect(() => buildScene({ players: [{ wonder: "giza" }, { wonder: "rhodes" }] })).toThrow(/3–7/);
  });

  it("造出来的局面能接着打完（真实对局）", () => {
    let state = buildScene({ age: 2, round: 4, players: [{ wonder: "giza" }, { wonder: "rhodes", side: "B" }, { wonder: "babylon", side: "B", stages: 1 }, { wonder: "halicarnassus", stages: 1 }] });
    for (let guard = 0; guard < 200 && state.phase !== "finished"; guard += 1) {
      const actor = pendingActors(state)[0]!;
      state = apply(state, actor, legalActions(state, actor)[0]!).state;
    }
    expect(state.phase).toBe("finished");
  });
});

describe("补充 §4.3 教程剧本（3 人局 Age I 完整一时代 + Age II 第 1 轮）按引擎走一遍", () => {
  it("每一步的牌、付款、传牌、军事结算都和剧本对得上", () => {
    let state = buildScene({
      players: [
        { wonder: "giza", name: "学员", hand: ["Stone Pit", "Altar", "Theater", "Guard Tower", "Clay Pit", "Workshop", "Marketplace"] },
        { wonder: "babylon", name: "咕噜一号", hand: ["Scriptorium", "Clay Pool", "Timber Yard", "Loom", "Glassworks", "Barracks", "West Trading Post"] },
        { wonder: "olympia", name: "咕噜二号", hand: ["Baths", "Stockade", "Press", "Lumber Yard", "East Trading Post", "Ore Vein", "Apothecary"] },
      ],
      stacked: {
        2: [
          ["Library", "Sawmill", "Walls", "Aqueduct", "Temple", "Statue", "Courthouse"],
          ["Quarry", "Brickyard", "Foundry", "Loom@2", "Glassworks@2", "Press@2", "Forum"],
          ["Caravansery", "Vineyard", "Stables", "Archery Range", "Dispensary", "Laboratory", "School"],
        ],
      },
    });
    const coins = () => player(state, "p1").coins;
    // 第 1 轮
    state = round(state, { p1: { card: "Stone Pit", action: "build" }, p2: { card: "Clay Pool", action: "build" }, p3: { card: "Press", action: "build" } });
    expect(names(player(state, "p1").hand).sort()).toEqual(["Apothecary", "Baths", "East Trading Post", "Lumber Yard", "Ore Vein", "Stockade"]);
    // 第 2 轮：浴场 1 石自己有
    state = round(state, { p1: { card: "Baths", action: "build" }, p2: { card: "Guard Tower", action: "build" }, p3: { card: "Timber Yard", action: "build" } });
    expect(coins()).toBe(3);
    expect(player(state, "p3").coins).toBe(2);
    // 第 3 轮：写字间缺 1 纸，向右邻买 2 金
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Scriptorium") }).options[0]).toMatchObject({ right: "P", rightCost: 2 });
    state = round(state, { p1: { card: "Scriptorium", action: "build" }, p2: { card: "Lumber Yard", action: "build" }, p3: { card: "Clay Pit", action: "build" } });
    expect(coins()).toBe(1);
    // 第 4 轮：工坊垫奇迹，金字塔第 1 层（2 石）
    state = round(state, { p1: { card: "Workshop", action: "wonder" }, p2: { card: "Loom", action: "build" }, p3: { card: "Ore Vein", action: "build" } });
    expect(player(state, "p1").stages).toBe(1);
    // 第 5 轮：药房要布，左邻有布但只有 1 金买不起 → 弃牌换 3 金
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Apothecary") }).reason).toContain("钱不够");
    state = round(state, { p1: { card: "Apothecary", action: "discard" }, p2: { card: "Altar", action: "build" }, p3: { card: "West Trading Post", action: "build" } });
    expect(coins()).toBe(4);
    // 第 6 轮：兵营缺 1 矿向右邻买 2 金；玻璃厂作废
    expect(names(player(state, "p1").hand).sort()).toEqual(["Barracks", "Glassworks"]);
    state = round(state, { p1: { card: "Barracks", action: "build" }, p2: { card: "East Trading Post", action: "build" }, p3: { card: "Theater", action: "build" } });
    expect(coins()).toBe(2);
    expect(names(state.discard).sort()).toEqual(["Apothecary", "Glassworks", "Marketplace", "Stockade"]);
    // 时代结束：学员和左邻平、赢右邻 +1；左邻赢右邻 +1；右邻 −1 −1
    expect(player(state, "p1").tokens.map((token) => token.value)).toEqual([1]);
    expect(player(state, "p2").tokens.map((token) => token.value)).toEqual([1]);
    expect(player(state, "p3").tokens.map((token) => token.value)).toEqual([-1, -1]);
    expect(scoreBreakdown(state, "p1")).toMatchObject({ military: 1, wonder: 3, civilian: 3 });
    // Age II 第 1 轮：图书馆免费链，往右传
    expect(state.direction).toBe("right");
    expect(paymentOptions(state, "p1", { card: inHand(state, "p1", "Library") }).options[0]!.kind).toBe("chain");
    state = round(state, { p1: { card: "Library", action: "build" } });
    expect(scoreBreakdown(state, "p1").science).toBe(4);
    // 往右传：学员拿到左邻（咕噜一号）弃掉第一张以后的那手
    expect(names(player(state, "p1").hand)).toEqual(["Brickyard", "Foundry", "Loom", "Glassworks", "Press", "Forum"]);
  });
});
