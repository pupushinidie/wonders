import type { GameEvent, GameState, RevealedPlay } from "./types.js";

export interface RedactOptions {
  /** 观战「看全部」（房主打开 spectatorsSeeAll）：所有人的手牌、交了什么、垫在奇迹下的牌、弃牌堆都看得到；种子和随机数状态照样看不到。 */
  readonly seeAll?: boolean;
}

function hideCard(play: RevealedPlay, viewerId: string, seeAll: boolean): RevealedPlay {
  if (seeAll || play.action === "build" || play.player === viewerId) return play;
  return { ...play, card: null };
}

function redactEvent(event: GameEvent, viewerId: string, seeAll: boolean): GameEvent {
  if (event.type === "Revealed") return { ...event, plays: event.plays.map((play) => hideCard(play, viewerId, seeAll)) };
  if (event.type === "SeventhPlayed") return { ...event, play: hideCard(event.play, viewerId, seeAll) };
  return event;
}

/**
 * 发给某个座位（或观战，viewerId = ""）的视角：
 * - 删掉种子、随机数状态、动作序列、预先排好的手牌（Age III 抽掉的行会根本不进状态）；
 * - 别人的手牌是 []（张数看 handCount）、交了什么是 null（只公开 submitted）、垫在奇迹下的牌是 []；
 * - 弃牌堆牌面是 []（张数看 discardCount），只有哈利卡纳苏斯挑弃牌那一步发给他本人；
 * - 事件和 lastReveal 里，别人垫奇迹、弃掉的那张牌是 null（建造的牌公开）。
 * seeAll（观战看全部）时上面这些都给，除了种子、随机数状态和动作序列。
 */
export function redactGameForViewer(state: GameState, viewerId: string, options: RedactOptions = {}): GameState {
  const { seed: _seed, rngState: _rngState, log: _log, stacked: _stacked, ...rest } = state;
  const seeAll = options.seeAll === true;
  const players = state.players.map((player) =>
    seeAll || player.id === viewerId
      ? { ...player, hand: [...player.hand], stageCards: [...player.stageCards], built: [...player.built], tokens: [...player.tokens] }
      : { ...player, hand: [], stageCards: [], play: null, built: [...player.built], tokens: [...player.tokens] },
  );
  const showDiscard = seeAll || (state.phase === "discardBuild" && state.pending?.player === viewerId && viewerId !== "");
  return {
    ...rest,
    players,
    discard: showDiscard ? [...state.discard] : [],
    discardCount: state.discard.length > 0 ? state.discard.length : state.discardCount,
    lastReveal: state.lastReveal.map((play) => hideCard(play, viewerId, seeAll)),
    events: state.events.map((event) => redactEvent(event, viewerId, seeAll)),
  };
}
