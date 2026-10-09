/**
 * 新手教程剧本单测（照欲罢不能的五项写，换成同时出牌的七大奇迹）：
 * 从头走到尾每一步都合法、关键几幕一定发生、文案里的数字和引擎算的一致、剧本自身的格式、走完接练习局能打完。
 */
import { describe, expect, it } from "vitest";
import {
  botCommand,
  card,
  legalActions,
  paymentOptions,
  pendingActors,
  redactGameForViewer,
  scoreBreakdown,
  type GameState,
} from "@wonders/game";
import {
  applyMove,
  createPracticeGame,
  createShowcaseGame,
  createTutorialGame,
  resolveMove,
  sameMove,
  selfCanAct,
  TUTORIAL_LEFT,
  TUTORIAL_RIGHT,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  type TutorialMove,
  type TutorialStep,
} from "./script.js";

const player = (state: GameState, id: string) => state.players.find((entry) => entry.id === id)!;
const handNames = (state: GameState, id: string) => player(state, id).hand.map((entry) => card(entry).name).sort();
const stepIndex = (id: string) => TUTORIAL_STEPS.findIndex((step) => step.id === id);

function legal(state: GameState, move: TutorialMove): boolean {
  const command = resolveMove(state, move);
  if (command.type === "UNDO") return state.phase === "play" && player(state, move.player).submitted;
  return legalActions(state, move.player).some((candidate) => {
    if (candidate.type !== command.type) return false;
    if (candidate.type === "PLAY" && command.type === "PLAY") return candidate.card === command.card && candidate.action === command.action;
    return true;
  });
}

/** 按剧本走到第 upTo 步之前（不含）。 */
function playScript(upTo = TUTORIAL_STEPS.length, seed?: number): GameState {
  let state = createTutorialGame("小蒲", seed);
  for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
    if (step.kind === "do") state = applyMove(state, step.expect);
    if (step.kind === "watch") for (const move of step.moves) state = applyMove(state, move);
  }
  return state;
}

/**
 * 这个锚点在这个局面里，界面上应该看得见吗（对应 GameBoard / ActionPanel 的显示条件；桌面 1440 的布局）。
 * 数组锚点只要第一个看得见就行（网页按顺序挑页面上有的那个）。
 */
function anchorVisible(state: GameState, step: TutorialStep): boolean {
  const me = player(state, TUTORIAL_SELF);
  const myTurn = state.phase === "play" && !me.submitted;
  if (step.card) return me.hand.some((entry) => card(entry).name === step.card) && (step.kind !== "do" || myTurn);
  const anchor = typeof step.anchor === "string" ? step.anchor : step.anchor?.[0];
  if (!anchor) return true;
  if (step.showcase) return state.phase === "finished" && ["final", "final-table", "final-detail"].includes(anchor);
  switch (anchor) {
    case "hand":
      return me.hand.length > 0;
    case "submitted":
    case "undo":
      return state.phase === "play" && me.submitted;
    case "submitted-count":
    case "auto":
      return state.phase === "play";
    case "military":
      // 时代结束的军事横幅：只在刚结算完的那一刻出现（4 秒后网页改指 my-info）
      return state.events.some((event) => event.type === "MilitaryResolved");
    case "pass-arrow":
      return state.phase !== "finished" && state.phase !== "wonders";
    default:
      return ["my-wonder", "my-board", "my-city", "my-stats", "my-info", "my-wonder-stages", "neighbor-left", "neighbor-right", "neighbor-left-sell", "neighbor-right-sell", "neighbor-right-stats", "neighbor-left-stats"].includes(anchor);
  }
}

