/**
 * 规则核对 · 隐藏信息（规则书 §4.4、§8.3，补充 U12、E-T14）：redactGameForViewer 之后，
 * 别人的手牌、交了什么、垫在奇迹下的牌、Age III 抽掉的行会、弃牌堆牌面都拿不到；种子和随机状态不下发。
 */
import { describe, expect, it } from "vitest";
import { apply, buildScene, createGame, GUILDS, playTo, redactGameForViewer, type GameState } from "@wonders/game";
import { act, P, round } from "./helpers.js";

/** viewer 不该看到的牌 id（按完整状态算）。viewerIdx = -1 是观战。 */
export function hiddenIds(full: GameState, viewerIdx: number): string[] {
  const ids: string[] = [];
  full.players.forEach((p, i) => {
    if (i === viewerIdx) return;
    ids.push(...p.hand, ...p.stageCards);
    if (p.play) ids.push(p.play.card);
  });
  const haliSees = full.phase === "discardBuild" && full.pending && viewerIdx >= 0 && full.pending.player === full.players[viewerIdx]!.id;
  if (!haliSees) {
    // 自己最近一次亮牌弃掉 / 作废的那张自己知道（lastReveal 里自己那一条），不算泄露
    const mine = new Set(viewerIdx >= 0 ? full.lastReveal.filter((r) => r.player === full.players[viewerIdx]!.id).map((r) => r.card) : []);
    ids.push(...full.discard.filter((id) => !mine.has(id)));
  }
  // 公开的（城里的建筑）去掉；同一个 id 不会既在城里又在手里，这里保险一下
  const pub = new Set(full.players.flatMap((p) => p.built));
  return [...new Set(ids)].filter((id) => !pub.has(id));
}
export function leaks(full: GameState, viewerIdx: number, seeAll = false): string[] {
  const view = redactGameForViewer(full, viewerIdx < 0 ? "" : P(viewerIdx), seeAll ? { seeAll: true } : undefined);
  const text = JSON.stringify(view);
  const out = hiddenIds(full, viewerIdx).filter((id) => text.includes(`"${id}"`));
  for (const k of ["seed", "rngState", "log", "stacked"] as const) if (k in view && (view as unknown as Record<string, unknown>)[k] !== undefined) out.push(`字段 ${k}`);
  return out;
}

describe("出牌阶段的视角", () => {
  it("别人的手牌是 []、张数公开；别人交了什么是 null、只公开「已交」；种子、随机状态、动作序列、预排手牌都不下发", () => {
    let s = createGame([0, 1, 2, 3].map((i) => ({ id: P(i), name: `玩家${i}` })), 99);
    s = act(s, 0, "discard");
    const v1 = redactGameForViewer(s, P(1));
    expect(v1.players[0]!.hand).toEqual([]);
    expect(v1.players[0]!.handCount).toBe(7);
    expect(v1.players[0]!.submitted).toBe(true);
    expect(v1.players[0]!.play).toBeNull();
    expect(v1.players[1]!.hand.length).toBe(7);
    for (const k of ["seed", "rngState", "log", "stacked"]) expect((v1 as unknown as Record<string, unknown>)[k]).toBeUndefined();
    const v0 = redactGameForViewer(s, P(0));
    expect(v0.players[0]!.play).not.toBeNull();
    expect(JSON.stringify(v1.events)).not.toContain(s.players[0]!.play!.card);
    for (let i = 0; i < 4; i++) expect(leaks(s, i)).toEqual([]);
  });

  it("观战（viewerId = \"\"）谁的手牌都看不到；房主开了「观战看全部」时看得到手牌，但仍然没有种子和随机状态", () => {
    const s = act(createGame([0, 1, 2].map((i) => ({ id: P(i), name: `玩家${i}` })), 5), 1, "discard");
    const spec = redactGameForViewer(s, "");
    expect(spec.players.every((p) => p.hand.length === 0 && p.play === null)).toBe(true);
    expect(leaks(s, -1)).toEqual([]);
    const all = redactGameForViewer(s, "", { seeAll: true });
    expect(all.players.every((p) => p.hand.length === 7)).toBe(true);
    for (const k of ["seed", "rngState", "log", "stacked"]) expect((all as unknown as Record<string, unknown>)[k]).toBeUndefined();
  });
});

