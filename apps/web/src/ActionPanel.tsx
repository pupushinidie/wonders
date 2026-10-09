/**
 * 出牌面板：现在该做什么（轮到你 / 已出牌等谁 / 某某正在结算 / 托管中），选中一张手牌后列出三种用法：
 * 建造、建奇迹下一层、弃掉换 3 金。每行写好付款：自产的绿勾、向邻居买的黄底带价格、买不起的红叉、免费链金色。
 * 有几种付款方案时可以切换（默认最便宜的）。点那一行的按钮就交了；交了以后可以撤回，直到所有人都交了。
 */
import type { ReactNode } from "react";
import {
  canCover,
  card,
  productionSlots,
  wonderStages,
  type CardId,
  type CardPlayOptions,
  type GameCommand,
  type GameState,
  type PaymentInfo,
  type PaymentOption,
  type PlayAction,
  type PlayerState,
  type Resource,
} from "@wonders/game";
import { Icon } from "./Card.js";
import { cardText, effectText, paymentText, res, shortName } from "./text.js";

/** 一种用法的付款拆分：自产 / 向左买 / 向右买 / 还要买（没定从哪买）/ 凑不齐。 */
interface PayParts {
  own: string;
  left: string;
  right: string;
  need: string;
  missing: string;
}

function minus(cost: string, ...parts: string[]): string {
  const list = [...cost];
  for (const part of parts) for (const letter of part) {
    const at = list.indexOf(letter);
    if (at >= 0) list.splice(at, 1);
  }
  return list.join("");
}

/** 付不起时：自己最多能产哪几份，剩下的邻居有没有卖。 */
function impossibleParts(game: GameState, meIndex: number, cost: string): PayParts {
  const me = game.players[meIndex]!;
  const slots = productionSlots(me).map((slot) => slot.opts);
  const letters = [...cost];
  let own = "";
  for (let size = letters.length; size > 0 && !own; size -= 1) {
    for (let mask = 0; mask < 1 << letters.length; mask += 1) {
      let bits = 0;
      for (let m = mask; m; m >>= 1) bits += m & 1;
      if (bits !== size) continue;
      const pick = letters.filter((_, index) => mask & (1 << index)).join("");
      if (canCover(pick, slots)) { own = pick; break; }
    }
  }
  const rest = minus(cost, own);
  const n = game.players.length;
  const sellers = [game.players[(meIndex + 1) % n]!, game.players[(meIndex - 1 + n) % n]!];
  const sold = new Set(sellers.flatMap((player) => productionSlots(player).filter((slot) => slot.sellable).flatMap((slot) => [...slot.opts])));
  return {
    own,
    left: "",
    right: "",
    need: [...rest].filter((letter) => sold.has(letter)).join(""),
    missing: [...rest].filter((letter) => !sold.has(letter)).join(""),
  };
}

function partsOf(game: GameState, meIndex: number, cost: string, option: PaymentOption | undefined): PayParts {
  if (!option) return impossibleParts(game, meIndex, cost);
  return { own: minus(cost, option.left, option.right), left: option.left, right: option.right, need: "", missing: "" };
}

function ResIcons({ letters, s }: { letters: string; s: number }) {
  return <>{[...letters].map((letter, index) => <Icon key={index} name={`res-${letter as Resource}`} s={s} />)}</>;
}

function PayChips({ parts, option, bank, s }: { parts: PayParts; option: PaymentOption | undefined; bank: number; s: number }) {
  return (
    <span className="wd-chips">
      {parts.own && <span className="wd-chip own" title={`自己产：${res(parts.own)}`}><ResIcons letters={parts.own} s={s} /><i className="ok">✓</i></span>}
      {parts.left && <span className="wd-chip buy" title={`向左邻买 ${res(parts.left)}，付 ${option?.leftCost} 金`}><i className="dir">◀</i><ResIcons letters={parts.left} s={s} /><b>{option?.leftCost}</b></span>}
      {parts.right && <span className="wd-chip buy" title={`向右邻买 ${res(parts.right)}，付 ${option?.rightCost} 金`}><ResIcons letters={parts.right} s={s} /><b>{option?.rightCost}</b><i className="dir">▶</i></span>}
      {parts.need && <span className="wd-chip need" title={`要向邻居买：${res(parts.need)}（钱不够）`}><ResIcons letters={parts.need} s={s} /><i className="need-mark">买</i></span>}
      {parts.missing && <span className="wd-chip miss" title={`买不到：${res(parts.missing)}`}><ResIcons letters={parts.missing} s={s} /><i className="no">✗</i></span>}
      {bank > 0 && <span className="wd-chip bank" title={`付银行 ${bank} 金`}><Icon name="coin" s={s} /><b>{bank}</b></span>}
    </span>
  );
}

