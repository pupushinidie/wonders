/**
 * 随机对局：每种人数 300 局，随机走合法行动（偶尔撤回再改）直到终局，用普通代码检查不变量，最后汇总断言。
 */
import { describe, expect, it } from "vitest";
import {
  apply,
  card,
  createGame,
  createRng,
  finalScores,
  legalActions,
  pendingActors,
  redactGameForViewer,
  shieldsOf,
  VICTORY_POINTS,
  wonderStages,
  type GameEvent,
  type GameState,
} from "../src/index.js";

const GAMES = 300;

/** 随机对局里各种情况出现了几次（确认随机对局真的走到了巴比伦第 7 张、哈利卡纳苏斯、奥林匹亚、免费链、买资源……）。 */
const seen: Record<string, number> = {};
const tally = (key: string) => {
  seen[key] = (seen[key] ?? 0) + 1;
};

function cardsInPlay(state: GameState): string[] {
  return [
    ...state.discard,
    ...state.players.flatMap((player) => [...player.built, ...player.stageCards, ...player.hand]),
  ];
}

function agesDealt(state: GameState): number {
  return state.phase === "wonders" ? 0 : state.age;
}

/** 这一步事件里银行进出的金币（邻居之间的买卖不改总数）。 */
function bankDelta(events: readonly GameEvent[]): number {
  let delta = 0;
  for (const event of events) {
    if (event.type === "Revealed") for (const play of event.plays) delta += play.gained - play.paidBank;
    if (event.type === "SeventhPlayed") delta += event.play.gained - event.play.paidBank;
    if (event.type === "BuiltFromDiscard") delta += event.gained;
  }
  return delta;
}

function checkState(state: GameState, problems: string[], where: string): void {
  const n = state.players.length;
  const all = cardsInPlay(state);
  if (all.length !== 7 * n * agesDealt(state)) problems.push(`${where} 牌数 ${all.length} ≠ ${7 * n * agesDealt(state)}`);
  if (new Set(all).size !== all.length) problems.push(`${where} 有牌出现两次`);
  if (state.discardCount !== state.discard.length) problems.push(`${where} discardCount 不对`);
  for (const player of state.players) {
    const names = player.built.map((id) => card(id).name);
    if (new Set(names).size !== names.length) problems.push(`${where} ${player.id} 建了同名的`);
    if (!Number.isInteger(player.coins) || player.coins < 0) problems.push(`${where} ${player.id} 金币 ${player.coins}`);
    if (player.handCount !== player.hand.length) problems.push(`${where} ${player.id} handCount 不对`);
    if (player.stageCards.length !== player.stages) problems.push(`${where} ${player.id} 垫牌数 ≠ 阶段数`);
    if (player.wonder && player.stages > wonderStages(player.wonder, player.side).length) problems.push(`${where} ${player.id} 阶段超了`);
    for (const age of [1, 2, 3] as const) {
      const tokens = player.tokens.filter((token) => token.age === age);
      if (tokens.length > 2) problems.push(`${where} ${player.id} Age ${age} 标记超过 2 个`);
      if (tokens.some((token) => token.value !== -1 && token.value !== VICTORY_POINTS[age])) problems.push(`${where} ${player.id} 标记值不对`);
    }
    if (player.submitted !== (player.play !== null)) problems.push(`${where} ${player.id} submitted 和 play 不一致`);
    if (player.play && !player.hand.includes(player.play.card)) problems.push(`${where} ${player.id} 交的牌不在手里`);
  }
  if (state.phase === "play") {
    const size = 8 - state.round;
    if (state.players.some((player) => player.hand.length !== size)) problems.push(`${where} 出牌阶段手牌不是 ${size} 张`);
  }
  if (state.phase === "finished") {
    if (!state.finalResult) problems.push(`${where} 终局没有分数`);
    else {
      const again = finalScores(state);
      if (JSON.stringify(again) !== JSON.stringify(state.finalResult)) problems.push(`${where} 终局分数重算不一致`);
      for (const [index, score] of state.finalResult.scores.entries()) {
        const parts = score.military + score.coins + score.wonder + score.civilian + score.science + score.commerce + score.guilds;
        if (parts !== score.total) problems.push(`${where} ${score.player} 七项之和 ${parts} ≠ 总分 ${score.total}`);
        const player = state.players[index]!;
        if (score.military !== player.tokens.reduce((sum, token) => sum + token.value, 0)) problems.push(`${where} 军事分不对`);
        if (score.coins !== Math.floor(player.coins / 3)) problems.push(`${where} 金币分不对`);
        const better = state.finalResult.scores.filter((other) => other.total > score.total || (other.total === score.total && other.coinsHeld > score.coinsHeld)).length;
        if (score.rank !== better + 1) problems.push(`${where} 名次不对`);
      }
      const winners = state.finalResult.scores.filter((score) => score.rank === 1).map((score) => score.player);
      if (winners.length === 0 || JSON.stringify(winners) !== JSON.stringify(state.finalResult.winners)) problems.push(`${where} 赢家不对`);
      if (state.players.some((player) => player.hand.length > 0)) problems.push(`${where} 终局还有手牌`);
    }
  } else {
    const actors = pendingActors(state);
    if (actors.length === 0) problems.push(`${where} 卡死：没人能动（${state.phase}）`);
    for (const actor of actors) if (legalActions(state, actor).length === 0) problems.push(`${where} 卡死：${actor} 没有合法行动`);
  }
}

