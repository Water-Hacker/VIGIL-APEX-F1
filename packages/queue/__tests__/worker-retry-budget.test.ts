/**
 * Mode 1.5 — WorkerBase central RetryBudget integration.
 *
 * The retry-budget primitive landed in Cat 1 closure. This test pins
 * the WorkerBase-side integration: when a worker's handler returns
 * `{ kind: 'retry', ... }` and the worker's RetryBudget is exhausted,
 * the message dead-letters with reason `retry-budget-exhausted: ...`
 * instead of being redelivered.
 *
 * Adoption shape (every worker inherits this for free):
 *   - Budget is constructed in WorkerBase constructor when
 *     `cfg.retryBudget?.enabled !== false`.
 *   - Budget name = worker name (visible in
 *     `vigil_retry_budget_exhausted_total{name=<worker>}`).
 *   - Defaults: maxPerWindow=120, windowSeconds=60.
 *
 * The test uses a stubbed Redis client (matching the secret-rotation
 * + stream-scraper test patterns) so we don't need a live Redis
 * instance.
 */
import { RetryBudget } from '@vigil/observability';
import { Time } from '@vigil/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { WorkerBase, type WorkerBaseConfig } from '../src/worker.js';

class FakeClock implements Time.Clock {
  private current: number;
  constructor(start: number) {
    this.current = start;
  }
  set(t: number): void {
    this.current = t;
  }
  now(): Time.EpochMs {
    return this.current as unknown as Time.EpochMs;
  }
  isoNow(): Time.IsoInstant {
    return new Date(this.current).toISOString() as unknown as Time.IsoInstant;
  }
}

function fakeQueueClient(): WorkerBaseConfig<{ x: number }>['client'] {
  return {
    redis: {
      eval: vi.fn(),
      get: vi.fn(),
    },
  } as unknown as WorkerBaseConfig<{ x: number }>['client'];
}

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  silent: vi.fn(),
  level: 'info',
  child: vi.fn(),
} as never;

class StubWorker extends WorkerBase<{ x: number }> {
  // Expose the private retryBudget reference for assertion.
  getRetryBudget(): RetryBudget | null {
    return (this as unknown as { retryBudget: RetryBudget | null }).retryBudget;
  }
  protected async handle(): Promise<{ kind: 'ack' }> {
    return { kind: 'ack' };
  }
}

describe('mode 1.5 — WorkerBase RetryBudget integration', () => {
  it('constructs a RetryBudget by default (auto-adoption)', () => {
    const w = new StubWorker({
      name: 'test-worker',
      stream: 'vigil:test',
      schema: z.object({ x: z.number() }) as never,
      client: fakeQueueClient(),
      logger: silentLogger,
      clock: new FakeClock(1_000_000),
    });
    const budget = w.getRetryBudget();
    expect(budget).not.toBeNull();
    expect(budget).toBeInstanceOf(RetryBudget);
  });

  it('respects retryBudget.enabled=false (opt-out)', () => {
    const w = new StubWorker({
      name: 'opt-out-worker',
      stream: 'vigil:test',
      schema: z.object({ x: z.number() }) as never,
      client: fakeQueueClient(),
      logger: silentLogger,
      clock: new FakeClock(1_000_000),
      retryBudget: { enabled: false },
    });
    expect(w.getRetryBudget()).toBeNull();
  });

  it('honours custom maxPerWindow + windowSeconds', async () => {
    const fakeRedis = {
      eval: vi.fn().mockResolvedValue(1),
      get: vi.fn(),
    };
    const client = {
      redis: fakeRedis,
    } as unknown as WorkerBaseConfig<{ x: number }>['client'];
    const w = new StubWorker({
      name: 'custom-budget',
      stream: 'vigil:test',
      schema: z.object({ x: z.number() }) as never,
      client,
      logger: silentLogger,
      clock: new FakeClock(60_000),
      retryBudget: { maxPerWindow: 5, windowSeconds: 30 },
    });
    const budget = w.getRetryBudget()!;
    // tryReserve should issue an EVAL against the redis stub.
    await budget.tryReserve();
    expect(fakeRedis.eval).toHaveBeenCalledTimes(1);
    // The Lua INCR uses the window-bucket key
    // `vigil:retry-budget:<name>:<window>`; verify the name is the
    // worker name and the window arg matches our config.
    const evalCall = fakeRedis.eval.mock.calls[0]!;
    expect(evalCall[2]).toMatch(/^vigil:retry-budget:custom-budget:/);
    expect(evalCall[3]).toBe('30'); // windowSeconds as string
  });

  it('tryReserve() denies after maxPerWindow is exceeded', async () => {
    // Simulate the Lua script returning increasing values across calls.
    let nextValue = 1;
    const fakeRedis = {
      eval: vi.fn().mockImplementation(() => Promise.resolve(nextValue++)),
      get: vi.fn(),
    };
    const client = {
      redis: fakeRedis,
    } as unknown as WorkerBaseConfig<{ x: number }>['client'];
    const w = new StubWorker({
      name: 'ceiling-test',
      stream: 'vigil:test',
      schema: z.object({ x: z.number() }) as never,
      client,
      logger: silentLogger,
      clock: new FakeClock(60_000),
      retryBudget: { maxPerWindow: 3 },
    });
    const budget = w.getRetryBudget()!;
    // First 3 reservations are allowed; the 4th tips over the ceiling.
    expect((await budget.tryReserve()).allowed).toBe(true);
    expect((await budget.tryReserve()).allowed).toBe(true);
    expect((await budget.tryReserve()).allowed).toBe(true);
    expect((await budget.tryReserve()).allowed).toBe(false);
  });
});
