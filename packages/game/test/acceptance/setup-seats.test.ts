/**
 * 规则核对 · 开局、座位圆环、传牌方向：规则书 §3、§4、§7.1，补充 §1.3（E-T1）、TC1、TC8、TC13，开工拍板（奇迹分配、只做 3–7 人）。
 */
import { describe, expect, it } from "vitest";
import {
  ageCards,
  apply,
  card,
  createGame,
  leftOf,
  passDirection,
  playTo,
  rightOf,
  WONDER_KEYS,
  type GameState,
} from "@wonders/game";
import { fx } from "./oracle.js";
import { P, round } from "./helpers.js";

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: P(i), name: `玩家${i + 1}` }));
const sorted = (a: readonly string[]) => [...a].sort();

describe("开局（规则书 §3，开工拍板）", () => {
  for (const n of [3, 4, 5, 6, 7]) {
    it(`${n} 人：每人 3 金、7 张手牌、奇迹各不相同、默认全员 A 面；手牌合起来正好是 ${n} 人的 Age I 牌`, () => {
      const s = createGame(seats(n), 42 + n);
      expect(s.phase).toBe("play");
      expect(s.age).toBe(1);
      expect(s.round).toBe(1);
      expect(s.direction).toBe("left");
      expect(new Set(s.players.map((p) => p.wonder)).size).toBe(n);
      for (const p of s.players) {
        expect(p.coins).toBe(3);
        expect(p.hand.length).toBe(7);
        expect(p.side).toBe("A");
        expect(p.stages).toBe(0);
        expect(p.built).toEqual([]);
        expect(p.tokens).toEqual([]);
        expect(WONDER_KEYS).toContain(p.wonder);
      }
      expect(sorted(s.players.flatMap((p) => p.hand))).toEqual(sorted(ageCards(1, n).map((c) => c.id)));
    });
  }

  it("只做 3–7 人：2 人、8 人开不了局", () => {
    expect(() => createGame(seats(2), 1)).toThrow();
    expect(() => createGame(seats(8), 1)).toThrow();
  });

  it("开房选项「随机 A/B 面」：多开几局 A、B 面都会出现", () => {
    const sides = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) for (const p of createGame(seats(7), seed, { randomSides: true }).players) sides.add(p.side);
    expect(sides).toEqual(new Set(["A", "B"]));
  });

  it("奇迹是随机分的：多开几局，座位 0 拿到过不止一种奇迹", () => {
    const got = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) got.add(createGame(seats(3), seed).players[0]!.wonder!);
    expect(got.size).toBeGreaterThan(2);
  });

  it("开房选项「自选奇迹」：按顺序轮流挑，挑过的不能再挑，不是你挑时被拒绝；挑完才发 Age I", () => {
    let s = createGame(seats(4), 7, { chooseWonders: true });
    expect(s.phase).toBe("wonders");
    expect(s.players.every((p) => p.hand.length === 0)).toBe(true);
    const order = s.chooseOrder;
    expect(sorted(order.map(String))).toEqual(["0", "1", "2", "3"]);
    // README 默认规则表 #3：从随机一位开始，按座位往左邻方向轮流
    for (let k = 1; k < order.length; k++) expect(order[k]).toBe(leftOf(s, order[k - 1]!));
    const first = order[0]!;
    const other = order[1]!;
    expect(() => apply(s, P(other), { type: "CHOOSE_WONDER", wonder: "giza", side: "A" })).toThrow();
    s = apply(s, P(first), { type: "CHOOSE_WONDER", wonder: "giza", side: "B" }).state;
    expect(() => apply(s, P(other), { type: "CHOOSE_WONDER", wonder: "giza", side: "A" })).toThrow();
    s = apply(s, P(other), { type: "CHOOSE_WONDER", wonder: "rhodes", side: "A" }).state;
    s = apply(s, P(order[2]!), { type: "CHOOSE_WONDER", wonder: "babylon", side: "B" }).state;
    expect(s.phase).toBe("wonders");
    s = apply(s, P(order[3]!), { type: "CHOOSE_WONDER", wonder: "olympia", side: "A" }).state;
    expect(s.phase).toBe("play");
    expect(s.players[first]!.wonder).toBe("giza");
    expect(s.players[first]!.side).toBe("B");
    expect(s.players[order[2]!]!.side).toBe("B");
    expect(s.players.every((p) => p.hand.length === 7 && p.coins === 3)).toBe(true);
  });
});

