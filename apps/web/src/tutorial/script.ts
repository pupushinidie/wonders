/**
 * 七大奇迹的新手教程剧本（补充文件 §4.3：3 人局，时代 I 完整一个时代 + 时代 II 第 1 轮，再快进到一局打完讲计分）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器。七大奇迹没有骰子：时代 I 的手牌在开局时摆好，
 * 时代 II 的手牌用 buildScene 的 stacked 预先排好，两位人机（咕噜一号、二号）按剧本出牌，
 * 所以每次教程都一样、每个教学点都一定出现。剧本走完接着把这局打完（练习局），对手交给人机。
 *
 * 每一步写三件事：咕噜嘎说什么（say / note）、高亮哪个元素（anchor 或 card，对应网页里的 data-tutorial）、
 * 等玩家做什么（do 步骤的 expect）。改了规则或界面，script.test.ts 会检查剧本还能不能从头走到尾。
 *
 * 和欲罢不能（轮流行动）不一样的地方：七大奇迹是所有人同时出牌，所以剧本里的一步是「谁 + 什么命令」（TutorialMove），
 * 命令里的牌写英文名（"Stone Pit"），走的时候换成那人手里的那张牌。
 */
import {
  apply,
  buildScene,
  card,
  createGame,
  isCardId,
  pendingActors,
  type GameCommand,
  type GameState,
  type PlayAction,
} from "@wonders/game";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

/** 剧本里的一步：谁做什么。牌可以写英文名（剧本里）或者牌 id（网页发来的）。 */
export interface TutorialMove {
  readonly player: string;
  readonly command: GameCommand;
}

interface StepBase {
  readonly id: string;
  /** 侧栏 / 记录里的「新手教程」进度这一课叫什么；没有就不单独列。 */
  readonly lesson?: string;
  /** 主句（24px），一句话说清这一步。 */
  readonly say: string;
  /** 补充说明（12px）。 */
  readonly note?: string;
  /** 触屏设备上换成这句说明。 */
  readonly noteTouch?: string;
  /**
   * 高亮哪个元素：网页里 data-tutorial 的值。写成数组时按顺序挑页面上有的第一个
   * （比如 ["my-info", "my-stats"]：1024 和手机上没有 my-info）。
   */
  readonly anchor?: string | readonly string[];
  /** 高亮手里的哪张牌（英文名）；do 步骤选中这张以后，高亮改成对应用法那一行。 */
  readonly card?: string;
  readonly face?: TutorialFace;
  /** 这一步牌桌换成「一局打完的样子」（讲终局计分），不是剧本里正在打的这局。 */
  readonly showcase?: boolean;
}

export type TutorialStep =
  /** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: TutorialMove })
  /** 人机按剧本自动出牌，牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly TutorialMove[] });

export const TUTORIAL_SELF = "p1";
/** 学员的左邻（座位 1，屏幕左边）。 */
export const TUTORIAL_LEFT = "p2";
/** 学员的右邻（座位 2，屏幕右边）。 */
export const TUTORIAL_RIGHT = "p3";
export const TUTORIAL_BOTS = [TUTORIAL_LEFT, TUTORIAL_RIGHT] as const;
export const TUTORIAL_NAMES = { [TUTORIAL_LEFT]: "咕噜一号", [TUTORIAL_RIGHT]: "咕噜二号" } as const;

