/** 规则核对：隐藏信息检查——某个视角拿到的数据里有没有不该看到的牌 id、种子。 */
import { redactGameForViewer, type GameState } from "@wonders/game";
import { P } from "./helpers.js";

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

