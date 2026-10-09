/**
 * 七大奇迹的类型（对外接口）。界面、人机、教程、验收都按这里的字段读状态、发命令。
 *
 * 资源字母：W 木、C 砖、S 石、O 矿（原料）；G 玻璃、L 布、P 纸（制成品）。
 * 座位圆环：players 按「从上往下看顺时针」排列，左邻 = (i + 1) % n，右邻 = (i - 1 + n) % n（补充 §1.3）。
 */

export const RESOURCES = ["W", "C", "S", "O", "G", "L", "P"] as const;
export type Resource = (typeof RESOURCES)[number];
/** 原料（棕卡）。 */
export const RAW_RESOURCES: readonly Resource[] = ["W", "C", "S", "O"];
/** 制成品（灰卡）。 */
export const MANUFACTURED_RESOURCES: readonly Resource[] = ["G", "L", "P"];
export const RESOURCE_NAMES: Record<Resource, string> = { W: "木", C: "砖", S: "石", O: "矿", G: "玻璃", L: "布", P: "纸" };

export type Age = 1 | 2 | 3;
export type CardColor = "brown" | "gray" | "blue" | "yellow" | "red" | "green" | "purple";
export const CARD_COLORS: readonly CardColor[] = ["brown", "gray", "blue", "yellow", "red", "green", "purple"];
export const COLOR_NAMES: Record<CardColor, string> = {
  brown: "原料",
  gray: "制成品",
  blue: "文明",
  yellow: "商业",
  red: "军事",
  green: "科技",
  purple: "行会",
};

/** 科技符号：圆规、齿轮、石板。 */
export type ScienceSymbol = "compass" | "gear" | "tablet";
export const SCIENCE_SYMBOLS: readonly ScienceSymbol[] = ["compass", "gear", "tablet"];
export const SCIENCE_NAMES: Record<ScienceSymbol, string> = { compass: "圆规", gear: "齿轮", tablet: "石板" };

export type Side = "left" | "right";
export type Scope = "left" | "self" | "right";
/** perCount 数什么：卡的颜色、败仗标记（defeat）、已建奇迹阶段（stage）。 */
export type CountWhat = CardColor | "defeat" | "stage";

/** 卡牌效果（data/cards.json 的 effect 字段，原样）。 */
export type CardEffect =
  | { readonly type: "produce"; readonly res: string; readonly sellable: boolean }
  | { readonly type: "produceChoice"; readonly options: string; readonly sellable: boolean }
  | { readonly type: "vp"; readonly n: number }
  | { readonly type: "shields"; readonly n: number }
  | { readonly type: "science"; readonly symbol: ScienceSymbol | "any" }
  | { readonly type: "coins"; readonly n: number }
  | { readonly type: "tradeDiscount"; readonly res: string; readonly from: readonly Side[] }
  | {
      readonly type: "perCount";
      readonly what: readonly CountWhat[];
      readonly scope: readonly Scope[];
      /** 建成那一刻每个给几金。 */
      readonly coinsNow?: number;
      /** 终局每个给几分。 */
      readonly vpEnd?: number;
    };

/** 卡牌 id，例如 "a1_lumber_yard_3p"；行会没有人数后缀，例如 "a3_spies_guild"。一张实体卡一个 id。 */
export type CardId = string;

/** 一张实体卡（data/cards.json 的一行，148 张）。 */
export interface CardDef {
  readonly id: CardId;
  readonly age: Age;
  readonly color: CardColor;
  /** 英文名（第一版拼写），同名判断、免费链都按它。 */
  readonly name: string;
  readonly zh: string;
  /** 资源成本，重复字母 = 多份，空串 = 不要资源。 */
  readonly cost: string;
  /** 付给银行的金币。 */
  readonly coin: number;
  /** 建过其中任意一张（英文名）就能免费建。 */
  readonly chainFrom: readonly string[];
  readonly chainTo: readonly string[];
  /** 人数标记 3–7；行会是 null。 */
  readonly minPlayers: number | null;
  readonly guild: boolean;
  readonly effect: CardEffect;
}

/** 奇迹阶段的效果。 */
export type StageEffect =
  | CardEffect
  /** 巴比伦 B2：每个时代可以打第 7 张牌。 */
  | { readonly type: "playSeventhCard" }
  /** 奥林匹亚 A2：每个时代免费建 1 张手牌。 */
  | { readonly type: "freeBuildOncePerAge" }
  /** 哈利卡纳苏斯：建成那一轮结束时从弃牌堆免费建 1 张。 */
  | { readonly type: "buildFromDiscard" }
  /** 奥林匹亚 B3：终局复制一位邻居的 1 张行会。 */
  | { readonly type: "copyGuild" };

