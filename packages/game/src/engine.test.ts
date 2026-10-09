import { describe, expect, it } from "vitest";
import { botCommand } from "./bot.js";
import { domino } from "./dominoes.js";
import { apply, autoCommand, createGame, pendingSlot, pickRow, redactGameForViewer, selectableSlots, timeoutTurn } from "./engine.js";
import { bounds, key, legalPlacements } from "./kingdom.js";
import { createRng, type Rng } from "./rng.js";
import type { GameCommand, GameOptions, GameState, Slot } from "./types.js";

const names = ["红", "蓝", "绿", "黄"];
const players = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: names[i]! }));
const slots = (...ns: number[]): Slot[] => ns.map((n) => ({ n, king: null, resolved: false, pre: null }));
const actor = (state: GameState) => state.players[state.currentPlayer]!.id;
const act = (state: GameState, command: GameCommand, who = actor(state)) => apply(state, who, command).state;

/** 一直按超时规则自动行动，直到满足条件。 */
function runUntil(state: GameState, done: (s: GameState) => boolean): GameState {
  let s = state;
  for (let guard = 0; guard < 500 && !done(s); guard += 1) s = act(s, autoCommand(s));
  return s;
}

describe("开局", () => {
  it("4 人局：48 张，翻第一排后牌堆剩 44；开局选牌顺序是 4 位玩家的一个排列", () => {
    const s = createGame(players(4), 7);
    expect(s.deck).toHaveLength(44);
    expect(s.setAside).toHaveLength(0);
    expect(s.current.map((slot) => slot.n)).toEqual([...s.current.map((slot) => slot.n)].sort((x, y) => x - y));
    expect(s.pickOrder.map((k) => k.player).sort()).toEqual([0, 1, 2, 3]);
    expect(s.phase).toBe("picking");
    expect(s.totalRounds).toBe(12);
  });

  it("TC12 2 人默认局：移出 24 张，开局 A → B → B → A，第二排翻出后牌堆剩 16", () => {
    let s = createGame(players(2), 11);
    expect(s.setAside).toHaveLength(24);
    expect(s.config.size).toBe(5);
    expect(s.totalRounds).toBe(6);
    const [a, b] = [s.pickOrder[0]!.player, s.pickOrder[1]!.player];
    expect(s.pickOrder.map((k) => k.player)).toEqual([a, b, b, a]);
    s = act(s, { type: "PICK", slot: 0 });
    expect(s.currentPlayer).toBe(b);
    s = act(s, { type: "PICK", slot: 1 });
    expect(s.currentPlayer).toBe(b);
    s = act(s, { type: "PICK", slot: 2 });
    // A 的第二个国王只剩一张，自动拿
    expect(s.phase).toBe("playing");
    expect(s.current[3]!.king).toEqual({ player: a, idx: 1 });
    expect(s.deck).toHaveLength(16);
    expect(s.next).toHaveLength(4);
  });

  it("TC13 强力对决：48 张全用、7×7、12 轮", () => {
    const s = createGame(players(2), 3, { mighty: true });
    expect(s.setAside).toHaveLength(0);
    expect(s.config.size).toBe(7);
    expect(s.totalRounds).toBe(12);
    // 3–4 人局开了强力对决也不生效
    expect(createGame(players(3), 3, { mighty: true }).config.size).toBe(5);
  });
});

