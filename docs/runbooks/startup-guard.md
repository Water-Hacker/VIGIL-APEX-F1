# Runbook — StartupGuard (mode 1.7 crash-loop circuit breaker)

> Operator reference for the `vigil_worker_startup_failures_total` metric
>
> - the `StartupGuard` exit-code behaviour. Closes documentation Issue 8
>   from the post-pass code review of mode 1.7.

---

## What StartupGuard does

Every VIGIL APEX worker now wraps its `main()` boot sequence with two
calls — `await guard.check()` at the top, `await guard.markBootSuccess()`
after init completes. The guard:

1. Reads a per-service sentinel file at
   `/run/vigil/<service>.startup-failures.json` (override via the
   `VIGIL_STARTUP_SENTINEL_DIR` env or `sentinelDir` option).
2. Counts failed-startup timestamps within `windowMs` (default 5 min).
3. If the count ≥ `maxFailures` (default 5), sleeps for an
   exponentially-growing pre-exit duration (initial 30 s, capped 5 min)
   then exits with code 42.
4. Otherwise records a boot-in-progress entry, returns control to
   `main()`, and waits for the worker to call `markBootSuccess()` once
   init succeeds — at which point the entry is removed.

The pre-exit sleep is the load-bearing piece: even when the orchestrator
ignores exit codes (e.g. compose `restart: unless-stopped`), each restart
is now spaced minutes apart rather than seconds. That spacing is what
buys operators the bandwidth to intervene before logs flood and CPU
saturates.

---

## What you see when it fires

### Prometheus

`vigil_worker_startup_failures_total{service="<name>"}` increments by
1 on each trip. The time series is materialised at zero from the moment
each worker starts, so "no trips yet" is distinguishable from "metric
never armed" in Grafana.

Two patterns worth alerting:

```
# Single trip in the last hour — investigate.
increase(vigil_worker_startup_failures_total[1h]) > 0

# Repeated trips — operator action overdue.
increase(vigil_worker_startup_failures_total[1h]) > 3
```

### Logs

The guard emits three `logger.*` events:

| Level   | Message                                                                                   | Meaning                                                                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `info`  | `startup-guard-armed`                                                                     | Boot is in progress; failure count below ceiling. Normal.                                                                                                               |
| `error` | `startup-guard-tripped; sleeping before exit to slow the orchestrator restart cadence`    | Trip fired. The worker will sleep + exit.                                                                                                                               |
| `error` | `startup-guard-sentinel-write-failed; crash-loop protection NOT armed for this boot`      | The sentinel file couldn't be written (disk full, permissions, tmpfs unmounted). The boot did NOT silently proceed — it threw and `main().catch` will exit the process. |
| `info`  | `startup-guard-cleared`                                                                   | `markBootSuccess()` succeeded; in-progress entry removed. Normal.                                                                                                       |
| `warn`  | `startup-guard-sentinel-dir-not-writable; crash-loop detection will run in degraded mode` | `preflight()` found the sentinel dir unwritable. Worker boots but the guard's counter won't accumulate.                                                                 |

---

## What to do when the guard trips

### 1. Identify the worker

The label on the metric + the structured `service:` field in the log
event tell you which worker tripped. Each worker's sentinel file lives
at `/run/vigil/<service>.startup-failures.json`.

### 2. Read the sentinel file

```bash
sudo cat /run/vigil/<service>.startup-failures.json
# Expected shape:
# {"version": 1, "failures": [1715800000000, 1715800030000, ...]}
```

The `failures` array contains unix-millisecond timestamps of the last
several failed boots within the active window.

### 3. Triage the underlying failure

The guard is a SYMPTOM, not a cause. The actual error lives in the
worker's logs from the failing boots. Pull the last several boot
attempts from the log aggregator:

```bash
# Recent fatal-startup log lines for the tripped worker:
kubectl logs --previous --tail=200 -l app=<service>
# Or for compose:
docker compose logs --tail=200 <service>
```

