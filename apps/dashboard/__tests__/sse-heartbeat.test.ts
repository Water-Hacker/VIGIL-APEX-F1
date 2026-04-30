/**
 * AUDIT-035 — SSE heartbeat tests.
 */
import { describe, expect, it, vi } from 'vitest';

import { startSseHeartbeat, type SseHeartbeatDeps } from '../src/lib/sse-heartbeat.js';

function fakeTimers() {
  let nextHandle = 1;
  const scheduled = new Map<number, () => void>();
  const deps: SseHeartbeatDeps = {
    setInterval: vi.fn((cb: () => void, _ms: number) => {
      const h = nextHandle++;
      scheduled.set(h, cb);
      return h;
    }),
    clearInterval: vi.fn((h: unknown) => {
      scheduled.delete(h as number);
    }),
  };
  return { deps, scheduled };
}

describe('AUDIT-035 — startSseHeartbeat', () => {
  it('schedules exactly one interval at the requested interval', () => {
    const ctrl = new AbortController();
    const onTick = vi.fn();
    const { deps } = fakeTimers();
    const { stop } = startSseHeartbeat({
      intervalMs: 25_000,
      signal: ctrl.signal,
      onTick,
      timers: deps,
    });
    expect(deps.setInterval).toHaveBeenCalledTimes(1);
    expect((deps.setInterval as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe(25_000);
    stop();
  });

  it('on abort: clears the timer immediately (no waiting on the next tick)', () => {
    const ctrl = new AbortController();
    const { deps, scheduled } = fakeTimers();
    startSseHeartbeat({
      intervalMs: 25_000,
      signal: ctrl.signal,
      onTick: vi.fn(),
      timers: deps,
    });
    expect(scheduled.size).toBe(1);
    ctrl.abort();
    expect(scheduled.size).toBe(0);
    expect(deps.clearInterval).toHaveBeenCalledTimes(1);
  });

  it('stop() is idempotent', () => {
    const ctrl = new AbortController();
    const { deps } = fakeTimers();
    const { stop } = startSseHeartbeat({
      intervalMs: 25_000,
      signal: ctrl.signal,
      onTick: vi.fn(),
      timers: deps,
    });
    stop();
    stop();
    stop();
    expect(deps.clearInterval).toHaveBeenCalledTimes(1);
  });

  it('stop() and abort() together do not double-clear', () => {
    const ctrl = new AbortController();
    const { deps } = fakeTimers();
    const { stop } = startSseHeartbeat({
      intervalMs: 25_000,
      signal: ctrl.signal,
      onTick: vi.fn(),
      timers: deps,
    });
    stop();
    ctrl.abort();
    expect(deps.clearInterval).toHaveBeenCalledTimes(1);
  });

  it('skips scheduling entirely when the signal is already aborted', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { deps } = fakeTimers();
    startSseHeartbeat({
      intervalMs: 25_000,
      signal: ctrl.signal,
      onTick: vi.fn(),
      timers: deps,
    });
    expect(deps.setInterval).not.toHaveBeenCalled();
  });

  it('onTick fires on each scheduled interval until cleared', () => {
    const ctrl = new AbortController();
    const onTick = vi.fn();
    const { deps, scheduled } = fakeTimers();
    startSseHeartbeat({
      intervalMs: 25_000,
      signal: ctrl.signal,
      onTick,
      timers: deps,
    });
    const cb = [...scheduled.values()][0]!;
    cb();
    cb();
    cb();
    expect(onTick).toHaveBeenCalledTimes(3);
    ctrl.abort();
    cb(); // tick after abort
    expect(onTick).toHaveBeenCalledTimes(3); // not 4
  });
});
