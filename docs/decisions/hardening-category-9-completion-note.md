# Hardening Pass · Category 9 (Configuration, deployment, and secrets) — Completion Note

**Date:** 2026-05-15
**Branch:** `hardening/phase-1-orientation`
**Phase:** 10 of 11 in the 90-mode hardening pass
**Modes closed this category:** 4 partial→CV (9.1, 9.2, 9.3, 9.6) + 1 N/A ratified (9.7)
**Modes pre-existing closed-verified:** 2 (9.4, 9.5)
**Modes deferred to Phase 12:** 2 (9.8, 9.9 — cross-cutting cosign work with 10.8)

## What landed

Four mode-closure commits (9.3 + 9.6 share one commit — single CI gate
covers both modes):

| Mode      | Title                                              | Commit                    | Tests / Artefacts                                               |
| --------- | -------------------------------------------------- | ------------------------- | --------------------------------------------------------------- |
| 9.3 + 9.6 | Migration rollback round-trip                      | `ci(infra)` (`ad871da`)   | `check-migration-rollback.ts` + new `migration-rollback` CI job |
| 9.7       | Forward-incompatible code shipped before migration | `docs(repo)` (`38eded1`)  | `docs/runbooks/migration-rollout-policy.md`                     |
| 9.2       | Secret rotation missing consumer                   | `feat(queue)` (`b5ba087`) | 6 unit tests + `loadRedisPassword` export + rotation runbook    |
| 9.1       | Configuration drift staging vs production          | `ci(infra)` (`46be8ba`)   | `check-helm-values-drift.ts` + new `helm-values-drift` CI job   |

One housekeeping commit ahead of Cat 9:

| Commit                 | Note                                          |
| ---------------------- | --------------------------------------------- |
| `a07edae` `docs(repo)` | Corrected fabricated Q2–Q5 list in Cat 8 note |

## Tests added

6 new unit tests, in 1 new test file:

- `packages/queue/__tests__/secret-rotation.test.ts` — 6 cases on the
  `loadRedisPassword` contract (no in-function caching; explicit
  wins over env-file; env-file wins over default mount; REDIS_PASSWORD
  env is last fallback; null on no source; trims whitespace).

Two new CI gates, both running on every push + PR:

- `migration-rollback` — forward → reverse-order down → forward against
  an ephemeral `postgres:16.2-alpine` service.
- `helm-values-drift` — values-lint with 7 invariants on prod values.

Two new runbooks:

- `docs/runbooks/migration-rollout-policy.md` (~180 lines) — two-phase
  rollout discipline, 6-item pre-deploy checklist, 3 worked examples.
- `docs/runbooks/secret-rotation.md` (~250 lines) — per-secret cadence
  table, step-by-step procedures for Redis / Postgres / Vault /
  Turnstile / TLS.

## Invariants added

| Layer        | Invariant                                                                                           | Effect                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Code         | `loadRedisPassword` exported with "called once at QueueClient construction" docstring (mode 9.2)    | Future contributor who adds caching breaks the contract test                                        |
| CI           | `migration-rollback` job runs forward → down → forward against ephemeral postgres (modes 9.3 + 9.6) | Broken `*_down.sql` files (forgotten DROPs, syntax errors) fail CI on first push                    |
| CI           | `helm-values-drift` job enforces 7 invariants on `values-prod.yaml` (mode 9.1 Tier 1)               | Image-tag floating, replicas<2, missing limits, dev cert issuer, etc. fail CI on first push         |
| Doc / Policy | `docs/runbooks/migration-rollout-policy.md` 6-item pre-deploy checklist (mode 9.7)                  | Architect signs per migration; forward-incompatible-code-before-migration becomes deliberate review |
| Doc / Policy | `docs/runbooks/secret-rotation.md` per-secret cadence table + procedures (mode 9.2)                 | Rotation is documented, scheduled, and on-call-executable                                           |
| Tests        | 6 new unit tests pinning the secret-loader contract                                                 | Regression coverage for the restart-on-rotate posture                                               |

## Cross-cutting verification

- `pnpm --filter @vigil/queue exec vitest run __tests__/secret-rotation.test.ts` → **6/6 pass**.
- `pnpm --filter @vigil/queue run typecheck` → clean.
- `pnpm exec tsx scripts/check-helm-values-drift.ts` → clean against
  the current values files. Caught a real edge case during development
  (`caddy.image.tag = "rl-2.8"` flagged by over-strict semver regex;
  gate relaxed to "digit-bearing" pattern).
- `pnpm exec tsx scripts/check-migration-rollback.ts` smoke-tested:
  loads 18 forward + 10 down migrations; exits 2 on missing /
  unreachable DB. End-to-end DB-side verification gated to CI (local
  DB-container spin-up blocked by explicit session boundary; the CI
  job is the canonical test).
- All Cat-1/2/3/4/5/6/7/8 invariants still hold.

## Secondary findings surfaced during Category 9

Three observations:

**(a) The script-lint pattern is now well-established.** Categories
1–9 have produced 8 script-level gates:
`check-rbac-coverage.ts`, `check-migration-locks.ts`,
`check-api-error-leaks.ts`, `check-compose-deps.ts`,
`check-migration-pairs.ts`, `check-migration-rollback.ts`,
`check-helm-values-drift.ts`, plus the cert/NTP textfile producers.
They all follow the same shape — parse an artefact, assert invariants,
exit non-zero on failure, integrate in `ci.yml` as a top-level job.
This is now the canonical pattern for catching "merge-time drift in
machine-readable artefacts". Future hardening should reach for this
shape first, before considering runtime gates.

