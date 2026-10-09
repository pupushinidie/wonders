/**
 * 弹窗：完整城池（任何玩家）、自选奇迹、哈利卡纳苏斯挑弃牌；城池 7 色分列的组件也在这里（牌桌和弹窗共用）。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  card,
  CARD_COLORS,
  COLOR_NAMES,
  discardBuildOptions,
  productionSlots,
  scoreBreakdown,
  WONDER_KEYS,
  wonder as wonderDef,
  wonderStages,
  type CardColor,
  type CardId,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type PlayerState,
  type Resource,
  type ScoreBreakdown,
  type WonderKey,
  type WonderSide,
} from "@wonders/game";
import { art } from "./art.js";
import { CardItem, CityStrip, Icon } from "./Card.js";
import { ColorCounts, PlayerTags, ScienceCounts, StatLine, type SeatInfo } from "./Players.js";
import { COLOR_HEX, effectText, resCount } from "./text.js";
import { PlayerBoard, WonderBoard } from "./Wonder.js";

export function Modal({ title, onClose, children, className = "", wide = false, tutorial, footer }: {
  title: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  /** 固定在弹窗底部的按钮（列表再长也看得见）。 */
  footer?: ReactNode;
  className?: string;
  wide?: boolean;
  tutorial?: string;
}) {
  useEffect(() => {
    if (!onClose) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="gm-modal-backdrop wd-backdrop" role="presentation" onMouseDown={(event) => { if (onClose && event.target === event.currentTarget) onClose(); }}>
      <section className={`gm-panel wd-dialog ${wide ? "wide" : ""} ${className}`} role="dialog" aria-modal="true" data-tutorial={tutorial}>
        <header className="wd-dialog-head">
          <h2>{title}</h2>
          {onClose && <button type="button" className="quiet-button" onClick={onClose}>关闭</button>}
        </header>
        <div className="wd-dialog-body">{children}</div>
        {footer && <footer className="wd-dialog-foot">{footer}</footer>}
      </section>
    </div>
  );
}

/** 城池：7 种颜色各一列，同色叠成一列只露卡名。capacity 给了就每列最多显示那么多条，多的写「还有 N 张」。 */
export function City({ player, capacity, fresh, tutorial, style }: {
  player: PlayerState;
  capacity?: number;
  fresh?: ReadonlySet<CardId>;
  tutorial?: string;
  style?: CSSProperties;
}) {
  const byColor = new Map<CardColor, CardId[]>(CARD_COLORS.map((color) => [color, []]));
  for (const id of player.built) byColor.get(card(id).color)!.push(id);
  return (
    <div className="wd-city" data-tutorial={tutorial} style={style}>
      {CARD_COLORS.map((color) => {
        const list = byColor.get(color)!;
        const cut = capacity !== undefined && list.length > capacity ? capacity - 1 : list.length;
        return (
          <div key={color} className={list.length === 0 ? "wd-city-col empty" : "wd-city-col"} style={{ "--c": COLOR_HEX[color][0] } as CSSProperties}>
            <h4 title={COLOR_NAMES[color]}><Icon name={`cat-${color}`} s={1} /><span>{COLOR_NAMES[color]}</span><b>{list.length}</b></h4>
            <ul>
              {list.slice(0, cut).map((id) => <CityStrip key={id} id={id} fresh={fresh?.has(id) ?? false} />)}
              {cut < list.length && <li className="wd-strip more">还有 {list.length - cut} 张</li>}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** 七项分数（军事、金币、奇迹、文明、科技、商业、行会）。 */
export const SCORE_ITEMS = [
  { key: "military", label: "军事", icon: "cat-red" },
  { key: "coins", label: "金币", icon: "coin" },
  { key: "wonder", label: "奇迹", icon: "stage-built" },
  { key: "civilian", label: "文明", icon: "cat-blue" },
  { key: "science", label: "科技", icon: "cat-green" },
  { key: "commerce", label: "商业", icon: "cat-yellow" },
  { key: "guilds", label: "行会", icon: "cat-purple" },
] as const;

export function ScoreRow({ score }: { score: ScoreBreakdown }) {
  return (
    <div className="wd-score-row">
      {SCORE_ITEMS.map((item) => (
        <span key={item.key} title={item.label}>
          <Icon name={item.icon} s={2} /><small>{item.label}</small><b>{score[item.key]}</b>
        </span>
      ))}
      <span className="total" title="合计"><Icon name="vp" s={2} /><small>合计</small><b>{score.total}</b></span>
    </div>
  );
}

export function Production({ player }: { player: PlayerState }) {
  const slots = productionSlots(player);
  return (
    <div className="wd-prod">
      {slots.length === 0 ? <span className="wd-muted">还没有资源</span> : slots.map((slot, index) => (
        <span key={index} className={[slot.opts.length > 1 ? "choice" : "", slot.sellable ? "" : "private"].join(" ")} title={slot.sellable ? "" : "这份邻居买不到"}>
          {[...slot.opts].map((letter, k) => <Icon key={k} name={`res-${letter as Resource}`} s={slot.opts.length > 2 ? 1 : 2} />)}
        </span>
      ))}
    </div>
  );
}

/** 任何玩家的完整城池和奇迹板。 */
export function PlayerDialog({ seat, game, onClose }: { seat: SeatInfo; game: GameState; onClose: () => void }) {
  const { player } = seat;
  const score = scoreBreakdown(game, player.id);
  const big = window.innerWidth >= 1200 && window.innerHeight >= 700;
  return (
    <Modal
      title={<span className="wd-dialog-title">{player.wonder && <img src={art.emblem(player.wonder)} alt="" width={32} height={32} />}{seat.you ? "你的城池" : `${player.name} 的城池`}<PlayerTags member={seat.member} you={false} /></span>}
      onClose={onClose}
      wide
      className="wd-player-dialog"
      tutorial="player-dialog"
    >
      <div className="wd-pd-top">
        <PlayerBoard player={player} n={big ? 2 : 1} detail />
        <div className="wd-pd-info">
          <StatLine seat={seat} />
          <div className="wd-pd-line"><em>产出</em><Production player={player} /></div>
          <div className="wd-pd-line"><em>科技</em><ScienceCounts player={player} /></div>
          <div className="wd-pd-line"><em>军事标记</em>
            <span className="wd-tokens">
              {player.tokens.length === 0 ? <span className="wd-muted">还没有</span> : player.tokens.map((token, index) => (
                <img key={index} src={art.token(token.value)} alt={String(token.value)} title={`时代 ${token.age} 和${token.vs === "left" ? "左邻" : "右邻"}比：${token.value > 0 ? "+" : ""}${token.value}`} width={32} height={32} />
              ))}
            </span>
          </div>
          <div className="wd-pd-line"><em>手牌</em><span>{player.handCount} 张</span></div>
        </div>
      </div>
      <h3 className="wd-pd-sub">现在的分数（局中实时）</h3>
      <ScoreRow score={score} />
      <h3 className="wd-pd-sub">城池 · {player.built.length} 张 <ColorCounts player={player} /></h3>
      <City player={player} />
    </Modal>
  );
}

/** 自选奇迹：左边 7 块，右边选中那块的 A / B 两面。 */
export function ChooseWonderDialog({ game, me, members, nameOf, onCommand, onClose, busy }: {
  game: GameState;
  me: string;
  members: readonly LobbyMember[];
  nameOf: (id: string) => string;
  onCommand: (command: GameCommand) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const takenBy = new Map<WonderKey, PlayerState>();
  for (const player of game.players) if (player.wonder) takenBy.set(player.wonder, player);
  const firstFree = WONDER_KEYS.find((key) => !takenBy.has(key)) ?? "giza";
  const [pick, setPick] = useState<WonderKey>(firstFree);
  const chooser = game.players[game.chooseOrder[game.chooser] ?? -1];
  const mine = chooser?.id === me;
  void members;
  const big = window.innerWidth >= 1200 && window.innerHeight >= 700;
  const narrow = window.innerWidth < 720;
  const [showSide, setShowSide] = useState<WonderSide>("A");
  const choose = (side: WonderSide) => onCommand({ type: "CHOOSE_WONDER", wonder: pick, side });
  const taken = takenBy.get(pick);
  return (
    <Modal title={mine ? "轮到你挑奇迹" : `等 ${chooser ? nameOf(chooser.id) : ""} 挑奇迹`} onClose={onClose} wide className="wd-choose" tutorial="choose-wonder">
      <div className="wd-choose-body">
        <ol className="wd-choose-list">
          {WONDER_KEYS.map((key) => {
            const owner = takenBy.get(key);
            return (
              <li key={key}>
                <button type="button" className={[pick === key ? "on" : "", owner ? "taken" : ""].join(" ")} onClick={() => setPick(key)}>
                  <img src={art.emblem(key)} alt="" width={32} height={32} />
                  <span>{wonderDef(key).zh}</span>
                  {owner && <small>{nameOf(owner.id)} · {owner.side} 面</small>}
                </button>
              </li>
            );
          })}
        </ol>
        {narrow ? (
          <div className="wd-choose-side">
            <div className="wd-side-tabs" role="tablist">
              {(["A", "B"] as const).map((side) => (
                <button key={side} type="button" role="tab" aria-selected={showSide === side} className={showSide === side ? "on" : ""} onClick={() => setShowSide(side)}>{side} 面</button>
              ))}
            </div>
            <WonderBoard wonder={pick} side={showSide} stages={0} n={1} />
            <ol className="wd-stage-list">
              {wonderStages(pick, showSide).map((stage, index) => (
                <li key={index}><b>第 {index + 1} 层</b> {resCount(stage.cost)} → {stage.effects.map(effectText).join("，")}</li>
              ))}
            </ol>
            {mine && <button type="button" className="primary-button" disabled={busy || Boolean(taken)} onClick={() => choose(showSide)}>{taken ? "已被挑走" : `选 ${showSide} 面`}</button>}
          </div>
        ) : (
        <div className="wd-choose-sides">
          {(["A", "B"] as const).map((side) => (
            <div key={side} className="wd-choose-side">
              <WonderBoard wonder={pick} side={side} stages={0} n={big ? 2 : 1} detail />
              {mine && <button type="button" className="primary-button" disabled={busy || Boolean(taken)} onClick={() => choose(side)}>{taken ? "已被挑走" : `选 ${side} 面`}</button>}
            </div>
          ))}
        </div>
        )}
      </div>
      <p className="wd-muted">A 面简单（推荐新手），B 面花样多。奇迹板左上角的资源是起始资源，开局就有，邻居也能买。</p>
    </Modal>
  );
}

/** 哈利卡纳苏斯：从弃牌堆挑一张免费建（弃牌堆只有他看得到）。 */
export function DiscardDialog({ game, me, onCommand, onClose, busy }: {
  game: GameState;
  me: string;
  onCommand: (command: GameCommand) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const buildable = new Set(discardBuildOptions(game, me));
  const [pick, setPick] = useState<CardId | null>(null);
  const list = [...game.discard].sort((a, b) => Number(buildable.has(b)) - Number(buildable.has(a)) || card(a).age - card(b).age);
  return (
    <Modal
      title="从弃牌堆免费建一张"
      onClose={onClose}
      wide
      className="wd-discard"
      tutorial="discard-dialog"
      footer={
        <>
          <button type="button" className="quiet-button" disabled={busy} onClick={() => onCommand({ type: "DISCARD_BUILD", card: null })}>放弃</button>
          <button type="button" className="primary-button" disabled={busy || !pick} onClick={() => pick && onCommand({ type: "DISCARD_BUILD", card: pick })}>
            {pick ? `免费建 ${card(pick).zh}` : "先点一张"}
          </button>
        </>
      }
    >
      <p className="wd-muted">哈利卡纳苏斯的奇迹能力：挑一张，不付任何费用直接建。灰掉的是你已经有同名的。</p>
      <div className="wd-discard-grid">
        {list.map((id, index) => (
          <CardItem
            key={`${id}-${index}`}
            id={id}
            selected={pick === id}
            {...(buildable.has(id) ? { onClick: () => setPick(id) } : { status: { kind: "dup" as const, text: "已有同名" } })}
            sub={`时代 ${"I".repeat(card(id).age)}`}
          />
        ))}
        {list.length === 0 && <p className="wd-muted">弃牌堆是空的。</p>}
      </div>
    </Modal>
  );
}