/** 隐藏信息：别人的手牌、交的牌、垫奇迹的牌、弃牌堆不出现在这个视角的 JSON 里；种子、随机数状态、动作序列不下发。 */
function checkRedaction(state: GameState, problems: string[], where: string): void {
  for (const viewer of [...state.players.map((player) => player.id), ""]) {
    const view = redactGameForViewer(state, viewer);
    // 自己弃掉 / 垫下去的牌自己知道：先把自己那几手从记录里拿掉，再查别人的秘密
    const others = <T extends { player: string }>(plays: readonly T[]) => plays.filter((play) => play.player !== viewer);
    const json = JSON.stringify({
      ...view,
      lastReveal: others(view.lastReveal),
      events: view.events.map((event) =>
        event.type === "Revealed" ? { ...event, plays: others(event.plays) } : event.type === "SeventhPlayed" && event.play.player === viewer ? { type: "SeventhPlayed" } : event,
      ),
    });
    for (const key of ['"seed"', '"rngState"', '"log"', '"stacked"']) if (json.includes(key)) problems.push(`${where} 视角 ${viewer} 带了 ${key}`);
    const secret: string[] = [];
    for (const player of state.players) if (player.id !== viewer) secret.push(...player.hand, ...player.stageCards);
    const seesDiscard = state.phase === "discardBuild" && state.pending?.player === viewer;
    if (!seesDiscard) secret.push(...state.discard);
    // 公开的牌（已建成的）不算；一张牌不会同时在两处
    for (const id of secret) if (json.includes(`"${id}"`)) problems.push(`${where} 视角 ${viewer} 看到了 ${id}`);
  }
}

