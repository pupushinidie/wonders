/**
 * 调试牌桌（引擎阶段联调用，正式界面由界面阶段替换）：把当前状态列出来，每个合法行动一个按钮。
 * 观战时按 watchId 那位玩家的座位看，什么都不能点。
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  card,
  COLOR_NAMES,
  discardBuildOptions,
  legalActions,
  pendingActors,
  playOptions,
  productionSummary,
  RESOURCE_NAMES,
  SCIENCE_NAMES,
  scoreBreakdown,
  shieldsOf,
  WONDER_KEYS,
  wonder as wonderDef,
  wonderStages,
  type CardId,
  type GameCommand,
  type GameEvent,
  type GameState,
  type LobbyRoomSnapshot,
  type PaymentOption,
  type PlayerState,
  type Resource,
} from "@wonders/game";
import GameRules from "./GameRules.js";
import { RoomSettingsPanel } from "./RoomExtras.js";
import { socket } from "./socket.js";
import type { Theme } from "./theme.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
  readonly theme: Theme;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  /** 打开 / 取消自己的托管。 */
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  /** 观战时从这位玩家的座位看。 */
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  /** 观战的人离开。 */
  readonly onLeave: () => void;
}

const res = (letters: string) => [...letters].map((letter) => RESOURCE_NAMES[letter as Resource]).join("");
const cardName = (id: CardId | null) => (id ? card(id).zh : "（暗）");

function payText(option: PaymentOption): string {
  if (option.kind === "chain") return "免费链";
  if (option.kind === "olympia") return "奥林匹亚免费";
  const parts: string[] = [];
  if (option.left) parts.push(`左买${res(option.left)} ${option.leftCost}金`);
  if (option.right) parts.push(`右买${res(option.right)} ${option.rightCost}金`);
  if (option.bankCost) parts.push(`银行 ${option.bankCost}金`);
  return parts.length ? parts.join("，") : "免费";
}

function eventText(event: GameEvent, nameOf: (id: string) => string): string | null {
  switch (event.type) {
    case "WondersAssigned":
      return `奇迹：${event.assignments.map((entry) => `${nameOf(entry.player)} ${wonderDef(entry.wonder).zh} ${entry.side}`).join("，")}`;
    case "WonderChosen":
      return `${nameOf(event.player)} 挑了 ${wonderDef(event.wonder).zh} ${event.side} 面`;
    case "AgeStarted":
      return `Age ${event.age} 开始，传给${event.direction === "left" ? "左" : "右"}邻`;
    case "RoundStarted":
      return `Age ${event.age} 第 ${event.round} 轮`;
    case "Submitted":
      return `${nameOf(event.player)} 交了牌`;
    case "Withdrawn":
      return `${nameOf(event.player)} 撤回了`;
    case "Revealed":
      return event.plays
        .map((play) => {
          const what = play.action === "build" ? `建 ${cardName(play.card)}` : play.action === "wonder" ? `建奇迹第 ${play.stage} 层` : "弃牌 +3 金";
          return `${nameOf(play.player)}：${what}${play.paidLeft + play.paidRight ? `（付邻居 ${play.paidLeft + play.paidRight}）` : ""}${play.gained && play.action !== "discard" ? ` +${play.gained} 金` : ""}`;
        })
        .join("；");
    case "SeventhPending":
      return `${nameOf(event.player)} 打第 7 张`;
    case "SeventhPlayed":
      return `${nameOf(event.play.player)} 第 7 张：${event.play.action === "build" ? `建 ${cardName(event.play.card)}` : event.play.action === "wonder" ? "建奇迹" : "弃牌 +3 金"}`;
    case "CardsBurned":
      return "最后一张作废";
    case "DiscardBuildPending":
      return `${nameOf(event.player)} 从弃牌堆挑牌（${event.options} 张能建）`;
    case "BuiltFromDiscard":
      return `${nameOf(event.player)} 从弃牌堆${event.card ? `建了 ${cardName(event.card)}` : "没有建"}`;
    case "HandsPassed":
      return null;
    case "MilitaryResolved":
      return `军事：${event.results.map((entry) => `${nameOf(entry.player)} ${entry.shields} 盾 左${entry.left >= 0 ? "+" : ""}${entry.left} 右${entry.right >= 0 ? "+" : ""}${entry.right}`).join("，")}`;
    case "GameEnded":
      return "游戏结束";
    case "TurnTimedOut":
      return `${nameOf(event.player)} 超时，人机替他出了`;
    default:
      return null;
  }
}

