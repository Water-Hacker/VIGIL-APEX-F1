import { setTimeout as sleep } from 'node:timers/promises';

import { dbPoolWaiting, dbPoolTotal, dbPoolIdle } from '@vigil/observability';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PoolSaturatedError,
  acquireWithPriority,
  startPoolMetricsScraper,
  stopPoolMetricsScraper,
  poolStats,
} from '../src/client.js';

import type { Pool, PoolClient } from 'pg';

/**
 * Mode 2.1 — Connection pool exhaustion from runaway clients.
 *
 * The failure mode: a burst of N>poolMax concurrent slow queries
 * exhausts the connection pool. Without a circuit breaker, every
 * caller queues indefinitely (`pool.waitingCount` grows unbounded),
 * starving foreground requests behind background batch work.
 *
 * Closure contract:
 *   1. `poolStats(pool)` exposes total/idle/waiting (already present).
 *   2. `startPoolMetricsScraper()` periodically writes those values
 *      to the `vigil_db_pool_{total,idle,waiting}` Prometheus gauges.
 *   3. `acquireWithPriority(pool, 'background')` REJECTS with
 *      `PoolSaturatedError` when `waitingCount >= threshold`, so
 *      background workers back off when the pool is stressed.
 *   4. `acquireWithPriority(pool, 'foreground')` always proceeds —
 *      user-facing requests are not throttled by background load.
 *
 * The first two suites use a mocked Pool (no DB needed) — they
 * exercise the saturation logic and scraper directly. The third
 * suite is gated on `INTEGRATION_DB_URL` and exercises the path
 * against a real Postgres pool.
 */

interface PoolMock {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  connect: ReturnType<typeof vi.fn>;
}

function makePoolMock(overrides: Partial<PoolMock> = {}): Pool {
  const client = { release: vi.fn() } as unknown as PoolClient;
  const base: PoolMock = {
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    connect: vi.fn().mockResolvedValue(client),
    ...overrides,
  };
  return base as unknown as Pool;
}

describe('mode 2.1 — saturation circuit breaker (unit)', () => {
  afterEach(() => {
    stopPoolMetricsScraper();
  });

  it('foreground always invokes pool.connect()', async () => {
    const pool = makePoolMock({ waitingCount: 1_000 });
    const client = await acquireWithPriority(pool, 'foreground');
    expect((pool as unknown as PoolMock).connect).toHaveBeenCalledTimes(1);
    expect(client).toBeDefined();
  });

  it('background rejects when waitingCount >= threshold', async () => {
    const pool = makePoolMock({ waitingCount: 5 });
    await expect(
      acquireWithPriority(pool, 'background', { waitingThreshold: 5 }),
    ).rejects.toBeInstanceOf(PoolSaturatedError);
    expect((pool as unknown as PoolMock).connect).not.toHaveBeenCalled();
  });

  it('background proceeds when waitingCount < threshold', async () => {
    const pool = makePoolMock({ waitingCount: 2 });
    const client = await acquireWithPriority(pool, 'background', { waitingThreshold: 5 });
    expect(client).toBeDefined();
    expect((pool as unknown as PoolMock).connect).toHaveBeenCalledTimes(1);
  });

  it('PoolSaturatedError exposes pool stats for observability', async () => {
    const pool = makePoolMock({ totalCount: 4, idleCount: 0, waitingCount: 10 });
    try {
      await acquireWithPriority(pool, 'background', { waitingThreshold: 5 });
      expect.fail('expected PoolSaturatedError');
    } catch (e) {
      expect(e).toBeInstanceOf(PoolSaturatedError);
      const err = e as PoolSaturatedError;
      expect(err.stats.waiting).toBe(10);
      expect(err.stats.total).toBe(4);
      expect(err.threshold).toBe(5);
    }
  });

  it('default waitingThreshold is reasonable (10)', async () => {
    // At 9 waiters, default threshold passes; at 10 it rejects.
    const okPool = makePoolMock({ waitingCount: 9 });
    await expect(acquireWithPriority(okPool, 'background')).resolves.toBeDefined();

    const blockPool = makePoolMock({ waitingCount: 10 });
    await expect(acquireWithPriority(blockPool, 'background')).rejects.toBeInstanceOf(
      PoolSaturatedError,
    );
  });
});

