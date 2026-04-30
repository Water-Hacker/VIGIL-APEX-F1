/**
 * AUDIT-047 — WorkerBase honours an injected Time.Clock.
 *
 * The worker's adaptive-concurrency window, the redisAckLatency
 * histogram, and the dead-letter envelope `produced_at` field all
 * used `Date.now()` / `new Date()` inline. Per AUDIT-047, these are
 * routed through `cfg.clock` (default Time.systemClock).
 */
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
  advance(deltaMs: number): void {
    this.current += deltaMs;
  }
  now(): Time.EpochMs {
    return this.current as unknown as Time.EpochMs;
  }
  isoNow(): Time.IsoInstant {
    return new Date(this.current).toISOString() as unknown as Time.IsoInstant;
  }
}

class StubWorker extends WorkerBase<{ x: number }> {
  // expose protected method for testing
  recordOutcomePublic(ok: boolean): void {
    this.recordOutcome(ok);
  }
  effectiveConcurrencyPublic(): number {
    return (this as unknown as { effectiveConcurrency: () => number }).effectiveConcurrency();
  }
  protected async handle(): Promise<{ kind: 'ack' }> {
    return { kind: 'ack' };
  }
}

function fakeQueueClient(): WorkerBaseConfig<{ x: number }>['client'] {
  return {} as unknown as WorkerBaseConfig<{ x: number }>['client'];
}

describe('AUDIT-047 — WorkerBase Clock injection', () => {
  it('error-window GC observes the injected clock (timestamps older than 60s drop)', () => {
    const clock = new FakeClock(1_000_000);
    const w = new StubWorker({
      name: 'test-worker',
      stream: 'vigil:test',
      schema: z.object({ x: z.number() }) as never,
      client: fakeQueueClient(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        silent: vi.fn(),
        level: 'info',
        child: vi.fn(),
      } as never,
      concurrency: 4,
      clock,
    });
    // Push 3 outcomes at T=1_000_000
    w.recordOutcomePublic(true);
    w.recordOutcomePublic(true);
    w.recordOutcomePublic(false);
    expect(w.effectiveConcurrencyPublic()).toBe(2); // 1/3 errorRate -> ceil*2/3 = 2.66 -> floor 2
    // Advance past the window — all entries should be GC'd
    clock.advance(60_001);
    expect(w.effectiveConcurrencyPublic()).toBe(4); // back to ceiling
  });

  it('circuit half-open uses clock.now() for circuitOpenUntil', () => {
    const clock = new FakeClock(1_000_000);
    const w = new StubWorker({
      name: 'circuit-test',
      stream: 'vigil:test',
      schema: z.object({ x: z.number() }) as never,
      client: fakeQueueClient(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        silent: vi.fn(),
        level: 'info',
        child: vi.fn(),
      } as never,
      concurrency: 4,
      clock,
    });
    // 10 errors in a row -> errorRate 1.0 -> circuit opens for 60s
    for (let i = 0; i < 10; i++) w.recordOutcomePublic(false);
    expect(w.effectiveConcurrencyPublic()).toBe(1); // half-open
    clock.advance(30_000);
    expect(w.effectiveConcurrencyPublic()).toBe(1); // still half-open at 30s
    clock.advance(31_000); // past the 60s window
    // After 61s: errorWindow entries are now older than the 60s GC bound
    // -> they're dropped, errorRate becomes 0/0 (empty), back to ceiling.
    expect(w.effectiveConcurrencyPublic()).toBe(4);
  });

  it('AUDIT-057: isHealthy() returns true after start and false when stop()ped', () => {
    const clock = new FakeClock(1_000_000);
    const w = new StubWorker({
      name: 'health-test',
      stream: 'vigil:test',
      schema: z.object({ x: z.number() }) as never,
      client: fakeQueueClient(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        silent: vi.fn(),
        level: 'info',
        child: vi.fn(),
      } as never,
      concurrency: 1,
      clock,
    });
    // Pre-start: isHealthy() returns false (running == false).
    expect(w.isHealthy()).toBe(false);
    // Force-set running to true via the field name (simulates start).
    (w as unknown as { running: boolean }).running = true;
    // No tick yet -> isHealthy returns true (boot grace).
    expect(w.isHealthy()).toBe(true);
    // Stamp a tick at current clock time.
    (w as unknown as { lastTickAtMs: number }).lastTickAtMs = clock.now();
    expect(w.isHealthy()).toBe(true);
    // Advance past blockMs * 2 (default 5000 -> threshold 10_000).
    clock.advance(11_000);
    expect(w.isHealthy()).toBe(false);
  });

  it('falls back to Time.systemClock when no clock is supplied (existing behaviour)', () => {
    const w = new StubWorker({
      name: 'sys-clock-test',
      stream: 'vigil:test',
      schema: z.object({ x: z.number() }) as never,
      client: fakeQueueClient(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        silent: vi.fn(),
        level: 'info',
        child: vi.fn(),
      } as never,
      concurrency: 2,
    });
    // No clock passed; should default to systemClock and not throw.
    w.recordOutcomePublic(true);
    expect(w.effectiveConcurrencyPublic()).toBe(2);
  });
});
