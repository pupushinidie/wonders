/**
 * 给玩家看的文字：卡名（卡面上的短名）、效果的一句话说明、奇迹名、事件记录。全部用自己的话。
 */
import {
  card,
  CARDS,
  COLOR_NAMES,
  RESOURCE_NAMES,
  SCIENCE_NAMES,
  type CardColor,
  type CardEffect,
  type CardId,
  type CountWhat,
  type GameEvent,
  type PaymentOption,
  type Resource,
  type Scope,
  type StageEffect,
  type WonderKey,
} from "@wonders/game";

/** 卡面上的短名：行会去掉「行会」二字（紫色本身就说明是行会，最长 3 个字），详情和终局写全名。 */
export function shortName(id: CardId): string {
  const def = card(id);
  return def.color === "purple" ? def.zh.replace(/行会$/, "") : def.zh;
}

/** 奇迹的短名（面板标题、小卡用）。 */
export const WONDER_SHORT: Record<WonderKey, string> = {
  giza: "金字塔",
  rhodes: "巨像",
  alexandria: "灯塔",
  ephesus: "神庙",
  babylon: "空中花园",
  olympia: "宙斯像",
  halicarnassus: "陵墓",
};

/** 七种卡色：主色、亮、暗（spec §1）。 */
export const COLOR_HEX: Record<CardColor, readonly [string, string, string]> = {
  brown: ["#8c582c", "#b07a44", "#5e3a1c"],
  gray: ["#8a8c92", "#b4b6bc", "#5c5e64"],
  blue: ["#346cd4", "#5e92ee", "#22489a"],
  green: ["#349c4c", "#5cc070", "#22693a"],
  yellow: ["#e2b834", "#f4d66a", "#a88420"],
  red: ["#c83a30", "#e86a5c", "#8a2620"],
  purple: ["#7c48b2", "#a276d4", "#54307c"],
};

export const res = (letters: string) => [...letters].map((letter) => RESOURCE_NAMES[letter as Resource] ?? letter).join("");
/** 「木木石」→「2 木 + 1 石」。 */
export function resCount(letters: string): string {
  const counts = new Map<string, number>();
  for (const letter of letters) counts.set(letter, (counts.get(letter) ?? 0) + 1);
  return [...counts].map(([letter, count]) => `${count} ${RESOURCE_NAMES[letter as Resource] ?? letter}`).join(" + ");
}
const choice = (options: string) => [...options].map((letter) => RESOURCE_NAMES[letter as Resource]).join(" / ");

const WHAT_NAMES: Record<CountWhat, string> = {
  ...(Object.fromEntries(Object.entries(COLOR_NAMES).map(([color, name]) => [color, `${name}卡`])) as Record<CardColor, string>),
  defeat: "败仗标记",
  stage: "已建的奇迹层",
};
function scopeText(scope: readonly Scope[]): string {
  const left = scope.includes("left");
  const right = scope.includes("right");
  const self = scope.includes("self");
  if (left && right && self) return "两邻和自己";
  if (left && right) return "两邻";
  if (self) return "自己";
  return left ? "左邻" : "右邻";
}

/** 效果的一句话说明。 */
export function effectText(effect: CardEffect | StageEffect): string {
  switch (effect.type) {
    case "produce":
      return `每轮产出 ${resCount(effect.res)}${effect.sellable ? "" : "（邻居买不到）"}`;
    case "produceChoice":
      return `每轮产出 ${choice(effect.options)} 任选一种${effect.sellable ? "" : "（邻居买不到）"}`;
    case "vp":
      return `${effect.n} 分`;
    case "shields":
      return `${effect.n} 盾`;
    case "science":
      return effect.symbol === "any" ? "终局任选一种科技符号" : `科技符号：${SCIENCE_NAMES[effect.symbol]}`;
    case "coins":
      return `建成时 +${effect.n} 金`;
    case "tradeDiscount": {
      const from = effect.from.length === 2 ? "两边邻居" : effect.from[0] === "left" ? "左邻" : "右邻";
      const kind = effect.res === "WCSO" ? "原料" : effect.res === "GLP" ? "制成品" : res(effect.res);
      return `向${from}买${kind}每份 1 金（下一轮起）`;
    }
    case "perCount": {
      const what = effect.what.map((entry) => WHAT_NAMES[entry]).join("、");
      const parts: string[] = [];
      if (effect.coinsNow) parts.push(`建成时${scopeText(effect.scope)}每张${what} +${effect.coinsNow} 金`.replace("每张已建的奇迹层", "每层奇迹").replace("每张败仗标记", "每个败仗标记"));
      if (effect.vpEnd) parts.push(`终局${scopeText(effect.scope)}每张${what} ${effect.vpEnd} 分`.replace("每张已建的奇迹层", "每层奇迹").replace("每张败仗标记", "每个败仗标记"));
      return parts.join("；");
    }
    case "playSeventhCard":
      return "每个时代第 6 轮，最后那张也能打出";
    case "freeBuildOncePerAge":
      return "每个时代可以免费建 1 张手牌";
    case "buildFromDiscard":
      return "建成那轮结束时，从弃牌堆免费建 1 张";
    case "copyGuild":
      return "终局复制左右邻居的 1 张行会";
    default:
      return "";
  }
}

