/**
 * 卡牌：手牌卡面（代码画框 + 56×44 插画，原始网格 64×96，整卡 ×N）、列表项（手机手牌、弃牌堆）、城池卡名条。
 * 卡框、色带、名字和效果都是 CSS / DOM（spec §3.1），图只有插画、小点和图标。
 */
import type { CSSProperties, ReactNode } from "react";
import { card, type CardEffect, type CardId, type PaymentInfo, type Resource, type Scope, type StageEffect } from "@wonders/game";
import { art, type IconName } from "./art.js";
import { cardText, COLOR_HEX, shortName } from "./text.js";

/** 一张图标（16×16 原图 × s）。 */
export function Icon({ name, s = 1, flip = false, title }: { name: IconName; s?: number; flip?: boolean; title?: string }) {
  return (
    <img
      className={flip ? "wd-icon flip" : "wd-icon"}
      src={art.icon(name)}
      alt={title ?? ""}
      title={title}
      width={16 * s}
      height={16 * s}
      draggable={false}
    />
  );
}

/** 卡色变量（色带主色 / 亮 / 暗）。 */
export function colorVars(id: CardId): CSSProperties {
  const [main, hi, lo] = COLOR_HEX[card(id).color];
  return { "--band": main, "--band-hi": hi, "--band-lo": lo } as CSSProperties;
}

/** 成本小点（8×8 × n）：资源一份一个，银行金币一枚一个；7 个以上描边重叠 1 原图像素（spec §6）。 */
export function CostPips({ cost, coin = 0, n }: { cost: string; coin?: number; n: number }) {
  const items: string[] = [...Array.from({ length: coin }, () => "coin"), ...cost];
  if (items.length === 0) return null;
  const tight = items.length >= 7;
  return (
    <span className={tight ? "wd-pips tight" : "wd-pips"} style={{ "--pn": n } as CSSProperties}>
      {items.map((item, index) => (
        <img key={index} src={art.pip(item as Resource | "coin")} alt="" width={8 * n} height={8 * n} draggable={false} />
      ))}
    </span>
  );
}

function ScopeMark({ scope }: { scope: readonly Scope[] }) {
  return (
    <span className="wd-scope" title={scope.map((entry) => (entry === "left" ? "左邻" : entry === "right" ? "右邻" : "自己")).join("、")}>
      {scope.includes("left") && <i className="l" />}
      {scope.includes("self") && <i className="s" />}
      {scope.includes("right") && <i className="r" />}
    </span>
  );
}

/** 效果的图标版（卡面下半、阶段格）：s = 图标倍数；数字用 .wd-num（字号由外面定）。 */
export function EffectIcons({ effect, s }: { effect: CardEffect | StageEffect; s: number }) {
  const small = Math.max(1, s - 1);
  switch (effect.type) {
    case "produce":
      return <>{[...effect.res].map((letter, index) => <Icon key={index} name={`res-${letter as Resource}`} s={s} />)}</>;
    case "produceChoice":
      if (effect.options.length === 2) {
        return <><Icon name={`res-${effect.options[0] as Resource}`} s={s} /><span className="wd-slash">/</span><Icon name={`res-${effect.options[1] as Resource}`} s={s} /></>;
      }
      return <Icon name={effect.options.includes("G") ? "eff-any-goods" : "eff-any-raw"} s={s} />;
    case "vp":
      return <><Icon name="vp" s={s} /><b className="wd-num">{effect.n}</b></>;
    case "shields":
      return <>{Array.from({ length: effect.n }, (_, index) => <Icon key={index} name="shield" s={s} />)}</>;
    case "science":
      return <Icon name={effect.symbol === "any" ? "sci-any" : `sci-${effect.symbol}`} s={s} />;
    case "coins":
      return <><Icon name="coin" s={s} /><b className="wd-num">{effect.n}</b></>;
    case "tradeDiscount":
      return (
        <>
          {effect.from.length === 2 ? <Icon name="trade" s={s} /> : <Icon name="trade-left" s={s} flip={effect.from[0] === "right"} />}
          <Icon name={effect.res === "GLP" ? "eff-any-goods" : "eff-any-raw"} s={small} />
          <Icon name="coin" s={small} /><b className="wd-num">1</b>
        </>
      );
    case "perCount": {
      const what = effect.what[0]!;
      const whatIcon: IconName = what === "defeat" ? "cat-red" : what === "stage" ? "stage-built" : `cat-${what}`;
      return (
        <>
          {effect.coinsNow ? <><Icon name="coin" s={small} /><b className="wd-num">{effect.coinsNow}</b></> : null}
          {effect.vpEnd ? <><Icon name="vp" s={small} /><b className="wd-num">{effect.vpEnd}</b></> : null}
          <span className="wd-slash">/</span>
          {effect.what.length > 1 ? effect.what.map((entry) => <Icon key={entry} name={`cat-${entry as "brown"}`} s={small} />) : <Icon name={whatIcon} s={small} />}
          {what === "defeat" && <img className="wd-icon" src={art.token(-1)} alt="" width={16 * small} height={16 * small} />}
          <ScopeMark scope={effect.scope} />
        </>
      );
    }
    case "playSeventhCard":
      return <Icon name="eff-seventh" s={s} />;
    case "freeBuildOncePerAge":
      return <Icon name="eff-free-build" s={s} />;
    case "buildFromDiscard":
      return <Icon name="eff-discard-build" s={s} />;
    case "copyGuild":
      return <Icon name="eff-copy-guild" s={s} />;
    default:
      return null;
  }
}

