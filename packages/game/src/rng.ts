/**
 * 可复现的随机数（mulberry32）。状态是一个 32 位整数，存在对局状态里，
 * 所以同一种子、同一串操作总能得到同一局。
 */
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  readonly state: number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number) => Math.floor(next() * maxExclusive);
  return {
    next,
    int,
    pick: (items) => items[int(items.length)]!,
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = int(i + 1);
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    },
    get state() {
      return state;
    },
  };
}
