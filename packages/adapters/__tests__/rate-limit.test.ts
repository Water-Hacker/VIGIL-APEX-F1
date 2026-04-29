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
});
