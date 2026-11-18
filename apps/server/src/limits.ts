/** Small in-memory rate limiters. They reset when the Durable Object is evicted, which is fine for flood control. */

/** Allows `capacity` events at once, refilling `perSecond` per second. */
export class TokenBucket {
  private tokens: number;

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private last: number,
  ) {
    this.tokens = capacity;
  }

  take(now: number): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** At most `limit` events per key in any `windowMs` window. */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records the event and returns 0 if allowed, or the ms to wait if not. */
  hit(key: string, now: number): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return recent[0]! + this.windowMs - now;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return 0;
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}
