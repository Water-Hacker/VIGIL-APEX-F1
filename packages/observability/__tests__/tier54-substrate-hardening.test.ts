/**
 * Tier-54 audit closure — observability substrate hardening tests.
 *
 * Three defences shipped:
 *
 *   (A) LoopBackoff: optional jitter on failure-path delay to smooth
 *       thundering-herd on dependency recovery. When ~12 worker fleets
 *       all wake at the same exponential delay, the recovered service
 *       gets a synchronized retry burst that can re-overload it.
 *       Multiplicative jitter in [1 - r, 1 + r] using crypto.randomInt
 *       (HARDEN-#7 compliant) smears the wake-ups.
 *
 *   (B) RetryBudget: constructor rejects `windowSeconds <= 0` /
 *       non-integer / non-finite. Pre-fix a misconfiguration produced
 *       a constant Redis key (`...:Infinity`) that ate all retries
 *       globally — budget appeared dead from the caller's perspective.
 *
 *   (C) sentinel-quorum: `emitOutageAuditRow` returns a structured
 *       `EmitOutageResult { ok, status?, error? }`. `runSentinelQuorum`
 *       propagates the result via new `emitOk` / `emitError` fields.
 *       Pre-fix the orchestrator returned `emitted: true` regardless
 *       of whether the audit-bridge actually accepted the row —
 *       silently undermining the "watcher is watched" doctrine.
 */
import { describe, expect, it, vi } from 'vitest';

import { LoopBackoff } from '../src/loop-backoff.js';
import { RetryBudget, type RedisLike } from '../src/retry-budget.js';
import {
  emitOutageAuditRow,
  runSentinelQuorum,
  type QuorumDecision,
  type SentinelReport,
  type EmitOutageResult,
} from '../src/sentinel-quorum.js';

describe('Tier-54 (A) — LoopBackoff jitter', () => {
  it('jitter=0 (default) preserves exact behaviour', () => {
    const b = new LoopBackoff({ initialMs: 1000, capMs: 60_000 });
    b.onError();
    expect(b.nextDelayMs()).toBe(1000); // 2^0 * 1000
    b.onError();
    expect(b.nextDelayMs()).toBe(2000); // 2^1 * 1000
  });

  it('rejects jitterRatio outside [0, 1)', () => {
    expect(() => new LoopBackoff({ capMs: 1000, jitterRatio: -0.1 })).toThrow(/jitterRatio/);
    expect(() => new LoopBackoff({ capMs: 1000, jitterRatio: 1 })).toThrow(/jitterRatio/);
    expect(() => new LoopBackoff({ capMs: 1000, jitterRatio: 1.5 })).toThrow(/jitterRatio/);
  });

  it('jitter applies multiplicative scaling in [1 - r, 1 + r]', () => {
    // Pin randomness to verify the math: jitterRatio=0.2 → ratioBp=200,
    // randomInt(-200, 201) range. Force returns of -200 (min) and +200
    // (max) via injection.
    const minJ = new LoopBackoff({
      initialMs: 1000,
      capMs: 60_000,
      jitterRatio: 0.2,
      randomIntForJitter: () => -200, // 800/1000 = 0.8
    });
    minJ.onError();
    expect(minJ.nextDelayMs()).toBe(800);

    const maxJ = new LoopBackoff({
      initialMs: 1000,
      capMs: 60_000,
      jitterRatio: 0.2,
      randomIntForJitter: () => 200, // 1200/1000 = 1.2
    });
    maxJ.onError();
    expect(maxJ.nextDelayMs()).toBe(1200);
  });

  it('jitter respects the cap (jittered value clamps to capMs)', () => {
    const b = new LoopBackoff({
      initialMs: 50_000,
      capMs: 60_000,
      jitterRatio: 0.5,
      randomIntForJitter: () => 500, // +50% → 75_000, clamps to 60_000
    });
    b.onError();
    expect(b.nextDelayMs()).toBe(60_000);
  });

  it('jitter never goes negative even on extreme low end', () => {
    // Mathematically `base * (1000 - 999) / 1000` for base=1 = 0.001 → floor to 0.
    const b = new LoopBackoff({
      initialMs: 1,
      capMs: 10_000,
      jitterRatio: 0.999,
      randomIntForJitter: () => -999,
    });
    b.onError();
    const d = b.nextDelayMs();
    expect(d).toBeGreaterThanOrEqual(0);
  });

  it('jitter does NOT apply on success (steady-state cadence)', () => {
    const b = new LoopBackoff({
      initialMs: 1000,
      capMs: 60_000,
      jitterRatio: 0.5,
      randomIntForJitter: () => {
        throw new Error('should not be called on success path');
      },
    });
    // No onError calls — backoff counter is 0.
    expect(b.nextDelayMs()).toBe(60_000);
  });
});