export function commandFor(cardId: CardId, action: PlayAction, option: PaymentOption | undefined): GameCommand {
  if (action === "discard" || !option || option.kind === "chain") return { type: "PLAY", card: cardId, action };
  if (option.kind === "olympia") return { type: "PLAY", card: cardId, action, olympia: true };
  return { type: "PLAY", card: cardId, action, trade: { left: option.left, right: option.right } };
}

function shortReason(info: PaymentInfo): string {
  const reason = info.reason ?? "";
  if (reason.startsWith("已经建过")) return "已有同名";
  if (reason.startsWith("钱不够")) return "钱不够";
  if (reason.startsWith("奇迹已经建满")) return "已建满";
  return "凑不齐";
}

function ActionRow({ action, label, info, cost, bank, game, meIndex, choice, onChoice, onPlay, disabled, extra, iconS, tutorial }: {
  action: "build" | "wonder";
  label: string;
  info: PaymentInfo;
  cost: string;
  bank: number;
  game: GameState;
  meIndex: number;
  choice: number;
  onChoice: (index: number) => void;
  onPlay: (option: PaymentOption | undefined) => void;
  disabled: boolean;
  extra?: ReactNode;
  iconS: number;
  tutorial: string;
}) {
  const options = info.options;
  const option = options[Math.min(choice, options.length - 1)];
  const ok = options.length > 0;
  const parts = option?.kind === "chain" || option?.kind === "olympia" ? null : partsOf(game, meIndex, cost, option);
  const total = option?.total ?? 0;
  return (
    <div className={ok ? `wd-act-row ${action}` : `wd-act-row ${action} no`} data-tutorial={tutorial}>
      <button
        type="button"
        className={ok ? "primary-button wd-act-btn" : "quiet-button wd-act-btn"}
        disabled={!ok || disabled}
        onClick={() => onPlay(option)}
        title={ok ? `${label}：${paymentText(option!)}` : info.reason ?? ""}
      >
        <Icon name={action === "build" ? "act-build" : "act-wonder"} s={2} />{label}
      </button>
      <span className="wd-act-pay">
        {extra}
        {option?.kind === "chain" ? (
          <span className="wd-chip chain"><Icon name="chain" s={iconS} />免费链</span>
        ) : option?.kind === "olympia" ? (
          <span className="wd-chip chain"><Icon name="eff-free-build" s={iconS} />宙斯免费</span>
        ) : parts && (cost || bank) ? (
          <PayChips parts={parts} option={option} bank={bank} s={iconS} />
        ) : (
          <span className="wd-chip own">免费<i className="ok">✓</i></span>
        )}
      </span>
      <span className="wd-act-total" title={ok ? paymentText(option!) : info.reason ?? ""}>
        {ok ? (total > 0 ? <><Icon name="coin" s={1} /><b>{total}</b></> : <b className="free">免费</b>) : <em>{shortReason(info)}</em>}
        {options.length > 1 && (
          <span className="wd-switch">
            <button type="button" aria-label="上一种付款方案" onClick={() => onChoice((choice + options.length - 1) % options.length)}>‹</button>
            <small>{Math.min(choice, options.length - 1) + 1}/{options.length}</small>
            <button type="button" aria-label="下一种付款方案" onClick={() => onChoice((choice + 1) % options.length)}>›</button>
          </span>
        )}
      </span>
    </div>
  );
}

