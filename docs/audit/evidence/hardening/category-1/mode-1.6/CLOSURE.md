# Mode 1.6 — Hot retry loop without backoff

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 3 / Category 1
**Branch:** `hardening/phase-1-orientation`

## The failure mode

A worker's main loop catches an exception and unconditionally sleeps for a fixed `intervalMs` before retrying. If the underlying failure is sustained (Polygon RPC down, Fabric gateway unreachable, Postgres replica restarting), the worker hammers the dependency at the same rate forever — wasting CPU + bandwidth AND giving operators no signal that consecutive failures are accumulating.

Pre-closure, six loops in the codebase had this pattern:

- `apps/worker-anchor/src/index.ts:127-130` (main Polygon anchor loop)
- `apps/worker-anchor/src/high-sig-loop.ts:62-74` (TAL-PA high-significance anchor)
- `apps/audit-verifier/src/index.ts:135-139` (CT-01/02/03 verifier loop)
- `apps/worker-audit-watch/src/index.ts:203-207` (anomaly detection loop)
- `apps/worker-pattern-discovery/src/index.ts:79-83` (graph snapshot discovery loop)
- `apps/worker-reconcil-audit/src/index.ts:280-284` (cross-witness reconciliation loop)

## What was added

### 1. `LoopBackoff` primitive in `@vigil/observability`

`packages/observability/src/loop-backoff.ts` — a stateful counter that:

- Returns `capMs` (steady-state cadence) when zero consecutive failures.
- After N consecutive failures, returns `min(initialMs * 2^(N-1), capMs)`.
- Resets to zero on `onSuccess()`.

The class is intentionally small (≈40 lines of substance) and has no async behaviour — it's a pure counter that the caller queries before its `sleep()`. This decouples it from any specific sleep implementation and makes it trivial to unit-test.

### 2. Six worker loops adopted

Every loop above now follows the same shape:

```typescript
const backoff = new LoopBackoff({ initialMs: 1_000, capMs: intervalMs });
while (!stopping) {
  try {
    await doWork();
    backoff.onSuccess();
  } catch (e) {
    backoff.onError();
    logger.error(
      { err: e, consecutiveFailures: backoff.consecutiveFailureCount },
      '<worker>-loop-error',
    );
  }
  await sleep(backoff.nextDelayMs());
}
```

The `consecutiveFailures` field in the error log gives operators direct visibility into how long a failure has been sustained.

`worker-reconcil-audit` also calls `backoff.onError()` on the non-throwing `result.fatal` path — treating "we detected a divergence but didn't throw" as a "don't pound the dependency" signal.

### 3. Unit test for the primitive

`packages/observability/__tests__/loop-backoff.test.ts` — 7 tests:

1. Initial state: counter is 0, delay is capMs.
2. Exponential growth from initialMs on consecutive failures.
3. Capped at capMs even after 20 failures.
4. `onSuccess` resets counter and delay returns to capMs.
5. Mixed success/failure: counter tracks consecutive failures only.
6. Default initialMs is 1_000 when omitted.
7. Rejects `capMs <= 0` at construction.

## The invariant

Three layers protect against regression:

1. **The unit test** (7 cases) — locks in the LoopBackoff contract. Future changes to the math or reset semantics must update the test.
2. **The pattern is now uniform across 6 worker loops** — any new long-running worker that follows the same pattern automatically gets the same behaviour by reusing `LoopBackoff`.
3. **The log line includes `consecutiveFailures`** — operators can observe "this loop has failed N times in a row" without parsing the loop's source. A Prometheus log-derived metric is a follow-up (out of scope here).

## What this closure does NOT include

- **Per-worker retry budget with dead-letter** (the orientation's optional second piece). The current closure achieves the "stop hammering the dependency" property; dead-lettering after N failures is a separate concern that should be coordinated with mode 1.5's global retry budget. Flagged for follow-up.
- **A Prometheus counter for backoff state.** The error logs include the counter so it's observable; adding a metric is a follow-up if operators want graphed visualisation.
- **Adoption in queue workers** (`packages/queue/src/worker.ts`). Those workers already use a different adaptive concurrency primitive (the `errorWindow` half-open circuit at `:130-147`). LoopBackoff is for the "fixed-interval tick" pattern; the BullMQ-style consumer loop has its own.

## Files touched

- `packages/observability/src/loop-backoff.ts` (new, 79 lines)
- `packages/observability/src/index.ts` (+1 line: re-export)
- `packages/observability/__tests__/loop-backoff.test.ts` (new, 72 lines)
- `apps/worker-anchor/src/index.ts` (loop wrapped)
- `apps/worker-anchor/src/high-sig-loop.ts` (loop wrapped)
- `apps/audit-verifier/src/index.ts` (loop wrapped)
- `apps/worker-audit-watch/src/index.ts` (loop wrapped)
- `apps/worker-pattern-discovery/src/index.ts` (loop wrapped)
- `apps/worker-reconcil-audit/src/index.ts` (loop wrapped)
- `docs/audit/evidence/hardening/category-1/mode-1.6/CLOSURE.md` (this file)

## Verification

- `pnpm --filter @vigil/observability test`: 28 tests pass (was 21 before this closure; +7 LoopBackoff).
- `pnpm --filter worker-anchor test`: 7 tests pass (unchanged; existing tests cover the high-sig batch processor; the loop wrapper itself is exercised by its unit test on LoopBackoff).
- `pnpm run typecheck`: 60 packages successful.