export interface WonderStageDef {
  readonly cost: string;
  readonly effects: readonly StageEffect[];
}

export const WONDER_KEYS = ["giza", "rhodes", "alexandria", "ephesus", "babylon", "olympia", "halicarnassus"] as const;
export type WonderKey = (typeof WONDER_KEYS)[number];
export type WonderSide = "A" | "B";

/** 一块奇迹板（data/wonders.json 的一行）。 */
export interface WonderDef {
  readonly key: WonderKey;
  readonly name: string;
  readonly zh: string;
  /** 起始资源（能卖给邻居）。 */
  readonly start: Resource;
  readonly sides: Readonly<Record<WonderSide, readonly WonderStageDef[]>>;
}

/** 开房选项（房主在等候房间里可以改，room:settings）。 */
export interface GameOptions {
  /** 随机 A/B 面；关着时全员 A 面（默认）。 */
  readonly randomSides: boolean;
  /** 自选奇迹：开局前按座位顺序轮流挑奇迹和面；关着时随机分（默认）。 */
  readonly chooseWonders: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { randomSides: false, chooseWonders: false };

export interface Config {
  readonly playerCount: number;
  readonly randomSides: boolean;
  readonly chooseWonders: boolean;
  /** 每轮出牌的时限（秒）。 */
  readonly roundSec: number;
  /** 插入选择（巴比伦第 7 张、哈利卡纳苏斯挑弃牌）的时限（秒）。 */
  readonly choiceSec: number;
  /** 自选奇迹每人的时限（秒）。 */
  readonly wonderPickSec: number;
}

/** 三种用法：建这张卡 / 垫到奇迹下建下一阶段 / 弃掉换 3 金。 */
export type PlayAction = "build" | "wonder" | "discard";

/** 向左右邻居买的资源（字母串，比如 left: "WW" = 向左邻买 2 木）。 */
export interface Trade {
  readonly left: string;
  readonly right: string;
}

/**
 * 一种付款方案。
 * - own：自己产的资源就够（可能要付卡上的金币给银行）；
 * - trade：要向邻居买；
 * - chain：免费链（建过链来源），不付资源也不付金币；
 * - olympia：用奥林匹亚 A 面阶段 2 的「每时代免费建 1 张」。
 */
export interface PaymentOption {
  readonly kind: "own" | "trade" | "chain" | "olympia";
  /** 向左邻买的资源（按 WCSOGLP 排好序的字母串），没有就是 ""。 */
  readonly left: string;
  readonly right: string;
  /** 付给左邻 / 右邻 / 银行的金币。 */
  readonly leftCost: number;
  readonly rightCost: number;
  readonly bankCost: number;
  readonly total: number;
  /** 默认方案：最便宜的那个（一样便宜时少付左邻、多向右邻买，U10）；奥林匹亚免费只在没有别的方案时才是默认。 */
  readonly isDefault: boolean;
}

/** paymentOptions 的结果：能付就列出所有方案（默认方案排第一，其余按总价从低到高），不能付就说明原因。 */
export interface PaymentInfo {
  readonly options: readonly PaymentOption[];
  /** options 为空时的原因（「已经建过同名的」「缺资源」「钱不够」……），否则 null。 */
  readonly reason: string | null;
}

/** 付款目标：建某张卡，或者建奇迹的下一个阶段（垫哪张牌不影响成本）。 */
export type PayTarget = { readonly card: CardId } | { readonly stage: true };

/** 手里一张牌三种用法各自能不能做（界面用）。 */
export interface CardPlayOptions {
  readonly card: CardId;
  readonly build: PaymentInfo;
  readonly wonder: PaymentInfo;
  /** 弃牌换 3 金永远可以。 */
  readonly discard: true;
}

/** 已提交（还没亮）的一手：只有本人看得到。payment 是引擎补全后的付款方案，弃牌时为 null。 */
export interface PlannedPlay {
  readonly card: CardId;
  readonly action: PlayAction;
  readonly payment: PaymentOption | null;
}

/** 军事标记：+1 / +3 / +5（胜）或 −1（败），和哪一边的邻居比出来的。 */
export interface MilitaryToken {
  readonly age: Age;
  readonly value: number;
  readonly vs: Side;
}

export interface PlayerState {
  readonly id: string;
  readonly name: string;
  /** 自选奇迹阶段还没挑的人是 null。 */
  wonder: WonderKey | null;
  side: WonderSide;
  /** 已建的奇迹阶段数（公开）。 */
  stages: number;
  /** 垫在奇迹下面的牌：只有本人（和「观战看全部」）看得到，别人是 []。 */
  stageCards: CardId[];
  /** 已建成的建筑，按建造先后（公开）。 */
  built: CardId[];
  coins: number;
  tokens: MilitaryToken[];
  /** 手牌：只有本人看得到，别人是 []，张数看 handCount。 */
  hand: CardId[];
  handCount: number;
  /** 这一轮交了没有（公开）。 */
  submitted: boolean;
  /** 交了什么：只有本人看得到，别人是 null。 */
  play: PlannedPlay | null;
  /** 奥林匹亚 A 的免费建造这个时代用过了。 */
  freeBuildUsed: boolean;
}

/**
 * 阶段：
 * - wonders：自选奇迹，按 chooseOrder 轮流挑（只有开了自选才有）；
 * - play：所有人同时出牌（交了可以撤回，全交齐立刻结算）；
 * - seventh：巴比伦 B 打第 7 张牌（只等 pending.player）；
 * - discardBuild：哈利卡纳苏斯从弃牌堆挑一张免费建（只等 pending.player）；
 * - finished：终局。
 */
export type Phase = "wonders" | "play" | "seventh" | "discardBuild" | "finished";

export interface PendingChoice {
  readonly type: "seventh" | "discardBuild";
  readonly player: string;
}

/** 亮牌后公开的一手（事件里用）。card：建造的牌公开；垫奇迹、弃牌的牌只有本人看得到，别人是 null。 */
export interface RevealedPlay {
  readonly player: string;
  readonly action: PlayAction;
  readonly card: CardId | null;
  /** 付款方式（自己产 / 买 / 免费链 / 奥林匹亚免费）；弃牌时为 null。 */
  readonly via: PaymentOption["kind"] | null;
  /** 建奇迹时建成的是第几阶段（1 起）。 */
  readonly stage?: number;
  /** 向左右邻居买了什么。 */
  readonly bought: Trade;
  /** 付给左邻 / 右邻 / 银行的金币。 */
  readonly paidLeft: number;
  readonly paidRight: number;
  readonly paidBank: number;
  /** 这一手直接拿到的金币（弃牌 3、酒馆 5、葡萄园、奇迹阶段……，不含卖资源的收入）。 */
  readonly gained: number;
  /** 本轮卖资源给邻居收到的金币合计。 */
  readonly income: number;
}

export type GameEvent =
  | { readonly type: "WondersAssigned"; readonly assignments: readonly { player: string; wonder: WonderKey; side: WonderSide }[] }
  | { readonly type: "WonderChosen"; readonly player: string; readonly wonder: WonderKey; readonly side: WonderSide }
  | { readonly type: "AgeStarted"; readonly age: Age; readonly direction: Side }
  | { readonly type: "RoundStarted"; readonly age: Age; readonly round: number }
  | { readonly type: "Submitted"; readonly player: string }
  | { readonly type: "Withdrawn"; readonly player: string }
  /** 本轮所有人同时亮牌、结算完。 */
  | { readonly type: "Revealed"; readonly age: Age; readonly round: number; readonly plays: readonly RevealedPlay[] }
  | { readonly type: "SeventhPending"; readonly player: string }
  | { readonly type: "SeventhPlayed"; readonly play: RevealedPlay }
  /** 时代最后一轮剩下的牌作废进弃牌堆（不给钱）。 */
  | { readonly type: "CardsBurned"; readonly players: readonly string[] }
  | { readonly type: "DiscardBuildPending"; readonly player: string; readonly options: number }
  /** 哈利卡纳苏斯从弃牌堆免费建了一张（card 为 null：放弃或者没有能建的）。 */
  | { readonly type: "BuiltFromDiscard"; readonly player: string; readonly card: CardId | null; readonly gained: number }
  | { readonly type: "HandsPassed"; readonly direction: Side }
  | {
      readonly type: "MilitaryResolved";
      readonly age: Age;
      /** left / right：和左邻、右邻比出来的标记（+1/+3/+5、−1，平局 0）。 */
      readonly results: readonly { player: string; shields: number; left: number; right: number }[];
    }
  | { readonly type: "GameEnded"; readonly result: FinalResult }
  | { readonly type: "TurnTimedOut"; readonly player: string };

export type GameCommand =
  /** 出牌：牌 + 用法 + 买资源方案。trade 不给就用默认方案；olympia: true 用奥林匹亚的免费建造。play 阶段已交过的要先 UNDO。巴比伦第 7 张也用它。 */
  | { readonly type: "PLAY"; readonly card: CardId; readonly action: PlayAction; readonly trade?: Trade; readonly olympia?: boolean }
  /** 撤回这一轮交的牌（所有人交齐之前）。 */
  | { readonly type: "UNDO" }
  /** 自选奇迹：轮到自己时挑一块还没人挑的奇迹和面。 */
  | { readonly type: "CHOOSE_WONDER"; readonly wonder: WonderKey; readonly side: WonderSide }
  /** 哈利卡纳苏斯：从弃牌堆挑一张免费建；card 为 null 是放弃。 */
  | { readonly type: "DISCARD_BUILD"; readonly card: CardId | null };

/** 科技计分明细：各符号张数、任选符号个数、最优分配后的张数。 */
export interface ScienceDetail {
  readonly compass: number;
  readonly gear: number;
  readonly tablet: number;
  readonly wild: number;
  /** 任选符号最优分配之后的三种张数。 */
  readonly best: { readonly compass: number; readonly gear: number; readonly tablet: number };
}

/** 一位玩家的分数明细，七项分开。 */
export interface ScoreBreakdown {
  readonly player: string;
  readonly military: number;
  readonly coins: number;
  readonly wonder: number;
  readonly civilian: number;
  readonly science: number;
  readonly commerce: number;
  readonly guilds: number;
  readonly total: number;
  /** 手里的金币（平局比较用）。 */
  readonly coinsHeld: number;
  readonly scienceDetail: ScienceDetail;
  /** 每张行会（含奥林匹亚 B 复制来的那张，copied: true）各得几分；科学家行会记 0（分数算进科技）。 */
  readonly guildDetail: readonly { card: CardId; points: number; copied: boolean }[];
  /** 奥林匹亚 B 复制了哪张邻居的行会（自动取最优），没有就是 null。 */
  readonly copiedGuild: CardId | null;
  /** 名次：1 起，总分和金币都一样的并列同名次。 */
  readonly rank: number;
}

export interface FinalResult {
  /** 按座位顺序。 */
  readonly scores: readonly ScoreBreakdown[];
  /** 赢家（可以并列）。 */
  readonly winners: readonly string[];
}

export type LogEntry = {
  readonly player: string;
  readonly command: GameCommand;
  /** 超时（或离线代打）由服务器替他出的。 */
  readonly timeout?: true;
};

export interface GameState {
  readonly config: Config;
  phase: Phase;
  /** 按座位顺序（顺时针）。 */
  players: PlayerState[];
  age: Age;
  /** 本时代第几轮（1–6）；自选奇迹阶段是 0。 */
  round: number;
  /** 本时代传牌方向：Age I、III 传左邻，Age II 传右邻。 */
  direction: Side;
  /** 计时的键：换轮、换阶段、换人挑奇迹时 +1；别人交牌、撤回不变。 */
  step: number;
  /** 插入选择（巴比伦第 7 张、哈利卡纳苏斯挑弃牌）在等谁。 */
  pending: PendingChoice | null;
  /** 巴比伦打第 7 张的时候，哈利卡纳苏斯是否还在后面等着挑弃牌（player id）。 */
  discardBuildDue: string | null;
  /** 自选奇迹的顺序（players 下标）和现在轮到第几个。 */
  chooseOrder: number[];
  chooser: number;
  /** 弃牌堆：只有哈利卡纳苏斯挑牌那一步发给他本人（和「观战看全部」），别人是 []，张数看 discardCount。 */
  discard: CardId[];
  discardCount: number;
  /** 上一次亮牌的结果（公开部分），界面显示「这一轮谁做了什么」。 */
  lastReveal: RevealedPlay[];
  /** 这一步产生的事件。 */
  events: GameEvent[];
  finalResult?: FinalResult;
  /** 每次 apply +1；界面看它变没变来触发动画。 */
  version: number;
  /** 以下只在服务端（发给客户端前删掉）：种子、随机数状态、动作序列、预先指定的后面时代的手牌（教程用）。 */
  seed?: number;
  rngState?: number;
  log?: LogEntry[];
  stacked?: Partial<Record<Age, CardId[][]>>;
}
