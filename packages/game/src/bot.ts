import { autoCommand } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";
import { WONDER_KEYS } from "./types.js";

/**
 * 人机（占位实现，人机阶段会换成正式策略）。
 * 输入必须是这个座位视角的状态（redactGameForViewer(game, playerId) 之后的），只用自己看得到的信息。
 * 现在：挑奇迹时随机挑一块剩下的（A 面）；其余照引擎的保底动作 autoCommand（能建就建最便宜的，否则弃牌换 3 金）。
 * 不该它行动时返回 null。
 */
export function botCommand(view: GameState, playerId: string): GameCommand | null {
  if (view.phase === "wonders") {
    const auto = autoCommand(view, playerId);
    if (!auto) return null;
    const free = WONDER_KEYS.filter((key) => !view.players.some((player) => player.wonder === key));
    const wonder = free[Math.floor(Math.random() * free.length)] ?? free[0]!;
    return { type: "CHOOSE_WONDER", wonder, side: view.config.randomSides && Math.random() < 0.5 ? "B" : "A" };
  }
  return autoCommand(view, playerId);
}