describe('Tier-54 (B) — RetryBudget windowSeconds validation', () => {
  const fakeRedis: RedisLike = { eval: vi.fn(), get: vi.fn() };

  it('rejects windowSeconds=0', () => {
    expect(
      () => new RetryBudget(fakeRedis, { name: 't', maxPerWindow: 5, windowSeconds: 0 }),
    ).toThrow(/windowSeconds must be a positive integer/);
  });

  it('rejects negative windowSeconds', () => {
    expect(
      () => new RetryBudget(fakeRedis, { name: 't', maxPerWindow: 5, windowSeconds: -1 }),
    ).toThrow(/windowSeconds/);
  });

  it('rejects fractional windowSeconds', () => {
    expect(
      () => new RetryBudget(fakeRedis, { name: 't', maxPerWindow: 5, windowSeconds: 0.5 }),
    ).toThrow(/windowSeconds/);
  });

  it('rejects NaN / Infinity windowSeconds', () => {
    expect(
      () => new RetryBudget(fakeRedis, { name: 't', maxPerWindow: 5, windowSeconds: Number.NaN }),
    ).toThrow(/windowSeconds/);
    expect(
      () =>
        new RetryBudget(fakeRedis, {
          name: 't',
          maxPerWindow: 5,
          windowSeconds: Number.POSITIVE_INFINITY,
        }),
    ).toThrow(/windowSeconds/);
  });

  it('accepts valid positive integer windowSeconds (no regression)', () => {
    expect(
      () => new RetryBudget(fakeRedis, { name: 't', maxPerWindow: 5, windowSeconds: 30 }),
    ).not.toThrow();
    expect(() => new RetryBudget(fakeRedis, { name: 't', maxPerWindow: 5 })).not.toThrow();
  });
});

describe('Tier-54 (C) — sentinel-quorum emit result is structured', () => {
  const D: QuorumDecision = {
    decision: 'down',
    up: 0,
    down: 2,
    unknown: 1,
    attesting_sites: ['helsinki', 'tokyo'],
  };

  it('runSentinelQuorum propagates emitOk=true on successful emit', async () => {
    const reports: SentinelReport[] = [
      { site: 'helsinki', target: 't', outcome: 'down', observed_at: '2026-01-01T00:00:00Z' },
      { site: 'tokyo', target: 't', outcome: 'down', observed_at: '2026-01-01T00:00:00Z' },
      { site: 'nyc', target: 't', outcome: 'unknown', observed_at: '2026-01-01T00:00:00Z' },
    ];
    let i = 0;
    const r = await runSentinelQuorum({
      target: 't',
      endpoints: [
        { site: 'helsinki', url: 'http://h' },
        { site: 'tokyo', url: 'http://t' },
        { site: 'nyc', url: 'http://n' },
      ],
      probe: async () => reports[i++]!,
      emit: async () => ({ ok: true, status: 200 }) as EmitOutageResult,
    });
    expect(r.decision.decision).toBe('down');
    expect(r.emitted).toBe(true);
    expect(r.emitOk).toBe(true);
    expect(r.emitError).toBeUndefined();
  });

  it('runSentinelQuorum propagates emitOk=false + emitError on failed emit', async () => {
    const reports: SentinelReport[] = [
      { site: 'helsinki', target: 't', outcome: 'down', observed_at: '2026-01-01T00:00:00Z' },
      { site: 'tokyo', target: 't', outcome: 'down', observed_at: '2026-01-01T00:00:00Z' },
      { site: 'nyc', target: 't', outcome: 'up', observed_at: '2026-01-01T00:00:00Z' },
    ];
    let i = 0;
    const r = await runSentinelQuorum({
      target: 't',
      endpoints: [
        { site: 'helsinki', url: 'http://h' },
        { site: 'tokyo', url: 'http://t' },
        { site: 'nyc', url: 'http://n' },
      ],
      probe: async () => reports[i++]!,
      emit: async () => ({ ok: false, error: 'audit-bridge unreachable' }) as EmitOutageResult,
    });
    expect(r.emitted).toBe(true);
    expect(r.emitOk).toBe(false);
    expect(r.emitError).toContain('audit-bridge unreachable');
  });

  it('runSentinelQuorum legacy void-returning emit injection still works', async () => {
    const reports: SentinelReport[] = [
      { site: 'helsinki', target: 't', outcome: 'down', observed_at: '2026-01-01T00:00:00Z' },
      { site: 'tokyo', target: 't', outcome: 'down', observed_at: '2026-01-01T00:00:00Z' },
      { site: 'nyc', target: 't', outcome: 'down', observed_at: '2026-01-01T00:00:00Z' },
    ];
    let i = 0;
    const r = await runSentinelQuorum({
      target: 't',
      endpoints: [
        { site: 'helsinki', url: 'http://h' },
        { site: 'tokyo', url: 'http://t' },
        { site: 'nyc', url: 'http://n' },
      ],
      probe: async () => reports[i++]!,
      // Legacy injection — returns void; should default to emitOk=true.
      emit: async () => undefined,
    });
    expect(r.emitted).toBe(true);
    expect(r.emitOk).toBe(true);
  });

  it('emitOutageAuditRow function-level: failure returns structured error', async () => {
    // Hit a guaranteed-unreachable socket path so the function exercises
    // its catch branch. Output is { ok: false, error: ... }.
    const r = await emitOutageAuditRow(
      D,
      'test-target',
      '/tmp/definitely-no-such-socket-tier54.sock',
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
