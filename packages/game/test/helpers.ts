import { apply, card, type CardId, type GameCommand, type GameState, type PlayAction, type Trade } from "../src/index.js";

/** 手里名字（英文名 / 中文名 / id）对应的那张牌。 */
export function inHand(state: GameState, playerId: string, ref: string): CardId {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  const id = player.hand.find((entry) => entry === ref || card(entry).name === ref || card(entry).zh === ref);
  if (!id) throw new Error(`${playerId} 手里没有 ${ref}（手里：${player.hand.map((entry) => card(entry).name).join(", ")}）`);
  return id;
}

export interface PlaySpec {
  readonly card: string;
  readonly action: PlayAction;
  readonly trade?: Trade;
  readonly olympia?: boolean;
}

export function playCommand(state: GameState, playerId: string, spec: PlaySpec): GameCommand {
  return {
    type: "PLAY",
    card: inHand(state, playerId, spec.card),
    action: spec.action,
    ...(spec.trade ? { trade: spec.trade } : {}),
    ...(spec.olympia ? { olympia: true } : {}),
  };
}

export function act(state: GameState, playerId: string, command: GameCommand): GameState {
  return apply(state, playerId, command).state;
}

export function play(state: GameState, playerId: string, spec: PlaySpec): GameState {
  return act(state, playerId, playCommand(state, playerId, spec));
}

/** 这一轮每个人怎么出：写了的按写的，没写的弃手里第一张。按座位顺序交，最后一个交齐时结算。 */
export function round(state: GameState, plays: Record<string, PlaySpec> = {}): GameState {
  let next = state;
  for (const player of state.players) {
    if (player.submitted) continue;
    const spec = plays[player.id] ?? { card: player.hand[0]!, action: "discard" as const };
    next = play(next, player.id, spec);
  }
  return next;
}

export function player(state: GameState, id: string) {
  return state.players.find((candidate) => candidate.id === id)!;
}

export function names(ids: readonly CardId[]): string[] {
  return ids.map((id) => card(id).name);
}

/** 深冻结：apply 改了输入就会抛错。 */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
