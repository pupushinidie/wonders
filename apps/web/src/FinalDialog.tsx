/**
 * 终局：七项分数表（每列最高的标金色），点一行看那个人每一项是怎么来的，再写「比第一名少几分、主要差在哪」。
 */
import { useState, type CSSProperties } from "react";
import {
  card,
  countFor,
  playerIndex,
  wonderStages,
  type GameState,
  type LobbyRoomSnapshot,
  type ScoreBreakdown,
} from "@wonders/game";
import { art } from "./art.js";
import { Icon } from "./Card.js";
import { SCORE_ITEMS } from "./Dialogs.js";
import { seatVar } from "./text.js";
import { socket } from "./socket.js";
import { Sprite } from "./Fx.js";

type ItemKey = (typeof SCORE_ITEMS)[number]["key"];

function sign(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

/** 每一项的来源，一句话。 */
function explain(game: GameState, score: ScoreBreakdown, key: ItemKey): string {
  const index = playerIndex(game, score.player);
  const player = game.players[index]!;
  switch (key) {
    case "military":
      return player.tokens.length === 0 ? "没有军事标记" : `${player.tokens.map((token) => sign(token.value)).join(" ")} = ${score.military}`;
    case "coins":
      return `${score.coinsHeld} 金 ÷ 3 = ${score.coins} 分${score.coinsHeld % 3 ? `（余 ${score.coinsHeld % 3} 不算）` : ""}`;
    case "wonder": {
      if (!player.wonder) return "没有奇迹";
      const parts = wonderStages(player.wonder, player.side)
        .slice(0, player.stages)
        .map((stage, at) => ({ at, vp: stage.effects.reduce((sum, effect) => sum + (effect.type === "vp" ? effect.n : 0), 0) }))
        .filter((entry) => entry.vp > 0)
        .map((entry) => `第${entry.at + 1}层 ${entry.vp}`);
      return parts.length === 0 ? `建了 ${player.stages} 层，没有分` : parts.join(" + ");
    }
    case "civilian": {
      const blue = player.built.filter((id) => card(id).color === "blue");
      return blue.length === 0 ? "没有蓝卡" : blue.map((id) => { const effect = card(id).effect; return `${card(id).zh} ${effect.type === "vp" ? effect.n : 0}`; }).join("、");
    }
    case "science": {
      const detail = score.scienceDetail;
      const best = detail.best;
      const sets = Math.min(best.compass, best.gear, best.tablet);
      if (best.compass + best.gear + best.tablet === 0) return "没有科技符号";
      return `圆规 ${best.compass} · 齿轮 ${best.gear} · 石板 ${best.tablet}${detail.wild ? `（含任选 ${detail.wild} 个）` : ""}：${best.compass ** 2}+${best.gear ** 2}+${best.tablet ** 2} + ${sets} 套×7 = ${score.science}`;
    }
    case "commerce": {
      const list = player.built
        .filter((id) => card(id).color === "yellow")
        .map((id) => {
          const effect = card(id).effect;
          if (effect.type !== "perCount" || !effect.vpEnd) return null;
          return `${card(id).zh} ${effect.vpEnd * countFor(game, index, effect.what, effect.scope)}`;
        })
        .filter(Boolean);
      return list.length === 0 ? "没有终局计分的黄卡" : list.join("、");
    }
    case "guilds":
      return score.guildDetail.length === 0
        ? "没有行会"
        : score.guildDetail.map((entry) => `${card(entry.card).zh}${entry.copied ? "（复制）" : ""} ${card(entry.card).name === "Scientists Guild" ? "算进科技" : entry.points}`).join("、");
    default:
      return "";
  }
}

export function FinalDialog({ game, room, myId, spectating, nameOf, onRematch, onLeave, onHide }: {
  game: GameState;
  room: LobbyRoomSnapshot;
  myId: string;
  spectating: boolean;
  nameOf: (id: string) => string;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
  onHide: () => void;
}) {
  const result = game.finalResult!;
  const scores = [...result.scores].sort((a, b) => a.rank - b.rank || b.total - a.total);
  const [focus, setFocus] = useState(myId && scores.some((score) => score.player === myId) ? myId : scores[0]!.player);
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const best = Object.fromEntries(SCORE_ITEMS.map((item) => [item.key, Math.max(...scores.map((score) => score[item.key]))])) as Record<ItemKey, number>;
  const focused = scores.find((score) => score.player === focus)!;
  const top = scores[0]!;
  const gaps = SCORE_ITEMS.map((item) => ({ label: item.label, diff: top[item.key] - focused[item.key] })).filter((entry) => entry.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 2);
  const won = result.winners.includes(myId);
  const title = won ? (result.winners.length > 1 ? "并列第一！" : "你赢了！") : "游戏结束";
  return (
    <div className="gm-modal-backdrop wd-backdrop" role="presentation">
      <section className="gm-panel wd-dialog wide wd-final" role="dialog" aria-modal="true" aria-labelledby="wd-final-title" data-tutorial="final">
        <header className="wd-final-head">
          {won && <Sprite name="fireworks" s={1} className="fw" loopDelay={900} />}
          <span className="wd-ribbon" style={{ "--rw": `${160 * 2}px` } as CSSProperties}>
            <img src={art.ribbon} alt="" width={320} height={48} />
            <h2 id="wd-final-title">{title}</h2>
          </span>
          {won && <Sprite name="fireworks" s={1} className="fw" delay={500} loopDelay={900} />}
        </header>
        <div className="wd-final-scroll">
          <table className="wd-final-table">
            <thead>
              <tr>
                <th>名次</th>
                <th className="name">玩家</th>
                {SCORE_ITEMS.map((item) => <th key={item.key} title={item.label}><Icon name={item.icon} s={2} /><small>{item.label}</small></th>)}
                <th title="总分"><Icon name="vp" s={2} /><small>总分</small></th>
              </tr>
            </thead>
            <tbody>
              {scores.map((score) => {
                const player = game.players.find((candidate) => candidate.id === score.player)!;
                const winner = result.winners.includes(score.player);
                return (
                  <tr key={score.player} className={[winner ? "winner" : "", score.player === myId ? "mine" : "", score.player === focus ? "focus" : ""].join(" ")} onClick={() => setFocus(score.player)}>
                    <td className="rank">{winner ? <img src={art.laurel} alt="第一" width={48} height={32} /> : score.rank}</td>
                    <td className="name wd-seat" style={seatVar(player.wonder) as CSSProperties}>
                      {player.wonder && <img src={art.emblem(player.wonder)} alt="" width={32} height={32} />}
                      <strong>{nameOf(score.player)}</strong>
                    </td>
                    {SCORE_ITEMS.map((item) => (
                      <td key={item.key} className={score[item.key] === best[item.key] && best[item.key] > 0 ? "best" : ""}>{score[item.key]}</td>
                    ))}
                    <td className="total">{score.total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="wd-final-detail" data-tutorial="final-detail">
            <h3>{nameOf(focused.player)} 的分数怎么来的 <small>点上面任意一行换人</small></h3>
            <ul>
              {SCORE_ITEMS.map((item) => (
                <li key={item.key}>
                  <Icon name={item.icon} s={1} /><em>{item.label}</em><b>{focused[item.key]}</b><span>{explain(game, focused, item.key)}</span>
                </li>
              ))}
            </ul>
            <p className="wd-final-gap">
              {focused.player === top.player
                ? result.winners.length > 1 ? `和 ${result.winners.filter((id) => id !== top.player).map(nameOf).join("、")} 总分、金币都一样，并列第一。` : `第一名，比第二名多 ${top.total - (scores[1]?.total ?? top.total)} 分。`
                : `比第一名少 ${top.total - focused.total} 分${gaps.length ? `，主要差在${gaps.map((gap) => `${gap.label}（少 ${gap.diff}）`).join("、")}` : ""}。${focused.total === top.total ? "总分一样，比金币输了。" : ""}`}
            </p>
          </div>
        </div>
        <div className="wd-rematch">
          {spectating ? (
            <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length} 人同意）` : "对局结束"}</span>
          ) : room.rematch ? (
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
          ) : <span>对局结束</span>}
          <div className="gm-panel-actions">
            <button className="quiet-button" type="button" onClick={onHide}>看牌桌</button>
            {spectating ? (
              <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>
            ) : room.rematch ? (
              <>
                <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
                <button className="primary-button" type="button" data-tutorial="rematch" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
              </>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