describe("行动顺序", () => {
  it("TC8 4 人：按新排编号决定下一轮顺序", () => {
    let s = createGame(players(4), 5);
    // 红 0、蓝 1、绿 2、黄 3
    s.current = slots(5, 18, 30, 44);
    s.pickOrder = [0, 1, 2, 3].map((player) => ({ player, idx: 0 as const }));
    s.currentPlayer = 0;
    s = act(s, { type: "PICK", slot: 2 }, "p0"); // 红选 30
    s = act(s, { type: "PICK", slot: 0 }, "p1"); // 蓝选 5
    s = act(s, { type: "PICK", slot: 3 }, "p2"); // 绿选 44
    // 黄只剩 18，自动
    expect(s.current.map((slot) => slot.king!.player)).toEqual([1, 3, 0, 2]);
    expect(actor(s)).toBe("p1");
    expect(s.step).toBe("place");
  });

  it("TC9 2 人：A 在 #12、#47，B 在 #20、#33 → A → B → B → A，B 连续行动两次", () => {
    let s = createGame(players(2), 5);
    s.current = slots(12, 20, 33, 47);
    s.pickOrder = [{ player: 0, idx: 0 }, { player: 1, idx: 0 }, { player: 1, idx: 1 }, { player: 0, idx: 1 }];
    s.currentPlayer = 0;
    s = act(s, { type: "PICK", slot: 0 }, "p0");
    s = act(s, { type: "PICK", slot: 1 }, "p1");
    s = act(s, { type: "PICK", slot: 2 }, "p1");
    expect(s.current.map((slot) => slot.king!.player)).toEqual([0, 1, 1, 0]);
    const order: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      order.push(actor(s));
      expect(s.step).toBe("place");
      s = act(s, autoCommand(s)); // 放
      if (i < 3) {
        expect(s.step).toBe("pick");
        s = act(s, autoCommand(s)); // 选（最后一个国王自动选）
      }
    }
    expect(order).toEqual(["p0", "p1", "p1", "p0"]);
    expect(s.round).toBe(2);
  });

  it("TC10 3 人：每排没人选的那张弃掉；下一轮按编号顺序", () => {
    let s = createGame(players(3), 9);
    s = runUntil(s, (x) => x.phase === "playing");
    expect(s.current).toHaveLength(3);
    expect(s.removed).toHaveLength(1);
    s.next = slots(3, 15, 27, 40);
    const want = [1, 3, 0]; // 依次选 15、40、3
    const pickers: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      s = act(s, autoCommand(s));
      expect(s.step).toBe("pick");
      pickers.push(s.currentPlayer);
      s = act(s, { type: "PICK", slot: want[i]! });
    }
    expect(s.removed).toContain(27);
    expect(s.current.map((slot) => slot.n)).toEqual([3, 15, 40]);
    expect(s.current.map((slot) => slot.king!.player)).toEqual([pickers[2], pickers[0], pickers[1]]);
  });

  it("TC10 3 人整局：翻 12 排，弃掉的剩牌 12 张，每人放下 + 弃掉 = 12", () => {
    const s = runUntil(createGame(players(3), 21), (x) => x.phase === "finished");
    expect(s.removed).toHaveLength(12);
    for (const p of s.players) {
      expect(placedCount(p.kingdom) + p.discarded.length).toBe(12);
    }
  });

  it("TC11 4 人：牌堆按轮减少，第 11 轮还选牌，第 12 轮只放不选", () => {
    let s = createGame(players(4), 33);
    expect(s.deck).toHaveLength(44);
    s = runUntil(s, (x) => x.phase === "playing");
    expect(s.deck).toHaveLength(40);
    for (let round = 1; round <= 10; round += 1) {
      expect(s.round).toBe(round);
      s = runUntil(s, (x) => x.round === round + 1);
      expect(s.deck).toHaveLength(40 - 4 * round);
    }
    expect(s.round).toBe(11);
    expect(s.next).toHaveLength(4);
    s = runUntil(s, (x) => x.round === 12);
    expect(s.next).toHaveLength(0);
    // 第 12 轮：只有放置
    let picks = 0;
    while (s.phase !== "finished") {
      if (s.step === "pick") picks += 1;
      s = act(s, autoCommand(s));
    }
    expect(picks).toBe(0);
    expect(s.finalResult).toBeDefined();
    for (const p of s.players) expect(placedCount(p.kingdom) + p.discarded.length).toBe(12);
  });

  it("TC12 / TC13：2 人局每人放下 + 弃掉 = 12（强力对决 24）", () => {
    const short = runUntil(createGame(players(2), 4), (x) => x.phase === "finished");
    for (const p of short.players) expect(placedCount(p.kingdom) + p.discarded.length).toBe(12);
    const mighty = runUntil(createGame(players(2), 4, { mighty: true }), (x) => x.phase === "finished");
    for (const p of mighty.players) {
      expect(placedCount(p.kingdom) + p.discarded.length).toBe(24);
      const b = bounds(p.kingdom);
      expect(b.maxR - b.minR + 1).toBeLessThanOrEqual(7);
      expect(b.maxC - b.minC + 1).toBeLessThanOrEqual(7);
    }
  });
});