const play = (player: string, cardName: string, action: PlayAction): TutorialMove => ({
  player,
  command: { type: "PLAY", card: cardName, action },
});
const mine = (cardName: string, action: PlayAction) => play(TUTORIAL_SELF, cardName, action);
const bots = (left: [string, PlayAction], right: [string, PlayAction]): TutorialMove[] => [
  play(TUTORIAL_LEFT, left[0], left[1]),
  play(TUTORIAL_RIGHT, right[0], right[1]),
];

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // ---------- 开场 ----------
  {
    kind: "info", id: "goal", lesson: "目标", face: "happy",
    say: "三个时代打完，七项分数加起来最高的城赢。",
    note: "分数来自军事、金币、奇迹、蓝卡、绿卡、黄卡、紫卡，终局自动算；我带你打完第一个时代。",
  },
  {
    kind: "info", id: "city", lesson: "你的城", anchor: ["my-wonder", "my-board"],
    say: "这是你的城：金字塔，它每轮自带产 1 石。",
    note: "奇迹板上有 3 层，以后可以一层一层建上去。",
  },
  {
    kind: "info", id: "neighbors", lesson: "两位邻居", anchor: "neighbor-left",
    say: "左边是左邻咕噜一号，右边是右邻咕噜二号。",
    note: "买资源、比军事，都只跟这两位邻居打交道。",
  },
  {
    kind: "info", id: "hand", lesson: "同时出牌", anchor: "hand",
    say: "这是你的 7 张手牌，每轮大家同时挑 1 张。",
    note: "没有「轮到谁」：所有人都选好以后一起亮牌。",
  },

  // ---------- 时代 I 第 1 轮：建造 ----------
  {
    kind: "watch", id: "r1-bots", anchor: "neighbor-left",
    say: "两位邻居正在挑牌……",
    moves: bots(["Clay Pool", "build"], ["Press", "build"]),
  },
  {
    kind: "info", id: "r1-wait", anchor: "submitted-count",
    say: "「已出 2/3」：两位邻居都选好了，就等你。",
    note: "他们出了什么，要等亮牌时才知道。",
  },
  {
    kind: "do", id: "r1-build", lesson: "建造", card: "Stone Pit", expect: mine("Stone Pit", "build"),
    say: "点手牌「采石坑」，再点「建造」。",
    note: "采石坑不要任何成本，建好后每轮多产 1 石。",
  },
  {
    kind: "info", id: "r1-city", lesson: "资源不会用掉", anchor: "my-city", face: "happy",
    say: "亮牌：采石坑进了你的城。",
    note: "资源不会用掉：自己产的石头每轮都能用，建多少次都行。",
  },
  {
    kind: "info", id: "pass", lesson: "传牌", anchor: "pass-arrow",
    say: "剩下的手牌传给了左邻，你接到了右邻传来的 6 张。",
    note: "时代 I 往左传、时代 II 往右传、时代 III 又往左，看顶上的箭头。",
  },

  // ---------- 第 2 轮：提交、撤回 ----------
  {
    kind: "do", id: "r2-build", card: "Baths", expect: mine("Baths", "build"),
    say: "这次你先出：建「浴场」。",
    note: "它要 1 石，你自己就产。",
  },
  {
    kind: "info", id: "r2-sent", anchor: "submitted",
    say: "交了：别人只看到你头上打了勾，看不到出的是什么。",
    note: "大家都交齐之前，还能反悔。",
  },
  {
    kind: "do", id: "r2-undo", lesson: "撤回", anchor: "undo", expect: { player: TUTORIAL_SELF, command: { type: "UNDO" } },
    say: "点「撤回」试试。",
  },
  {
    kind: "do", id: "r2-again", card: "Baths", expect: mine("Baths", "build"),
    say: "好，重新选「浴场」，点「建造」。",
  },
  {
    kind: "watch", id: "r2-bots", anchor: "submitted-count",
    say: "等两位邻居选好，就一起亮牌。",
    moves: bots(["Guard Tower", "build"], ["Timber Yard", "build"]),
  },
  {
    kind: "info", id: "r2-score", lesson: "蓝卡给分", anchor: "my-stats",
    say: "浴场是蓝卡，直接给 3 分。",
    note: "你的金币、盾和当前分数都在这一行。",
  },

  // ---------- 第 3 轮：向邻居买资源 ----------
  {
    kind: "watch", id: "r3-bots", anchor: "neighbor-right",
    say: "两位邻居又在挑牌……",
    moves: bots(["Lumber Yard", "build"], ["Clay Pit", "build"]),
  },
  {
    kind: "info", id: "r3-sell", lesson: "向邻居买", anchor: ["neighbor-right-sell", "neighbor-right"], face: "think",
    say: "「写字间」要 1 纸，你不产纸，但右邻有印刷所。",
    note: "缺的资源可以向左右邻居买，每份 2 金，钱付给邻居；隔一个座位的人买不到。",
  },
  {
    kind: "do", id: "r3-build", card: "Scriptorium", expect: mine("Scriptorium", "build"),
    say: "建「写字间」，向右邻买 1 纸，付 2 金。",
    note: "出牌面板会写清楚：哪些自己产、向谁买、一共付几金。",
  },
  {
    kind: "info", id: "r3-paid", lesson: "当轮的钱", anchor: ["neighbor-right-stats", "neighbor-right"],
    say: "你剩 1 金，那 2 金给了右邻咕噜二号。",
    note: "邻居这一轮刚收到的钱，要下一轮才能花。",
  },

  // ---------- 第 4 轮：建奇迹 ----------
  {
    kind: "watch", id: "r4-bots", anchor: "neighbor-left",
    say: "两位邻居在挑牌……",
    moves: bots(["Loom", "build"], ["Ore Vein", "build"]),
  },
  {
    kind: "info", id: "r4-wonder", lesson: "建奇迹", anchor: ["my-wonder-stages", "my-board"], face: "think",
    say: "第二种用法：拿一张手牌垫到奇迹下面，建下一层。",
    note: "付的是奇迹板上这一层的成本（金字塔第 1 层要 2 石），不是那张牌上的。",
  },
  {
    kind: "do", id: "r4-build", card: "Workshop", expect: mine("Workshop", "wonder"),
    say: "点「工坊」，再点「建奇迹」。",
    note: "2 石由金字塔自带的 1 石和采石坑凑齐；垫下去的牌没有效果，别人也看不到是哪张。",
  },
  {
    kind: "info", id: "r4-done", anchor: ["my-wonder-stages", "my-board"], face: "happy",
    say: "金字塔第 1 层建好了，+3 分！",
    note: "奇迹只能从下往上按顺序建，下一层要 3 木。",
  },

  // ---------- 第 5 轮：弃牌换钱、折扣 ----------
  {
    kind: "watch", id: "r5-bots", anchor: "neighbor-right",
    say: "两位邻居在挑牌……",
    moves: bots(["Altar", "build"], ["West Trading Post", "build"]),
  },
  {
    kind: "info", id: "r5-poor", card: "Apothecary", face: "think",
    say: "「药房」要 1 布，左邻有布，可你只剩 1 金，买不起。",
    note: "买东西只能用这一轮开始时就有的钱。",
  },
  {
    kind: "info", id: "r5-discount", lesson: "贸易站打折", card: "East Trading Post",
    say: "像「东贸易站」这样的黄卡能打折：以后向右邻买原料每份只要 1 金。",
    note: "西贸易站管左邻；市场管两边的玻璃、布、纸。",
  },
  {
    kind: "do", id: "r5-discard", lesson: "弃牌换钱", card: "Apothecary", expect: mine("Apothecary", "discard"),
    say: "第三种用法：弃掉「药房」，换 3 金。",
    note: "什么都建不了的牌，弃掉换钱总是可以的。",
  },

  // ---------- 第 6 轮：最后一张作废 ----------
  {
    kind: "watch", id: "r6-bots", anchor: "neighbor-left",
    say: "最后一轮，两位邻居在挑牌……",
    moves: bots(["East Trading Post", "build"], ["Theater", "build"]),
  },
  {
    kind: "info", id: "r6-last", lesson: "第 6 轮", anchor: "hand", face: "think",
    say: "第 6 轮手里只剩 2 张：打 1 张，另 1 张直接作废。",
    note: "作废的那张不给 3 金。",
  },
  {
    kind: "do", id: "r6-build", card: "Barracks", expect: mine("Barracks", "build"),
    say: "建「兵营」：红卡，+1 盾。",
    note: "缺的 1 矿向右邻买，付 2 金。",
  },
  {
    kind: "info", id: "military", lesson: "军事", anchor: ["military", "my-info", "my-stats"],
    say: "时代结束比军事：只和左右两位邻居比盾。",
    note: "你 1 盾：和左邻一样多，平局不拿；比右邻多，拿 +1。",
  },
  {
    kind: "info", id: "military-values", anchor: ["my-info", "my-stats"],
    say: "赢一位邻居：时代 I +1、时代 II +3、时代 III +5。",
    note: "输了每次 −1；整局最后一起算分。",
  },

  // ---------- 时代 II 第 1 轮：换方向、免费链、科技 ----------
  {
    kind: "info", id: "age2-pass", lesson: "换方向", anchor: "pass-arrow",
    say: "时代 II 发了新牌，这个时代往右传。",
    note: "打完这一轮，剩下的牌交给右邻。",
  },
  {
    kind: "info", id: "chain", lesson: "免费链", card: "Library", face: "happy",
    say: "「图书馆」标着免费链：你建过写字间，它什么都不用付。",
    note: "「水道桥」也能免费链（你建过浴场）；前置建筑哪个时代建的都算。",
  },
  {
    kind: "watch", id: "a2-bots", anchor: "neighbor-left",
    say: "两位邻居在挑牌……",
    moves: bots(["Brickyard", "build"], ["Stables", "build"]),
  },
  {
    kind: "do", id: "a2-build", card: "Library", expect: mine("Library", "build"),
    say: "建「图书馆」，免费。",
  },
  {
    kind: "info", id: "science", lesson: "科技计分", anchor: ["my-info", "my-stats"], face: "think",
    say: "科技分：每种符号张数的平方加起来，三种各一张凑一套再 +7。",
    note: "你 2 张石板 = 4 分；再来 1 圆规 + 1 齿轮就是 4+1+1+7 = 13 分，凑套很划算。",
  },
  {
    kind: "info", id: "same-name", lesson: "不能同名", anchor: "hand",
    say: "同名的建筑，一座城只能有一张。",
    note: "手牌上标「已有同名」的，只能拿去建奇迹或者弃掉。",
  },

  // ---------- 快进到终局：计分 ----------
  {
    kind: "info", id: "final", lesson: "终局计分", anchor: "final-table", showcase: true,
    say: "快进看看：三个时代打完，自动算七项分。",
    note: "这是一局打完的样子；每列最高的标金色，总分最高的赢。",
  },
  {
    kind: "info", id: "final-science", anchor: "final-detail", showcase: true,
    say: "这里写着每一项怎么来的：你的科技 3 石板、2 圆规、1 齿轮 = 21 分。",
    note: "9 + 4 + 1，再加凑成的 1 套 7 分。",
  },
  {
    kind: "info", id: "final-guild", lesson: "行会", anchor: "final-detail", showcase: true,
    say: "紫卡（行会）只在时代 III 出现，多半按两位邻居的城计分。",
    note: "比如工人行会：两位邻居每有 1 张棕卡，你得 1 分，这里是 7 分。",
  },
  {
    kind: "info", id: "final-coins", lesson: "金币和平局", anchor: "final-detail", showcase: true,
    say: "剩下的金币每 3 枚算 1 分。",
    note: "总分一样时，金币多的赢。",
  },

  // ---------- 本站设定、收尾 ----------
  {
    kind: "info", id: "site", lesson: "限时和托管", anchor: "auto",
    say: "每轮限时 60 秒，到点由人机替你出这一轮。",
    note: "连续超时 2 次或掉线会转成「托管」（人机代打），点「取消托管」就拿回来。",
  },
  {
    kind: "info", id: "finale", finale: true, face: "happy",
    say: "你已经会玩了，接着和咕噜一号、二号把这局打完吧！",
    note: "拿不准就点「提示」；以后人不够，房主可以给空座位「加人机」。",
  },
];

