/**
 * 别人的面板：左右邻居的大面板（能买什么、每份几金、盾、金币、奇迹进度、颜色计数、科技）、
 * 其他人的小卡、手机上的半宽邻居面板和小签。点哪个都能打开完整城池。
 */
import type { CSSProperties, ReactNode } from "react";
import {
  CARD_COLORS,
  colorCount,
  priceOf,
  productionSlots,
  scienceCounts,
  shieldsOf,
  type GameState,
  type LobbyMember,
  type PlayerState,
  type Resource,
  type RevealedPlay,
  type Side,
  wonderStages,
} from "@wonders/game";
import { art } from "./art.js";
import { Icon } from "./Card.js";
import { PlayerBoard } from "./Wonder.js";
import { COLOR_HEX, playText, seatVar, WONDER_SHORT } from "./text.js";

export interface SeatInfo {
  readonly player: PlayerState;
  readonly member: LobbyMember | undefined;
  /** 当前分（局中实时）。 */
  readonly score: number;
  readonly you: boolean;
  readonly last: RevealedPlay | undefined;
}

export function PlayerTags({ member, you }: { member: LobbyMember | undefined; you: boolean }) {
  const offline = member ? !member.connected : false;
  return (
    <>
      {you && <small className="wd-tag you">你</small>}
      {member?.bot && <small className="wd-tag bot">人机</small>}
      {!member?.bot && (member?.auto || offline) && <small className="wd-tag auto">托管</small>}
      {offline && !member?.bot && <small className="wd-tag off">离线</small>}
    </>
  );
}

/** 这位玩家这一步的状态：已出牌 ✓ / 还在想（沙漏）/ 正在结算 / 正在挑奇迹。 */
export function readyState(game: GameState, player: PlayerState): { kind: "ready" | "waiting" | "busy" | "none"; text: string } {
  switch (game.phase) {
    case "play":
      return player.submitted ? { kind: "ready", text: "已出牌" } : { kind: "waiting", text: "在想" };
    case "seventh":
    case "discardBuild":
      return game.pending?.player === player.id ? { kind: "busy", text: game.phase === "seventh" ? "打第 7 张" : "挑弃牌" } : { kind: "none", text: "" };
    case "wonders": {
      const chooser = game.chooseOrder[game.chooser];
      if (chooser !== undefined && game.players[chooser]?.id === player.id) return { kind: "busy", text: "在挑奇迹" };
      return player.wonder ? { kind: "ready", text: "已挑" } : { kind: "waiting", text: "等着挑" };
    }
    default:
      return { kind: "none", text: "" };
  }
}

export function ReadyMark({ game, player, showText = false }: { game: GameState; player: PlayerState; showText?: boolean }) {
  const state = readyState(game, player);
  if (state.kind === "none") return null;
  return (
    <span className={`wd-ready ${state.kind}`} title={state.text}>
      {state.kind === "busy" ? <i className="wd-busy-dot" /> : <img src={art.icon(state.kind === "ready" ? "ready" : "waiting")} alt={state.text} width={32} height={32} />}
      {showText && <span>{state.text}</span>}
    </span>
  );
}

const warSum = (player: PlayerState) => player.tokens.reduce((sum, token) => sum + token.value, 0);

/** 金币、盾、军事标记合计、当前分（数字 24px）。 */
export function StatLine({ seat, items = ["coin", "shield", "war", "vp"], tutorial }: { seat: SeatInfo; items?: readonly ("coin" | "shield" | "war" | "vp")[]; tutorial?: string | undefined }) {
  const { player } = seat;
  const war = warSum(player);
  return (
    <div className="wd-stats" data-tutorial={tutorial}>
      {items.includes("coin") && <span title="金币"><Icon name="coin" s={2} /><b>{player.coins}</b></span>}
      {items.includes("shield") && <span title="盾（军事力量）"><Icon name="shield" s={2} /><b>{shieldsOf(player)}</b></span>}
      {items.includes("war") && <span title={`军事标记：${player.tokens.map((token) => (token.value > 0 ? `+${token.value}` : token.value)).join(" ") || "还没有"}`} className="war">
        <img className="wd-icon" src={art.token(war < 0 ? -1 : 1)} alt="" width={32} height={32} /><b>{war > 0 ? `+${war}` : war}</b>
      </span>}
      {items.includes("vp") && <span title="当前分（局中实时）" className="vp"><Icon name="vp" s={2} /><b>{seat.score}</b></span>}
    </div>
  );
}