describe("命令校验", () => {
  function firstPlaceStep(seed = 2): GameState {
    return runUntil(createGame(players(2), seed), (x) => x.phase === "playing" && x.step === "place");
  }

  it("TC4 有合法放法时不能弃", () => {
    const s = firstPlaceStep();
    s.current[s.active] = { ...s.current[s.active]!, n: 48 };
    expect(() => act(s, { type: "DISCARD" })).toThrow("还有地方能放");
  });

  it("TC16 选牌校验：已有国王、放置这一步发选牌、不是自己的回合", () => {
    let s = createGame(players(4), 8);
    const first = actor(s);
    s = act(s, { type: "PICK", slot: 0 });
    expect(() => act(s, { type: "PICK", slot: 0 })).toThrow("已经有国王");
    expect(() => apply(s, first, { type: "PICK", slot: 1 })).toThrow("还没轮到你");
    const placing = firstPlaceStep();
    expect(() => act(placing, { type: "PICK", slot: 0 })).toThrow("先把脚下的骨牌");
    expect(() => act(placing, { type: "PICK", slot: 9 })).toThrow();
    expect(() => apply(placing, "nobody", { type: "PICK", slot: 0 })).toThrow("不在这局");
  });

  it("不合法的放置被拒绝，状态不变", () => {
    const s = firstPlaceStep();
    const before = JSON.stringify(s);
    expect(() => act(s, { type: "PLACE", a: { r: 2, c: 2 }, b: { r: 2, c: 3 } })).toThrow();
    expect(() => act(s, { type: "PLACE", a: { r: 0, c: 0 }, b: { r: 0, c: 1 } })).toThrow();
    expect(JSON.stringify(s)).toBe(before);
  });

  it("轮到的国王放不下时自动弃掉，不停下来等人", () => {
    let s = firstPlaceStep();
    const later = s.current.findIndex((slot, i) => i > s.active && slot.king!.player !== s.currentPlayer);
    const owner = s.current[later]!.king!.player;
    const n = s.current[later]!.n;
    // 把这位玩家的王国堵成只剩一个空格
    const kingdom = s.players[owner]!.kingdom;
    for (let r = -2; r <= 2; r += 1) {
      for (let c = -2; c <= 2; c += 1) if ((r || c) && !(r === 2 && c === 2)) kingdom[key(r, c)] = { t: "W", c: 0, d: 100 + r * 5 + c };
    }
    let stoppedThere = false;
    for (let guard = 0; guard < 50 && s.active <= later && s.round === 1; guard += 1) {
      if (s.active === later && s.step === "place") stoppedThere = true;
      s = act(s, autoCommand(s));
    }
    expect(stoppedThere).toBe(false);
    expect(s.players[owner]!.discarded).toContain(n);
  });
});