/** 时代 I 每人的 7 张（补充 §4.3）。 */
const AGE1_HANDS = [
  ["Stone Pit", "Altar", "Theater", "Guard Tower", "Clay Pit", "Workshop", "Marketplace"],
  ["Scriptorium", "Clay Pool", "Timber Yard", "Loom", "Glassworks", "Barracks", "West Trading Post"],
  ["Baths", "Stockade", "Press", "Lumber Yard", "East Trading Post", "Ore Vein", "Apothecary"],
] as const;
/** 时代 II 每人的 7 张（学员手里有能免费链的图书馆、水道桥）。 */
const AGE2_HANDS = [
  ["Library", "Sawmill", "Walls", "Aqueduct", "Temple", "Statue", "Courthouse"],
  ["Quarry", "Brickyard", "Foundry", "Loom@2", "Glassworks@2", "Press@2", "Forum"],
  ["Caravansery", "Vineyard", "Stables", "Archery Range", "Dispensary", "Laboratory", "School"],
] as const;

/**
 * 教程开局：学员金字塔 A（座位 0），左邻咕噜一号巴比伦 A，右邻咕噜二号奥林匹亚 A，每人 3 金。
 * seed 只影响剧本走完以后时代 III 怎么发牌（练习局每次不一样）。
 */