describe("座位圆环和传牌方向（补充 §1.3，E-T1，TC13）", () => {
  it("左邻 = (i+1)%n，右邻 = (i−1+n)%n：4 人座位 [甲乙丙丁]，甲的左邻乙、右邻丁", () => {
    const s = createGame(seats(4), 3);
    expect(leftOf(s, 0)).toBe(1);
    expect(rightOf(s, 0)).toBe(3);
    expect(leftOf(s, 3)).toBe(0);
    expect(rightOf(s, 1)).toBe(0);
  });

  it("传牌方向只看时代：I 左、II 右、III 左（和人数无关）", () => {
    expect(passDirection(1)).toBe("left");
    expect(passDirection(2)).toBe("right");
    expect(passDirection(3)).toBe("left");
    for (const n of [3, 7]) {
      expect(playTo({ players: n, age: 2, round: 1, seed: 5 }).direction).toBe("right");
      expect(playTo({ players: n, age: 3, round: 1, seed: 5 }).direction).toBe("left");
    }
  });

  const passCheck = (s0: GameState, from: (i: number) => number) => {
    const before = s0.players.map((p) => [...p.hand]);
    const played = s0.players.map((p) => p.hand[0]!);
    const s1 = round(s0); // 每人弃第一张
    expect(s1.round).toBe(s0.round + 1);
    s1.players.forEach((p, i) => {
      const src = from(i);
      expect(sorted(p.hand), `座位 ${i} 应拿到座位 ${src} 的牌`).toEqual(sorted(before[src]!.filter((id) => id !== played[src])));
    });
  };

  it("E-T1 Age I 第 1 轮后：甲拿到丁原来那手（少了丁打出的），乙拿到甲原来那手", () => {
    const s = createGame(seats(4), 11);
    passCheck(s, (i) => rightOf(s, i));
  });

  it("E-T1 Age II 第 1 轮后：甲拿到乙原来那手", () => {
    const s = playTo({ players: 4, age: 2, round: 1, seed: 11 });
    passCheck(s, (i) => leftOf(s, i));
  });

  it("Age III 第 1 轮后：又传给左邻（我拿到右邻的牌）", () => {
    const s = playTo({ players: 5, age: 3, round: 1, seed: 11 });
    passCheck(s, (i) => rightOf(s, i));
  });

  it("TC13 / TC1 / TC8：7 人局三个时代都弃牌，每轮手牌 8−轮数张，第 6 轮作废的不给钱，6 轮后手牌清空", () => {
    let s = createGame(seats(7), 77);
    for (const age of [1, 2, 3] as const) {
      expect(s.age).toBe(age);
      if (age === 3) {
        const guilds = s.players.flatMap((p) => p.hand).filter((id) => fx(id).guild);
        expect(guilds.length).toBe(9);
        expect(s.players.flatMap((p) => p.hand).length).toBe(49);
      }
      for (let r = 1; r <= 6; r++) {
        expect(s.round).toBe(r);
        for (const p of s.players) expect(p.hand.length).toBe(8 - r);
        s = round(s);
      }
      // 每轮弃一张 +3：第 6 轮那张作废不给钱
      for (const p of s.players) expect(p.coins).toBe(3 + 18 * age);
      expect(s.discardCount).toBe(49 * age);
    }
    expect(s.phase).toBe("finished");
    for (const p of s.players) {
      expect(p.hand).toEqual([]);
      expect(p.tokens).toEqual([]); // 都没盾：平局不拿标记
    }
    // 57 金 = 19 分；七个人全一样 → 并列
    expect(s.finalResult!.winners.length).toBe(7);
    for (const sc of s.finalResult!.scores) {
      expect(sc.total).toBe(19);
      expect(sc.rank).toBe(1);
    }
  });

  it("第 6 轮：手里 2 张，打 1 张，另 1 张进弃牌堆、不给钱（CardsBurned）", () => {
    let s = playTo({ players: 3, age: 1, round: 6, seed: 9 });
    const burned = s.players.map((p) => p.hand[1]!);
    const coins = s.players.map((p) => p.coins);
    const dc = s.discardCount;
    const res = (() => {
      let st = s;
      let ev: unknown[] = [];
      for (let i = 0; i < 3; i++) {
        const r = apply(st, P(i), { type: "PLAY", card: st.players[i]!.hand[0]!, action: "discard" });
        st = r.state;
        ev = r.events;
      }
      return { st, ev };
    })();
    s = res.st;
    expect(s.age).toBe(2);
    expect(s.discardCount).toBe(dc + 6);
    s.players.forEach((p, i) => expect(p.coins).toBe(coins[i]! + 3));
    expect((res.ev as { type: string }[]).some((e) => e.type === "CardsBurned")).toBe(true);
    for (const id of burned) expect(card(id).age).toBe(1);
  });
});