describe("提前放置", () => {
  it("没轮到时先放好；别人看不到位置；轮到时自动生效，直接进入选牌；回合计时不重置", () => {
    // 3 人局：最后一个国王还有 2 张可选，生效后停在选牌这一步
    let s = runUntil(createGame(players(3), 12), (x) => x.phase === "playing");
    const last = s.current[2]!.king!.player;
    const lastId = s.players[last]!.id;
    expect(pendingSlot(s, last)).toBe(2);
    const options = legalPlacements(s.players[last]!.kingdom, domino(s.current[2]!.n), 5);
    const turn = s.turn;
    s = apply(s, lastId, { type: "PLACE", a: options[0]!.a, b: options[0]!.b }).state;
    expect(s.turn).toBe(turn);
    expect(s.current[2]!.pre).toEqual(options[0]);
    expect(Object.keys(s.players[last]!.kingdom)).toHaveLength(1);
    const otherView = redactGameForViewer(s, s.players[(last + 1) % 3]!.id);
    expect(otherView.current[2]!.pre).toBe("hidden");
    expect(redactGameForViewer(s, lastId).current[2]!.pre).toEqual(options[0]);
    // 改主意：取消再放
    s = apply(s, lastId, { type: "CANCEL_PRE" }).state;
    expect(s.current[2]!.pre).toBeNull();
    s = apply(s, lastId, { type: "PLACE", a: options[1]!.a, b: options[1]!.b }).state;
    s = runUntil(s, (x) => x.active === 2);
    expect(s.currentPlayer).toBe(last);
    expect(s.step).toBe("pick");
    expect(Object.keys(s.players[last]!.kingdom)).toHaveLength(3);
    expect(s.events.some((e) => e.type === "Placed" && e.pre)).toBe(true);
  });

  it("4 人局最后一个国王提前放好：生效后自动拿最后一张，直接进下一轮", () => {
    let s = runUntil(createGame(players(4), 12), (x) => x.phase === "playing");
    const last = s.current[3]!.king!.player;
    const option = legalPlacements(s.players[last]!.kingdom, domino(s.current[3]!.n), 5)[0]!;
    s = apply(s, s.players[last]!.id, { type: "PLACE", ...option }).state;
    s = runUntil(s, (x) => x.round === 2);
    expect(Object.keys(s.players[last]!.kingdom)).toHaveLength(3);
    expect(s.events.map((e) => e.type)).toEqual(["Picked", "Placed", "Picked", "RoundStarted"]);
  });

  it("不合法的提前放置被拒绝；2 人局只能先放自己最早的一张", () => {
    let s = runUntil(createGame(players(2), 6), (x) => x.phase === "playing");
    const p = 1 - s.currentPlayer;
    const id = s.players[p]!.id;
    const mine = s.current.flatMap((slot, i) => (slot.king?.player === p ? [i] : []));
    expect(pendingSlot(s, p)).toBe(mine[0]);
    expect(() => apply(s, id, { type: "PLACE", a: { r: 2, c: 2 }, b: { r: 2, c: 3 } })).toThrow();
    const opt = legalPlacements(s.players[p]!.kingdom, domino(s.current[mine[0]!]!.n), 5)[0]!;
    s = apply(s, id, { type: "PLACE", ...opt }).state;
    expect(s.current[mine[0]!]!.pre).toEqual(opt);
    expect(s.current[mine[1]!]!.pre).toBeNull();
    expect(() => apply(s, id, { type: "CANCEL_PRE" })).not.toThrow();
  });

  it("开局选牌阶段不能放", () => {
    const s = createGame(players(3), 1);
    expect(() => act(s, { type: "PLACE", a: { r: 0, c: 1 }, b: { r: 0, c: 2 } })).toThrow("还不能放");
  });
});

describe("隐藏信息", () => {
  it("牌堆、移出的牌、种子、动作序列不下发", () => {
    let s = createGame(players(2), 77);
    s = act(s, autoCommand(s));
    s.log = [{ player: "p0", command: { type: "PICK", slot: 0 } }];
    const view = redactGameForViewer(s, "p0");
    expect(view.deck).toEqual([]);
    expect(view.setAside).toEqual([]);
    expect(view.deckCount).toBe(s.deck.length);
    expect(view.setAsideCount).toBe(24);
    expect(view.seed).toBeUndefined();
    expect(view.rngState).toBeUndefined();
    expect(view.log).toBeUndefined();
    const text = JSON.stringify(view);
    // 牌堆里的编号不会出现在下发状态里（除非已经翻开）
    const shown = new Set([...view.current, ...view.next].map((slot) => slot.n));
    for (const n of [...s.deck, ...s.setAside]) {
      if (!shown.has(n)) expect(text).not.toMatch(new RegExp(`"n":${n}[,}]`));
    }
  });
});

function placedCount(kingdom: Record<string, { d: number }>): number {
  return new Set(Object.values(kingdom).filter((cell) => cell.d > 0).map((cell) => cell.d)).size;
}

/** 随机合法命令：随机放法 / 随机选牌，偶尔有人提前放、取消、超时。 */
function randomStep(s: GameState, rng: Rng): GameState {
  const roll = rng.next();
  if (s.phase === "playing" && roll < 0.15) {
    const p = rng.int(s.players.length);
    const index = pendingSlot(s, p);
    if (index >= 0 && !(p === s.currentPlayer && s.step === "place")) {
      const slot = s.current[index]!;
      if (slot.pre && rng.next() < 0.3) return apply(s, s.players[p]!.id, { type: "CANCEL_PRE" }).state;
      const options = legalPlacements(s.players[p]!.kingdom, domino(slot.n), s.config.size);
      if (options.length > 0) return apply(s, s.players[p]!.id, { type: "PLACE", ...rng.pick(options) }).state;
    }
  }
  if (roll > 0.95) return timeoutTurn(s);
  if (s.step === "pick") return act(s, { type: "PICK", slot: rng.pick(selectableSlots(s)) });
  const slot = s.current[s.active]!;
  const options = legalPlacements(s.players[s.currentPlayer]!.kingdom, domino(slot.n), s.config.size);
  return act(s, options.length > 0 ? { type: "PLACE", ...rng.pick(options) } : { type: "DISCARD" });
}

