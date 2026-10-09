/**
 * 规则核对 · 随机整局对照：3–7 人各若干局，随机走合法命令打到终局；每一步用独立规则模型（oracle.ts，只依据补充文件数据）核对：
 * - 不卡死：没结束时总有人在等、每个人都有合法命令；
 * - 牌守恒：每张牌只在一个地方，每轮开始手牌 8 − 轮数，总数 = 7 × 人数 × 时代；同名不建两张；金币不为负；
 * - 每次亮牌（含巴比伦第 7 张）：买的资源邻居在回合开始时真的能卖、价格按折扣算对、自产 + 买的能凑齐成本、不多买、
 *   免费链 / 奥林匹亚的条件成立；付给银行的是卡上的金币；直接拿到的金币（弃牌 3、酒馆、葡萄园、奇迹……）算对；
 *   卖资源收入 = 两邻付给我的；金币流水对得上；
 * - 每个时代结束：军事标记和独立模型一致；
 * - 终局：七项分数和独立模型一致，赢家 = 总分最高、再比金币；
 * - 每一步每个视角（含观战）都没有泄露别人的手牌、交的牌、垫奇迹的牌、弃牌堆牌面、种子。
 */
import { describe, expect, it } from "vitest";
import {
  apply,
  card,
  createGame,
  legalActions,
  pendingActors,
  wonderStages,
  type GameCommand,
  type GameEvent,
  type GameState,
  type RevealedPlay,
} from "@wonders/game";
import { countFor, cover, fx, leftIdx, militaryTokens, oracleScore, ownSlots, price, rightIdx, sellableSlots, type City } from "./oracle.js";
import { P } from "./helpers.js";
import { leaks } from "./leaks.js";

function lcg(seed: number) {
  let x = seed >>> 0 || 1;
  return (k: number) => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x % k;
  };
}

const minus = (a: string, b: string) => {
  const arr = [...a];
  for (const ch of b) {
    const k = arr.indexOf(ch);
    if (k < 0) return null;
    arr.splice(k, 1);
  }
  return arr.join("");
};

interface Stats {
  games: number;
  plays: number;
  trades: number;
  chains: number;
  olympia: number;
  seventh: number;
  discardBuild: number;
  wonders: number;
}

