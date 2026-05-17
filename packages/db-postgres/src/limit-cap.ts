/**
 * Tier-56 audit closure — repo-side hard cap on listing `limit`.
 *
 * Every `*Repo.list*(... limit)` method in this package historically
 * passed the caller-supplied `limit` straight through to
 * `.limit(limit)` on Drizzle. The dashboard API routes clamp at the
 * boundary (e.g., `audit/public/route.ts` clamps to 500), but
 * worker-side callers (other workers calling repos directly, scripts,
 * dr-rehearsal harness) bypass that clamping.
 *
 * A buggy worker passing `limit = 10_000_000` would attempt to load
 * that many rows into Node heap — OOM-killing the worker AND
 * stalling the Postgres connection while it returns the result set.
 *
 * `clampRepoLimit` is the defence-in-depth ceiling applied at every
 * repo call site. Returns a safe integer in `[1, MAX_REPO_LIMIT]`:
 *
 *   - NaN / Infinity / negative / fractional → clamps to `[1, MAX]`.
 *   - Above MAX → MAX.
 *   - Below 1 → 1 (a list call asking for 0 rows is almost certainly
 *     a caller bug; returning at least 1 row is closer to the
 *     expected intent and the caller-side conditional is unchanged).
 *
 * `MAX_REPO_LIMIT = 10_000` chosen to be:
 *   - Generous enough that legitimate "give me everything in this
 *     range" callers (audit-verifier sweeps, anchor-batch loops)
 *     never hit it on real-world Cameroon-scale data.
 *   - Bounded enough that a single accidental call can't load a
 *     million rows into worker heap.
 *
 * Repos with their own tighter cap (e.g., audit-log.listPublic at
 * 500) keep that cap; clampRepoLimit is the OUTER ceiling.
 */
export const MAX_REPO_LIMIT = 10_000;

export function clampRepoLimit(value: number | undefined, defaultLimit = 100): number {
  const raw = value ?? defaultLimit;
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return defaultLimit;
  const intVal = Math.floor(raw);
  if (intVal < 1) return 1;
  if (intVal > MAX_REPO_LIMIT) return MAX_REPO_LIMIT;
  return intVal;
}
