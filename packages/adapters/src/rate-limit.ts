import type Redis from 'ioredis';

/**
 * Per-source daily request counter (Tier 3 / W-13 hardening).
 *
 * `infra/sources.json` declares each source's `daily_request_cap`. Until now
 * the cap was advisory; this module enforces it. The counter lives in Redis
 * keyed by `adapter:ratelimit:<source>:<yyyy-mm-dd>` with a 36-hour TTL so
 * day-rollover always finds an empty bucket.
 *
 * Usage in the runner pre-flight:
 *
 *     const guard = new DailyRateLimiter(queue.redis);
 *     if (!(await guard.allow(src.id, src.daily_request_cap))) {
 *       // skip this run; cap reached
 *       return;
 *     }
 *     await adapter.run(...);
 *     await guard.increment(src.id);
 */
export class DailyRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly nowFn: () => Date = () => new Date(),
  ) {}

  private dayKey(): string {
    const d = this.nowFn();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private key(sourceId: string): string {
    return `adapter:ratelimit:${sourceId}:${this.dayKey()}`;
  }

  /** Returns the current count without incrementing. */
  async count(sourceId: string): Promise<number> {
    const v = await this.redis.get(this.key(sourceId));
    return v ? Number(v) : 0;
  }

  /**
   * Returns true if a fetch is allowed (count < cap), false if the cap is
   * already reached for today. Does NOT increment — call `increment()` after
   * a successful fetch so failed/blocked attempts don't burn the budget.
   */
  async allow(sourceId: string, cap: number): Promise<boolean> {
    if (!Number.isFinite(cap) || cap <= 0) return true; // no cap declared
    const current = await this.count(sourceId);
    return current < cap;
  }

  /** Bump the counter; called after a successful run. */
  async increment(sourceId: string, by = 1): Promise<number> {
    const k = this.key(sourceId);
    const v = await this.redis.incrby(k, by);
    // 36 h TTL: covers day rollover even with timezone offsets.
    await this.redis.expire(k, 36 * 3600);
    return v;
  }
}