export interface ActionPanelProps {
  readonly game: GameState;
  readonly me: PlayerState;
  readonly meIndex: number;
  readonly options: readonly CardPlayOptions[];
  readonly selected: CardId | null;
  readonly onSelect: (id: CardId | null) => void;
  readonly onCommand: (command: GameCommand) => void;
  readonly busy: boolean;
  readonly autoPlaying: boolean;
  readonly onAuto: (enabled: boolean) => void;
  readonly spectating: boolean;
  readonly spectateBar: ReactNode;
  readonly nameOf: (id: string) => string;
  readonly feedback: ReactNode;
  readonly mobile: boolean;
  readonly iconS: number;
  readonly onOpenDiscard: () => void;
  readonly onOpenWonders: () => void;
  readonly onOpenFinal: () => void;
  readonly passName: string;
  /** 建造 / 建奇迹各选了第几种付款方案（键盘出牌也用它）。 */
  readonly choice: { readonly build: number; readonly wonder: number };
  readonly onChoice: (choice: { build: number; wonder: number }) => void;
  readonly className?: string;
}

export function ActionPanel(props: ActionPanelProps) {
  const { game, me, meIndex, options, selected, onSelect, onCommand, busy, autoPlaying, onAuto, spectating, nameOf, feedback, mobile, iconS } = props;
  const { choice, onChoice: setChoice } = props;
  const pendingOthers = game.players.filter((player) => !player.submitted);
  const phase = game.phase;
  const myTurnToPlay = !spectating && ((phase === "play" && !me.submitted) || (phase === "seventh" && game.pending?.player === me.id));
  const pendingName = game.pending ? nameOf(game.pending.player) : "";

  let title = "";
  let sub: ReactNode = null;
  let body: ReactNode = null;
  let mode = "status";

  if (spectating) {
    title = phase === "finished" ? "游戏结束" : phase === "wonders" ? "自选奇迹中" : phase === "play" ? `大家在选牌 · 已出 ${game.players.length - pendingOthers.length}/${game.players.length}` : `${pendingName} 正在结算`;
    body = props.spectateBar;
  } else if (phase === "finished") {
    title = "游戏结束";
    sub = "七项分数加起来最高的城赢。";
    body = <button type="button" className="primary-button wd-wide" onClick={props.onOpenFinal}>看结算</button>;
  } else if (autoPlaying) {
    mode = "auto";
    title = "托管中";
    sub = "人机正在替你出牌。点下面的按钮马上拿回来。";
    body = <button type="button" className="primary-button wd-wide" data-tutorial="cancel-auto" onClick={() => onAuto(false)}>取消托管</button>;
  } else if (phase === "wonders") {
    const chooser = game.players[game.chooseOrder[game.chooser] ?? -1];
    const mine = chooser?.id === me.id;
    title = mine ? "轮到你挑奇迹" : `等 ${chooser ? nameOf(chooser.id) : ""} 挑奇迹`;
    sub = "按座位轮流挑奇迹和 A/B 面，挑完发时代 I 的牌。";
    body = <button type="button" className={mine ? "primary-button wd-wide" : "quiet-button wd-wide"} onClick={props.onOpenWonders}>{mine ? "挑奇迹" : "看大家挑了什么"}</button>;
  } else if (phase === "discardBuild") {
    const mine = game.pending?.player === me.id;
    title = mine ? "哈利卡纳苏斯：从弃牌堆免费建一张" : `${pendingName} 正在从弃牌堆挑一张`;
    sub = mine ? "弃牌堆只有你看得到；同名建过的不能建，也可以放弃。" : "哈利卡纳苏斯的奇迹能力，挑完继续。";
    if (mine) body = <button type="button" className="primary-button wd-wide" onClick={props.onOpenDiscard}>打开弃牌堆</button>;
  } else if (phase === "seventh" && game.pending?.player !== me.id) {
    title = `${pendingName} 正在打第 7 张`;
    sub = "巴比伦的奇迹能力：第 6 轮最后那张也能打出。打完结算军事。";
  } else if (phase === "play" && me.submitted) {
    mode = "sent";
    const play = me.play;
    const waiting = pendingOthers.map((player) => nameOf(player.id));
    title = waiting.length > 0 ? `已出牌 · 等 ${waiting.length} 人` : "已出牌";
    sub = waiting.length > 0 ? `还在想：${waiting.join("、")}` : "马上亮牌";
    body = (
      <div className="wd-sent" data-tutorial="submitted">
        {play && (
          <p className="wd-sent-what">
            <b>{play.action === "build" ? `建造 ${card(play.card).zh}` : play.action === "wonder" ? `用 ${shortName(play.card)} 建奇迹第 ${me.stages + 1} 层` : `弃掉 ${shortName(play.card)} 换 3 金`}</b>
            {play.payment && <small>{paymentText(play.payment)}</small>}
          </p>
        )}
        <button type="button" className="quiet-button" data-tutorial="undo" disabled={busy} onClick={() => onCommand({ type: "UNDO" })}>撤回{mobile ? "" : "（U）"}</button>
      </div>
    );
  } else if (myTurnToPlay && selected && options.some((entry) => entry.card === selected)) {
    mode = "act";
    const entry = options.find((candidate) => candidate.card === selected)!;
    const def = card(selected);
    const stages = me.wonder ? wonderStages(me.wonder, me.side) : [];
    const nextStage = stages[me.stages];
    const play = (action: PlayAction, option: PaymentOption | undefined) => {
      onCommand(commandFor(selected, action, option));
      onSelect(null);
    };
    title = def.zh;
    sub = cardText(selected);
    body = (
      <div className="wd-act-rows">
        <ActionRow
          action="build" label="建造" info={entry.build} cost={def.cost} bank={def.coin} game={game} meIndex={meIndex}
          choice={choice.build} onChoice={(index) => setChoice({ ...choice, build: index })}
          onPlay={(option) => play("build", option)} disabled={busy} iconS={iconS} tutorial="act-build"
        />
        <ActionRow
          action="wonder" label="建奇迹" info={entry.wonder} cost={nextStage?.cost ?? ""} bank={0} game={game} meIndex={meIndex}
          choice={choice.wonder} onChoice={(index) => setChoice({ ...choice, wonder: index })}
          onPlay={(option) => play("wonder", option)} disabled={busy} iconS={iconS} tutorial="act-wonder"
          extra={nextStage ? <small className="wd-stage-no" title={nextStage.effects.map(effectText).join("，")}>第{me.stages + 1}层</small> : null}
        />
        <div className="wd-act-row discard" data-tutorial="act-discard">
          <button type="button" className="quiet-button wd-act-btn" disabled={busy} onClick={() => play("discard", undefined)} title="弃掉这张，从银行拿 3 金">
            <Icon name="act-sell" s={2} />弃掉
          </button>
          <span className="wd-act-pay"><span className="wd-chip gain"><Icon name="coin" s={iconS} /><b>+3</b></span></span>
          <span className="wd-act-total" />
        </div>
      </div>
    );
  } else if (myTurnToPlay) {
    title = phase === "seventh" ? "巴比伦：打出第 7 张" : game.round === 6 ? "第 6 轮：打一张，另一张作废" : "轮到你：选一张手牌";
    sub = mobile
      ? "点手牌看三种用法。大家都选好后一起亮牌。"
      : `点一张手牌（或按 1–${me.hand.length}）看三种用法。大家都选好后一起亮牌，剩下的传给${props.passName}。`;
  } else {
    title = "等一下";
  }

  return (
    <section className={`wd-panel wd-act mode-${mode} ${props.className ?? ""}`} data-tutorial="action-panel">
      <div className="wd-act-head">
        <div>
          <h2 data-tutorial="prompt">{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {mode === "act" && <button type="button" className="quiet-button wd-act-close" onClick={() => onSelect(null)} title="取消选择（Esc）">取消</button>}
      </div>
      {body}
      {feedback}
      {!spectating && phase !== "finished" && !autoPlaying && mode !== "act" && (
        <div className="wd-act-foot">
          {!mobile && mode !== "sent" && myTurnToPlay && <small>键盘：1–7 选牌 · B 建造 · W 建奇迹 · D 弃掉 · Esc 取消</small>}
          <button type="button" className="quiet-button wd-auto-btn" data-tutorial="auto" onClick={() => onAuto(true)}>托管</button>
        </div>
      )}
    </section>
  );
}
