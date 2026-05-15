import { describe, expect, it } from 'vitest';

import { LoopBackoff } from '../src/loop-backoff.js';

/**
 * Mode 1.6 — adaptive sleep for forever-running worker loops.
 *
 * The unit tests below pin the LoopBackoff contract that the
 * worker-anchor loop relies on:
 *   - Initial state: zero failures, next delay = capMs (steady-state).
 *   - On error: counter increments, next delay doubles (capped at capMs).
 *   - On success: counter resets, next delay returns to capMs.
 *   - capMs ceiling is hard — even at N=20 the delay must not exceed it.
 */

describe('LoopBackoff (mode 1.6)', () => {
  it('initial state: counter is 0 and nextDelayMs returns capMs', () => {
    const b = new LoopBackoff({ initialMs: 1_000, capMs: 60_000 });
    expect(b.consecutiveFailureCount).toBe(0);
    expect(b.nextDelayMs()).toBe(60_000);
  });

  it('after onError, delay grows exponentially from initialMs', () => {
    const b = new LoopBackoff({ initialMs: 1_000, capMs: 60_000 });
    b.onError(); // 1 failure
    expect(b.nextDelayMs()).toBe(1_000); // initial * 2^0
    b.onError(); // 2
    expect(b.nextDelayMs()).toBe(2_000); // initial * 2^1
    b.onError(); // 3
    expect(b.nextDelayMs()).toBe(4_000); // initial * 2^2
    b.onError(); // 4
    expect(b.nextDelayMs()).toBe(8_000); // initial * 2^3
  });

  it('delay is capped at capMs no matter how many failures', () => {
    const b = new LoopBackoff({ initialMs: 1_000, capMs: 10_000 });
    for (let i = 0; i < 20; i++) b.onError();
    expect(b.nextDelayMs()).toBe(10_000);
    expect(b.consecutiveFailureCount).toBe(20);
  });

  it('onSuccess resets the counter and the delay returns to capMs', () => {
    const b = new LoopBackoff({ initialMs: 1_000, capMs: 60_000 });
    b.onError();
    b.onError();
    b.onError();
    expect(b.nextDelayMs()).toBe(4_000);
    b.onSuccess();
    expect(b.consecutiveFailureCount).toBe(0);
    expect(b.nextDelayMs()).toBe(60_000);
  });

  it('mixed success/failure: counter tracks consecutive failures only', () => {
    const b = new LoopBackoff({ initialMs: 100, capMs: 10_000 });
    b.onError();
    b.onError();
    b.onSuccess(); // resets
    b.onError();
    expect(b.consecutiveFailureCount).toBe(1);
    expect(b.nextDelayMs()).toBe(100);
  });

  it('defaults: initialMs defaults to 1_000 when omitted', () => {
    const b = new LoopBackoff({ capMs: 60_000 });
    b.onError();
    expect(b.nextDelayMs()).toBe(1_000);
  });

  it('rejects capMs <= 0 at construction', () => {
    expect(() => new LoopBackoff({ capMs: 0 })).toThrow(/capMs must be positive/);
    expect(() => new LoopBackoff({ capMs: -1 })).toThrow(/capMs must be positive/);
  });
});