function PlayerRow({ game, player, me, room }: { game: GameState; player: PlayerState; me: boolean; room: LobbyRoomSnapshot }) {
  const member = room.members.find((candidate) => candidate.playerId === player.id);
  const production = productionSummary(player);
  const byColor = new Map<string, string[]>();
  for (const id of player.built) {
    const def = card(id);
    byColor.set(def.color, [...(byColor.get(def.color) ?? []), def.zh]);
  }
  const score = scoreBreakdown(game, player.id);
  const stages = player.wonder ? wonderStages(player.wonder, player.side).length : 0;
  return (
    <tr className={me ? "wd-me" : ""} data-player={player.id}>
      <td>
        <b>{player.name}</b>
        {member?.bot && <small className="bot-badge">人机</small>}
        {member && !member.bot && (member.auto || !member.connected) && <small className="wd-auto">{member.connected ? "托管" : "离线"}</small>}
        <div>{player.wonder ? `${wonderDef(player.wonder).zh} ${player.side}` : "未挑奇迹"} · 阶段 {player.stages}/{stages}</div>
      </td>
      <td>{player.coins} 金 · {shieldsOf(player)} 盾<div>标记 {player.tokens.map((token) => (token.value > 0 ? `+${token.value}` : token.value)).join(" ") || "—"}</div></td>
      <td>
        产 {res(production.fixed) || "—"} {production.choices.map((choice) => `[${res(choice)}]`).join("")}
        {production.privateChoices.length > 0 && ` 自用${production.privateChoices.map((choice) => `[${res(choice)}]`).join("")}`}
      </td>
      <td className="wd-city">
        {[...byColor].map(([color, names]) => (
          <span key={color} className={`wd-c-${color}`}>{COLOR_NAMES[color as keyof typeof COLOR_NAMES]}：{names.join("、")}</span>
        ))}
      </td>
      <td>手牌 {player.handCount}{game.phase === "play" ? (player.submitted ? " · 已交" : " · 想") : ""}</td>
      <td>{score.total} 分</td>
    </tr>
  );
}