/** 核对一次亮牌里某一手的付款和金币。prev = 亮牌前的状态，after = 结算后的状态（同时建的都在里面）。 */
function checkPlay(prev: GameState, after: GameState, play: RevealedPlay, errs: string[], stats: Stats) {
  const n = prev.players.length;
  const i = prev.players.findIndex((p) => p.id === play.player);
  const me = prev.players[i]! as unknown as City;
  const L = prev.players[leftIdx(i, n)]! as unknown as City;
  const R = prev.players[rightIdx(i, n)]! as unknown as City;
  const tag = `${play.player} A${prev.age}R${prev.round} ${play.action} ${play.card}`;
  const cardId = play.card;
  stats.plays++;
  if (play.action === "discard") {
    if (play.gained !== 3) errs.push(`${tag}：弃牌应得 3 金，实际 ${play.gained}`);
    if (play.paidLeft + play.paidRight + play.paidBank !== 0) errs.push(`${tag}：弃牌还付了钱`);
    return;
  }
  let cost: string;
  let bank: number;
  let gainedExpect = 0;
  if (play.action === "build") {
    if (!cardId) {
      errs.push(`${tag}：建造的牌没公开`);
      return;
    }
    const c = fx(cardId);
    cost = c.cost;
    bank = c.coin;
    if (me.built.some((id) => fx(id).name === c.name)) errs.push(`${tag}：同名建了第二张`);
    if (c.effect.type === "coins") gainedExpect += c.effect.n ?? 0;
    if (c.effect.type === "perCount" && c.effect.coinsNow)
      gainedExpect += countFor(after.players as unknown as City[], i, c.effect.what ?? [], c.effect.scope ?? []) * c.effect.coinsNow;
    if (play.via === "chain") {
      stats.chains++;
      const names = new Set(me.built.map((id) => fx(id).name));
      if (!c.chainFrom.some((x) => names.has(x))) errs.push(`${tag}：走了免费链但没建过 ${c.chainFrom.join("/")}`);
      if (play.paidLeft + play.paidRight + play.paidBank !== 0) errs.push(`${tag}：免费链还付了钱`);
      return void checkGain();
    }
    if (play.via === "olympia") {
      stats.olympia++;
      const pl = prev.players[i]!;
      const hasA2 = pl.wonder === "olympia" && pl.side === "A" && pl.stages >= 2;
      if (!hasA2 || pl.freeBuildUsed) errs.push(`${tag}：奥林匹亚免费不可用却用了`);
      const names = new Set(me.built.map((id) => fx(id).name));
      if (c.chainFrom.some((x) => names.has(x))) errs.push(`${tag}：能免费链的牌用了奥林匹亚次数（README #7）`);
      if (play.paidLeft + play.paidRight + play.paidBank !== 0) errs.push(`${tag}：奥林匹亚免费还付了钱`);
      return void checkGain();
    }
  } else {
    stats.wonders++;
    const st = wonderStages(prev.players[i]!.wonder!, prev.players[i]!.side);
    const k = prev.players[i]!.stages;
    if (k >= st.length) {
      errs.push(`${tag}：奇迹已经建满还在建`);
      return;
    }
    if (play.stage !== k + 1) errs.push(`${tag}：应建第 ${k + 1} 阶段，事件写 ${play.stage}`);
    cost = st[k]!.cost;
    bank = 0;
    for (const e of st[k]!.effects) if (e.type === "coins") gainedExpect += e.n;
  }
  // 自产 / 买
  if (play.paidBank !== bank) errs.push(`${tag}：付银行 ${play.paidBank}，应为 ${bank}`);
  const bl = play.bought.left;
  const br = play.bought.right;
  if (bl || br) stats.trades++;
  if (!cover(bl, sellableSlots(L))) errs.push(`${tag}：左邻（回合开始时）卖不出 ${bl}`);
  if (!cover(br, sellableSlots(R))) errs.push(`${tag}：右邻（回合开始时）卖不出 ${br}`);
  const pl = [...bl].reduce((a, r) => a + price(me, "left", r), 0);
  const pr = [...br].reduce((a, r) => a + price(me, "right", r), 0);
  if (pl !== play.paidLeft || pr !== play.paidRight) errs.push(`${tag}：买 ${bl}|${br} 付 ${play.paidLeft}|${play.paidRight}，按折扣应付 ${pl}|${pr}`);
  const rest = minus(cost, bl + br);
  if (rest === null) errs.push(`${tag}：买了成本里没有的资源 ${bl}|${br}（成本 ${cost}）`);
  else {
    if (!cover(rest, ownSlots(me))) errs.push(`${tag}：自产凑不齐 ${rest}`);
    // README #16：不多买——少买任何一份都凑不齐
    const all = bl + br;
    for (let k = 0; k < all.length; k++) {
      const less = all.slice(0, k) + all.slice(k + 1);
      const r2 = minus(cost, less);
      if (r2 !== null && cover(r2, ownSlots(me))) {
        errs.push(`${tag}：多买了（${bl}|${br}，成本 ${cost}）`);
        break;
      }
    }
  }
  if (play.paidLeft + play.paidRight + play.paidBank > me.coins) errs.push(`${tag}：付 ${play.paidLeft + play.paidRight + play.paidBank} 超过回合开始时的 ${me.coins} 金`);
  checkGain();

  function checkGain() {
    if (play.gained !== gainedExpect) errs.push(`${tag}：直接得金 ${play.gained}，应为 ${gainedExpect}`);
  }
}

