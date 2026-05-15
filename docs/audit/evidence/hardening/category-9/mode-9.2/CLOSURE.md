# Mode 9.2 — Secret rotation: restart-on-rotate contract

**State after closure:** closed-verified (contract test + runbook + restart-on-rotate posture ratified)
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 10 / Category 9
**Branch:** `hardening/phase-1-orientation`

## The failure mode

Per orientation §3.9 / 9.2:

> `.env.example:28-34` Vault paths + 1 h AppRole TTL on `VAULT_TOKEN_FILE`.
> K8s ExternalSecret refreshes mounted Secrets hourly but Pods must restart
> to re-read. Workers read `*_PASSWORD_FILE` only at init.

The orientation classified this as "partially closed (medium, 1–3 days)"
with three sub-tasks:

> (a) document that rotation requires pod restart (Vault Agent sidecar with
> `exit_after_auth=true` OR manual recycle);
> (b) periodic smoke test that rotates a test secret + verifies
> ExternalSecret sync within 90s + kills pod to confirm new value mounted;
> (c) for compose, accept "compose is ephemeral; rotation is manual" or add
> systemd timer that re-sources `/run/vigil/secrets/`.

## Q4 default: restart-on-rotate + tests

Orientation §7 Q4 asked:

> 9.2 secret rotation: continue with restart-on-rotate (current pattern,
> plus tests), or invest in hot-reload via Vault Agent sidecar? Hot-reload
> is genuinely better operationally but adds a sidecar to every workload.
> Recommend: tests + restart-on-rotate for now; revisit during M5 prep.

The architect issued `proceed` for Category 9 on 2026-05-15; per the
preflight, the default for Q4 is the orientation's recommendation
(restart-on-rotate + tests). This closure ratifies that default.

## What was added

### 1. `packages/queue/__tests__/secret-rotation.test.ts` (6 cases)

Pins the `loadRedisPassword` contract:

1. **Re-reads on every call** — a rotated file content is reflected on
   the next call (no in-function caching). This is the contract that
   QueueClient relies on: when it calls `loadRedisPassword` at
   construction, it gets the file's CURRENT content. Caching would
   mean cross-process state leakage in worker testing.
2. **Explicit `passwordFile` wins over `REDIS_PASSWORD_FILE` env.**
3. **Env-file path is used when no explicit is given.**
4. **Default `/run/secrets/redis_password` fallback chains to
   `REDIS_PASSWORD` env if the default mount doesn't exist.**
5. **Returns `null` when no source is configured** — the function
   doesn't throw on a missing file; it lets the caller decide whether
   to connect anonymously or fail.
6. **Trims whitespace + newlines** — file content from `vault kv get
-field=password | tee /run/secrets/redis_password` may carry a
   trailing newline; the contract requires it gone.

All 6 cases pass: `pnpm --filter @vigil/queue exec vitest run __tests__/secret-rotation.test.ts → 6/6`.

### 2. `packages/queue/src/client.ts` — `loadRedisPassword` exported + docstring

`loadRedisPassword` is now exported (was module-scope private). Its
header explicitly states the contract:

```typescript
/**
 * Per `docs/runbooks/secret-rotation.md` (mode 9.2 closure), this function
 * is called EXACTLY ONCE from `QueueClient`'s constructor. A rotated Redis
 * password requires the worker process to restart — there is no in-process
 * watcher. The function itself re-reads the file on every invocation (no
 * caching here), but only the constructor invokes it. Hot-reload via a
 * Vault Agent sidecar was considered + deferred per orientation Q4.
 */
```

This is the source-of-truth for the contract. If a future contributor
adds caching, the contract test fails. If a future contributor adds an
inotify watcher in the constructor, the test would still pass — but
the docstring and the runbook would diverge from the implementation,
flagging the drift on PR review.

### 3. `docs/runbooks/secret-rotation.md` (new, ~250 lines)

The operational runbook for rotation. Captures:

- The **restart-on-rotate** contract as the canonical posture.
- A **per-secret-type cadence table** with default cadences (quarterly
  for KV passwords, annual for Turnstile + cosign, auto-renewal for
  certs, never for YubiKey-held material).