function GameBoard({ room, busy, error, notice, brand, connection, themeToggle, chat, onCommand, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const me = game.players.find((player) => player.id === myId)!;
  const isHost = member?.isHost ?? false;
  const autoPlaying = member?.auto === true;
  const finished = game.phase === "finished";
  const nameOf = (id: string) => game.players.find((player) => player.id === id)?.name ?? id;
  const waiting = pendingActors(game);
  const canAct = !spectating && !autoPlaying && waiting.includes(myId);

  const [log, setLog] = useState<{ key: string; text: string }[]>([]);
  useEffect(() => {
    const lines = game.events.flatMap((event, index) => {
      const text = eventText(event, nameOf);
      return text ? [{ key: `${game.version}-${index}`, text }] : [];
    });
    if (lines.length) setLog((previous) => [...lines.reverse(), ...previous].slice(0, 60));
  }, [game.version]);

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (room.turnRemainingMs === undefined) {
      setSecondsLeft(null);
      return;
    }
    const end = Date.now() + room.turnRemainingMs;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [room.turnRemainingMs, game.version, room]);

  let status: string;
  if (finished) status = "游戏结束";
  else if (game.phase === "wonders") status = `自选奇迹：轮到 ${nameOf(waiting[0] ?? "")}`;
  else if (game.phase === "seventh") status = `${nameOf(game.pending!.player)} 正在打第 7 张`;
  else if (game.phase === "discardBuild") status = `${nameOf(game.pending!.player)} 正在从弃牌堆挑牌`;
  else status = `Age ${game.age} 第 ${game.round} 轮 · 传给${game.direction === "left" ? "左" : "右"}邻 · 还没交：${waiting.map(nameOf).join("、") || "—"}`;

  const options = canAct && (game.phase === "play" || game.phase === "seventh") ? playOptions(game, myId) : [];
  const actions = canAct ? legalActions(game, myId) : [];

  return (
    <div className="wd-debug">
      <header className="wd-topbar">
        {brand}
        <span className="wd-status">{status}{secondsLeft !== null && <b className="wd-timer"> {secondsLeft}s</b>}</span>
        <div className="wd-topbar-right">
          {themeToggle}
          <GameRules />
          {connection}
          {spectating && <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>}
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {!spectating && !finished && !autoPlaying && <button className="quiet-button" type="button" onClick={() => onAuto(true)}>托管</button>}
          {autoPlaying && <button className="primary-button" type="button" onClick={() => onAuto(false)}>取消托管</button>}
        </div>
      </header>
      <p className="wd-note">调试牌桌：引擎联调用，正式界面由界面阶段做。{spectating ? `你在观战（看 ${me.name} 的座位）。` : ""}</p>
      {spectating && (
        <div className="wd-watch">
          看谁：{game.players.map((player) => (
            <button key={player.id} type="button" className={player.id === myId ? "quiet-button on" : "quiet-button"} onClick={() => onWatch(player.id)}>{player.name}</button>
          ))}
        </div>
      )}
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

      <table className="wd-players">
        <tbody>
          {game.players.map((player) => <PlayerRow key={player.id} game={game} player={player} me={player.id === myId} room={room} />)}
        </tbody>
      </table>
      <p>弃牌堆 {game.discardCount} 张</p>

      {!finished && (
        <section className="wd-hand">
          <h3>{spectating ? `${me.name} 的手牌` : "我的手牌"}（{me.hand.length}）</h3>
          {me.play && (
            <p>
              已交：{me.play.action === "build" ? "建" : me.play.action === "wonder" ? "垫奇迹" : "弃掉"} {cardName(me.play.card)}
              {me.play.payment ? `（${payText(me.play.payment)}）` : ""}
              {!spectating && game.phase === "play" && <button type="button" className="quiet-button" disabled={busy} onClick={() => onCommand({ type: "UNDO" })}>撤回</button>}
            </p>
          )}
          {me.stageCards.length > 0 && <p>垫在奇迹下：{me.stageCards.map(cardName).join("、")}</p>}
          <ul>
            {me.hand.map((id) => {
              const option = options.find((entry) => entry.card === id);
              const def = card(id);
              return (
                <li key={id} data-card={id}>
                  <b className={`wd-c-${def.color}`}>{def.zh}</b> <small>{def.cost ? `成本 ${res(def.cost)}` : "免费"}{def.coin ? ` + ${def.coin}金` : ""}{def.chainFrom.length ? ` · 链自 ${def.chainFrom.join("/")}` : ""}</small>
                  {option && (
                    <span className="wd-actions">
                      {option.build.options.map((pay) => (
                        <button key={`b-${pay.kind}-${pay.left}-${pay.right}`} type="button" className="quiet-button" disabled={busy}
                          onClick={() => onCommand(pay.kind === "olympia" ? { type: "PLAY", card: id, action: "build", olympia: true } : { type: "PLAY", card: id, action: "build", trade: { left: pay.left, right: pay.right } })}>
                          建造（{payText(pay)}）
                        </button>
                      ))}
                      {option.build.reason && <small className="wd-why">不能建：{option.build.reason}</small>}
                      {option.wonder.options.map((pay) => (
                        <button key={`w-${pay.left}-${pay.right}`} type="button" className="quiet-button" disabled={busy}
                          onClick={() => onCommand({ type: "PLAY", card: id, action: "wonder", trade: { left: pay.left, right: pay.right } })}>
                          垫奇迹（{payText(pay)}）
                        </button>
                      ))}
                      <button type="button" className="quiet-button" disabled={busy} onClick={() => onCommand({ type: "PLAY", card: id, action: "discard" })}>弃牌 +3 金</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {canAct && game.phase === "discardBuild" && (
            <div className="wd-actions">
              弃牌堆：{game.discard.map(cardName).join("、")}
              <div>
                {discardBuildOptions(game, myId).map((id) => (
                  <button key={id} type="button" className="quiet-button" disabled={busy} onClick={() => onCommand({ type: "DISCARD_BUILD", card: id })}>免费建 {cardName(id)}</button>
                ))}
                <button type="button" className="quiet-button" disabled={busy} onClick={() => onCommand({ type: "DISCARD_BUILD", card: null })}>放弃</button>
              </div>
            </div>
          )}
          {canAct && game.phase === "wonders" && (
            <div className="wd-actions">
              {WONDER_KEYS.filter((key) => actions.some((action) => action.type === "CHOOSE_WONDER" && action.wonder === key)).flatMap((key) =>
                (["A", "B"] as const).map((side) => (
                  <button key={`${key}${side}`} type="button" className="quiet-button" disabled={busy} onClick={() => onCommand({ type: "CHOOSE_WONDER", wonder: key, side })}>
                    {wonderDef(key).zh} {side}
                  </button>
                )),
              )}
            </div>
          )}
        </section>
      )}

      {finished && game.finalResult && (
        <section className="wd-final">
          <h3>终局：{game.finalResult.winners.map(nameOf).join("、")} 获胜</h3>
          <table>
            <thead><tr><th>玩家</th><th>军事</th><th>金币</th><th>奇迹</th><th>文明</th><th>科技</th><th>商业</th><th>行会</th><th>总分</th><th>名次</th></tr></thead>
            <tbody>
              {game.finalResult.scores.map((entry) => (
                <tr key={entry.player}>
                  <td>{nameOf(entry.player)}</td><td>{entry.military}</td><td>{entry.coins}</td><td>{entry.wonder}</td><td>{entry.civilian}</td>
                  <td>{entry.science}{entry.scienceDetail.wild ? `（任选 ${entry.scienceDetail.wild}：${SCIENCE_NAMES.compass}${entry.scienceDetail.best.compass} ${SCIENCE_NAMES.gear}${entry.scienceDetail.best.gear} ${SCIENCE_NAMES.tablet}${entry.scienceDetail.best.tablet}）` : ""}</td>
                  <td>{entry.commerce}</td><td>{entry.guilds}{entry.copiedGuild ? `（复制 ${cardName(entry.copiedGuild)}）` : ""}</td><td><b>{entry.total}</b></td><td>{entry.rank}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {room.rematch && !spectating && (
            <p>
              再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）
              <button type="button" className="primary-button" onClick={() => onRematch(true)}>再来一局</button>
              <button type="button" className="quiet-button" onClick={() => onRematch(false)}>不玩了</button>
            </p>
          )}
        </section>
      )}

      <div className="wd-bottom">
        <section className="wd-log"><h3>记录</h3><ul>{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul></section>
        <section className="wd-chat">{chat}</section>
        {isHost && <section><RoomSettingsPanel room={room} /></section>}
      </div>
    </div>
  );
}

export default GameBoard;