/** 卡的完整说明：效果 + 免费链。 */
export function cardText(id: CardId): string {
  const def = card(id);
  const lines = [effectText(def.effect)];
  if (def.chainFrom.length > 0) {
    const from = def.chainFrom.map((name) => CARD_ZH.get(name) ?? name).join(" 或 ");
    lines.push(`建过${from}就免费`);
  }
  if (def.chainTo.length > 0) lines.push(`以后免费链出 ${def.chainTo.map((name) => CARD_ZH.get(name) ?? name).join("、")}`);
  return lines.join("。");
}

const CARD_ZH = new Map<string, string>();
for (const def of CARDS) CARD_ZH.set(def.name, def.zh);

/** 付款方案的一句话：「自产」「付右邻 2 金」「免费链」……（银行的钱单独写）。 */
export function paymentText(option: PaymentOption): string {
  if (option.kind === "chain") return "免费链";
  if (option.kind === "olympia") return "奥林匹亚免费建";
  const parts: string[] = [];
  if (option.left) parts.push(`向左邻买 ${res(option.left)} ${option.leftCost} 金`);
  if (option.right) parts.push(`向右邻买 ${res(option.right)} ${option.rightCost} 金`);
  if (option.bankCost) parts.push(`付银行 ${option.bankCost} 金`);
  return parts.length === 0 ? "自产，不花钱" : parts.join("，");
}

/** 动作记录：一条事件 → 一句话（null = 不记）。 */
export function describeEvent(event: GameEvent, name: (id: string) => string): string[] {
  switch (event.type) {
    case "WondersAssigned":
      return ["奇迹分好了，开始时代 I"];
    case "WonderChosen":
      return [`${name(event.player)} 选了 ${WONDER_SHORT[event.wonder]}（${event.side} 面）`];
    case "AgeStarted":
      return [`时代 ${"I".repeat(event.age)} 开始，打完传给${event.direction === "left" ? "左邻" : "右邻"}`];
    case "Revealed":
      return event.plays.map((play) => `${name(play.player)} ${playText(play)}`);
    case "SeventhPlayed":
      return [`${name(event.play.player)} 打出第 7 张：${playText(event.play)}`];
    case "CardsBurned":
      return ["第 6 轮剩下的牌作废"];
    case "DiscardBuildPending":
      return [`${name(event.player)} 正在从弃牌堆挑一张免费建`];
    case "BuiltFromDiscard":
      return [event.card ? `${name(event.player)} 从弃牌堆免费建了 ${card(event.card).zh}` : `${name(event.player)} 放弃从弃牌堆建`];
    case "MilitaryResolved":
      return [`时代 ${"I".repeat(event.age)} 军事结算`];
    case "GameEnded":
      return ["游戏结束"];
    case "TurnTimedOut":
      return [`${name(event.player)} 超时，人机替他出了`];
    default:
      return [];
  }
}

export function playText(play: { action: string; card: CardId | null; stage?: number; via: PaymentOption["kind"] | null; paidLeft: number; paidRight: number; gained: number }): string {
  const paid = play.paidLeft + play.paidRight;
  const extra = [paid > 0 ? `买资源 ${paid} 金` : "", play.via === "chain" ? "免费链" : "", play.via === "olympia" ? "奥林匹亚免费" : "", play.gained > 0 ? `+${play.gained} 金` : ""].filter(Boolean).join("，");
  const what =
    play.action === "build" ? `建了 ${play.card ? card(play.card).zh : "?"}` :
    play.action === "wonder" ? `建奇迹第 ${play.stage ?? "?"} 层` :
    "弃牌";
  return extra ? `${what}（${extra}）` : what;
}

export const ROMAN = ["", "I", "II", "III"] as const;
