import { describe, expect, it } from 'vitest';

import { DailyRateLimiter } from '../src/rate-limit.js';

class FakeRedis {
  store = new Map<string, number>();
  ttl = new Map<string, number>();
  async get(k: string): Promise<string | null> {
    const v = this.store.get(k);
    return v === undefined ? null : String(v);
  }
  async incrby(k: string, n: number): Promise<number> {
    const v = (this.store.get(k) ?? 0) + n;
    this.store.set(k, v);
    return v;
  }
  async expire(k: string, sec: number): Promise<number> {
    this.ttl.set(k, sec);
    return 1;
  }
  // Tier-37: Lua eval stub that implements the same RESERVE_LUA contract
  // (INCR + EXPIRE NX, then DECR rollback if cap exceeded).
  async eval(
    script: string,
    _numKeys: number,
    key: string,
    capStr: string,
    ttlStr: string,
  ): Promise<number> {
    void script;
    const current = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, current);
    if (!this.ttl.has(key)) this.ttl.set(key, Number(ttlStr));
    const cap = Number(capStr);
    if (cap > 0 && current > cap) {
      this.store.set(key, current - 1);
      return 0;
    }
    return current;
  }
}

describe('DailyRateLimiter', () => {
  it('allow returns true when no cap is configured', async () => {
    const redis = new FakeRedis();
    const lim = new DailyRateLimiter(redis as unknown as never);
    expect(await lim.allow('any', 0)).toBe(true);
    expect(await lim.allow('any', NaN)).toBe(true);
  });

  it('allow returns true when count < cap', async () => {
    const redis = new FakeRedis();
    const lim = new DailyRateLimiter(redis as unknown as never);
    expect(await lim.allow('armp-main', 100)).toBe(true);
    await lim.increment('armp-main');
    expect(await lim.allow('armp-main', 100)).toBe(true);
  });

  it('refuses once cap is reached', async () => {
    const redis = new FakeRedis();
    const lim = new DailyRateLimiter(redis as unknown as never);
    for (let i = 0; i < 5; i++) await lim.increment('armp-main');
    expect(await lim.allow('armp-main', 5)).toBe(false);
  });

  it('day rollover yields a fresh bucket', async () => {
    const redis = new FakeRedis();
    let now = new Date('2026-04-28T23:59:00Z');
    const lim = new DailyRateLimiter(redis as unknown as never, () => now);
    for (let i = 0; i < 5; i++) await lim.increment('armp-main');
    expect(await lim.allow('armp-main', 5)).toBe(false);
    now = new Date('2026-04-29T00:01:00Z');
    expect(await lim.allow('armp-main', 5)).toBe(true);
  });

  it('TTL is set on increment', async () => {
    const redis = new FakeRedis();
    const lim = new DailyRateLimiter(redis as unknown as never);
    await lim.increment('armp-main');
    const ttl = [...redis.ttl.values()][0];
    expect(ttl).toBeGreaterThanOrEqual(86400); // ≥ 24h, less than 36h
    expect(ttl).toBeLessThanOrEqual(36 * 3600);
  });

  // ---- Tier-37 audit closure: reserve() is atomic compare-and-increment ----

  it('reserve allows the first call under cap', async () => {
    const redis = new FakeRedis();
    const lim = new DailyRateLimiter(redis as unknown as never);
    const r = await lim.reserve('armp-main', 5);
    expect(r.allowed).toBe(true);
    expect(r.current).toBe(1);
  });

  it('reserve sets a TTL on first call', async () => {
    const redis = new FakeRedis();
    const lim = new DailyRateLimiter(redis as unknown as never);
    await lim.reserve('armp-main', 5);
    const ttl = [...redis.ttl.values()][0];
    expect(ttl).toBeGreaterThanOrEqual(86400);
    expect(ttl).toBeLessThanOrEqual(36 * 3600);
  });

  it('reserve denies when post-increment would exceed cap (and rolls back)', async () => {
    const redis = new FakeRedis();
    const lim = new DailyRateLimiter(redis as unknown as never);
    // Cap = 3; first three should succeed.
    expect((await lim.reserve('s', 3)).allowed).toBe(true);
    expect((await lim.reserve('s', 3)).allowed).toBe(true);
    expect((await lim.reserve('s', 3)).allowed).toBe(true);
    // Fourth call is denied AND the counter is rolled back to 3
    // (the post-INCR DECR keeps the bucket from reporting above cap).
    const fourth = await lim.reserve('s', 3);
    expect(fourth.allowed).toBe(false);
    expect(await lim.count('s')).toBe(3);
  });

  it('reserve with cap=0 (no cap) always allows and tracks the count', async () => {
    const redis = new FakeRedis();
    const lim = new DailyRateLimiter(redis as unknown as never);
    expect((await lim.reserve('s', 0)).allowed).toBe(true);
    expect((await lim.reserve('s', 0)).allowed).toBe(true);
    expect(await lim.count('s')).toBe(2);
  });

  it('reserve closes the TOCTOU window — parallel calls see at most `cap` allowed', async () => {
    const redis = new FakeRedis();
    const lim = new DailyRateLimiter(redis as unknown as never);
    const results = await Promise.all(Array.from({ length: 10 }, () => lim.reserve('s', 3)));
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(3);
    expect(await lim.count('s')).toBe(3);
  });
});