export function createTutorialGame(selfName: string, seed = 20261009): GameState {
  return buildScene({
    players: [
      { id: TUTORIAL_SELF, name: selfName, wonder: "giza", hand: AGE1_HANDS[0] },
      { id: TUTORIAL_LEFT, name: TUTORIAL_NAMES[TUTORIAL_LEFT], wonder: "babylon", hand: AGE1_HANDS[1] },
      { id: TUTORIAL_RIGHT, name: TUTORIAL_NAMES[TUTORIAL_RIGHT], wonder: "olympia", hand: AGE1_HANDS[2] },
    ],
    stacked: { 2: AGE2_HANDS.map((hand) => [...hand]) },
    seed,
  });
}

/** 讲终局计分用的「一局打完的样子」（同样三个人、三块奇迹）。数字由引擎算，script.test.ts 核对文案。 */
export function createShowcaseGame(selfName: string): GameState {
  return buildScene({
    phase: "finished",
    age: 3,
    round: 6,
    players: [
      {
        id: TUTORIAL_SELF, name: selfName, wonder: "giza", stages: 3, coins: 8, tokens: [1, 3, -1, 5],
        built: ["Stone Pit", "Clay Pool", "Baths", "Scriptorium", "Apothecary", "Workshop", "Barracks", "Library", "Aqueduct", "School", "Dispensary", "Temple", "Pantheon", "Workers Guild"],
      },
      {
        id: TUTORIAL_LEFT, name: TUTORIAL_NAMES[TUTORIAL_LEFT], wonder: "babylon", stages: 3, coins: 4, tokens: [1, 3, 5],
        built: ["Lumber Yard", "Ore Vein", "Clay Pit", "Loom", "Altar", "Guard Tower", "Stockade", "Walls", "Stables", "Quarry", "Sawmill", "Fortifications", "Arsenal", "Lighthouse", "Senate", "Strategists Guild"],
      },
      {
        id: TUTORIAL_RIGHT, name: TUTORIAL_NAMES[TUTORIAL_RIGHT], wonder: "olympia", stages: 3, coins: 11, tokens: [-1, -1, -1, 5],
        built: ["Timber Yard", "Press", "Excavation", "Glassworks", "Tavern", "East Trading Post", "Statue", "Vineyard", "Courthouse", "Gardens", "Palace", "Town Hall", "Chamber of Commerce"],
      },
    ],
  });
}