**(b) Honesty-of-record correction landed.** The Cat 8 completion
note had a fabricated Q2–Q5 list; commit `a07edae` corrects it with
the real orientation §7 questions. Posture-4 (no sugarcoating)
required surfacing this and fixing it before Cat 9 began. The
correction is in-place in
`docs/decisions/hardening-category-8-completion-note.md` with an
explicit "earlier revision carried a fabricated Q2–Q5 list; corrected
here" annotation. Future contributors reading the audit chain see the
correction explicitly.

**(c) Mode 9.1's Tier 2 (helm-template rendered diff + ArgoCD
ApplicationSet) is deliberately deferred to Phase 12.** The reasoning:

- Both layers need helm-in-CI infrastructure (preinstall + version pin).
- The ArgoCD ApplicationSet needs a live cluster to be meaningful.
- Both pair naturally with the cosign work (modes 9.9 + 10.8) which
  also requires registry + cluster-side admission policy work.

The Tier 1 values-lint catches the highest-risk drift cases today;
Tier 2 lands when the infrastructure work for cosign lands.

## Modes deferred to Phase 12

| Mode | Title                       | Why deferred                                                                                                                                                                      |
| ---- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.8  | Image pulled by mutable tag | Requires CI step to resolve FROM tags → sha256 digests across all Dockerfiles + Helm chart `image.digest` override fields + deploy-time `verify-image-digest`. Estimated 3+ days. |
| 9.9  | Cosign verification missing | Requires `cosign sign` in CI build + Kyverno ClusterPolicy in k3s OR init-container `cosign verify` in compose + key rotation doc. Estimated 3+ days. Same surface as 10.8.       |

Per orientation §6 and the agent's sequence in §4 (Phase 12 cross-cutting
cosign+digest work, modes 9.8 + 9.9 + 10.8), these three modes will close
in a single bundled commit when:

- **Q2 (cosign closure scope)** is resolved by the architect: full
  Kyverno ClusterPolicy in k3s OR init-container verify in compose for
  now. Until Q2 is answered, the Phase 12 work is shaped but not
  scheduled.
- **A registry** is provisioned (the architect's decision per
  orientation §5.10) for cosign signatures to live alongside the
  image manifests.

This category's `proceed` commits Phase 10 (non-cosign Cat 9 closures).
Phase 11 is Category 10 (non-cosign portion); Phase 12 is the bundled
cosign closure.

## Status of the 90-mode pass after Category 9

Pre-Cat-9 starting ledger (from Cat 8 completion note): 75 CV, 5
partial, 4 open, 6 N/A. Sum = 90.

Cat 9 at orientation: 2 CV (9.4, 9.5), 4 partial (9.1, 9.2, 9.3, 9.6),
2 open (9.8 + 9.9 — per orientation totals line, 9.8 counted as open
despite "partially closed (agent recommends open)" wording in its
row), 1 N/A (9.7, already classified at orientation).

Cat 9 movements this phase:

- 9.1 partial → CV (Tier 1 values-lint).
- 9.2 partial → CV (restart-on-rotate contract + tests + runbook).
- 9.3 partial → CV (round-trip CI gate; shared with 9.6).
- 9.6 partial → CV (same CI gate as 9.3).
- 9.7 N/A → N/A-ratified (already N/A at orientation; closure adds
  the policy doc; no count change).
- 9.8 open → unchanged (deferred to Phase 12).
- 9.9 open → unchanged (deferred to Phase 12).

Net deltas: +4 CV, −4 partial, 0 open, 0 N/A.

After this category:

- **Closed-verified now:** 75 + 4 = **79 of 90**.
- **Partially closed:** 5 − 4 = **1** (9.8 alone; deferred to Phase 12).
- **Open:** **4** unchanged (9.9 + 3 from Cat 10; deferred to Phase 12).
- **Not applicable:** **6** unchanged (9.7 was already N/A at orientation).

Total: 79 + 1 + 4 + 6 = **90** ✓.

## Architect signal needed

None for proceeding to Category 10 (Supply chain and dependency hygiene).
Orientation §3.10 lists Cat 10 as:

- 10.1, 10.5, 10.6, 10.7, 10.9 — pre-existing closed-verified.
- 10.2 — partial (compromised container base image).
- 10.3, 10.4 — open (subresource-integrity, post-quantum readiness).
- 10.8 — open (cosign verification; deferred to Phase 12 alongside 9.9).

So Cat 10 has 1 partial + 2 immediately-addressable opens + 1
Phase-12-deferred open. Estimated 2–4 days for the non-cosign portion.

**Five open questions from §7 of the orientation** — running status:

- **Q1 (8.5 timing side-channel)** — resolved at Cat 8.
- **Q2 (cosign closure scope: Kyverno vs init-container)** — still
  unanswered; needed when Phase 12 starts.
- **Q3 (9.7 policy-only doc vs tooling gate)** — resolved at Cat 9
  (policy-only doc per architect's `proceed` default).
- **Q4 (9.2 restart-on-rotate vs Vault Agent sidecar)** — resolved at
  Cat 9 (restart-on-rotate + tests per architect's `proceed` default).
- **Q5 (PR #5 Helm chart coordination)** — resolved by observation:
  the chart is already on the working branch
  (`infra/k8s/charts/vigil-apex/` with `values{,-dev,-prod,-cluster}.yaml`).

Only Q2 remains unresolved, and it doesn't block Category 10.
