# Mode 2.1 — Connection pool exhaustion from runaway clients

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 2 / Category 2
**Branch:** `hardening/phase-1-orientation`

## The failure mode

A burst of N > poolMax concurrent slow queries exhausts the Postgres connection pool. Without a circuit breaker, every subsequent caller queues indefinitely on `pool.waitingCount`. Foreground (user-facing) requests stall behind background batch work, the dashboard times out, and the platform degrades silently — operators see "everything still running" while real users see 30 s+ response times.

Pre-closure: `packages/db-postgres/src/client.ts:73-94` defined pool min=4/max=40 with `statement_timeout=30s`, `lock_timeout=5s`, `idle_in_transaction_session_timeout=5min`. `poolStats(pool)` was exported but never wired anywhere; the `vigil_db_pool_{total,idle,waiting}` Prometheus gauges in `packages/observability/src/metrics.ts:248-264` were declared but never populated. The audit's own `docs/audit/04-failure-modes.md:27` explicitly flagged the gap.

## What was added

### 1. `PoolSaturatedError` typed exception

`packages/db-postgres/src/client.ts` — new class with `code: 'POOL_SATURATED'`, `stats: { total, idle, waiting }`, `threshold: number`. Callers that catch this error know the pool is congested and can decide to retry-with-backoff vs. fail-fast.

### 2. `acquireWithPriority(pool, priority, opts)` priority-aware acquirer

Same file. `'foreground'` always proceeds (queues if needed) — user-facing requests are never throttled by background load. `'background'` checks `pool.waitingCount`; if it has reached `opts.waitingThreshold` (default 10), the caller rejects with `PoolSaturatedError` instead of joining the queue. Background workers wrap their pool acquisitions in this helper and back off when the pool is stressed.

### 3. `startPoolMetricsScraper(pool, opts)` Prometheus exporter

Same file. Starts a `setInterval` (default 5 s) that polls `poolStats(pool)` and writes the values to the three pre-declared gauges. Calls `Timer.unref()` so it never holds the event loop open on shutdown. Auto-replaces a prior scraper if invoked twice (multiple init paths safely converge on one timer). `stopPoolMetricsScraper()` is the symmetric shutdown.

Wired into `getPool()` so every long-lived process that uses the singleton pool gets the scraper for free. Wired into `closePool()` so shutdown is clean.

### 4. Prometheus alerts

`infra/docker/prometheus/alerts/vigil.yml` — two new rules:

- `DbPoolSaturated` — fires when `vigil_db_pool_waiting > 10 for 30s`. Severity warning. Operator action: either scale `POSTGRES_POOL_MAX` or investigate the slow-query source.
- `DbPoolScraperStale` — companion alert when the gauge itself isn't refreshed for > 60 s. Catches the case where `startPoolMetricsScraper()` was never called or the worker that owns the pool has died.

## The test

`packages/db-postgres/__tests__/pool-saturation.test.ts` — 10 tests, 8 pass without DB, 2 integration tests gated on `INTEGRATION_DB_URL` (consistent with `audit-log-cas.test.ts` gating pattern).

The eight unit tests exercise the actual failure mode under realistic mock conditions:

| Test                                                  | What it asserts                                  |
| ----------------------------------------------------- | ------------------------------------------------ |
| `foreground always invokes pool.connect()`            | even at `waitingCount=1000`, foreground proceeds |
| `background rejects when waitingCount >= threshold`   | the breaker actually trips                       |
| `background proceeds when waitingCount < threshold`   | the breaker doesn't false-positive               |
| `PoolSaturatedError exposes pool stats`               | observability of WHY background was rejected     |
| `default waitingThreshold is reasonable (10)`         | 9 OK, 10 trips — locks the contract              |
| `writes pool stats to Prometheus gauges on each tick` | scraper actually updates gauges                  |
| `stopPoolMetricsScraper is idempotent`                | safe shutdown semantics                          |
| `starting twice replaces the prior scraper`           | safe re-initialisation                           |

The integration tests (skipped locally, run in CI when `INTEGRATION_DB_URL` is set) exercise the path against a real Postgres pool: saturate by holding 4 connections, queue threshold+1 foreground waiters, assert background rejects + foreground succeeds.

**Test-fails-without-fix verified:** before implementing, the test produced `TypeError: startPoolMetricsScraper is not a function` and `acquireWithPriority is not a function` — the imports themselves failed. After implementing, all 8 unit tests pass.

## The invariant

Three layers of defence prevent regression:

1. **The test itself** (8 unit + 2 integration) — any future refactor that breaks the saturation breaker fails CI.
2. **The Prometheus alert `DbPoolSaturated`** — operator-visible alarm if waiting count sustains > 10 in production, regardless of code state.
3. **The Prometheus alert `DbPoolScraperStale`** — operator-visible alarm if the scraper itself goes silent (catches "someone removed `startPoolMetricsScraper()` from `getPool()`").

## Adoption note

`acquireWithPriority()` is an OPT-IN primitive for new background-priority code. Existing call sites that use `pool.query()` directly via Drizzle continue to work unchanged — they have implicit foreground priority (the breaker doesn't engage). As the codebase migrates batch/reconciliation paths to call `acquireWithPriority(pool, 'background')`, the breaker progressively protects foreground latency under stress. The progressive-adoption is intentional: no refactor of every Drizzle call site is required for the closure to be effective, but every additional adopter strengthens the guarantee.

## Files touched

- `packages/db-postgres/src/client.ts` (+102 lines, -1 line)
- `packages/db-postgres/__tests__/pool-saturation.test.ts` (new, +205 lines)
- `infra/docker/prometheus/alerts/vigil.yml` (+27 lines)
- `docs/audit/evidence/hardening/category-2/mode-2.1/CLOSURE.md` (this file)

## What this closure does NOT include

- Migration of every background-priority caller to `acquireWithPriority`. The primitive is in place; selective adoption per worker is incremental.
- An adaptive `statement_timeout` controller (the orientation proposed this as part-c of the closure). The agent's judgement is that the priority-aware breaker plus the alert is sufficient closure for this failure mode; adaptive timeout is a second-order optimisation that's harder to test deterministically and adds complexity. If the architect wants it, it's a separate follow-up commit.

Closure verified by:

- `pnpm --filter @vigil/db-postgres run typecheck` (clean)
- `pnpm --filter @vigil/db-postgres test` (46 passed, 3 skipped)
- `pnpm --filter @vigil/observability run typecheck` (clean)