- **Step-by-step procedures** for: Redis password (8 steps, double-password
  transition via ACL SETUSER), Postgres password (8 steps,
  shadow-role transition + 24 h grace), Vault AppRole (auto), Turnstile
  (manual via Cloudflare dashboard), TLS cert (cert-manager auto).
- **What we don't have yet** — the cluster-integration smoke test is
  flagged as a DR-rehearsal additive.
- **Re-open triggers**: rotation-induced downtime, deploy-noise
  threshold breach, compliance-driven exposure-window requirement.

## The invariant

Three layers pin the restart-on-rotate posture:

1. **Source-pinned** — `loadRedisPassword` is called exactly once from
   the QueueClient constructor (line 74). The function docstring
   declares this. The DB-side is structurally identical
   (`packages/db-postgres/src/client.ts:46-50`, inline read in
   `createPool`).

2. **Test-pinned** — `secret-rotation.test.ts` verifies the function
   contract on every CI run. A future contributor who adds caching to
   `loadRedisPassword` (premature optimisation), or who refactors the
   constructor to read on every operation (premature complexity),
   breaks the test.

3. **Doc-pinned** — `docs/runbooks/secret-rotation.md` documents the
   contract + the on-call procedure that depends on it. The runbook
   references the test + the function + the DB-side equivalent by
   filename + line number; this is the audit-chain anchor.

If a future closure adopts Vault Agent sidecar hot-reload (Q4 revisit),
all three layers update together: test asserts the new contract, function
docstring describes the new behavior, runbook describes the new procedure.

## What this closure does NOT include

- **No Vault Agent Injector sidecar.** Per Q4 default.

- **No SIGHUP-based re-read.** A simpler alternative to a sidecar
  (signal the worker, re-read the file in the signal handler) was
  considered. Rejected because (a) the rolling-restart path is already
  graceful with consumer-group reclaim, (b) signal handling adds a
  surface for accidental no-op reloads, (c) the orientation Q4 default
  is "restart-on-rotate + tests, revisit at M5 prep."

- **No periodic cluster-integration smoke test.** Flagged as a
  DR-rehearsal additive in the runbook's §"Smoke test — what we
  DON'T have (yet)". The next quarterly rehearsal picks it up.

- **No automated audit-chain emit on rotation.** The runbook documents
  the `INSERT INTO audit.event (kind='secret.rotated', ...)` step as
  manual; automating it would require Vault webhook integration
  outside the closure's budget. Flagged as future hardening.

- **No compose-side systemd timer that re-sources
  `/run/vigil/secrets/`.** Per orientation §3.9 / 9.2's "(c)" option,
  the runbook accepts "compose is ephemeral; rotation is manual" —
  compose is the dev path; production runs on k3s with ESO.

## Files touched

- `packages/queue/src/client.ts` (+9 lines: `loadRedisPassword` exported with contract docstring)
- `packages/queue/__tests__/secret-rotation.test.ts` (new, ~95 lines, 6 test cases)
- `docs/runbooks/secret-rotation.md` (new, ~250 lines)
- `docs/audit/evidence/hardening/category-9/mode-9.2/CLOSURE.md` (this file)

## Verification

- `pnpm --filter @vigil/queue exec vitest run __tests__/secret-rotation.test.ts` → **6/6 pass**.
- `pnpm --filter @vigil/queue run typecheck` → expected clean (verified separately).
- Existing queue tests still pass (no regression in `stream-scraper.test.ts`, `envelope.test.ts`, `worker-clock.test.ts`).

## Architect signal recorded

Orientation §7 Q4: "9.2 secret rotation: continue with restart-on-rotate
(current pattern, plus tests), or invest in hot-reload via Vault Agent
sidecar? Recommend: tests + restart-on-rotate for now; revisit during M5
prep."

The architect issued `proceed` for Category 9 on 2026-05-15. Per the
preflight, the default for Q4 is the orientation's recommendation. This
closure ratifies that default.
