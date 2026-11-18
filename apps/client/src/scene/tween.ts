import type { Ticker } from 'pixi.js';

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inCubic: (t: number) => t ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number) => {
    const c = 1.70158;
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  },
  outElastic: (t: number) =>
    t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
} satisfies Record<string, Ease>;

interface Running {
  elapsed: number;
  duration: number;
  step: (t: number) => void;
  done: () => void;
}

/** How long without a frame before the backup timer takes over. */
const STALL_MS = 200;

/**
 * Frame-driven tweens on the Pixi ticker (no dependency needed). Browsers stop
 * drawing frames in a background tab, so while tweens are running a backup
 * timer keeps them moving: the game, and its sounds, go on in the background.
 */
export class Tweens {
  private running = new Set<Running>();
  private lastTick = performance.now();
  private backup: number | null = null;

  constructor(ticker: Ticker) {
    ticker.add((t) => {
      this.lastTick = performance.now();
      this.update(t.deltaMS);
    });
  }

  private watch(): void {
    if (this.backup !== null) return;
    this.backup = window.setInterval(() => {
      const now = performance.now();
      if (now - this.lastTick > STALL_MS) {
        this.update(now - this.lastTick);
        this.lastTick = now;
      }
      if (this.running.size === 0 && this.backup !== null) {
        window.clearInterval(this.backup);
        this.backup = null;
      }
    }, STALL_MS);
  }

  private update(dt: number): void {
    for (const r of [...this.running]) {
      r.elapsed += dt;
      const t = Math.min(1, r.elapsed / r.duration);
      r.step(t);
      if (t >= 1) {
        this.running.delete(r);
        r.done();
      }
    }
  }

  /** Calls `step` with eased progress 0..1 over `ms`. */
  run(ms: number, step: (t: number) => void, easing: Ease = ease.outCubic): Promise<void> {
    if (ms <= 0) {
      step(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.running.add({ elapsed: 0, duration: ms, step: (t) => step(easing(t)), done: resolve });
      this.watch();
    });
  }

  /** Tweens numeric properties of an object. */
  to<T extends object>(target: T, props: Partial<Record<keyof T, number>>, ms: number, easing: Ease = ease.outCubic): Promise<void> {
    const from = {} as Record<string, number>;
    for (const key of Object.keys(props)) from[key] = (target as Record<string, number>)[key];
    return this.run(
      ms,
      (t) => {
        for (const [key, to] of Object.entries(props) as [string, number][]) {
          (target as Record<string, number>)[key] = from[key] + (to - from[key]) * t;
        }
      },
      easing,
    );
  }
}
