/** 规则核对的公共辅助：只用引擎对外导出的接口（apply / buildScene / card …）。 */
import { apply, buildScene, card, type GameCommand, type GameState, type SceneSpec } from "@wonders/game";

export const P = (i: number) => `p${i + 1}`;

/** 某位玩家手里名字（英文或中文）对应的那张牌的 id。 */
export function handId(state: GameState, i: number, name: string): string {
  const id = state.players[i]!.hand.find((h) => card(h).name === name || card(h).zh === name);
  if (!id) throw new Error(`座位 ${i} 手里没有 ${name}：${state.players[i]!.hand.map((h) => card(h).name).join(",")}`);
  return id;
}
/** 某位玩家城里名字对应的建筑 id。 */
export function builtId(state: GameState, i: number, name: string): string {
  const id = state.players[i]!.built.find((h) => card(h).name === name || card(h).zh === name);
  if (!id) throw new Error(`座位 ${i} 城里没有 ${name}`);
  return id;
}
export const builtNames = (state: GameState, i: number) => state.players[i]!.built.map((id) => card(id).name);

export type Plan =
  | GameCommand
  | "discard"
  | { build: string; trade?: { left: string; right: string }; olympia?: boolean }
  | { wonder: string; trade?: { left: string; right: string } }
  | { discard: string };

export function toCommand(state: GameState, i: number, plan: Plan | undefined): GameCommand {
  if (plan === undefined || plan === "discard") return { type: "PLAY", card: state.players[i]!.hand[0]!, action: "discard" };
  if ("type" in plan) return plan;
  if ("build" in plan) {
    const cmd: { type: "PLAY"; card: string; action: "build"; trade?: { left: string; right: string }; olympia?: boolean } = {
      type: "PLAY",
      card: handId(state, i, plan.build),
      action: "build",
    };
    if (plan.trade) cmd.trade = plan.trade;
    if (plan.olympia) cmd.olympia = true;
    return cmd;
  }
  if ("wonder" in plan) {
    const cmd: { type: "PLAY"; card: string; action: "wonder"; trade?: { left: string; right: string } } = {
      type: "PLAY",
      card: handId(state, i, plan.wonder),
      action: "wonder",
    };
    if (plan.trade) cmd.trade = plan.trade;
    return cmd;
  }
  return { type: "PLAY", card: handId(state, i, plan.discard), action: "discard" };
}

/** 一位玩家发一条命令。 */
export function act(state: GameState, i: number, plan: Plan): GameState {
  return apply(state, P(i), toCommand(state, i, plan)).state;
}

/**
 * 一轮：按 order（默认座位顺序）让还没交的人交牌；没写的人弃第一张。最后一个人交完引擎会立刻结算。
 */
export function round(state: GameState, plans: Record<number, Plan> = {}, order?: number[]): GameState {
  let s = state;
  const seats = order ?? s.players.map((_, i) => i);
  for (const i of seats) {
    if (s.phase !== "play" || s.players[i]!.submitted) continue;
    s = act(s, i, plans[i] ?? "discard");
  }
  return s;
}

/** 造局面的简写：3 人默认 Giza / Rhodes / Babylon（A 面）。 */
export function scene(spec: SceneSpec): GameState {
  return buildScene(spec);
}

/** 所有出现的 id（深度遍历 JSON），用来查隐藏信息有没有混进视角。 */
export function jsonOf(x: unknown): string {
  return JSON.stringify(x);
}