describe("新手教程剧本", () => {
  it("从头走到尾：每一步要学员做的都合法，人机的每一手都合法，高亮的东西那时看得见", () => {
    let state = createTutorialGame("小蒲");
    for (const step of TUTORIAL_STEPS) {
      if (!step.showcase) expect(anchorVisible(state, step), `「${step.id}」高亮的东西看不见`).toBe(true);
      if (step.kind === "do") {
        expect(legal(state, step.expect), `「${step.id}」这一步不合法`).toBe(true);
        state = applyMove(state, step.expect);
      }
      if (step.kind === "watch") {
        for (const move of step.moves) {
          expect(legal(state, move), `「${step.id}」里 ${move.player} 的 ${JSON.stringify(move.command)} 不合法`).toBe(true);
          state = applyMove(state, move);
        }
      }
    }
    // 剧本走完：时代 II 第 2 轮，等学员出牌（finale 之后接练习局）
    expect([state.phase, state.age, state.round]).toEqual(["play", 2, 2]);
    expect(pendingActors(state)).toContain(TUTORIAL_SELF);
    const showcase = createShowcaseGame("小蒲");
    for (const step of TUTORIAL_STEPS.filter((entry) => entry.showcase)) expect(anchorVisible(showcase, step), step.id).toBe(true);
  });

  it("关键几幕一定发生，文案里的数字和引擎算的一样", () => {
    // 第 1 轮：两位人机先交，学员建采石坑（免费），之后手里是右邻传来的 6 张
    const r1 = playScript(stepIndex("r1-build"));
    expect(r1.players.filter((entry) => entry.submitted).map((entry) => entry.id)).toEqual([TUTORIAL_LEFT, TUTORIAL_RIGHT]);
    expect(paymentOptions(r1, TUTORIAL_SELF, { card: resolveCard(r1, "Stone Pit") }).options[0]).toMatchObject({ total: 0 });
    const afterR1 = playScript(stepIndex("r1-build") + 1);
    expect(handNames(afterR1, TUTORIAL_SELF)).toEqual(["Apothecary", "Baths", "East Trading Post", "Lumber Yard", "Ore Vein", "Stockade"]);
    expect(afterR1.direction).toBe("left");
    // 第 2 轮：学员先交，可以撤回（还有两位没交）
    const sent = playScript(stepIndex("r2-build") + 1);
    expect(player(sent, TUTORIAL_SELF).submitted).toBe(true);
    expect(pendingActors(sent)).toEqual([TUTORIAL_LEFT, TUTORIAL_RIGHT]);
    const undone = playScript(stepIndex("r2-undo") + 1);
    expect(player(undone, TUTORIAL_SELF).submitted).toBe(false);
    // 浴场 3 分
    expect(scoreBreakdown(playScript(stepIndex("r2-score")), TUTORIAL_SELF).civilian).toBe(3);
    // 第 3 轮：写字间只能向右邻买 1 纸，2 金；买完剩 1 金，右邻收 2 金
    const r3 = playScript(stepIndex("r3-build"));
    const scriptorium = paymentOptions(r3, TUTORIAL_SELF, { card: resolveCard(r3, "Scriptorium") }).options;
    expect(scriptorium).toHaveLength(1);
    expect(scriptorium[0]).toMatchObject({ left: "", right: "P", rightCost: 2, total: 2 });
    const afterR3 = playScript(stepIndex("r3-build") + 1);
    expect(player(afterR3, TUTORIAL_SELF).coins).toBe(1);
    const reveal = afterR3.events.find((event) => event.type === "Revealed");
    expect(reveal?.type === "Revealed" && reveal.plays.find((entry) => entry.player === TUTORIAL_RIGHT)?.income).toBe(2);
    // 第 4 轮：金字塔第 1 层 2 石自己够，建完 +3 分
    const r4 = playScript(stepIndex("r4-build"));
    expect(paymentOptions(r4, TUTORIAL_SELF, { stage: true }).options[0]).toMatchObject({ kind: "own", total: 0 });
    const afterR4 = playScript(stepIndex("r4-build") + 1);
    expect(player(afterR4, TUTORIAL_SELF).stages).toBe(1);
    expect(scoreBreakdown(afterR4, TUTORIAL_SELF).wonder).toBe(3);
    // 第 5 轮：药房要布，只有 1 金买不起（左邻有布）；弃掉 +3 → 4 金
    const r5 = playScript(stepIndex("r5-discard"));
    expect(player(r5, TUTORIAL_SELF).coins).toBe(1);
    expect(paymentOptions(r5, TUTORIAL_SELF, { card: resolveCard(r5, "Apothecary") }).reason).toContain("钱不够");
    expect(player(r5, TUTORIAL_LEFT).built.map((entry) => card(entry).name)).toContain("Loom");
    expect(player(playScript(stepIndex("r5-discard") + 1), TUTORIAL_SELF).coins).toBe(4);
    // 第 6 轮：兵营向右邻买 1 矿 2 金；玻璃厂作废不给钱；军事：和左邻 1:1 平，赢右邻 +1
    const r6 = playScript(stepIndex("r6-build"));
    expect(handNames(r6, TUTORIAL_SELF)).toEqual(["Barracks", "Glassworks"]);
    expect(paymentOptions(r6, TUTORIAL_SELF, { card: resolveCard(r6, "Barracks") }).options[0]).toMatchObject({ right: "O", total: 2 });
    const afterR6 = playScript(stepIndex("r6-build") + 1);
    expect(player(afterR6, TUTORIAL_SELF).coins).toBe(2);
    expect(player(afterR6, TUTORIAL_SELF).tokens).toEqual([{ age: 1, value: 1, vs: "right" }]);
    expect(player(afterR6, TUTORIAL_LEFT).tokens.map((token) => token.value)).toEqual([1]);
    expect(afterR6.discard.map((entry) => card(entry).name)).toContain("Glassworks");
    // 时代 II：往右传；图书馆、水道桥都能免费链
    expect([afterR6.age, afterR6.round, afterR6.direction]).toEqual([2, 1, "right"]);
    for (const name of ["Library", "Aqueduct"]) {
      expect(paymentOptions(afterR6, TUTORIAL_SELF, { card: resolveCard(afterR6, name) }).options[0]!.kind, name).toBe("chain");
    }
    // 图书馆以后：2 张石板 = 4 分；再来 1 圆规 1 齿轮 = 13
    const afterLibrary = playScript(stepIndex("a2-build") + 1);
    expect(scoreBreakdown(afterLibrary, TUTORIAL_SELF).science).toBe(4);
    expect(player(afterLibrary, TUTORIAL_SELF).coins).toBe(2);
    // 往右传：学员接到左邻的那手
    expect(player(afterLibrary, TUTORIAL_SELF).hand).toHaveLength(6);
  });

  it("终局样子：科技 3/2/1 = 21、工人行会 7 分、金币和名次跟文案一致", () => {
    const state = createShowcaseGame("小蒲");
    const me = state.finalResult!.scores.find((score) => score.player === TUTORIAL_SELF)!;
    expect(me.scienceDetail).toMatchObject({ compass: 2, gear: 1, tablet: 3, wild: 0 });
    expect(me.science).toBe(21);
    expect(me.guildDetail.map((entry) => [card(entry.card).name, entry.points])).toEqual([["Workers Guild", 7]]);
    expect(me.coinsHeld).toBe(8);
    expect(me.coins).toBe(2);
    expect(me.military).toBe(8);
    // 学员赢（教程收尾时心情好），每一项都有分
    expect(state.finalResult!.winners).toEqual([TUTORIAL_SELF]);
    for (const score of state.finalResult!.scores) expect(score.total).toBeGreaterThan(30);
    const step = TUTORIAL_STEPS.find((entry) => entry.id === "final-guild")!;
    expect(step.note).toContain(`${me.guildDetail[0]!.points} 分`);
  });

  it("剧本本身：id 不重复、收尾唯一且在最后、每步最多两句、终局讲解都在收尾之前", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
    const tooLong: string[] = [];
    for (const step of TUTORIAL_STEPS) {
      expect(step.say.trim().length, step.id).toBeGreaterThan(0);
      const sentences = (text: string) => text.split(/[。！？]/).filter((part) => part.trim().length > 0).length;
      if (sentences(step.say) + sentences(step.note ?? "") > 2) tooLong.push(step.id);
      // 不说内部术语
      expect(`${step.say}${step.note ?? ""}`).not.toMatch(/command|phase|PLAY|UNDO|Age /);
    }
    expect(tooLong, "超过两句的步骤").toEqual([]);
    expect(TUTORIAL_STEPS.findIndex((step) => step.showcase)).toBeGreaterThan(stepIndex("a2-build"));
  });

  it("同一步的判断：牌名或牌 id 都认，用法不同、人不同都不算", () => {
    const state = createTutorialGame("小蒲");
    const id = resolveCard(state, "Stone Pit");
    const expectMove = TUTORIAL_STEPS[stepIndex("r1-build")]! as Extract<TutorialStep, { kind: "do" }>;
    expect(sameMove({ player: TUTORIAL_SELF, command: { type: "PLAY", card: id, action: "build", trade: { left: "", right: "" } } }, expectMove.expect)).toBe(true);
    expect(sameMove({ player: TUTORIAL_SELF, command: { type: "PLAY", card: id, action: "discard" } }, expectMove.expect)).toBe(false);
    expect(sameMove({ player: TUTORIAL_LEFT, command: { type: "PLAY", card: id, action: "build" } }, expectMove.expect)).toBe(false);
    // 学员交了以后还能撤回；人机按顺序跟上
    const sent = playScript(stepIndex("r2-build") + 1);
    expect(selfCanAct(sent, TUTORIAL_SELF)).toBe(true);
    expect(tutorialActor(sent)).toBe(TUTORIAL_LEFT);
    expect(tutorialActor(createTutorialGame("小蒲"))).toBe(TUTORIAL_SELF);
  });

  it("剧本走完接练习局（和「再练一局」）：人机替另外两位出，学员这边也交给人机，一百多局都能打完", () => {
    const stuck: string[] = [];
    for (let seed = 1; seed <= 120; seed += 1) {
      let state = seed % 2 === 0 ? playScript(TUTORIAL_STEPS.length, seed) : createPracticeGame("小蒲", seed);
      let moves = 0;
      while (state.phase !== "finished" && moves < 400) {
        const actor = tutorialActor(state);
        if (!actor) break;
        const command = botCommand(redactGameForViewer(state, actor), actor);
        if (!command) break;
        state = applyMove(state, { player: actor, command });
        moves += 1;
      }
      if (state.phase !== "finished" || !state.finalResult) stuck.push(`第 ${seed} 局（${moves} 步，${state.phase}）`);
    }
    expect(stuck).toEqual([]);
  }, 60_000);
});

/** 学员手里叫这个名字的那张牌的 id。 */
function resolveCard(state: GameState, name: string): string {
  const command = resolveMove(state, { player: TUTORIAL_SELF, command: { type: "PLAY", card: name, action: "build" } });
  return command.type === "PLAY" ? command.card : "";
}