function playRandomGame(n: number, seed: number, problems: string[], checkViews: boolean): number {
  const random = createRng(seed * 7919 + n);
  const options = { randomSides: seed % 2 === 1, chooseWonders: seed % 5 === 0 };
  let state = createGame(Array.from({ length: n }, (_, index) => ({ id: `p${index + 1}`, name: `玩家${index}` })), seed, options);
  checkState(state, problems, `n${n}#${seed} 开局`);
  let steps = 0;
  let undos = 0;
  while (state.phase !== "finished") {
    steps += 1;
    if (steps > 600) {
      problems.push(`n${n}#${seed} 超过 600 步没打完`);
      break;
    }
    const where = `n${n}#${seed} A${state.age}R${state.round} ${state.phase} 第${steps}步`;
    const before = state;
    const submittedPlayers = state.phase === "play" ? state.players.filter((player) => player.submitted) : [];
    let actor: string;
    let command;
    if (submittedPlayers.length > 0 && undos < 40 && random.next() < 0.08) {
      actor = random.pick(submittedPlayers).id;
      command = { type: "UNDO" } as const;
      undos += 1;
    } else {
      actor = random.pick(pendingActors(state));
      command = random.pick(legalActions(state, actor));
    }
    try {
      state = apply(state, actor, command).state;
    } catch (error) {
      problems.push(`${where} 合法行动被拒：${JSON.stringify(command)} ${(error as Error).message}`);
      break;
    }
    if (state.version !== before.version + 1) problems.push(`${where} version 没有 +1`);
    if (state.step < before.step) problems.push(`${where} step 倒退`);
    if (state.age < before.age || (state.age === before.age && state.round < before.round && before.phase !== "wonders")) problems.push(`${where} 时代 / 轮倒退`);
    const coins = (s: GameState) => s.players.reduce((sum, player) => sum + player.coins, 0);
    if (coins(state) - coins(before) !== bankDelta(state.events)) problems.push(`${where} 金币不守恒`);
    if (command.type === "UNDO") tally("撤回");
    for (const event of state.events) {
      if (event.type === "Revealed") for (const play of event.plays) tally(play.via ? `付款:${play.via}` : `用法:${play.action}`);
      if (event.type === "Revealed") for (const play of event.plays) if (play.action === "wonder") tally("建奇迹");
      if (event.type === "SeventhPlayed") tally("巴比伦第7张");
      if (event.type === "BuiltFromDiscard") tally(event.card ? "哈利卡纳苏斯挑牌" : "哈利卡纳苏斯没挑");
      if (event.type === "GameEnded" && event.result.winners.length > 1) tally("并列");
      if (event.type === "GameEnded") for (const score of event.result.scores) if (score.copiedGuild) tally("奥林匹亚复制行会");
      if (event.type === "GameEnded") for (const score of event.result.scores) if (score.scienceDetail.wild > 0) tally("任选科技符号");
      if (event.type !== "MilitaryResolved") continue;
      // 军事：按结算那一刻的盾牌和左右邻居比
      event.results.forEach((result, index) => {
        const left = event.results[(index + 1) % n]!.shields;
        const right = event.results[(index - 1 + n) % n]!.shields;
        const expect = (other: number) => (result.shields > other ? VICTORY_POINTS[event.age] : result.shields < other ? -1 : 0);
        if (result.left !== expect(left) || result.right !== expect(right)) problems.push(`${where} 军事结算不对`);
        if (result.shields !== shieldsOf(state.players[index]!)) problems.push(`${where} 盾牌数不对`);
      });
    }
    checkState(state, problems, where);
    if (checkViews && steps % 5 === 0) checkRedaction(state, problems, where);
    if (problems.length > 20) break;
  }
  return steps;
}

describe("随机对局（每种人数 300 局）", () => {
  for (const n of [3, 4, 5, 6, 7]) {
    it(`每种人数 300 局：${n} 人，牌数守恒、金币不为负且守恒、同名不重复、分数分项相加等于总分、不会卡死、隐藏信息不下发`, () => {
      const problems: string[] = [];
      let totalSteps = 0;
      for (let game = 0; game < GAMES; game += 1) totalSteps += playRandomGame(n, game + 1, problems, game < 30);
      expect(problems).toEqual([]);
      expect(totalSteps).toBeGreaterThan(GAMES * 18 * n);
    }, 120_000);
  }

  it("随机对局覆盖到了所有用法和特殊能力", () => {
    for (const key of ["撤回", "付款:own", "付款:trade", "付款:chain", "付款:olympia", "用法:discard", "建奇迹", "巴比伦第7张", "哈利卡纳苏斯挑牌", "奥林匹亚复制行会", "任选科技符号"]) {
      expect(seen[key] ?? 0, key).toBeGreaterThan(0);
    }
  });
});
