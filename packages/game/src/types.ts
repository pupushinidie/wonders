/** 6 种地形：麦田、森林、湖泊、草地、沼泽、矿山。 */
export const TERRAINS = ["W", "F", "L", "G", "S", "M"] as const;
export type Terrain = (typeof TERRAINS)[number];

export const TERRAIN_NAMES: Record<Terrain, string> = {
  W: "麦田",
  F: "森林",
  L: "湖泊",
  G: "草地",
  S: "沼泽",
  M: "矿山",
};

/** 骨牌的一端：地形 + 皇冠数。 */
export interface Half {
  readonly t: Terrain;
  readonly c: number;
}

/** 一张骨牌：编号 1–48，A 端、B 端（放置时可以任意旋转）。 */
export interface Domino {
  readonly n: number;
  readonly a: Half;
  readonly b: Half;
}

/** 王国里的坐标，城堡在 (0, 0)；行号往下增大，列号往右增大。 */
export interface Pos {
  readonly r: number;
  readonly c: number;
}

/** 一次放置：骨牌 A 端、B 端各放在哪一格（两格上下或左右相邻）。 */
export interface Placement {
  readonly a: Pos;
  readonly b: Pos;
}

/** 王国里的一格。城堡 t = "castle"、d = 0；地形格记下来自哪张骨牌。 */
export interface Cell {
  readonly t: Terrain | "castle";
  readonly c: number;
  readonly d: number;
}

/** 王国：键是 "r,c"。 */
export type Kingdom = Record<string, Cell>;

/** 城堡和国王的颜色（按座位顺序分配）。 */
export const PLAYER_COLORS = ["pink", "yellow", "green", "blue"] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];
export const PLAYER_COLOR_NAMES: Record<PlayerColor, string> = { pink: "粉", yellow: "黄", green: "绿", blue: "蓝" };

export interface Config {
  readonly playerCount: number;
  /** 王国边长：5（默认）或 7（2 人「强力对决」）。 */
  readonly size: 5 | 7;
  /** 2 人「强力对决」：48 张全用、7×7。 */
  readonly mighty: boolean;
  /** 中央王国：终局时城堡在王国正中心 +10。 */
  readonly middleKingdom: boolean;
  /** 和谐：王国拼满且整局没弃过骨牌 +5。 */
  readonly harmony: boolean;
  /** 每人几个国王：2 人局 2 个，3–4 人 1 个。 */
  readonly kingsPerPlayer: 1 | 2;
  /** 选牌、放置的时限（秒）；超时自动行动。 */
  readonly pickTimeoutSec: number;
  readonly placeTimeoutSec: number;
}

/** 开房时可以选的变体。 */
export interface GameOptions {
  readonly middleKingdom: boolean;
  readonly harmony: boolean;
  /** 只在 2 人局生效。 */
  readonly mighty: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { middleKingdom: false, harmony: false, mighty: false };

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly color: PlayerColor;
  kingdom: Kingdom;
  /** 弃掉的骨牌编号。 */
  discarded: number[];
  /** 对局中是区域分（不含奖励）；终局后是总分。 */
  score: number;
}

/** 一个国王：属于第几位玩家（players 下标），2 人局里是这位玩家的第几个国王。 */
export interface King {
  readonly player: number;
  readonly idx: 0 | 1;
}

/** 一排里的一张骨牌。 */
export interface Slot {
  readonly n: number;
  king: King | null;
  /** 当前排：这张骨牌已经放进王国（或弃掉）了。 */
  resolved: boolean;
  /** 当前排：提前放好、等轮到时生效的放法。别人看到的是 "hidden"。 */
  pre: Placement | "hidden" | null;
}

export type GameCommand =
  | { readonly type: "PICK"; readonly slot: number }
  | { readonly type: "PLACE"; readonly a: Pos; readonly b: Pos }
  | { readonly type: "DISCARD" }
  | { readonly type: "CANCEL_PRE" };

/** 一片同地形连通区域。 */
export interface Region {
  readonly t: Terrain;
  readonly cells: Pos[];
  readonly crowns: number;
  readonly points: number;
}

export interface ScoreBreakdown {
  readonly player: string;
  readonly regions: Region[];
  /** 所有区域得分之和。 */
  readonly base: number;
  readonly middle: number;
  readonly harmony: number;
  readonly total: number;
  /** 最大的单个区域格数（不管有没有皇冠），平局比较第一项。 */
  readonly largest: number;
  /** 王国里的皇冠总数，平局比较第二项。 */
  readonly crowns: number;
}

export interface FinalResult {
  readonly scores: ScoreBreakdown[];
  readonly winners: string[];
}

export type GameEvent =
  | { readonly type: "Picked"; readonly player: string; readonly n: number; readonly auto: boolean }
  | {
      readonly type: "Placed";
      readonly player: string;
      readonly n: number;
      readonly a: Pos;
      readonly b: Pos;
      /** 提前放好、轮到时生效的。 */
      readonly pre: boolean;
      readonly scoreBefore: number;
      readonly scoreAfter: number;
    }
  | { readonly type: "Discarded"; readonly player: string; readonly n: number }
  /** 3 人局每排没人选的那张弃掉。 */
  | { readonly type: "LeftoverRemoved"; readonly n: number }
  | { readonly type: "RoundStarted"; readonly round: number; readonly last: boolean; readonly revealed: number[] }
  | { readonly type: "GameEnded"; readonly result: FinalResult }
  | { readonly type: "TurnTimedOut"; readonly player: string };

export interface GameState {
  readonly config: Config;
  /** picking：开局选第一排；playing：正常回合；finished：结束。 */
  phase: "picking" | "playing" | "finished";
  players: Player[];
  /** 正在行动的玩家（players 下标）；结束后是 −1。 */
  currentPlayer: number;
  /** 正在行动的国王在当前排的位置（picking 阶段是在 pickOrder 里的位置）。 */
  active: number;
  /** playing 阶段：这个国王在放置还是选牌。picking 阶段一直是 pick。 */
  step: "place" | "pick";
  /** 开局选牌的顺序。 */
  pickOrder: King[];
  /** 当前排（国王站在上面、等着放进王国），按编号升序。picking 阶段是第一排。 */
  current: Slot[];
  /** 新排（等着被选），按编号升序；最后一轮为空。 */
  next: Slot[];
  /** 第几轮放置，从 1 开始；picking 阶段是 0。 */
  round: number;
  /** 一共几轮放置。 */
  totalRounds: number;
  /** 每换一个行动的国王或步骤 +1，用作回合计时的键（提前放置不改它）。 */
  turn: number;
  /** 3 人局每排弃掉的剩牌（公开）。 */
  removed: number[];
  events: GameEvent[];
  finalResult?: FinalResult;
  version: number;
  /** 以下只在服务端：牌堆顺序、2 人默认局移出的 24 张、种子、随机数状态、动作序列。发给客户端前清空。 */
  deck: number[];
  setAside: number[];
  seed?: number;
  rngState?: number;
  log?: { player: string; command: GameCommand | { type: "TIMEOUT" } }[];
  /** 仅客户端视角：牌堆和移出的张数。 */
  deckCount?: number;
  setAsideCount?: number;
}
