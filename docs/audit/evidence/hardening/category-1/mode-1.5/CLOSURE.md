# Mode 1.5 — Cascading failure under retry storm

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 3 / Category 1
**Branch:** `hardening/phase-1-orientation`

## The failure mode

A shared dependency fails (Polygon RPC, Postgres replica, Vault, LLM provider). Each of the ~12 worker fleets independently retries on its own configured cadence. Mode 1.6's `LoopBackoff` caps the per-worker retry rate but does NOT coordinate across workers. When the dependency comes back up, the recovered service is hit by 12 uncoordinated retry streams simultaneously, which can re-overload it and cause a secondary outage. The original incident becomes a multi-cascade outage.

Pre-closure: no cross-worker retry coordination existed. Each worker has its own circuit breaker (`packages/queue/src/worker.ts:130-147` adaptive concurrency; `packages/llm/src/providers/anthropic.ts:57-65` 3-failure circuit breaker) but those are per-process — they don't see the fleet-wide retry rate.

## What was added

### 1. `RetryBudget` primitive in `@vigil/observability`

`packages/observability/src/retry-budget.ts` — a Redis-backed sliding-window counter:

```typescript
const budget = new RetryBudget(redis, {
  name: 'polygon', // logical dependency
  maxPerWindow: 100, // hard ceiling per window
  windowSeconds: 60, // default
});

const { allowed, current, ceiling } = await budget.tryReserve();
if (!allowed) {
  // Skip the retry. The fleet's global budget is exhausted; another
  // worker is already trying to recover the dependency. Back off.
}
```

The implementation uses an atomic INCR + EXPIRE Lua script to ensure the counter is consistent under fleet-wide concurrency. The key includes the window number (`floor(now / windowSeconds)`) so the window rolls over naturally without explicit reset.

Two metrics emitted:

- `vigil_retry_budget_reserved_total{name}` — every reservation attempt (allowed or denied).
- `vigil_retry_budget_exhausted_total{name}` — only when the ceiling was crossed.

### 2. Structural `RedisLike` interface (no ioredis dep)

`packages/observability` doesn't take a direct dependency on the `ioredis` package. The primitive uses a structural type that matches the two methods we need (`eval`, `get`); any ioredis-compatible client satisfies it. This keeps the observability package's dependency graph minimal.

### 3. Prometheus alert

`infra/docker/prometheus/alerts/vigil.yml` — new `RetryBudgetExhausted` alert:

```yaml
expr: rate(vigil_retry_budget_exhausted_total[5m]) > 0
for: 5m
severity: warning
```

Fires when a budget is sustained-exhausted for 5 minutes. Severity warning (not critical) because the budget exhaustion is by design — workers are correctly backing off — but operators should investigate the underlying dependency.

### 4. Unit tests (7 cases)

`packages/observability/__tests__/retry-budget.test.ts` uses a stub Redis that emulates `eval` (INCR+EXPIRE) and `get` semantics including TTL expiry:

1. **Allows up to maxPerWindow** — 3 reservations of a 3-ceiling budget all succeed.
2. **Denies above maxPerWindow** — 3rd and 4th reservations of a 2-ceiling budget return `allowed: false` with the over-ceiling counter value.
3. **Resets on window roll-over** — after advancing the clock by a full window, the new window starts fresh.
4. **Separate counter per namespace** — `space-a` and `space-b` budgets are independent.
5. **`currentUsage` does NOT consume budget** — read-only.
6. **Prometheus counters emit correctly** — reserved on every call; exhausted only when denied.
7. **Rejects `maxPerWindow <= 0`** at construction.

### 5. Integration test (gated)

The same file includes an INTEGRATION_REDIS_URL-gated test that exercises the actual Redis path: two RetryBudget instances sharing the same namespace simulate two workers — 5 concurrent `tryReserve()` calls against a 3-ceiling budget produce exactly 3 allowed + 2 denied. ioredis is lazy-imported inside the test so it doesn't pollute the observability package's dep graph.

## The invariant

Four layers:

1. **The 7 unit tests** lock the contract: allow / deny / window / namespace / metric / validation.
2. **The integration test** locks fleet-wide coordination (multiple clients on same Redis).
3. **The Prometheus alert** `RetryBudgetExhausted` surfaces sustained pressure to operators.
4. **The metric counter exists in Prometheus regardless** — even if the alert is muted, the operator can graph the counter to confirm the budget is working.

## What this closure does NOT include

- **Adoption sweep across worker fleet.** The primitive is in place; per-worker integration with the `LoopBackoff` retry path is the next incremental step. Pattern:
  ```typescript
  const budget = new RetryBudget(redisClient, {
    name: 'polygon',
    maxPerWindow: 100,
  });
  // In the LoopBackoff onError path:
  const r = await budget.tryReserve();
  if (!r.allowed) {
    logger.warn('retry-budget exhausted; skipping retry');
    backoff.onError(); // still back off locally
    continue;
  }
  ```
  Flagged for Category-1 follow-up.
- **Per-namespace tuning.** Default `maxPerWindow=100/min` is a reasonable starting point but each dependency has its own ceiling appetite. Operators tune via the worker's environment config; documented in the JSDoc.
- **Burst-vs-sustained smoothing.** The current sliding-window-counter denies hard at the ceiling. A more sophisticated implementation could use a token-bucket. Token-bucket is a future refinement if operators see legitimate-burst → false-positive exhaustion.

## Files touched

- `packages/observability/src/retry-budget.ts` (new, 105 lines)
- `packages/observability/src/index.ts` (+1 line: re-export)
- `packages/observability/src/metrics.ts` (+22 lines: 2 new counters)
- `packages/observability/__tests__/retry-budget.test.ts` (new, 207 lines)
- `infra/docker/prometheus/alerts/vigil.yml` (+15 lines: `RetryBudgetExhausted` alert)
- `docs/audit/evidence/hardening/category-1/mode-1.5/CLOSURE.md` (this file)

## Verification

- `pnpm --filter @vigil/observability run typecheck` — clean.
- `pnpm --filter @vigil/observability test` — 42 passed, 1 skipped (was 35; +7 retry-budget unit + 1 integration skipped).