/** 邻居能卖给我的资源，按我的价格分组（1 金 / 2 金）。 */
export function SellList({ me, neighbor, side, s = 2 }: { me: PlayerState; neighbor: PlayerState; side: Side; s?: number }) {
  const slots = productionSlots(neighbor).filter((slot) => slot.sellable);
  if (slots.length === 0) return <p className="wd-sell none">没有能买的资源</p>;
  const groups = new Map<number, string[]>();
  for (const slot of slots) {
    const price = Math.min(...[...slot.opts].map((letter) => priceOf(me, side, letter)));
    groups.set(price, [...(groups.get(price) ?? []), slot.opts]);
  }
  return (
    <div className="wd-sell">
      {[...groups].sort((a, b) => a[0] - b[0]).map(([price, list]) => (
        <div key={price} className={price === 1 ? "wd-sell-row cheap" : "wd-sell-row"}>
          <span className="wd-sell-price" title={`每份 ${price} 金`}><Icon name="coin" s={1} /><b>{price}</b></span>
          <span className="wd-sell-res">
            {list.map((opts, index) => (
              <span key={index} className={opts.length > 1 ? "wd-res-choice" : "wd-res-one"}>
                {[...opts].map((letter, k) => (
                  <Icon key={k} name={`res-${letter as Resource}`} s={opts.length > 1 ? 1 : s} />
                ))}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 7 种颜色的卡各几张。 */
export function ColorCounts({ player, big = false }: { player: PlayerState; big?: boolean }) {
  return (
    <div className={big ? "wd-colors big" : "wd-colors"}>
      {CARD_COLORS.map((color) => {
        const count = colorCount(player, color);
        return (
          <span key={color} className={count === 0 ? "zero" : ""} style={{ "--c": COLOR_HEX[color][0] } as CSSProperties}>
            <i />{count}
          </span>
        );
      })}
    </div>
  );
}

export function ScienceCounts({ player }: { player: PlayerState }) {
  const counts = scienceCounts(player);
  return (
    <div className="wd-sci" title="科技符号：每种张数的平方相加，每凑齐三种各一张再加 7 分">
      <span><Icon name="sci-compass" s={2} /><b>{counts.compass}</b></span>
      <span><Icon name="sci-gear" s={2} /><b>{counts.gear}</b></span>
      <span><Icon name="sci-tablet" s={2} /><b>{counts.tablet}</b></span>
      {counts.wild > 0 && <span><Icon name="sci-any" s={2} /><b>{counts.wild}</b></span>}
    </div>
  );
}

export function LastPlay({ last, label = "上轮" }: { last: RevealedPlay | undefined; label?: string }) {
  if (!last) return null;
  return <p className={`wd-last ${last.action}`} title={playText(last)}><em>{label}</em>{playText(last)}</p>;
}

function Head({ seat, game, children }: { seat: SeatInfo; game: GameState; children?: ReactNode }) {
  const { player } = seat;
  return (
    <div className="wd-head">
      {player.wonder ? <img className="wd-emblem" src={art.emblem(player.wonder)} alt="" width={32} height={32} /> : <span className="wd-emblem blank" />}
      <strong title={player.name}>{seat.you ? "你" : player.name}</strong>
      <PlayerTags member={seat.member} you={false} />
      {children}
      <ReadyMark game={game} player={player} />
    </div>
  );
}

/** 左右邻居的大面板。 */
export function NeighborPanel({ seat, me, side, game, wonderN, passTo, onOpen, shine, tutorial }: {
  seat: SeatInfo;
  me: PlayerState;
  side: Side;
  game: GameState;
  wonderN: 1 | 2;
  /** 手牌这个时代传给他（否则是从他那里来）。 */
  passTo: boolean;
  onOpen: () => void;
  shine?: number;
  tutorial?: string;
}) {
  const { player } = seat;
  return (
    <section className={`wd-panel wd-neighbor wd-seat ${side}`} style={seatVar(player.wonder)} data-tutorial={tutorial}>
      <button type="button" className="wd-open" onClick={onOpen} aria-label={`看 ${player.name} 的城池`} />
      <div className="wd-nb-label">
        <span>{side === "left" ? "左邻" : "右邻"}</span>
        <em className={passTo ? "to" : "from"}>{passTo ? "手牌传给他" : "手牌从他来"}</em>
      </div>
      <Head seat={seat} game={game} />
      <PlayerBoard player={player} n={wonderN} {...(shine !== undefined ? { shine } : {})} />
      <StatLine seat={seat} tutorial={tutorial ? `${tutorial}-stats` : undefined} />
      <div className="wd-nb-sell" data-tutorial={tutorial ? `${tutorial}-sell` : undefined}>
        <div className="wd-nb-sub"><span>卖给你</span><small>每份几金</small></div>
        <SellList me={me} neighbor={player} side={side} s={2} />
      </div>
      <ColorCounts player={player} />
      <ScienceCounts player={player} />
      <LastPlay last={seat.last} />
    </section>
  );
}

/** 不相邻的其他玩家：一张小卡。 */
export function OtherCard({ seat, game, emblemN, onOpen }: { seat: SeatInfo; game: GameState; emblemN: 1 | 2; onOpen: () => void }) {
  const { player } = seat;
  const stagesTotal = player.wonder ? wonderStages(player.wonder, player.side).length : 0;
  return (
    <button type="button" className="wd-panel wd-other wd-seat" style={seatVar(player.wonder)} onClick={onOpen} title={`看 ${player.name} 的城池`}>
      {player.wonder ? <img className="wd-emblem" src={art.emblem(player.wonder)} alt="" width={32 * emblemN} height={32 * emblemN} /> : <span className="wd-emblem blank" />}
      <span className="wd-other-main">
        <span className="wd-other-name">
          <strong>{player.name}</strong>
          <PlayerTags member={seat.member} you={false} />
          {player.wonder && <small className="wd-other-wonder">{WONDER_SHORT[player.wonder]}{player.side === "B" ? " B" : ""} · {player.stages}{stagesTotal ? `/${stagesTotal}` : ""} 层</small>}
        </span>
        <StatLine seat={seat} items={["coin", "shield", "vp"]} />
      </span>
      <ReadyMark game={game} player={player} />
    </button>
  );
}

/** 手机：上面一排小签。 */
export function OtherTag({ seat, game, onOpen }: { seat: SeatInfo; game: GameState; onOpen: () => void }) {
  const { player } = seat;
  return (
    <button type="button" className="wd-tagcard wd-seat" style={seatVar(player.wonder)} onClick={onOpen} title={player.name}>
      {player.wonder ? <img className="wd-emblem" src={art.emblem(player.wonder)} alt="" width={32} height={32} /> : <span className="wd-emblem blank" />}
      <b>{seat.score}</b>
      <ReadyMark game={game} player={player} />
    </button>
  );
}

/** 手机：半宽的邻居面板。 */
export function MobileNeighbor({ seat, me, side, game, passTo, onOpen }: { seat: SeatInfo; me: PlayerState; side: Side; game: GameState; passTo: boolean; onOpen: () => void }) {
  const { player } = seat;
  return (
    <button type="button" className={`wd-panel wd-mnb wd-seat ${side}`} style={seatVar(player.wonder)} onClick={onOpen}>
      <span className="wd-mnb-head">
        <em className={passTo ? "to" : "from"}>{side === "left" ? "◀左邻" : "右邻▶"}</em>
        {player.wonder ? <img className="wd-emblem" src={art.emblem(player.wonder)} alt="" width={32} height={32} /> : <span className="wd-emblem blank" />}
        <strong>{player.name}</strong>
        <ReadyMark game={game} player={player} />
      </span>
      <StatLine seat={seat} items={["coin", "shield"]} />
      <SellList me={me} neighbor={player} side={side} s={1} />
    </button>
  );
}