Common root causes (per architect's experience):

- Missing env var: `Schemas.zEnv.parse(process.env)` rejects.
- Vault unreachable: `vault-unseal.service` hasn't run yet or Vault is sealed.
- Postgres misconfigured: `getDb()` fails on first connect.
- Audit-chain init failed: `chain.append(...)` from `auditFeatureFlagsAtBoot` throws.
- Worker code change introduced an async error in init that wasn't caught.

### 4. Fix the root cause + manually reset the sentinel

After deploying the fix, the failure history in the sentinel can be
manually cleared so the next boot doesn't inherit the previous trip's
pressure:

```bash
sudo rm /run/vigil/<service>.startup-failures.json
# Restart the worker
docker compose restart <service>    # or kubectl rollout restart deployment/<service>
```

A reboot of the host also resets the sentinel (since `/run/vigil` lives
on tmpfs). This is the only legitimate "all-clear" event the guard
respects automatically.

### 5. Confirm recovery

```bash
# The metric should stop incrementing.
curl -s http://<worker>:9100/metrics | grep vigil_worker_startup_failures_total

# A successful boot logs `startup-guard-cleared`.
docker compose logs --tail=20 <service> | grep startup-guard
```

---

## Exit code 42

The guard exits with code 42 on trip. This is a deliberate sentinel
value distinct from the worker's normal exit codes (0 success, 1
generic failure, 130 SIGINT, 143 SIGTERM). Orchestrators that respect
`restart: on-failure:N` policies see code 42 as a failure; the
exponential pre-exit sleep slows the next restart even when the policy
is `unless-stopped` (which ignores exit codes entirely).

If you need to override the exit code (e.g. to make Kubernetes treat
the trip as a non-restart event), set the `exitCode` option in
`StartupGuard`'s constructor at the worker.

---

## When NOT to use StartupGuard

The guard is appropriate for workers whose boot completes in seconds
and whose failures should be counted across recent restarts. It is
**not** appropriate for:

- **Slow-boot workers** (multi-minute migrations, long warm-up). Increase
  `windowMs` + `maxFailures` proportionally OR disable for that worker.
- **Workers with intentionally-flaky init** that retry internally before
  reporting success. The guard counts the OUTER boot, not the inner
  retries — if those internal retries succeed and the worker eventually
  calls `markBootSuccess()`, the entry is cleared.
- **One-shot jobs** (the cosign-verifier oneshot pattern). The guard is
  for long-running workers that restart on crash; a one-shot exits 0
  normally.

For any of the above, pass `enabled: false` in the worker's guard
config OR don't construct the guard at all.

---

## Implementation notes (code-reviewer follow-ups)

These are the closures of the code-review issues raised on the initial
mode 1.7 implementation:

| Issue                                                      | Status                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Issue 1 — zero-inc metric trick**                        | Closed: replaced with `prom-client`'s `.labels(...)` materialisation at constructor time.                                                                                                                                                                 |
| **Issue 2 — sentinel-dir permission handling**             | Closed: new `preflight()` method does a writability check; logs warn on failure (does NOT throw — boot-blocking on tmpfs misconfig would be worse than degraded mode). The sentinel-write failure path also surfaces via metric + log.                    |
| **Issue 3 — race condition / atomic write**                | Closed: `writeSentinel` now writes to `.tmp.<pid>` and POSIX-renames to the canonical path. Concurrent boots cannot observe a half-written sentinel.                                                                                                      |
| **Issue 4 — timestamp-collision in markBootSuccess**       | Closed: `indexOf + splice` replaces `filter`, so a same-millisecond double-boot only removes ONE marker (not all matching timestamps).                                                                                                                    |
| **Issue 5 — silent failure if writeSentinel itself fails** | Closed: sentinel-write failure now increments the failure counter, logs at error, AND throws — the worker's `main().catch` sees the failure rather than the guard silently bypassing.                                                                     |
| **Issue 6 — logger optional**                              | Mitigated: every state transition emits a metric (label materialised at construct), so observability is preserved when no logger is configured. Log messages remain logger-mediated; structured logs are the operator-facing channel.                     |
| **Issue 7 — tests**                                        | Already had 7 cases at `packages/observability/__tests__/startup-guard.test.ts`; **4 more added** for the new behaviour: atomic-write artefacts, same-millisecond exact-once removal, fail-loud sentinel-write, preflight writable check. 11 total cases. |
| **Issue 8 — operator documentation**                       | Closed by this runbook.                                                                                                                                                                                                                                   |

---

## Related

- `packages/observability/src/startup-guard.ts` — implementation.
- `packages/observability/__tests__/startup-guard.test.ts` — 11 cases.
- `packages/observability/src/metrics.ts` — `startupGuardFailuresTotal` counter.
- `docs/runbooks/primitive-adoption-guide.md` §"Adoption 3: StartupGuard" — per-worker adoption recipe.