/** 手牌上的角标：这张牌现在能不能建、怎么付。 */
export interface CardStatus {
  readonly kind: "own" | "trade" | "chain" | "olympia" | "no" | "dup";
  readonly text: string;
}

export function buildStatus(info: PaymentInfo, id?: CardId): CardStatus {
  const option = info.options[0];
  if (!option) {
    if (info.reason?.startsWith("已经建过")) return { kind: "dup", text: "已有同名" };
    if (info.reason?.startsWith("钱不够")) return { kind: "no", text: "钱不够" };
    return { kind: "no", text: "缺资源" };
  }
  if (option.kind === "chain") return { kind: "chain", text: "免费链" };
  if (option.kind === "olympia") return { kind: "olympia", text: "宙斯免费" };
  if (option.total === 0) return { kind: "own", text: id && !card(id).cost && !card(id).coin ? "免费" : "自产" };
  if (option.leftCost + option.rightCost === 0) return { kind: "own", text: `付${option.bankCost}金` };
  return { kind: "trade", text: `买${option.total}金` };
}

/** 手牌卡面（64×96 × n）。 */
export function CardFace({ id, n, status, selected = false, submitted = false, onClick, tutorial, index }: {
  id: CardId;
  n: number;
  status?: CardStatus;
  selected?: boolean;
  submitted?: boolean;
  onClick?: () => void;
  tutorial?: string;
  index?: number;
}) {
  const def = card(id);
  const dim = status && (status.kind === "no" || status.kind === "dup");
  const chainable = status?.kind === "chain";
  const className = ["wd-card", dim ? "dim" : "", selected ? "selected" : "", submitted ? "submitted" : "", onClick ? "clickable" : ""].join(" ");
  const style = { ...colorVars(id), "--n": n } as CSSProperties;
  const body: ReactNode = (
    <>
      <span className="wd-card-band">
        <CostPips cost={def.cost} coin={def.coin} n={n} />
        {def.chainFrom.length > 0 && <img className={chainable ? "wd-card-chain on" : "wd-card-chain"} src={art.pip("chain")} alt="" width={8 * n} height={8 * n} />}
      </span>
      <img className="wd-card-art" src={art.cardArt(id)} alt="" width={56 * n} height={44 * n} draggable={false} />
      <span className="wd-card-name">{shortName(id)}</span>
      <span className="wd-card-eff"><EffectIcons effect={def.effect} s={n >= 3 ? 2 : n === 2 ? 2 : 1} /></span>
      {status && <span className={`wd-card-status ${status.kind}`}>{status.text}</span>}
      {submitted && <span className="wd-card-status sent">已出</span>}
      {index !== undefined && n >= 2 && <kbd className="wd-card-key">{index + 1}</kbd>}
    </>
  );
  const title = `${def.zh}：${cardText(id)}`;
  return onClick ? (
    <button type="button" className={className} style={style} onClick={onClick} title={title} aria-pressed={selected} data-tutorial={tutorial}>
      {body}
    </button>
  ) : (
    <div className={className} style={style} title={title} data-tutorial={tutorial}>{body}</div>
  );
}

/** 列表项：左边 56×44 插画（×1），右边卡名和状态（手机手牌、弃牌堆、详情）。 */
export function CardItem({ id, status, selected = false, submitted = false, onClick, sub, tutorial }: {
  id: CardId;
  status?: CardStatus;
  selected?: boolean;
  submitted?: boolean;
  onClick?: () => void;
  sub?: ReactNode;
  tutorial?: string;
}) {
  const dim = status && (status.kind === "no" || status.kind === "dup");
  const className = ["wd-item", dim ? "dim" : "", selected ? "selected" : "", submitted ? "submitted" : ""].join(" ");
  const def = card(id);
  const body = (
    <>
      <img className="wd-item-art" src={art.cardArt(id)} alt="" width={56} height={44} draggable={false} />
      <span className="wd-item-text">
        <span className="wd-item-name">{shortName(id)}</span>
        {submitted ? <span className="wd-item-status sent">已出</span> : status ? <span className={`wd-item-status ${status.kind}`}>{status.text}</span> : sub ? <span className="wd-item-sub">{sub}</span> : null}
      </span>
    </>
  );
  const title = `${def.zh}：${cardText(id)}`;
  return onClick ? (
    <button type="button" className={className} style={colorVars(id)} onClick={onClick} title={title} aria-pressed={selected} data-tutorial={tutorial}>{body}</button>
  ) : (
    <div className={className} style={colorVars(id)} title={title} data-tutorial={tutorial}>{body}</div>
  );
}

/** 城池里的卡名条：左边卡色色块，右边纸色底 + 卡名。 */
export function CityStrip({ id, fresh = false }: { id: CardId; fresh?: boolean }) {
  return (
    <li className={fresh ? "wd-strip fresh" : "wd-strip"} style={colorVars(id)} title={`${card(id).zh}：${cardText(id)}`}>
      <i />
      <span>{shortName(id)}</span>
    </li>
  );
}