function checkReveal(prev: GameState, after: GameState, plays: readonly RevealedPlay[], errs: string[], stats: Stats) {
  const n = prev.players.length;
  for (const p of plays) checkPlay(prev, after, p, errs, stats);
  // 收入 = 两邻付给我的；金币流水
  const by = new Map(plays.map((p) => [p.player, p]));
  prev.players.forEach((pp, i) => {
    const mine = by.get(pp.id);
    const fromLeft = by.get(prev.players[leftIdx(i, n)]!.id)?.paidRight ?? 0;
    const fromRight = by.get(prev.players[rightIdx(i, n)]!.id)?.paidLeft ?? 0;
    const income = fromLeft + fromRight;
    if (mine && mine.income !== income) errs.push(`${pp.id} A${prev.age}R${prev.round}：收入 ${mine.income}，两邻实付 ${income}`);
    const delta = mine ? -mine.paidLeft - mine.paidRight - mine.paidBank + mine.gained + income : income;
    if (after.players[i]!.coins !== pp.coins + delta) errs.push(`${pp.id} A${prev.age}R${prev.round}：金币 ${pp.coins} → ${after.players[i]!.coins}，流水应为 ${pp.coins + delta}`);
  });
}

function invariants(s: GameState, errs: string[], where: string) {
  const all = [...s.players.flatMap((p) => [...p.hand, ...p.built, ...p.stageCards]), ...s.discard];
  if (new Set(all).size !== all.length) errs.push(`${where}：有牌出现在两个地方`);
  for (const p of s.players) {
    const names = p.built.map((id) => card(id).name);
    if (new Set(names).size !== names.length) errs.push(`${where}：${p.id} 城里有同名建筑`);
    if (p.coins < 0) errs.push(`${where}：${p.id} 金币为负`);
  }
  if (s.phase === "play" && s.players.every((p) => !p.submitted)) {
    const n = s.players.length;
    for (const p of s.players) if (p.hand.length !== 8 - s.round) errs.push(`${where}：${p.id} 手牌 ${p.hand.length}，应为 ${8 - s.round}`);
    if (all.length !== 7 * n * s.age) errs.push(`${where}：牌总数 ${all.length}，应为 ${7 * n * s.age}`);
  }
}

