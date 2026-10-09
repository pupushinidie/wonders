/**
 * 规则核对 · 非法命令和撤回（TC14，开工拍板「一次提交，所有人提交前可撤回」，README 命令表）：
 * 不合法的命令 apply 抛错（给玩家看的中文），不改输入，version 每步 +1。
 */
import { describe, expect, it } from "vitest";
import { apply, buildScene, createGame, legalActions, pendingActors, type GameCommand, type GameState } from "@wonders/game";
import { act, P, round } from "./helpers.js";

const g3 = () => createGame([0, 1, 2].map((i) => ({ id: P(i), name: `玩家${i}` })), 31);
const rejects = (s: GameState, who: string, cmd: GameCommand) => {
  const before = JSON.stringify(s);
  let msg = "";
  try {
    apply(s, who, cmd);
  } catch (e) {
    msg = (e as Error).message;
  }
  expect(msg, `应拒绝 ${JSON.stringify(cmd)}`).not.toBe("");
  expect(msg).toMatch(/[一-龥]/);
  expect(JSON.stringify(s)).toBe(before);
};

describe("TC14 非法命令被拒绝", () => {
  it("出不存在的牌、别人手里的牌、乱写的用法和买法", () => {
    const s = g3();
    rejects(s, P(0), { type: "PLAY", card: "a9_nothing_3p", action: "discard" });
    rejects(s, P(0), { type: "PLAY", card: s.players[1]!.hand[0]!, action: "discard" });
    rejects(s, P(0), { type: "PLAY", card: s.players[0]!.hand[0]!, action: "steal" as never });
    rejects(s, P(0), { type: "PLAY", card: s.players[0]!.hand[0]!, action: "build", trade: { left: "XYZ", right: "" } });
    rejects(s, "p9", { type: "PLAY", card: s.players[0]!.hand[0]!, action: "discard" });
  });

  it("已经交了不能再交；撤回后可以改交别的；没交时撤回被拒绝", () => {
    let s = g3();
    const [a, b] = s.players[0]!.hand;
    s = apply(s, P(0), { type: "PLAY", card: a!, action: "discard" }).state;
    rejects(s, P(0), { type: "PLAY", card: b!, action: "discard" });
    rejects(s, P(1), { type: "UNDO" });
    const step = s.step;
    s = apply(s, P(0), { type: "UNDO" }).state;
    expect(s.players[0]!.submitted).toBe(false);
    expect(s.players[0]!.play).toBeNull();
    expect(s.step).toBe(step); // 别人交牌、撤回不重置计时
    s = apply(s, P(0), { type: "PLAY", card: b!, action: "discard" }).state;
    expect(s.players[0]!.play!.card).toBe(b);
    s = round(s);
    expect(s.round).toBe(2);
    expect(s.step).not.toBe(step);
    expect(s.players[0]!.built).toEqual([]);
    expect(s.discardCount).toBe(3);
  });

  it("亮牌以后：上一轮交的牌已经传走，再出它被拒绝；新一轮自己没交时撤回被拒绝", () => {
    let s = g3();
    const old = s.players[0]!.hand[1]!; // 没打的那张会传给左邻
    s = round(s);
    rejects(s, P(0), { type: "PLAY", card: old, action: "discard" });
    rejects(s, P(0), { type: "UNDO" });
  });

  it("阶段不对的命令：出牌阶段挑奇迹、挑弃牌；第 7 张 / 挑弃牌阶段别人出牌", () => {
    const s = g3();
    rejects(s, P(0), { type: "CHOOSE_WONDER", wonder: "giza", side: "A" });
    rejects(s, P(0), { type: "DISCARD_BUILD", card: null });
    const b = buildScene({ age: 2, round: 6, players: [{ wonder: "babylon", side: "B", stages: 2, hand: ["Temple", "Statue"] }, { wonder: "olympia" }, { wonder: "rhodes" }] });
    const t = round(b);
    expect(t.phase).toBe("seventh");
    expect(pendingActors(t)).toEqual([P(0)]);
    rejects(t, P(1), { type: "PLAY", card: t.players[1]!.hand[0] ?? "x", action: "discard" });
    rejects(t, P(0), { type: "UNDO" });
    rejects(t, P(0), { type: "DISCARD_BUILD", card: null });
    expect(legalActions(t, P(1))).toEqual([]);
  });

  it("终局后任何命令都被拒绝", () => {
    const f = buildScene({ age: 3, round: 6, phase: "finished", players: [{ wonder: "giza" }, { wonder: "babylon" }, { wonder: "rhodes" }] });
    rejects(f, P(0), { type: "PLAY", card: "a1_lumber_yard_3p", action: "discard" });
    rejects(f, P(0), { type: "UNDO" });
    expect(legalActions(f, P(0))).toEqual([]);
    expect(pendingActors(f)).toEqual([]);
  });

  it("纯函数：合法命令不改输入，version +1", () => {
    const s = g3();
    const before = JSON.stringify(s);
    const r = apply(s, P(2), { type: "PLAY", card: s.players[2]!.hand[0]!, action: "discard" });
    expect(JSON.stringify(s)).toBe(before);
    expect(r.state.version).toBe(s.version + 1);
    const t = act(r.state, 0, "discard");
    expect(t.version).toBe(s.version + 2);
  });

  it("legalActions 列出的命令每一条都能执行；pendingActors 是还没交的人", () => {
    const s = act(g3(), 1, "discard");
    expect(pendingActors(s).sort()).toEqual([P(0), P(2)]);
    expect(legalActions(s, P(1))).toEqual([]);
    for (const cmd of legalActions(s, P(0))) expect(() => apply(s, P(0), cmd)).not.toThrow();
  });
});
