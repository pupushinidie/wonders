import { card, wonder, wonderStages } from "./cards.js";
import type {
  CardColor,
  CountWhat,
  GameState,
  PlayerState,
  Resource,
  Scope,
  ScienceSymbol,
  Side,
  StageEffect,
} from "./types.js";

/** 左邻、右邻的下标（补充 §1.3：左 = i + 1，右 = i − 1）。 */
export function leftOf(state: Pick<GameState, "players">, index: number): number {
  return (index + 1) % state.players.length;
}

export function rightOf(state: Pick<GameState, "players">, index: number): number {
  return (index - 1 + state.players.length) % state.players.length;
}

export function neighborOf(state: Pick<GameState, "players">, index: number, side: Side): number {
  return side === "left" ? leftOf(state, index) : rightOf(state, index);
}

export function playerIndex(state: Pick<GameState, "players">, playerId: string): number {
  return state.players.findIndex((player) => player.id === playerId);
}

/** 已建成的奇迹阶段的所有效果。 */
export function stageEffects(player: PlayerState): StageEffect[] {
  if (!player.wonder) return [];
  return wonderStages(player.wonder, player.side)
    .slice(0, player.stages)
    .flatMap((stage) => stage.effects);
}

export function hasStageEffect(player: PlayerState, type: StageEffect["type"]): boolean {
  return stageEffects(player).some((effect) => effect.type === type);
}

/** 一份产出：opts 是能产的资源（一个字母 = 固定，多个 = 每回合任选一种），sellable = 邻居能不能买。 */
export interface ProductionSlot {
  readonly opts: string;
  readonly sellable: boolean;
}

/** 城里所有的资源产出：奇迹起始资源、棕卡、灰卡、商队旅馆 / 广场、亚历山大的阶段。 */
export function productionSlots(player: PlayerState): ProductionSlot[] {
  const slots: ProductionSlot[] = [];
  if (player.wonder) slots.push({ opts: wonderStart(player), sellable: true });
  for (const id of player.built) {
    const effect = card(id).effect;
    if (effect.type === "produce") for (const letter of effect.res) slots.push({ opts: letter, sellable: effect.sellable });
    else if (effect.type === "produceChoice") slots.push({ opts: effect.options, sellable: effect.sellable });
  }
  for (const effect of stageEffects(player)) {
    if (effect.type === "produce") for (const letter of effect.res) slots.push({ opts: letter, sellable: effect.sellable });
    else if (effect.type === "produceChoice") slots.push({ opts: effect.options, sellable: effect.sellable });
  }
  return slots;
}

function wonderStart(player: PlayerState): Resource {
  return wonder(player.wonder!).start;
}

/**
 * units 里的每一份资源能不能各自对上一份产出（二分图匹配，二选一卡每回合只算一种）。
 * slots 是每份产出能给的资源字母。
 */
export function canCover(units: string, slots: readonly string[]): boolean {
  if (units.length === 0) return true;
  if (units.length > slots.length) return false;
  const owner: number[] = new Array(slots.length).fill(-1);
  const tryUnit = (u: number, seen: boolean[]): boolean => {
    const letter = units[u]!;
    for (let s = 0; s < slots.length; s += 1) {
      if (seen[s] || !slots[s]!.includes(letter)) continue;
      seen[s] = true;
      if (owner[s] === -1 || tryUnit(owner[s]!, seen)) {
        owner[s] = u;
        return true;
      }
    }
    return false;
  };
  for (let u = 0; u < units.length; u += 1) {
    if (!tryUnit(u, new Array(slots.length).fill(false))) return false;
  }
  return true;
}

/** 从 side 那边的邻居买 res 是不是 1 金（东/西贸易站、市场、奥林匹亚 B1；不叠加）。 */
export function hasDiscount(player: PlayerState, side: Side, res: string): boolean {
  for (const id of player.built) {
    const effect = card(id).effect;
    if (effect.type === "tradeDiscount" && effect.from.includes(side) && effect.res.includes(res)) return true;
  }
  return stageEffects(player).some(
    (effect) => effect.type === "tradeDiscount" && effect.from.includes(side) && effect.res.includes(res),
  );
}

/** 买一份资源的价格。 */
export function priceOf(player: PlayerState, side: Side, res: string): number {
  return hasDiscount(player, side, res) ? 1 : 2;
}

/** 盾牌总数：红卡 + 奇迹阶段（罗德岛）。 */
export function shieldsOf(player: PlayerState): number {
  let total = 0;
  for (const id of player.built) {
    const effect = card(id).effect;
    if (effect.type === "shields") total += effect.n;
  }
  for (const effect of stageEffects(player)) if (effect.type === "shields") total += effect.n;
  return total;
}

/** 已建成的某种颜色的卡有几张。 */
export function colorCount(player: PlayerState, color: CardColor): number {
  return player.built.filter((id) => card(id).color === color).length;
}

/** 科技符号张数 + 任选符号个数（巴比伦的科技阶段、科学家行会；奥林匹亚复制的另算）。 */
export function scienceCounts(player: PlayerState): { compass: number; gear: number; tablet: number; wild: number } {
  const counts = { compass: 0, gear: 0, tablet: 0, wild: 0 };
  const add = (symbol: ScienceSymbol | "any") => {
    if (symbol === "any") counts.wild += 1;
    else counts[symbol] += 1;
  };
  for (const id of player.built) {
    const effect = card(id).effect;
    if (effect.type === "science") add(effect.symbol);
  }
  for (const effect of stageEffects(player)) if (effect.type === "science") add(effect.symbol);
  return counts;
}

/** perCount 用：scope 里的每座城分别数 what（颜色卡张数 / 败仗标记个数 / 已建奇迹阶段），加起来。 */
export function countFor(state: Pick<GameState, "players">, index: number, what: readonly CountWhat[], scope: readonly Scope[]): number {
  let total = 0;
  for (const where of scope) {
    const target = where === "self" ? index : where === "left" ? leftOf(state, index) : rightOf(state, index);
    const player = state.players[target]!;
    for (const item of what) {
      if (item === "defeat") total += player.tokens.filter((token) => token.value < 0).length;
      else if (item === "stage") total += player.stages;
      else total += colorCount(player, item);
    }
  }
  return total;
}

/** 奥林匹亚 A：这个时代的免费建造还能不能用。 */
export function freeBuildAvailable(player: PlayerState): boolean {
  return hasStageEffect(player, "freeBuildOncePerAge") && !player.freeBuildUsed;
}

/** 是否建过同名建筑。 */
export function hasBuiltName(player: PlayerState, name: string): boolean {
  return player.built.some((id) => card(id).name === name);
}

/** 能不能免费链出这张卡（建过任意一张链来源）。 */
export function canChain(player: PlayerState, cardId: string): boolean {
  const from = card(cardId).chainFrom;
  return from.length > 0 && player.built.some((id) => from.includes(card(id).name));
}

/** 城里的资源产出概况（界面用）：固定产出的字母串、二选一的选项串，分能卖 / 不能卖。 */
export function productionSummary(player: PlayerState): { fixed: string; choices: string[]; privateChoices: string[] } {
  let fixed = "";
  const choices: string[] = [];
  const privateChoices: string[] = [];
  for (const slot of productionSlots(player)) {
    if (slot.opts.length === 1) fixed += slot.opts;
    else (slot.sellable ? choices : privateChoices).push(slot.opts);
  }
  return { fixed, choices, privateChoices };
}
