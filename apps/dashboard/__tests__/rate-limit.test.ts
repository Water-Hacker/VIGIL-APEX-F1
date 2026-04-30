/**
 * AUDIT-037 — per-key rate limiter unit tests.
 */
import { describe, expect, it } from 'vitest';

import { createPerKeyRateLimiter, AUDIT_PUBLIC_RATE_LIMIT } from '../src/lib/rate-limit.js';

describe('AUDIT-037 — createPerKeyRateLimiter', () => {
  it('allows up to maxPerWindow requests then rejects', () => {
    const now = 1_000;
    const limiter = createPerKeyRateLimiter({
      windowMs: 60_000,
      maxPerWindow: 3,
      now: () => now,
    });
    expect(limiter.exceeded('ip-1')).toBe(false);
    expect(limiter.exceeded('ip-1')).toBe(false);
    expect(limiter.exceeded('ip-1')).toBe(false);
    expect(limiter.exceeded('ip-1')).toBe(true);
    expect(limiter.exceeded('ip-1')).toBe(true);
  });

  it('per-key isolation: one key reaching the limit does not affect another', () => {
    const limiter = createPerKeyRateLimiter({ windowMs: 60_000, maxPerWindow: 2 });
    expect(limiter.exceeded('ip-1')).toBe(false);
    expect(limiter.exceeded('ip-1')).toBe(false);
    expect(limiter.exceeded('ip-1')).toBe(true);
    // ip-2 has its own bucket
    expect(limiter.exceeded('ip-2')).toBe(false);
    expect(limiter.exceeded('ip-2')).toBe(false);
    expect(limiter.exceeded('ip-2')).toBe(true);
  });

  it('sliding window: timestamps older than windowMs no longer count', () => {
    let now = 1_000;
    const limiter = createPerKeyRateLimiter({
      windowMs: 60_000,
      maxPerWindow: 2,
      now: () => now,
    });
    limiter.exceeded('ip-1'); // T=1000, count=1
    limiter.exceeded('ip-1'); // T=1000, count=2
    expect(limiter.exceeded('ip-1')).toBe(true); // T=1000, over
    now = 70_000; // 70 s later — both prior timestamps are out of window
    expect(limiter.exceeded('ip-1')).toBe(false);
    expect(limiter.count('ip-1')).toBe(1);
  });

  it('AUDIT_PUBLIC_RATE_LIMIT defaults: 60 s / 200 burst', () => {
    expect(AUDIT_PUBLIC_RATE_LIMIT.windowMs).toBe(60_000);
    expect(AUDIT_PUBLIC_RATE_LIMIT.maxPerWindow).toBe(200);
  });

  it('integration: 200 requests within window accepted, 201st rejected (burst contract)', () => {
    let now = 1_000;
    const limiter = createPerKeyRateLimiter({
      windowMs: AUDIT_PUBLIC_RATE_LIMIT.windowMs,
      maxPerWindow: AUDIT_PUBLIC_RATE_LIMIT.maxPerWindow,
      now: () => now,
    });
    for (let i = 0; i < AUDIT_PUBLIC_RATE_LIMIT.maxPerWindow; i++) {
      expect(limiter.exceeded('burst-key')).toBe(false);
      now += 50; // 50 ms apart
    }
    expect(limiter.exceeded('burst-key')).toBe(true);
  });
});
