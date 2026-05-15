/**
 * Hardening mode 1.6 — adaptive sleep for forever-running worker loops.
 *
 * The pattern this closes: a worker's main loop catches an exception
 * and unconditionally sleeps for a fixed `intervalMs` before retrying.
 * If the underlying failure is sustained (Polygon RPC down, Fabric
 * gateway unreachable, Postgres replica restart), the worker hammers
 * the dependency at the same rate forever — wasting CPU + bandwidth
 * AND giving operators no signal that consecutive failures are
 * accumulating.
 *
 * `LoopBackoff` is the missing primitive: a stateful counter that
 * grows the sleep exponentially on consecutive failures and resets
 * on success. Loop becomes:
 *
 *   const backoff = new LoopBackoff({ initialMs: 1_000, capMs: 60_000 });
 *   while (!stopping) {
 *     try {
 *       await doWork();
 *       backoff.onSuccess();
 *     } catch (e) {
 *       backoff.onError();
 *       logger.error({ err: e, consecutiveFailures: backoff.consecutiveFailureCount }, 'work-failed');
 *     }
 *     await sleep(backoff.nextDelayMs());
 *   }
 *
 * Steady-state sleep is `capMs` (typically the original loop interval).
 * After N consecutive failures, sleep is `min(initialMs * 2^(N-1), capMs)`.
 * Backoff resets to capMs on the first success.
 */

export interface LoopBackoffOptions {
  /** Sleep on the first failure, in milliseconds. Default 1_000. */
  readonly initialMs?: number;
  /** Ceiling for the sleep (steady-state + capped failure delay). Required. */
  readonly capMs: number;
}

export class LoopBackoff {
  private consecutiveFailures = 0;
  private readonly initialMs: number;
  private readonly capMs: number;

  constructor(opts: LoopBackoffOptions) {
    if (opts.capMs <= 0) {
      throw new Error('LoopBackoff: capMs must be positive');
    }
    this.initialMs = opts.initialMs ?? 1_000;
    this.capMs = opts.capMs;
  }

  /** Reset the counter — caller succeeded. */
  onSuccess(): void {
    this.consecutiveFailures = 0;
  }

  /** Increment the counter — caller failed. */
  onError(): void {
    this.consecutiveFailures += 1;
  }

  /** Current consecutive-failure count (for logging). */
  get consecutiveFailureCount(): number {
    return this.consecutiveFailures;
  }

  /**
   * Return the next sleep duration in milliseconds. On success (counter
   * is 0) returns `capMs` (steady-state cadence). On error, returns the
   * exponentially-growing delay capped at `capMs`.
   */
  nextDelayMs(): number {
    if (this.consecutiveFailures === 0) return this.capMs;
    const exp = this.initialMs * Math.pow(2, this.consecutiveFailures - 1);
    return Math.min(Math.floor(exp), this.capMs);
  }
}
