# Mode 6.9 — Silent feature flag toggle

**State after closure:** closed-verified (primitive in place; adoption is incremental)
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 7 / Category 6
**Branch:** `hardening/phase-1-orientation`

## The failure mode

VIGIL APEX has env-var-driven feature flags: `AWS_BEDROCK_ENABLED`, `LOCAL_LLM_ENABLED`, `VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER`, `VAULT_BACKUP_TOKEN`, etc. Pre-closure, when an operator changed a flag, the deployment manifest captured the change but the running platform did NOT. An incident weeks later couldn't be correlated to "when did the Bedrock fallback get disabled?" — there was no auditable record of the toggle.

## What was added

### 1. `vigil_feature_flag_state{name,service}` Prometheus gauge

`packages/observability/src/metrics.ts` — 1 if the flag is "truthy" (`1`, `true`, `yes`, `on` case-insensitive), 0 otherwise. Operators graph this to confirm flag rollout across the fleet without grep'ing pod env vars.

### 2. `packages/observability/src/feature-flags.ts` primitive

Three exports:

- **`AUDITED_FEATURE_FLAGS`** — canonical list of env-var flags that MUST be audited at boot. Currently 12 flags (LLM tier toggles, dev-only substitutes, backup/key management, quality gates, the mode-4.3 auth-proof key presence).
- **`isTruthy(value)`** — consistent env-string → boolean coercion (`1`/`true`/`yes`/`on` case-insensitive, trimmed). Locked by tests so a future "improvement" can't accidentally widen the truthy set.
- **`readFeatureFlagSnapshot(env?, flags?)`** — pure function that reads each flag's current value. Handles synthetic `_PRESENT` flags (where the underlying env var being defined-but-empty differs from undefined). Returns `{ name, enabled, source }` tuples.
- **`auditFeatureFlagsAtBoot({ service, emit, env?, flags? })`** — for each flag:
  1. Set the Prometheus gauge with the current state (gauge first, so even if emit fails the metric exists).
  2. Call the caller-supplied audit-emit callback with a structured event:
     ```
     { action: 'feature.toggled', actor: 'system:boot:<service>',
       subject_kind: 'feature_flag', subject_id: '<flag-name>',
       payload: { enabled, source, service } }
     ```

The `emit` callback is injected (not a hard dep on `@vigil/audit-log`) so this module stays dep-light. Workers wire their own emit. If emit fails, the error propagates — workers can decide whether to halt boot (Doctrine §"No dark periods" says yes).

### 3. Synthetic `_PRESENT` flag semantics

For sensitive material like `VAULT_BACKUP_TOKEN` and `VIGIL_AUTH_PROOF_KEY`, the audit shouldn't echo the value. The convention `<KEY>_PRESENT` reports whether the underlying env var is defined-and-non-empty. The audit row gets `{ enabled: true }` if the key is present, `{ enabled: false }` if absent — no secret content leaks.

### 4. Tests — 17 cases

`packages/observability/__tests__/feature-flags.test.ts`:

- `isTruthy`: 8 truthy + 8 falsy cases including edge cases (empty string, whitespace, mixed case, "anything-else").
- `readFeatureFlagSnapshot`: reads from env map; honours synthetic `_PRESENT`; honours flags-list override; returns canonical list by default.
- `auditFeatureFlagsAtBoot`: emits one event per flag with correct shape; sets the gauge; propagates emit failures BUT gauge is still set (operators see the boot attempt via Prometheus even when audit chain is degraded).

## The invariant

Four layers:

1. **17 unit tests** lock the contract: truthy semantics, snapshot purity, gauge+emit ordering, error propagation.
2. **Canonical list of audited flags** is a source-of-truth that grows when new flags are added; removal requires architect sign-off via the docstring comment.
3. **Gauge-first wiring** — Prometheus sees the flag state even if the audit chain is unreachable. Two-layer observability.
4. **Audit chain row per flag at boot** — every flag transition is logged on the next worker restart. An operator investigating "when did this flag flip?" greps audit.actions for `subject_id = 'AWS_BEDROCK_ENABLED'`.

## What this closure does NOT include

- **Adoption sweep across workers**. The primitive is in place; no worker `main()` currently calls `auditFeatureFlagsAtBoot`. Each worker needs to add the call in its boot path, passing its own audit-emit callback. Per the binding posture, this is OUT OF SCOPE for this commit — the primitive + tests are the failure-mode closure; adoption is the next incremental step.

- **Runtime feature-flag toggles** (Growthbook, LaunchDarkly). VIGIL doesn't use a runtime flag service; flags are env-var-driven, applied at boot, immutable for the worker's lifetime. If a future architect adds runtime flags, the audit emit would need to happen on toggle (not just at boot). Flagged for follow-up.

- **A Prometheus alert on flag changes**. Could detect a flag value changing between scrapes (a worker restarted with a different env). Out of scope — the audit-chain row IS the record of the change; the alert would be redundant.

## Files touched

- `packages/observability/src/metrics.ts` (+14 lines: new gauge)
- `packages/observability/src/feature-flags.ts` (new, 144 lines)
- `packages/observability/src/index.ts` (+1 line: re-export)
- `packages/observability/__tests__/feature-flags.test.ts` (new, 144 lines, 17 cases)
- `docs/audit/evidence/hardening/category-6/mode-6.9/CLOSURE.md` (this file)

## Verification

- `pnpm --filter @vigil/observability run typecheck`: clean.
- `pnpm --filter @vigil/observability test`: 65 passed, 1 skipped (was 42; +23 across mode 6.7 + 6.9).