describe("亮牌之后：垫奇迹和弃掉的牌别人看不到，建造的牌公开", () => {
  it("lastReveal 和事件里，别人垫奇迹、弃牌的那张是 null；自己的看得到；城里的建筑公开", () => {
    const s = buildScene({
      age: 1,
      round: 5,
      players: [
        { wonder: "giza", built: ["Stone Pit"], hand: ["Altar", "Theater", "Baths"] },
        { wonder: "babylon", hand: ["Lumber Yard", "Clay Pool", "Ore Vein"] },
        { wonder: "rhodes", hand: ["Loom", "Press", "Glassworks"] },
      ],
    });
    const t = round(s, { 0: { wonder: "Altar" }, 1: { discard: "Clay Pool" }, 2: { build: "Loom" } });
    const view1 = redactGameForViewer(t, P(1));
    const rv = (v: GameState, who: number) => v.lastReveal.find((r) => r.player === P(who))!;
    expect(rv(view1, 0).action).toBe("wonder");
    expect(rv(view1, 0).card).toBeNull();
    expect(rv(view1, 2).card).not.toBeNull();
    expect(rv(view1, 1).card).not.toBeNull(); // 自己弃的牌自己看得到
    const view2 = redactGameForViewer(t, P(2));
    expect(rv(view2, 1).action).toBe("discard");
    expect(rv(view2, 1).card).toBeNull();
    const revealed = view2.events.find((e) => e.type === "Revealed");
    if (revealed && revealed.type === "Revealed") {
      expect(revealed.plays.find((p) => p.player === P(0))!.card).toBeNull();
      expect(revealed.plays.find((p) => p.player === P(1))!.card).toBeNull();
    }
    // 垫下的牌只有本人看得到
    expect(redactGameForViewer(t, P(0)).players[0]!.stageCards.length).toBe(1);
    expect(view1.players[0]!.stageCards).toEqual([]);
    // 弃牌堆牌面不给，只给张数
    expect(view1.discard).toEqual([]);
    expect(view1.discardCount).toBe(t.discardCount);
    for (let i = -1; i < 3; i++) expect(leaks(t, i), `视角 ${i}`).toEqual([]);
  });
});

describe("哈利卡纳苏斯挑弃牌：弃牌堆牌面只发给他本人（U12）", () => {
  it("挑牌那一步：他看得到弃牌堆，别人和观战看不到；挑完又收回", () => {
    const s = buildScene({
      age: 1,
      round: 3,
      discard: ["Stockade", "Guard Tower"],
      players: [
        { wonder: "halicarnassus", stages: 1, built: ["Ore Vein", "Clay Pit"], coins: 5, hand: ["Altar", "Theater", "Baths", "Workshop", "Scriptorium"] },
        { wonder: "babylon" },
        { wonder: "rhodes" },
      ],
    });
    // 出牌阶段哈利卡纳苏斯本人也看不到弃牌堆
    expect(redactGameForViewer(s, P(0)).discard).toEqual([]);
    const t = round(s, { 0: { wonder: "Altar" } });
    expect(t.phase).toBe("discardBuild");
    expect(redactGameForViewer(t, P(0)).discard.length).toBe(t.discardCount);
    expect(redactGameForViewer(t, P(1)).discard).toEqual([]);
    expect(redactGameForViewer(t, "").discard).toEqual([]);
    for (let i = -1; i < 3; i++) expect(leaks(t, i), `视角 ${i}`).toEqual([]);
    const u = apply(t, P(0), { type: "DISCARD_BUILD", card: null }).state;
    expect(redactGameForViewer(u, P(0)).discard).toEqual([]);
  });
});

describe("Age III 抽掉的行会不进任何视角（规则书 §4.4，E-T14）", () => {
  const guildIds = GUILDS.map((g) => g.id);
  for (const n of [3, 5, 7]) {
    it(`${n} 人：开局完整状态里出现的行会不超过 ${n + 2} 张，玩家视角一张都没有；到 Age III 时手里正好 ${n + 2} 张、其余行会哪里都找不到`, () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const s = createGame(Array.from({ length: n }, (_, i) => ({ id: P(i), name: `玩家${i}` })), seed);
        const full = JSON.stringify(s);
        expect(guildIds.filter((id) => full.includes(`"${id}"`)).length).toBeLessThanOrEqual(n + 2);
        for (let i = 0; i < n; i++) {
          const v = JSON.stringify(redactGameForViewer(s, P(i)));
          expect(guildIds.filter((id) => v.includes(`"${id}"`))).toEqual([]);
        }
        const a3 = playTo({ players: n, age: 3, round: 1, seed });
        const inHands = a3.players.flatMap((p) => p.hand).filter((id) => guildIds.includes(id));
        expect(inHands.length).toBe(n + 2);
        const text = JSON.stringify(a3);
        expect(guildIds.filter((id) => text.includes(`"${id}"`)).sort()).toEqual([...inHands].sort());
      }
    });
  }
});
