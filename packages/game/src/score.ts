import { card } from "./cards.js";
import { countFor, hasStageEffect, leftOf, playerIndex, rightOf, scienceCounts, stageEffects } from "./city.js";
import type { CardId, FinalResult, GameState, ScienceDetail, ScoreBreakdown } from "./types.js";

/**
 * 科技分：每种符号张数的平方相加，再加每凑齐一套（三种各一）7 分。
 * wild 个任选符号枚举所有分法取最高（不能贪心，补充 E-T2）。返回分数和最优分配后的张数。
 */
export function scienceScore(
  counts: { readonly compass: number; readonly gear: number; readonly tablet: number },
  wild = 0,
): { score: number; best: { compass: number; gear: number; tablet: number } } {
  const raw = (c: number, g: number, t: number) => c * c + g * g + t * t + 7 * Math.min(c, g, t);
  let best = { compass: counts.compass, gear: counts.gear, tablet: counts.tablet };
  let score = raw(counts.compass, counts.gear, counts.tablet);
  for (let c = 0; c <= wild; c += 1) {
    for (let g = 0; g <= wild - c; g += 1) {
      const t = wild - c - g;
      const value = raw(counts.compass + c, counts.gear + g, counts.tablet + t);
      if (value > score) {
        score = value;
        best = { compass: counts.compass + c, gear: counts.gear + g, tablet: counts.tablet + t };
      }
    }
  }
  return { score, best };
}

/** 一张行会（或奥林匹亚复制来的行会）按 owner 的视角算几分；科学家行会记 0（算进科技）。 */
function guildPoints(state: Pick<GameState, "players">, owner: number, guild: CardId): number {
  const effect = card(guild).effect;
  if (effect.type !== "perCount") return 0;
  return (effect.vpEnd ?? 0) * countFor(state, owner, effect.what, effect.scope);
}

type Unranked = Omit<ScoreBreakdown, "rank">;

/** 某位玩家现在的分数明细（局中也能算：所有计分用到的都是公开信息）。copied：奥林匹亚 B 复制哪张行会（null = 不复制）。 */
function scoreWith(state: Pick<GameState, "players">, index: number, copied: CardId | null): Unranked {
  const player = state.players[index]!;
  const military = player.tokens.reduce((sum, token) => sum + token.value, 0);
  const coins = Math.floor(player.coins / 3);
  let wonder = 0;
  for (const effect of stageEffects(player)) if (effect.type === "vp") wonder += effect.n;

  let civilian = 0;
  let commerce = 0;
  const guildDetail: { card: CardId; points: number; copied: boolean }[] = [];
  for (const id of player.built) {
    const def = card(id);
    if (def.color === "blue" && def.effect.type === "vp") civilian += def.effect.n;
    if (def.color === "yellow" && def.effect.type === "perCount" && def.effect.vpEnd) {
      commerce += def.effect.vpEnd * countFor(state, index, def.effect.what, def.effect.scope);
    }
    if (def.color === "purple") guildDetail.push({ card: id, points: guildPoints(state, index, id), copied: false });
  }
  if (copied) guildDetail.push({ card: copied, points: guildPoints(state, index, copied), copied: true });
  const guilds = guildDetail.reduce((sum, entry) => sum + entry.points, 0);

  const counts = scienceCounts(player);
  const extraWild = copied && card(copied).effect.type === "science" ? 1 : 0;
  const wild = counts.wild + extraWild;
  const result = scienceScore(counts, wild);
  const scienceDetail: ScienceDetail = { compass: counts.compass, gear: counts.gear, tablet: counts.tablet, wild, best: result.best };

  const total = military + coins + wonder + civilian + result.score + commerce + guilds;
  return {
    player: player.id,
    military,
    coins,
    wonder,
    civilian,
    science: result.score,
    commerce,
    guilds,
    total,
    coinsHeld: player.coins,
    scienceDetail,
    guildDetail,
    copiedGuild: copied,
  };
}

/** 奥林匹亚 B3 能复制的行会：左右邻居已经建成的行会。 */
export function copyableGuilds(state: Pick<GameState, "players">, index: number): CardId[] {
  const player = state.players[index]!;
  if (!hasStageEffect(player, "copyGuild")) return [];
  const out: CardId[] = [];
  for (const neighbor of [leftOf(state, index), rightOf(state, index)]) {
    for (const id of state.players[neighbor]!.built) if (card(id).guild && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 某位玩家的分数明细（奥林匹亚 B 自动挑总分最高的复制；一样高时取左邻的、靠前的那张）。名次 rank 在这里记 0。 */
export function scorePlayer(state: Pick<GameState, "players">, index: number): Unranked {
  let best = scoreWith(state, index, null);
  for (const guild of copyableGuilds(state, index)) {
    const candidate = scoreWith(state, index, guild);
    if (candidate.total > best.total) best = candidate;
  }
  return best;
}

/** 所有人的分数和名次：总分高的在前，平分比金币，金币也一样就并列（赢家可以有几个）。 */
export function finalScores(state: Pick<GameState, "players">): FinalResult {
  const raw = state.players.map((_, index) => scorePlayer(state, index));
  const better = (a: Unranked, b: Unranked) => a.total > b.total || (a.total === b.total && a.coinsHeld > b.coinsHeld);
  const scores = raw.map((entry) => ({ ...entry, rank: 1 + raw.filter((other) => better(other, entry)).length }));
  return { scores, winners: scores.filter((entry) => entry.rank === 1).map((entry) => entry.player) };
}

/** 某位玩家现在的分数明细（局中也能用，界面显示「现在几分」）。 */
export function scoreBreakdown(state: Pick<GameState, "players">, playerId: string): ScoreBreakdown {
  const result = finalScores(state);
  const index = playerIndex(state, playerId);
  if (index < 0) throw new Error("没有这位玩家。");
  return result.scores[index]!;
}
