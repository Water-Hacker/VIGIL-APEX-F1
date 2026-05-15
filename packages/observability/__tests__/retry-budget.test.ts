import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { retryBudgetExhaustedTotal, retryBudgetTotalReserved } from '../src/metrics.js';
import { RetryBudget, type RedisLike } from '../src/retry-budget.js';

/**
 * Mode 1.5 — Cascading failure under retry storm.
 *
 * Unit tests use a stub Redis that emulates INCR + EXPIRE semantics
 * for the Lua script. Integration tests (gated on
 * INTEGRATION_REDIS_URL) exercise the actual Redis path.
 */

interface RedisStub {
  store: Map<string, { value: number; expiresAtMs: number | null }>;
  eval: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

function makeRedisStub(now: () => number): RedisStub {
  const store = new Map<string, { value: number; expiresAtMs: number | null }>();
  const stub: RedisStub = {
    store,
    eval: vi.fn((_script: string, _numKeys: number, key: string, ttlSecs: string) => {
      // Honour TTL: if a prior entry has expired, drop it before INCR.
      const entry = store.get(key);
      if (entry && entry.expiresAtMs !== null && entry.expiresAtMs <= now()) {
        store.delete(key);
      }
      const cur = (store.get(key)?.value ?? 0) + 1;
      const expiresAtMs =
        cur === 1 ? now() + Number(ttlSecs) * 1_000 : (store.get(key)?.expiresAtMs ?? null);
      store.set(key, { value: cur, expiresAtMs });
      return Promise.resolve(cur);
    }),
    get: vi.fn((key: string) => {
      const entry = store.get(key);
      if (!entry) return Promise.resolve(null);
      if (entry.expiresAtMs !== null && entry.expiresAtMs <= now()) {
        store.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(String(entry.value));
    }),
  };
  return stub;
}

describe('RetryBudget (mode 1.5, unit with Redis stub)', () => {
  beforeEach(() => {
    retryBudgetTotalReserved.reset();
    retryBudgetExhaustedTotal.reset();
  });

  it('allows up to maxPerWindow reservations in a single window', async () => {
    const t = 1_000;
    const stub = makeRedisStub(() => t);
    const budget = new RetryBudget(stub as unknown as RedisLike, {
      name: 'test-a',
      maxPerWindow: 3,
      windowSeconds: 60,
      nowMs: () => t,
    });

    const r1 = await budget.tryReserve();
    const r2 = await budget.tryReserve();
    const r3 = await budget.tryReserve();

    expect(r1).toEqual({ allowed: true, current: 1, ceiling: 3 });
    expect(r2).toEqual({ allowed: true, current: 2, ceiling: 3 });
    expect(r3).toEqual({ allowed: true, current: 3, ceiling: 3 });
  });

  it('denies reservations above maxPerWindow', async () => {
    const t = 1_000;
    const stub = makeRedisStub(() => t);
    const budget = new RetryBudget(stub as unknown as RedisLike, {
      name: 'test-b',
      maxPerWindow: 2,
      windowSeconds: 60,
      nowMs: () => t,
    });

    await budget.tryReserve();
    await budget.tryReserve();
    const r3 = await budget.tryReserve();
    const r4 = await budget.tryReserve();

    expect(r3.allowed).toBe(false);
    expect(r3.current).toBe(3);
    expect(r4.allowed).toBe(false);
    expect(r4.current).toBe(4);
  });

  it('resets on window roll-over', async () => {
    let t = 1_000_000; // ms; well-aligned to a window boundary
    const stub = makeRedisStub(() => t);
    const budget = new RetryBudget(stub as unknown as RedisLike, {
      name: 'test-c',
      maxPerWindow: 1,
      windowSeconds: 60,
      nowMs: () => t,
    });

    // First window: 1 allowed, 2nd denied.
    const w1a = await budget.tryReserve();
    const w1b = await budget.tryReserve();
    expect(w1a.allowed).toBe(true);
    expect(w1b.allowed).toBe(false);

    // Advance time by one full window — key from the prior window
    // expires; the new window starts fresh.
    t += 60_000;
    const w2 = await budget.tryReserve();
    expect(w2.allowed).toBe(true);
    expect(w2.current).toBe(1);
  });

  it('uses a separate counter per namespace', async () => {
    const t = 1_000;
    const stub = makeRedisStub(() => t);
    const a = new RetryBudget(stub as unknown as RedisLike, {
      name: 'space-a',
      maxPerWindow: 1,
      windowSeconds: 60,
      nowMs: () => t,
    });
    const b = new RetryBudget(stub as unknown as RedisLike, {
      name: 'space-b',
      maxPerWindow: 1,
      windowSeconds: 60,
      nowMs: () => t,
    });

    expect((await a.tryReserve()).allowed).toBe(true);
    // space-a exhausted, but space-b still has its own budget.
    expect((await a.tryReserve()).allowed).toBe(false);
    expect((await b.tryReserve()).allowed).toBe(true);
  });

  it('currentUsage does NOT consume budget', async () => {
    const t = 1_000;
    const stub = makeRedisStub(() => t);
    const budget = new RetryBudget(stub as unknown as RedisLike, {
      name: 'test-d',
      maxPerWindow: 5,
      windowSeconds: 60,
      nowMs: () => t,
    });
    await budget.tryReserve();
    const u1 = await budget.currentUsage();
    const u2 = await budget.currentUsage();
    expect(u1.current).toBe(1);
    expect(u2.current).toBe(1);
  });

  it('emits Prometheus counters: reserved on every call, exhausted only when denied', async () => {
    const t = 1_000;
    const stub = makeRedisStub(() => t);
    const budget = new RetryBudget(stub as unknown as RedisLike, {
      name: 'test-e',
      maxPerWindow: 2,
      windowSeconds: 60,
      nowMs: () => t,
    });

    await budget.tryReserve();
    await budget.tryReserve();
    await budget.tryReserve(); // denied

    const reserved = (await retryBudgetTotalReserved.get()).values.find(
      (v) => v.labels.name === 'test-e',
    );
    const exhausted = (await retryBudgetExhaustedTotal.get()).values.find(
      (v) => v.labels.name === 'test-e',
    );
    expect(reserved?.value).toBe(3);
    expect(exhausted?.value).toBe(1);
  });

  it('rejects maxPerWindow <= 0 at construction', () => {
    const stub = makeRedisStub(() => 0);
    expect(
      () => new RetryBudget(stub as unknown as RedisLike, { name: 'x', maxPerWindow: 0 }),
    ).toThrow(/maxPerWindow must be positive/);
    expect(
      () => new RetryBudget(stub as unknown as RedisLike, { name: 'x', maxPerWindow: -1 }),
    ).toThrow(/maxPerWindow must be positive/);
  });
});

const INTEGRATION_REDIS_URL = process.env.INTEGRATION_REDIS_URL ?? process.env.REDIS_URL;

describe.skipIf(!INTEGRATION_REDIS_URL)('RetryBudget (mode 1.5, integration)', () => {
  // Lazy-import ioredis so the file loads cleanly when observability
  // doesn't have ioredis as a direct dependency. The integration suite
  // is skipped without INTEGRATION_REDIS_URL anyway.
  let redis: import('ioredis').default;
  const ns = `it-${randomUUID().slice(0, 8)}`;

  beforeEach(async () => {
    const { default: IORedis } = await import('ioredis');
    redis = new IORedis(INTEGRATION_REDIS_URL!);
  });

  afterEach(async () => {
    const keys = await redis.keys(`vigil:retry-budget:${ns}*`).catch(() => [] as string[]);
    if (keys.length) await redis.del(...keys);
    await redis.quit().catch(() => {});
  });

  it('coordinates retry counts across multiple clients sharing the same namespace', async () => {
    // Two separate RetryBudget instances pointing at the SAME Redis +
    // namespace simulate two workers sharing the global budget.
    const a = new RetryBudget(redis, {
      name: ns,
      maxPerWindow: 3,
      windowSeconds: 60,
    });
    const b = new RetryBudget(redis, {
      name: ns,
      maxPerWindow: 3,
      windowSeconds: 60,
    });

    const results = await Promise.all([
      a.tryReserve(),
      b.tryReserve(),
      a.tryReserve(),
      b.tryReserve(),
      a.tryReserve(),
    ]);
    const allowed = results.filter((r) => r.allowed);
    const denied = results.filter((r) => !r.allowed);
    expect(allowed).toHaveLength(3);
    expect(denied).toHaveLength(2);
  }, 10_000);
});
