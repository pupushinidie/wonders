import { card, sortRes, wonderStages } from "./cards.js";
import {
  canChain,
  canCover,
  freeBuildAvailable,
  hasBuiltName,
  leftOf,
  playerIndex,
  priceOf,
  productionSlots,
  rightOf,
} from "./city.js";
import { RESOURCE_NAMES, type GameState, type PaymentInfo, type PaymentOption, type PayTarget, type Resource } from "./types.js";

/** 一种买法：向左右邻居各买什么、各付多少。 */
interface TradeCombo {
  readonly left: string;
  readonly right: string;
  readonly leftCost: number;
  readonly rightCost: number;
}

function describeRes(res: string): string {
  const counts = new Map<string, number>();
  for (const letter of res) counts.set(letter, (counts.get(letter) ?? 0) + 1);
  return [...counts].map(([letter, count]) => `${count} ${RESOURCE_NAMES[letter as Resource]}`).join(" + ");
}

/** 从 units 里按位掩码挑出一部分（字母串）。 */
function pickUnits(units: string, mask: number): string {
  let out = "";
  for (let i = 0; i < units.length; i += 1) if (mask & (1 << i)) out += units[i];
  return out;
}

/**
 * 凑齐资源成本的所有买法（不付金币之前）：
 * 1. 先找出「必须买」的最少组合：自己的产出（含二选一、商队旅馆、广场、亚历山大）凑不齐的部分，
 *    只保留最小的组合（多买一份永远更贵）；
 * 2. 每个最小组合再分给左右邻居，邻居只卖起始资源和棕 / 灰卡（二选一卡买家自己选种类），
 *    按回合开始时的城算（本轮刚建的卡还买不到）。
 */
export function tradeCombos(state: GameState, index: number, cost: string): TradeCombo[] {
  const me = state.players[index]!;
  const units = sortRes(cost);
  const own = productionSlots(me).map((slot) => slot.opts);
  if (canCover(units, own)) return [{ left: "", right: "", leftCost: 0, rightCost: 0 }];

  // 1. 必须买的最少组合
  const feasible = new Set<string>();
  for (let mask = 1; mask < 1 << units.length; mask += 1) {
    const buy = pickUnits(units, mask);
    if (feasible.has(buy)) continue;
    if (canCover(pickUnits(units, ~mask & ((1 << units.length) - 1)), own)) feasible.add(buy);
  }
  const minimal = [...feasible].filter((buy) => {
    for (let i = 0; i < buy.length; i += 1) {
      const smaller = buy.slice(0, i) + buy.slice(i + 1);
      if (smaller.length > 0 && feasible.has(smaller)) return false;
    }
    return true;
  });

  // 2. 分给左右邻居
  const leftIndex = leftOf(state, index);
  const rightIndex = rightOf(state, index);
  const leftSells = productionSlots(state.players[leftIndex]!).filter((slot) => slot.sellable).map((slot) => slot.opts);
  const rightSells = productionSlots(state.players[rightIndex]!).filter((slot) => slot.sellable).map((slot) => slot.opts);
  const combos = new Map<string, TradeCombo>();
  for (const buy of minimal) {
    for (let mask = 0; mask < 1 << buy.length; mask += 1) {
      const left = pickUnits(buy, mask);
      const right = pickUnits(buy, ~mask & ((1 << buy.length) - 1));
      const key = `${left}|${right}`;
      if (combos.has(key)) continue;
      if (!canCover(left, leftSells) || !canCover(right, rightSells)) continue;
      let leftCost = 0;
      let rightCost = 0;
      for (const letter of left) leftCost += priceOf(me, "left", letter);
      for (const letter of right) rightCost += priceOf(me, "right", letter);
      combos.set(key, { left, right, leftCost, rightCost });
    }
  }
  return [...combos.values()];
}

function compareOptions(a: PaymentOption, b: PaymentOption): number {
  return (
    a.total - b.total ||
    a.leftCost - b.leftCost ||
    a.left.length - b.left.length ||
    (a.left < b.left ? -1 : a.left > b.left ? 1 : 0) ||
    (a.right < b.right ? -1 : a.right > b.right ? 1 : 0)
  );
}

/**
 * 列出某位玩家建某张卡（或建奇迹下一阶段）的所有合法付款方案。
 *
 * - 按现在的状态算：出牌阶段就是「回合开始时」的金币和城（本轮新赚的钱、邻居本轮刚建的卡、
 *   本轮刚建的贸易站折扣都要下一轮才算）；巴比伦第 7 张是第 6 轮结算完以后单独的一步，按那时的状态算（U4）。
 * - 免费链：建过链来源就只有一个方案 chain（不扣奥林匹亚的次数，U5）。
 * - 奥林匹亚 A：这个时代还没用过免费建造时，多一个 olympia 方案（能链的牌不给）。
 * - 默认方案（isDefault）排第一：最便宜的；一样便宜时少付左邻（U10「选右邻」）；奥林匹亚只在没有别的方案时才是默认。
 *   其余按总价从低到高，再按付给左邻的钱从少到多。
 */
export function paymentOptions(state: GameState, playerId: string, target: PayTarget): PaymentInfo {
  const index = playerIndex(state, playerId);
  if (index < 0) return { options: [], reason: "你不在这局里。" };
  const me = state.players[index]!;
  if (!me.wonder) return { options: [], reason: "还没有奇迹板。" };

  let cost: string;
  let bank: number;
  if ("card" in target) {
    const def = card(target.card);
    if (hasBuiltName(me, def.name)) return { options: [], reason: `已经建过「${def.zh}」，同名的不能再建。` };
    if (canChain(me, def.id)) {
      return {
        options: [{ kind: "chain", left: "", right: "", leftCost: 0, rightCost: 0, bankCost: 0, total: 0, isDefault: true }],
        reason: null,
      };
    }
    cost = def.cost;
    bank = def.coin;
  } else {
    const stages = wonderStages(me.wonder, me.side);
    if (me.stages >= stages.length) return { options: [], reason: "奇迹已经建满了。" };
    cost = stages[me.stages]!.cost;
    bank = 0;
  }

  const combos = tradeCombos(state, index, cost);
  const paid: PaymentOption[] = combos
    .map((combo): PaymentOption => ({
      kind: combo.left || combo.right ? "trade" : "own",
      left: combo.left,
      right: combo.right,
      leftCost: combo.leftCost,
      rightCost: combo.rightCost,
      bankCost: bank,
      total: combo.leftCost + combo.rightCost + bank,
      isDefault: false,
    }))
    .sort(compareOptions);
  const affordable = paid.filter((option) => option.total <= me.coins);

  const options: PaymentOption[] = [...affordable];
  if ("card" in target && freeBuildAvailable(me)) {
    options.push({ kind: "olympia", left: "", right: "", leftCost: 0, rightCost: 0, bankCost: 0, total: 0, isDefault: false });
  }
  if (options.length === 0) {
    if (paid.length > 0) return { options: [], reason: `钱不够：至少要 ${paid[0]!.total} 金，你只有 ${me.coins} 金。` };
    return { options: [], reason: `资源凑不齐：要 ${describeRes(cost)}，自己和两边邻居都凑不出来。` };
  }
  const [first, ...rest] = options;
  return { options: [{ ...first!, isDefault: true }, ...rest], reason: null };
}