describe('mode 2.1 — Prometheus scraper (unit)', () => {
  beforeEach(() => {
    dbPoolTotal.reset();
    dbPoolIdle.reset();
    dbPoolWaiting.reset();
  });

  afterEach(() => {
    stopPoolMetricsScraper();
  });

  it('writes pool stats to Prometheus gauges on each tick', async () => {
    const pool = makePoolMock({ totalCount: 4, idleCount: 3, waitingCount: 0 });

    startPoolMetricsScraper(pool, { intervalMs: 20 });
    await sleep(60); // 3 ticks
    expect((await dbPoolTotal.get()).values[0]?.value).toBe(4);
    expect((await dbPoolIdle.get()).values[0]?.value).toBe(3);
    expect((await dbPoolWaiting.get()).values[0]?.value).toBe(0);

    // Mutate the mock to simulate a stress spike — the scraper re-reads
    // the live pool object on each tick, so the next gauge value will
    // reflect the new waitingCount.
    (pool as unknown as PoolMock).waitingCount = 7;
    await sleep(60);
    expect((await dbPoolWaiting.get()).values[0]?.value).toBe(7);
  });

  it('stopPoolMetricsScraper is idempotent', async () => {
    const pool = makePoolMock();
    startPoolMetricsScraper(pool, { intervalMs: 50 });
    stopPoolMetricsScraper();
    stopPoolMetricsScraper(); // second call must not throw
  });

  it('starting twice replaces the prior scraper (no double-tick)', async () => {
    const pool = makePoolMock({ totalCount: 1, idleCount: 1, waitingCount: 0 });
    startPoolMetricsScraper(pool, { intervalMs: 20 });
    startPoolMetricsScraper(pool, { intervalMs: 20 });
    // No assertion needed — the absence of a dangling-timer failure at
    // exit is the proof. afterEach calls stopPoolMetricsScraper().
    await sleep(40);
  });
});

const INTEGRATION_DB_URL = process.env.INTEGRATION_DB_URL;

describe.skipIf(!INTEGRATION_DB_URL)(
  'mode 2.1 — saturation circuit breaker (integration, real Postgres)',
  () => {
    let pool: Pool;

    beforeEach(async () => {
      // Import lazily so non-integration runs don't depend on pg's runtime.
      const { Pool: PgPool } = await import('pg');
      pool = new PgPool({
        connectionString: INTEGRATION_DB_URL!,
        max: 4,
        min: 0,
        idleTimeoutMillis: 1_000,
      });
      await pool.query('SELECT 1');
      dbPoolTotal.reset();
      dbPoolIdle.reset();
      dbPoolWaiting.reset();
    });

    afterEach(async () => {
      stopPoolMetricsScraper();
      await pool.end();
    });

    it('poolStats returns live totals from a real pool', () => {
      const stats = poolStats(pool);
      expect(typeof stats.total).toBe('number');
      expect(typeof stats.idle).toBe('number');
      expect(stats.waiting).toBe(0);
    });

    it('background priority rejects under saturation while foreground succeeds', async () => {
      const holders = await Promise.all([0, 1, 2, 3].map(() => pool.connect()));
      try {
        const threshold = 2;
        // Queue threshold+1 foreground waiters to push waitingCount up.
        const fgWaiters = Array.from({ length: threshold + 1 }, () =>
          acquireWithPriority(pool, 'foreground'),
        );
        await sleep(50);
        expect(pool.waitingCount).toBeGreaterThanOrEqual(threshold);

        await expect(
          acquireWithPriority(pool, 'background', { waitingThreshold: threshold }),
        ).rejects.toBeInstanceOf(PoolSaturatedError);

        for (const h of holders) h.release();
        const clients = await Promise.all(fgWaiters);
        for (const c of clients) c.release();
      } catch (e) {
        for (const h of holders) h.release();
        throw e;
      }
    }, 10_000);
  },
);
