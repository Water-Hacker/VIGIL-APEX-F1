/**
 * Tier-11 audit-chain-callers audit closure — env-driven loop-config
 * validation for worker-audit-watch.
 *
 * Pre-fix: `Number(process.env.AUDIT_WATCH_WINDOW_HOURS ?? 24)` returned
 * NaN on a non-numeric env value. The tick then computed
 * `Date.now() - NaN * 3600000 = NaN` and crashed every iteration with
 * "Invalid time value" from `new Date(NaN).toISOString()`. Silent
 * boot, loud crash on first tick.
 *
 * Post-fix: validate at boot. Fail loud with a structured message
 * pointing at the bad env var.
 *
 * Extracted to its own module so unit tests can import without
 * triggering the worker's `main()` at module load.
 */

export function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(
      `env ${name}=${JSON.stringify(raw)} is not a positive integer; refusing to boot worker-audit-watch`,
    );
  }
  return n;
}

/**
 * Like parsePositiveIntEnv but allows 0 (used for the verify-rows
 * cap, where 0 disables the chain-verify pass entirely).
 */
export function parseNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(
      `env ${name}=${JSON.stringify(raw)} is not a non-negative integer; refusing to boot worker-audit-watch`,
    );
  }
  return n;
}