/** 每一步都成立的不变量（普通代码检查，出错时抛出说明）。 */
function checkInvariants(s: GameState): void {
  const size = s.config.size;
  const seen = new Map<number, string>();
  const note = (n: number, where: string) => {
    if (seen.has(n)) throw new Error(`骨牌 ${n} 同时在 ${seen.get(n)} 和 ${where}`);
    seen.set(n, where);
  };
  for (const p of s.players) {
    const b = bounds(p.kingdom);
    if (b.maxR - b.minR + 1 > size || b.maxC - b.minC + 1 > size) throw new Error("王国超出边长");
    if (p.kingdom[key(0, 0)]?.t !== "castle") throw new Error("城堡不见了");
    for (const d of new Set(Object.values(p.kingdom).map((cell) => cell.d))) {
      if (d === 0) continue;
      const cells = Object.values(p.kingdom).filter((cell) => cell.d === d);
      if (cells.length !== 2) throw new Error(`骨牌 ${d} 只放了 ${cells.length} 格`);
      note(d, `${p.id} 的王国`);
    }
    for (const n of p.discarded) note(n, `${p.id} 的弃牌`);
  }
  for (const slot of s.current) if (!slot.resolved) note(slot.n, "当前排");
  for (const slot of s.next) note(slot.n, "新排");
  for (const n of s.removed) note(n, "剩牌");
  for (const n of s.deck) note(n, "牌堆");
  for (const n of s.setAside) note(n, "移出");
  if (seen.size !== 48) throw new Error(`骨牌总数 ${seen.size}`);
  if (s.phase !== "finished") {
    const p = s.players[s.currentPlayer];
    if (!p) throw new Error("没有行动的人");
    if (s.step === "pick" && selectableSlots(s).length < 2) {
      throw new Error("轮到选牌却只有不到 2 张可选（应该自动选）");
    }
    if (s.step === "pick" && pickRow(s).length === 0) throw new Error("最后一轮不该有选牌");
  }
}

describe("随机对局", () => {
  const setups: [number, Partial<GameOptions>][] = [
    [2, {}],
    [2, { mighty: true, middleKingdom: true, harmony: true }],
    [3, { harmony: true }],
    [4, { middleKingdom: true }],
  ];
  it("400 局随机合法行动：不变量始终成立，每人放下 + 弃掉的张数对，结算和明细一致", { timeout: 120_000 }, () => {
    for (let game = 0; game < 400; game += 1) {
      const [count, options] = setups[game % setups.length]!;
      const rng = createRng(1000 + game);
      let s = createGame(players(count), 5000 + game, options);
      let steps = 0;
      while (s.phase !== "finished") {
        const before = s.version;
        s = randomStep(s, rng);
        if (s.version !== before + 1) throw new Error("version 没有 +1");
        checkInvariants(s);
        steps += 1;
        if (steps > 600) throw new Error("对局没有结束");
      }
      for (const p of s.players) {
        expect(placedCount(p.kingdom) + p.discarded.length).toBe(count === 2 ? s.totalRounds * 2 : s.totalRounds);
      }
      const result = s.finalResult!;
      expect(result.winners.length).toBeGreaterThan(0);
      for (const score of result.scores) {
        expect(score.total).toBe(score.base + score.middle + score.harmony);
        expect(s.players.find((p) => p.id === score.player)!.score).toBe(score.total);
      }
    }
  });

  it("人机自己打：每一步都合法，平均分高于随机", { timeout: 60_000 }, () => {
    let botTotal = 0;
    let randomTotal = 0;
    const games = 40;
    for (let game = 0; game < games; game += 1) {
      const rng = createRng(game);
      let s = createGame(players(2), 900 + game);
      while (s.phase !== "finished") {
        const id = actor(s);
        if (s.currentPlayer === 0) {
          const command = botCommand(redactGameForViewer(s, id), id);
          expect(command).not.toBeNull();
          s = act(s, command!);
        } else s = randomStep(s, rng);
      }
      botTotal += s.players[0]!.score;
      randomTotal += s.players[1]!.score;
    }
    expect(botTotal / games).toBeGreaterThan(randomTotal / games + 5);
  });
});
