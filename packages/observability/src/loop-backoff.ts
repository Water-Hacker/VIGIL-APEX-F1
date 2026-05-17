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
  /**
   * Tier-54 audit closure — optional jitter on the failure-path delay.
   * When enabled, the returned delay is multiplied by a uniform random
   * factor in `[1 - jitterRatio, 1 + jitterRatio]` (clamped to
   * [0, capMs]). Default 0 (no jitter, behaviour-preserving for
   * existing callers).
   *
   * Use ~0.2 for ~12 worker fleets sharing the same dependency: when
   * a dependency recovers from outage, the per-worker exponential
   * delays would otherwise wake in lockstep and stampede the recovered
   * service. 20 % jitter smears the wake-ups across a quarter of the
   * delay window — enough to avoid thundering-herd amplification.
   *
   * Per HARDEN-#7 the randomness MUST come from `crypto.randomInt`
   * (forbidden: `Math.random` for any operation that could be
   * measured). The jitter source is exposed for tests via the
   * `randomIntForJitter` option.
   */
  readonly jitterRatio?: number;
  /** Test-injectable random source. Defaults to `crypto.randomInt`. */
  readonly randomIntForJitter?: (min: number, max: number) => number;
}

export class LoopBackoff {
  private consecutiveFailures = 0;
  private readonly initialMs: number;
  private readonly capMs: number;
  private readonly jitterRatio: number;
  private readonly randomInt: (min: number, max: number) => number;

  constructor(opts: LoopBackoffOptions) {
    if (opts.capMs <= 0) {
      throw new Error('LoopBackoff: capMs must be positive');
    }
    this.initialMs = opts.initialMs ?? 1_000;
    this.capMs = opts.capMs;
    // Tier-54: jitter bounds [0, 1) — a ratio of 1 would let the
    // delay vary from 0 to 2x, which is silly but legal. Negative or
    // >1 is meaningless.
    const j = opts.jitterRatio ?? 0;
    if (j < 0 || j >= 1) {
      throw new Error('LoopBackoff: jitterRatio must be in [0, 1)');
    }
    this.jitterRatio = j;
    // Default to crypto.randomInt per HARDEN-#7. Inline import keeps
    // the bundle slim for environments that don't construct backoffs
    // with jitter.
    this.randomInt =
      opts.randomIntForJitter ??
      ((min: number, max: number): number => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const c = require('node:crypto') as { randomInt: (a: number, b: number) => number };
        return c.randomInt(min, max);
      });
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
    const base = Math.min(Math.floor(exp), this.capMs);
    if (this.jitterRatio === 0) return base;
    // Tier-54 jitter: multiply by a random factor in
    // [1 - jitterRatio, 1 + jitterRatio]. Use integer math via
    // crypto.randomInt over a [0, 1000] grid to avoid floats while
    // staying HARDEN-#7 compliant (no Math.random).
    const ratioBp = Math.floor(this.jitterRatio * 1000); // basis points × 10
    // randomInt is [min, max) per node API.
    const offsetBp = this.randomInt(-ratioBp, ratioBp + 1);
    const jittered = Math.floor((base * (1000 + offsetBp)) / 1000);
    return Math.max(0, Math.min(jittered, this.capMs));
  }
}
