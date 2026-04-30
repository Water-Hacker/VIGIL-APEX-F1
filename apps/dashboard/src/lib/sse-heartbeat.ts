/**
 * AUDIT-035 — SSE heartbeat with prompt cancellation on AbortSignal.
 *
 * The realtime SSE route used `setInterval(..., 25_000)` and cleared it
 * inside the stream's `finally` block. The clear ran when the
 * underlying read loop exited — but the read loop is BLOCKed on Redis
 * for up to 15 s and the consumer disconnect signal could only be
 * observed at the next loop iteration. In the meantime, the heartbeat
 * timer remained scheduled and would fire once more after the consumer
 * was gone (no-op enqueue, but the timer entry persisted in the event
 * loop). Under a high-disconnect-rate fan-out, that's a measurable
 * resource leak.
 *
 * Fix: register an `abort` listener on the AbortSignal that clears the
 * interval immediately, and expose a `stop()` function so the route
 * can also clear synchronously when its own loop exits cleanly. The
 * helper is pure (no I/O) and accepts an injected `setInterval` /
 * `clearInterval` for deterministic testing.
 */

export interface SseHeartbeatDeps {
  readonly setInterval: (cb: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

const NODE_TIMERS: SseHeartbeatDeps = {
  setInterval: (cb, ms) => globalThis.setInterval(cb, ms) as unknown,
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof globalThis.setInterval>),
};

export interface SseHeartbeatOptions {
  readonly intervalMs: number;
  readonly signal: AbortSignal;
  readonly onTick: () => void;
  /** Optional override for tests. Defaults to globalThis.setInterval / clearInterval. */
  readonly timers?: SseHeartbeatDeps;
}

/**
 * Start a heartbeat. Returns a `stop` function that clears the timer
 * idempotently. The timer is ALSO cleared as soon as `signal.aborted`
 * flips true (via `addEventListener('abort', ...)`), so a TCP RST
 * doesn't leave a 25 s ghost timer in the event loop.
 */
export function startSseHeartbeat(opts: SseHeartbeatOptions): { stop: () => void } {
  const timers = opts.timers ?? NODE_TIMERS;
  let cleared = false;
  let handle: unknown = null;

  const clear = (): void => {
    if (cleared) return;
    cleared = true;
    if (handle !== null) timers.clearInterval(handle);
    opts.signal.removeEventListener('abort', clear);
  };

  // If the signal is already aborted by the time we got here, do nothing.
  if (opts.signal.aborted) {
    cleared = true;
    return { stop: () => undefined };
  }

  handle = timers.setInterval(() => {
    if (cleared || opts.signal.aborted) {
      clear();
      return;
    }
    opts.onTick();
  }, opts.intervalMs);

  opts.signal.addEventListener('abort', clear, { once: true });

  return { stop: clear };
}
