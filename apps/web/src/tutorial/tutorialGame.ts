/**
 * 七大奇迹和教程有关的部分（共用教练层之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import "./tutorial-wonders.css";
import { botHint, card, playOptions, wonder, type CardId, type GameCommand, type GameState, type PlayAction } from "@wonders/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "wonders";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 建议出哪张手牌（高亮它）；从弃牌堆挑、挑奇迹时是 null。 */
  readonly card: CardId | null;
  readonly action?: PlayAction;
  /** 没有手牌可指时高亮哪个元素（data-tutorial）。 */
  readonly anchor?: string;
  /** 人机算出来的完整命令（带付款方案、奥林匹亚免费建造），牌桌按它预选用法那一行的付款方案。 */
  readonly command?: GameCommand;
}

/** 理由太长时只留第一个分句（手机上提示框放不下）。 */
function shorten(reason: string): string {
  if (reason.length <= 64) return reason;
  const cut = reason.indexOf("；");
  return cut > 0 ? `${reason.slice(0, cut)}。` : reason;
}

/**
 * 「提示」：让人机从你的位置算一步（它本来就只看你能看到的信息），配一句原因。
 * game 是界面拿到的局面（已经按你的视角隐藏过别人的手牌）。轮不到你时返回 null。
 */
export function hintFor(game: GameState, playerId: string): Hint | null {
  const decision = botHint(game, playerId);
  if (!decision) return null;
  const command = decision.command;
  const note = shorten(decision.reason);
  if (command.type === "PLAY") {
    const zh = card(command.card).zh;
    const me = game.players.find((player) => player.id === playerId);
    const say = command.action === "build"
      ? command.olympia ? `我会用奥林匹亚的免费建造建「${zh}」。` : `我会建「${zh}」。`
      : command.action === "wonder"
        ? `我会拿「${zh}」去建奇迹第 ${(me?.stages ?? 0) + 1} 层。`
        : `我会弃掉「${zh}」换 3 金。`;
    return { say, note, card: command.card, action: command.action, command };
  }
  if (command.type === "DISCARD_BUILD") {
    return { say: command.card ? `我会从弃牌堆免费建「${card(command.card).zh}」。` : "我会放弃这次挑选。", note, card: null, command };
  }
  if (command.type === "CHOOSE_WONDER") {
    return { say: `我会挑${wonder(command.wonder).zh}（${command.side} 面）。`, note, card: null, command };
  }
  return { say: "现在撤回比较好。", note, card: null, anchor: "undo" };
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  sold: { title: "邻居向你买了资源", text: "钱已经到手，但这一轮花不了，下一轮才能用；你的资源也不会因此变少。" },
  military: { title: "时代结束比军事", text: "只和左右两位邻居比盾：比他多拿胜利标记（时代 I +1、II +3、III +5），比他少拿 −1，一样多不拿。" },
  "age-2": { title: "时代 II：往右传了", text: "这个时代剩下的手牌交给右邻（看顶上的箭头），时代 III 又改回往左。" },
  "age-3": { title: "时代 III：紫卡出现", text: "行会（紫卡）只在这个时代出现，多半按两位邻居城里的某种卡计分；传牌又改回往左。" },
  "last-round": { title: "第 6 轮", text: "手里 2 张只能打 1 张，剩下那张作废，不给 3 金。" },
  chain: { title: "手里有能免费链的牌", text: "你建过它的前置建筑，这张不用付资源也不用付钱（手牌上标「免费链」）。" },
  timeout: { title: "时间到了", text: "人机替你出了这一轮。连续超时 2 次会转成托管，点「取消托管」就能拿回来。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；没看过的前两条合成一条出，只在这一步出）。 */
export function detectTips(game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  const events = game.events;
  // 顺序就是优先级：只在这一步有用的（换时代的传牌方向、超时）排前面，以后还会再遇到的（卖资源、军事）排后面
  if (events.some((event) => event.type === "TurnTimedOut" && event.player === selfId)) ids.push("timeout");
  if (events.some((event) => event.type === "AgeStarted" && event.age === 2)) ids.push("age-2");
  if (events.some((event) => event.type === "AgeStarted" && event.age === 3)) ids.push("age-3");
  if (events.some((event) => event.type === "MilitaryResolved")) ids.push("military");
  if (events.some((event) => event.type === "Revealed" && event.plays.some((entry) => entry.player === selfId && entry.income > 0))) ids.push("sold");
  const me = game.players.find((player) => player.id === selfId);
  if (me && game.phase === "play" && !me.submitted && me.hand.length > 0) {
    if (game.round === 6) ids.push("last-round");
    if (playOptions(game, selfId).some((entry) => entry.build.options[0]?.kind === "chain")) ids.push("chain");
  }
  return ids;
}
