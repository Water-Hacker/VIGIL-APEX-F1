# Mode 1.7 — Infinite restart loop without circuit breaker

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 3 / Category 1
**Branch:** `hardening/phase-1-orientation`

## The failure mode

A worker that crashes during init (missing env var, Vault unreachable, Postgres misconfigured, container image bug) is restarted by docker-compose every few seconds forever — `restart: unless-stopped` ignores exit codes, and plain Compose doesn't honour `max-attempts`. The crash-loop generates log noise, eats CPU, and gives the operator no Prometheus signal that something is structurally wrong.

Pre-closure: every worker service in `infra/docker/docker-compose.yaml` uses `restart: unless-stopped` with no in-process guard. A worker that crashes 60 times per minute looks the same in `docker ps` as a worker that's healthy — operators only notice through logs.

## What was added

### 1. `StartupGuard` primitive in `@vigil/observability`

`packages/observability/src/startup-guard.ts` — file-tracked failure counter + exponential pre-exit sleep + Prometheus metric. Works regardless of restart-policy because:

- **Visibility:** the metric `vigil_worker_startup_failures_total{service}` makes the crash-loop observable even when the worker exits before reaching its first health-check tick.
- **Cadence shaping:** when the trip-threshold is exceeded, the guard sleeps for an exponentially-growing duration (default initial 30 s, capped at 5 min) BEFORE exiting. The orchestrator's auto-restart still kicks in, but the effective restart cadence is slowed by the sleep — operators get bandwidth to intervene before logs are unreadable.
- **Universal:** works under `restart: unless-stopped` (where exit codes are ignored, but the sleep slows things down), `restart: on-failure:N` (where exit code 42 triggers the operator-configured stop), and k3s `restartPolicy: Always` (where the kubelet's crash-loop-backoff stacks on top of our sleep).

### 2. Usage pattern

```typescript
const guard = new StartupGuard({ serviceName: 'worker-pattern', logger });
await guard.check(); // exits if too many recent failures
// ... do init work (Postgres, Vault, Redis) ...
await guard.markBootSuccess(); // remove the in-progress entry
// ... main loop ...
```

If `check()` returns, the guard has recorded a "boot-in-progress" entry in the sentinel file. If the worker crashes before `markBootSuccess()`, that entry persists and counts toward the next boot's failure count. If the worker reaches `markBootSuccess()`, the entry is removed and a clean boot doesn't accumulate.

Sentinel file path: `/run/vigil/<service>.startup-failures.json` (configurable via `VIGIL_STARTUP_SENTINEL_DIR` env or constructor option).

### 3. Prometheus alert

`infra/docker/prometheus/alerts/vigil.yml` — new rule `WorkerStartupCrashLoop`:

```yaml
expr: rate(vigil_worker_startup_failures_total[5m]) > 0
for: 1m
severity: critical
```

Fires when any service trips the guard at least once per 5 minutes for a sustained minute. Severity critical because a sustained crash-loop is structural failure of the worker contract.

### 4. Unit tests (7 cases)

`packages/observability/__tests__/startup-guard.test.ts`:

1. **First boot with no history**: armed, no trip; sentinel file created with the boot-in-progress entry.
2. **Below maxFailures**: no trip; entry appended.
3. **Trip path**: exits with the configured code (42 default).
4. **Pruning**: entries older than `windowMs` are dropped; old failures don't count.
5. **markBootSuccess clean-up**: when the only entry was the boot-in-progress, the sentinel file is removed entirely.
6. **markBootSuccess preserves prior entries**: removing only the current-boot entry; older real failures stay.
7. **Corrupt sentinel file**: treated as empty, rewritten with valid content (forwards-compat).

`exit()` and `now()` are injected via DI so tests don't actually kill the runner or depend on wall-clock time.

## The invariant

Three layers:

1. **The unit test (7 cases)** locks the trip / prune / cleanup behaviour.
2. **The Prometheus alert** `WorkerStartupCrashLoop` surfaces sustained pressure regardless of code path.
3. **The sentinel file** at `/run/vigil/` is observable to ops via `cat` even when the worker can't connect to Prometheus.

## What this closure does NOT include

- **Adoption across the worker fleet.** The primitive is in place; calling `await guard.check()` at the top of each worker's `main()` is the next incremental step. Out of scope for this commit per the binding posture.
- **Changing compose `restart:` policies.** The current `unless-stopped` works correctly with the sleep-before-exit pattern; switching to `on-failure:5` would honour the exit code but is a separate policy decision (and changes behaviour for stateful services like postgres / redis where unconditional restart is the right behaviour). Flagged for follow-up: workers (not stateful services) might benefit from `on-failure:5`.
- **Persisting across container restarts.** The sentinel file lives at `/run/vigil/` which is typically tmpfs in compose — sentinel state is lost on host reboot. That's intentional: the failure window is 5 min, much shorter than reboot intervals; a host reboot is itself a reset signal that operators want.

## Files touched

- `packages/observability/src/startup-guard.ts` (new, 188 lines)
- `packages/observability/src/index.ts` (+1 line: re-export)
- `packages/observability/src/metrics.ts` (+14 lines: `startupGuardFailuresTotal` counter)
- `packages/observability/__tests__/startup-guard.test.ts` (new, 184 lines)
- `infra/docker/prometheus/alerts/vigil.yml` (+15 lines: `WorkerStartupCrashLoop` alert)
- `docs/audit/evidence/hardening/category-1/mode-1.7/CLOSURE.md` (this file)

## Verification

- `pnpm --filter @vigil/observability run typecheck` — clean.
- `pnpm --filter @vigil/observability test` — 35 passed (was 28; +7 startup-guard).
