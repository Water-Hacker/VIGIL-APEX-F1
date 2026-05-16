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
 *
 * Tier-37 audit closure: also exposes `reserve(sourceId, cap)` which is
 * the atomic version — INCR-then-compare-against-cap in a single Lua call.
 * The legacy `allow` + `increment` pair has a TOCTOU race: two parallel
 * callers both read N (< cap), both increment to N+1 and N+2; second one
 * crossed the cap silently. `reserve()` decrements its own bump if the
 * post-increment value already exceeded the cap, so the cap is hard.
 */

// Tier-37 audit closure: atomic compare-and-increment. INCRs first
// (the EXPIRE NX adds a TTL only if absent — same self-heal pattern as
// retry-budget T29). If the post-increment value would exceed the cap,
// DECR back to the pre-increment state and return `denied`. Else
// return `allowed` with the new count.
const RESERVE_LUA = `
  local current = redis.call('INCR', KEYS[1])
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]), 'NX')
  local cap = tonumber(ARGV[1])
  if cap > 0 and current > cap then
    redis.call('DECR', KEYS[1])
    return 0
  end
  return current
`;

export interface ReserveResult {
  readonly allowed: boolean;
  /** Post-increment count if allowed; previous count if denied. */
  readonly current: number;
}

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
   *
   * NOTE: this read-then-write contract is NOT race-free under parallel
   * callers — two callers can both observe count=N<cap and both proceed.
   * For hard-cap enforcement use `reserve()` instead.
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

  /**
   * Tier-37 audit closure: atomic compare-and-increment. Returns
   * `{ allowed: true, current: N }` if N <= cap after the INCR, or
   * `{ allowed: false, current: cap }` if the cap would have been
   * crossed (the bump is rolled back via DECR in the Lua, so the
   * counter never reports above the cap).
   *
   * `cap <= 0` is treated as "no cap declared" — the call still
   * increments + returns allowed with the post-increment count.
   */
  async reserve(sourceId: string, cap: number): Promise<ReserveResult> {
    const k = this.key(sourceId);
    const capArg = Number.isFinite(cap) && cap > 0 ? String(cap) : '0';
    const result = (await this.redis.eval(RESERVE_LUA, 1, k, capArg, String(36 * 3600))) as number;
    if (result === 0) {
      return { allowed: false, current: cap };
    }
    return { allowed: true, current: result };
  }
}
