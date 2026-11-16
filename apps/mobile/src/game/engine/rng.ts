/**
 * Seeded random numbers (mulberry32). The whole game is probabilistic, and
 * every roll goes through one of these — so a seed replays a game exactly,
 * which is what makes the simulation unit-testable.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** Roughly normal, mean 0 / deviation 1 (sum of three uniforms). */
  gauss(): number;
  /** Picks by weight; `items` must not be empty. */
  pick<T>(items: readonly (readonly [T, number])[]): T;
  /** A fresh 32-bit seed drawn from this stream. */
  fork(): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    chance: (p) => next() < p,
    gauss: () => (next() + next() + next() - 1.5) * 2,
    pick: (items) => {
      let total = 0;
      for (const [, weight] of items) total += Math.max(0, weight);
      let roll = next() * total;
      for (const [item, weight] of items) {
        roll -= Math.max(0, weight);
        if (roll < 0) return item;
      }
      return items[items.length - 1]![0];
    },
    fork: () => Math.floor(next() * 4294967296),
  };
  return rng;
}