function playGame(n: number, seed: number, options: { randomSides?: boolean; chooseWonders?: boolean }, spyEvery: number, stats: Stats): string[] {
  const errs: string[] = [];
  const r = lcg(seed * 7919 + n);
  let s = createGame(
    Array.from({ length: n }, (_, i) => ({ id: P(i), name: `玩家${i}` })),
    seed,
    options,
  );
  let steps = 0;
  let lastAge = s.age;
  while (s.phase !== "finished") {
    if (++steps > 400) {
      errs.push(`超过 400 步还没结束（卡死？）阶段 ${s.phase}`);
      break;
    }
    const actors = pendingActors(s);
    if (actors.length === 0) {
      errs.push(`没结束但没人可动：${s.phase} A${s.age}R${s.round}`);
      break;
    }
    const a = actors[r(actors.length)]!;
    const acts = legalActions(s, a);
    if (acts.length === 0) {
      errs.push(`${a} 在 ${s.phase} 没有合法命令`);
      break;
    }
    // 偏向建造 / 建奇迹，让城市长起来
    const nonDiscard = acts.filter((c) => !(c.type === "PLAY" && c.action === "discard"));
    const pool = nonDiscard.length > 0 && r(10) < 8 ? nonDiscard : acts;
    const cmd: GameCommand = pool[r(pool.length)]!;
    const prev = s;
    let res: { state: GameState; events: GameEvent[] };
    try {
      res = apply(prev, a, cmd);
    } catch (e) {
      errs.push(`legalActions 给的命令被拒绝：${JSON.stringify(cmd)} → ${(e as Error).message}`);
      break;
    }
    s = res.state;
    const where = `n${n}#${seed} A${prev.age}R${prev.round}`;
    for (const ev of res.events) {
      if (ev.type === "Revealed") checkReveal(prev, s, ev.plays, errs, stats);
      if (ev.type === "SeventhPlayed") {
        stats.seventh++;
        checkReveal(prev, s, [ev.play], errs, stats);
      }
      if (ev.type === "BuiltFromDiscard" && ev.card) {
        stats.discardBuild++;
        const i = prev.players.findIndex((p) => p.id === ev.player);
        if (!prev.discard.includes(ev.card)) errs.push(`${where}：从弃牌堆建的 ${ev.card} 不在弃牌堆`);
        if (prev.players[i]!.built.some((id) => card(id).name === card(ev.card!).name)) errs.push(`${where}：从弃牌堆建了同名卡`);
      }
    }
    invariants(s, errs, where);
    // 时代结束：军事
    if (s.age !== lastAge || s.phase === "finished") {
      const endedAge = (s.phase === "finished" ? 3 : lastAge) as 1 | 2 | 3;
      const expectTok = militaryTokens(s.players as unknown as City[], endedAge);
      s.players.forEach((p, i) => {
        const got = p.tokens.filter((t) => t.age === endedAge);
        const want = [
          ...(expectTok[i]!.left ? [`left:${expectTok[i]!.left}`] : []),
          ...(expectTok[i]!.right ? [`right:${expectTok[i]!.right}`] : []),
        ].sort();
        const gotS = got.map((t) => `${t.vs}:${t.value}`).sort();
        if (gotS.join() !== want.join()) errs.push(`${where}：${p.id} Age ${endedAge} 军事 ${gotS}，应为 ${want}`);
      });
      lastAge = s.age;
    }
    if (spyEvery > 0 && steps % spyEvery === 0) {
      for (let v = -1; v < n; v++) {
        const l = leaks(s, v);
        if (l.length) errs.push(`${where}：视角 ${v} 泄露 ${l.join(",")}`);
      }
    }
    if (errs.length > 20) break;
  }
  if (s.phase === "finished") {
    stats.games++;
    const fr = s.finalResult!;
    const totals: number[] = [];
    fr.scores.forEach((sc, i) => {
      const o = oracleScore(s.players as unknown as City[], i);
      totals.push(o.total);
      const got = [sc.military, sc.coins, sc.wonder, sc.civilian, sc.science, sc.commerce, sc.guilds, sc.total];
      const want = [o.military, o.coins, o.wonder, o.civilian, o.science, o.commerce, o.guilds, o.total];
      if (got.join() !== want.join()) errs.push(`n${n}#${seed} 终局 ${sc.player}：引擎 ${got}，独立计分 ${want}`);
    });
    const best = Math.max(...totals);
    const coinsTop = Math.max(...s.players.filter((_, i) => totals[i] === best).map((p) => p.coins));
    const winners = s.players.filter((p, i) => totals[i] === best && p.coins === coinsTop).map((p) => p.id).sort();
    if ([...fr.winners].sort().join() !== winners.join()) errs.push(`n${n}#${seed} 赢家 ${fr.winners}，应为 ${winners}`);
    for (let v = -1; v < n; v++) {
      const l = leaks(s, v);
      if (l.length) errs.push(`n${n}#${seed} 终局视角 ${v} 泄露 ${l.join(",")}`);
    }
  }
  return errs;
}

describe("随机整局 × 独立模型对照", () => {
  const total: Stats = { games: 0, plays: 0, trades: 0, chains: 0, olympia: 0, seventh: 0, discardBuild: 0, wonders: 0 };
  for (const n of [3, 4, 5, 6, 7]) {
    it(`${n} 人 60 局（一半随机 A/B 面、部分自选奇迹）：每一步都和规则模型一致`, () => {
      const errs: string[] = [];
      for (let k = 0; k < 60; k++) {
        const options = { randomSides: k % 2 === 1, chooseWonders: k % 5 === 0 };
        const e = playGame(n, 1000 * n + k, options, k < 10 ? 1 : 7, total);
        errs.push(...e);
        if (errs.length > 30) break;
      }
      expect(errs.slice(0, 30)).toEqual([]);
    }, 120_000);
  }
  it("覆盖面：交易、免费链、奇迹、巴比伦第 7 张、哈利卡纳苏斯都真的出现过", () => {
    expect(total.games).toBe(300);
    expect(total.trades).toBeGreaterThan(100);
    expect(total.chains).toBeGreaterThan(20);
    expect(total.wonders).toBeGreaterThan(100);
    expect(total.seventh).toBeGreaterThan(0);
    expect(total.discardBuild).toBeGreaterThan(0);
    expect(total.olympia).toBeGreaterThan(0);
  });
});
