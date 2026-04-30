/**
 * AUDIT-037 — minimal in-process per-key rate limiter.
 *
 * Same shape as the existing limiter used by `/api/tip/attachment`
 * (apps/dashboard/src/app/api/tip/attachment/route.ts:43-59) — sliding
 * window over a per-key array of recent timestamps. Lives in this lib
 * so the audit-query routes can reuse it without duplicating the
 * implementation.
 *
 * Why in-process is OK here:
 *   - Caddy / upstream gateway also rate-limits at the edge.
 *   - The TAL-PA public audit routes set `Cache-Control: public, max-age=60`,
 *     so a single in-process server holding state per-IP is sufficient
 *     for the few minutes between cache hits.
 *   - Operator-facing audit routes (when they land — TBD per AUDIT-037)
 *     can swap to a Redis-backed limiter if the dashboard fleet grows
 *     beyond a single replica. The interface stays the same.
 *
 * Defensible default for audit query routes per AUDIT-037: 60 requests
 * per 60 s window per key, with a 200 burst cap. Sustained > 60 req/min
 * trips the limit; bursts up to 200 in the same minute also trip.
 */

export interface PerKeyRateLimiter {
  /** Returns true if the request should be rejected (key is over the limit). */
  exceeded(key: string): boolean;
  /** Test-only: peek at the current count for a key. */
  count(key: string): number;
}

export interface PerKeyRateLimiterOptions {
  readonly windowMs: number;
  readonly maxPerWindow: number;
  readonly now?: () => number;
}

export function createPerKeyRateLimiter(opts: PerKeyRateLimiterOptions): PerKeyRateLimiter {
  const { windowMs, maxPerWindow } = opts;
  const now = opts.now ?? (() => Date.now());
  const recentByKey = new Map<string, number[]>();

  return {
    exceeded(key) {
      const t = now();
      const arr = (recentByKey.get(key) ?? []).filter((ts) => t - ts < windowMs);
      if (arr.length >= maxPerWindow) {
        recentByKey.set(key, arr);
        return true;
      }
      arr.push(t);
      recentByKey.set(key, arr);
      return false;
    },
    count(key) {
      const t = now();
      return (recentByKey.get(key) ?? []).filter((ts) => t - ts < windowMs).length;
    },
  };
}

/**
 * Recommended defaults for the public audit query routes.
 * 60 sustained / 60 s + a 200 burst (single window). Both apply via
 * the windowMs / maxPerWindow pair — anything over 200 in a 60 s
 * window trips. Operator-facing audit queries (when they land) should
 * pick a tighter ceiling.
 */
export const AUDIT_PUBLIC_RATE_LIMIT = {
  windowMs: 60_000,
  maxPerWindow: 200,
} as const;