/** 练习局「再练一局」：随机分奇迹、全员 A 面、随机发牌（和真实对局的默认设置一样）。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame(
    [
      { id: TUTORIAL_SELF, name: selfName },
      { id: TUTORIAL_LEFT, name: TUTORIAL_NAMES[TUTORIAL_LEFT] },
      { id: TUTORIAL_RIGHT, name: TUTORIAL_NAMES[TUTORIAL_RIGHT] },
    ],
    seed,
  );
}

/** 牌的英文名（剧本里写英文名，网页发来的是 id）。 */
function nameOf(ref: string): string {
  return isCardId(ref) ? card(ref).name : ref;
}

/** 把剧本里写的牌名换成那个人手里的那张牌；本来就是 id 的不变。 */
export function resolveMove(state: GameState, move: TutorialMove): GameCommand {
  const command = move.command;
  if (command.type !== "PLAY" || isCardId(command.card)) return command;
  const player = state.players.find((candidate) => candidate.id === move.player);
  const id = player?.hand.find((entry) => card(entry).name === command.card);
  if (!id) throw new Error(`${move.player} 手里没有 ${command.card}`);
  return { ...command, card: id };
}

/** 走一步（不合法就抛错）。 */
export function applyMove(state: GameState, move: TutorialMove): GameState {
  return apply(state, move.player, resolveMove(state, move)).state;
}

/** 两步是不是同一步：同一个人、同一种命令；出牌比较牌名和用法（付款方案剧本里只有一种，不比）。 */
export function sameMove(a: TutorialMove, b: TutorialMove): boolean {
  if (a.player !== b.player || a.command.type !== b.command.type) return false;
  if (a.command.type === "PLAY" && b.command.type === "PLAY") {
    return nameOf(a.command.card) === nameOf(b.command.card) && a.command.action === b.command.action;
  }
  return true;
}

/**
 * 现在该谁动（给教程推进用）：学员还没出就是学员，否则是还没出的第一位人机；终局 null。
 * 练习局里人机等学员先出，学员交了以后人机依次跟上（同时出牌，先后不影响结果）。
 */
export function tutorialActor(state: GameState): string | null {
  if (state.phase === "finished") return null;
  const pending = pendingActors(state);
  if (pending.length === 0) return null;
  return pending.includes(TUTORIAL_SELF) ? TUTORIAL_SELF : pending[0]!;
}

/** 学员现在能不能发命令（出牌、撤回、巴比伦第 7 张、哈利卡纳苏斯挑弃牌）。 */
export function selfCanAct(state: GameState, playerId: string): boolean {
  if (pendingActors(state).includes(playerId)) return true;
  const me = state.players.find((player) => player.id === playerId);
  return state.phase === "play" && me?.submitted === true;
}

/** 步骤里要高亮的锚点候选（按顺序）。 */
export function anchorCandidates(step: TutorialStep): string[] {
  if (!step.anchor) return [];
  return typeof step.anchor === "string" ? [step.anchor] : [...step.anchor];
}
