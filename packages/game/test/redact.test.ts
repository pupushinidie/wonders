/** 隐藏信息：每个座位视角、观战视角、观战看全部、哈利卡纳苏斯挑弃牌那一步。 */
import { describe, expect, it } from "vitest";
import { apply, botCommand, buildScene, legalActions, pendingActors, playTo, redactGameForViewer, scene, type GameState } from "../src/index.js";
import { deepFreeze, play, player, round } from "./helpers.js";

const SERVER_ONLY = ["seed", "rngState", "log", "stacked"];

function midRound(): GameState {
  // 第 2 轮：上一轮有人弃牌、有人垫奇迹、有人建造；这一轮甲已经交了
  let state = buildScene({
    players: [
      { wonder: "giza", built: ["Stone Pit"], hand: ["Altar", "Theater", "Baths", "Pawnshop", "Lumber Yard", "Clay Pool", "Loom"] },
      { wonder: "rhodes", hand: ["Guard Tower", "Barracks", "Workshop", "Scriptorium", "Press", "Glassworks", "Tavern"] },
      { wonder: "olympia", hand: ["Ore Vein", "Clay Pit", "Apothecary", "East Trading Post", "West Trading Post", "Marketplace", "Timber Yard"] },
    ],
    stacked: {
      2: [
        ["Sawmill", "Quarry", "Brickyard", "Foundry", "Loom@2", "Glassworks@2", "Press@2"],
        ["Aqueduct", "Temple", "Statue", "Courthouse", "Forum", "Caravansery", "Vineyard"],
        ["Bazar", "Walls", "Training Ground", "Stables", "Archery Range", "Dispensary", "Laboratory"],
      ],
    },
  });
  state = round(state, { p1: { card: "Altar", action: "wonder" }, p2: { card: "Guard Tower", action: "discard" }, p3: { card: "Ore Vein", action: "build" } });
  return play(state, "p1", { card: player(state, "p1").hand[0]!, action: "discard" });
}

describe("redactGameForViewer", () => {
  it("别人的手牌、交了什么、垫奇迹的牌、弃牌堆牌面都拿不到；张数和「交了没有」公开；种子等服务端字段删掉", () => {
    const state = deepFreeze(midRound());
    const p1 = player(state, "p1");
    const view = redactGameForViewer(state, "p2");
    for (const key of SERVER_ONLY) expect(key in view).toBe(false);
    const seenP1 = view.players[0]!;
    expect(seenP1.hand).toEqual([]);
    expect(seenP1.handCount).toBe(p1.hand.length);
    expect(seenP1.play).toBeNull();
    expect(seenP1.submitted).toBe(true);
    expect(seenP1.stageCards).toEqual([]);
    expect(seenP1.stages).toBe(1);
    expect(seenP1.built).toEqual(p1.built);
    expect(view.discard).toEqual([]);
    expect(view.discardCount).toBe(state.discard.length);
    // 自己的都在
    expect(view.players[1]!.hand).toEqual(player(state, "p2").hand);
    // 上一轮：别人垫奇迹 / 弃掉的是哪张看不到，建造的看得到
    const reveal = Object.fromEntries(view.lastReveal.map((entry) => [entry.player, entry.card]));
    expect(reveal.p1).toBeNull();
    expect(reveal.p2).not.toBeNull(); // 自己弃的自己知道
    expect(reveal.p3).toBe(player(state, "p3").built[0]);
    // 甲自己的视角：自己交的牌、垫下去的牌都看得到
    const mine = redactGameForViewer(state, "p1");
    expect(mine.players[0]!.play).toEqual(p1.play);
    expect(mine.players[0]!.stageCards).toEqual(p1.stageCards);
    expect(mine.players[1]!.hand).toEqual([]);
  });

  it("观战（viewerId = \"\"）什么暗牌都看不到；观战看全部（seeAll）能看手牌、交的牌、垫的牌、弃牌堆，但种子照样没有", () => {
    const state = midRound();
    const blind = redactGameForViewer(state, "");
    expect(blind.players.every((entry) => entry.hand.length === 0 && entry.play === null && entry.stageCards.length === 0)).toBe(true);
    expect(blind.discard).toEqual([]);
    expect(blind.lastReveal.filter((entry) => entry.action !== "build").every((entry) => entry.card === null)).toBe(true);
    const all = redactGameForViewer(state, "", { seeAll: true });
    for (const key of SERVER_ONLY) expect(key in all).toBe(false);
    expect(all.players.map((entry) => entry.hand)).toEqual(state.players.map((entry) => entry.hand));
    expect(all.players[0]!.play).toEqual(state.players[0]!.play);
    expect(all.discard).toEqual(state.discard);
  });

  it("U12：弃牌堆牌面只在哈利卡纳苏斯挑牌那一步发给他本人", () => {
    const state = scene("halicarnassus");
    expect(redactGameForViewer(state, "p1").discard).toEqual(state.discard);
    expect(redactGameForViewer(state, "p2").discard).toEqual([]);
    expect(redactGameForViewer(state, "").discard).toEqual([]);
    expect(redactGameForViewer(state, "p2").discardCount).toBe(state.discard.length);
    // 再 redact 一次张数不丢
    expect(redactGameForViewer(redactGameForViewer(state, "p2"), "p2").discardCount).toBe(state.discard.length);
  });

  it("事件里别人垫奇迹、弃掉的牌是 null；巴比伦第 7 张同理", () => {
    let state = scene("babylonSeventh");
    state = apply(state, "p1", { type: "PLAY", card: player(state, "p1").hand[0]!, action: "discard" }).state;
    const seventh = redactGameForViewer(state, "p2").events.find((event) => event.type === "SeventhPlayed");
    expect(seventh).toMatchObject({ play: { player: "p1", action: "discard", card: null } });
    const own = redactGameForViewer(state, "p1").events.find((event) => event.type === "SeventhPlayed");
    expect(own).toMatchObject({ play: { card: expect.any(String) } });
  });

  it("人机只吃自己座位的视角也能出合法的牌（占位实现）；一个人只用视角打完 4 人局", () => {
    let state = playTo({ players: 4, age: 1, round: 1, seed: 21 });
    while (state.phase !== "finished") {
      const actor = pendingActors(state)[0]!;
      const command = botCommand(redactGameForViewer(state, actor), actor)!;
      expect(legalActions(state, actor).map((entry) => JSON.stringify(entry))).toContain(JSON.stringify(command));
      state = apply(state, actor, command).state;
    }
    expect(state.finalResult!.winners.length).toBeGreaterThan(0);
  });
});
