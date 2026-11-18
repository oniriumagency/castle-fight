/**
 * Seeded random numbers. The generator state is a single uint32 that lives in
 * `GameState.rng`, so the same seed and the same actions always give the same
 * game. The engine never calls `Math.random`.
 */

export interface RngHolder {
  rng: number;
}

/** Turn a numeric or text seed into a uint32 generator state (FNV-1a). */
export function hashSeed(seed: number | string): number {
  const text = typeof seed === 'number' ? `n:${seed}` : `s:${seed}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Next float in [0, 1). Advances `holder.rng` (mulberry32). */
export function nextRandom(holder: RngHolder): number {
  holder.rng = (holder.rng + 0x6d2b79f5) >>> 0;
  let t = holder.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Next integer in [0, n). */
export function randomInt(holder: RngHolder, n: number): number {
  return Math.floor(nextRandom(holder) * n);
}

/** Pick one element. The list must not be empty. */
export function randomPick<T>(holder: RngHolder, items: readonly T[]): T {
  return items[randomInt(holder, items.length)] as T;
}

/** Fisher-Yates shuffle, in place. */
export function shuffle<T>(holder: RngHolder, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(holder, i + 1);
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}
