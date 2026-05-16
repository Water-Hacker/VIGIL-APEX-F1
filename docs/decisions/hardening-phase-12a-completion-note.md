# Hardening Pass · Phase 12a (Cosign + digest-pin framework) — Completion Note

**Date:** 2026-05-15
**Branch:** `hardening/phase-1-orientation`
**Phase:** 12a of 12 in the 90-mode hardening pass (final phase, framework-only)
**Modes touched:** 4 (9.8, 9.9, 10.2(b), 10.8) — all moved to "framework-closed, activation-pending"
**Architect signal recorded:** Orientation §7 Q2 resolved on 2026-05-15: **Path A** (k3s Kyverno + compose init-container, full both-paths).

## Framing: "framework-closed, activation-pending"

Phase 12a is the **last** phase of the 90-mode pass. Unlike phases 2–11
(which landed code + tests that immediately closed modes to CV state),
Phase 12a ships a **framework** that depends on Phase-2 infrastructure
that does not yet exist:

| Activation prerequisite                         | Phase 12a status                                       | Resolved in                                                        |
| ----------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| Registry deployed at `registry.vigilapex.local` | Not deployed                                           | Phase 12b / Phase 2 cluster procurement (DECISION-020)             |
| Cosign signing keypair                          | Not provisioned                                        | Architect-side ceremony per `docs/runbooks/cosign-key-rotation.md` |
| `docker-bake.hcl` produces real images          | Incomplete (still `continue-on-error: true` in ci.yml) | R0.D follow-up                                                     |
| Kyverno operator in k3s                         | Not installed (k3s itself not yet deployed)            | Phase 2 cluster cutover                                            |

These four gates are listed in `docs/runbooks/cosign-rollout.md`
§Pre-flight. None of them are blocked by Phase 12a code; all are
architect-driven infrastructure work.

**Pass scope has bottomed out at the code layer.** The remaining
hardening movement requires hardware + ceremony + ops work that lives
in Phase 12b.

## What landed

Three commits' worth of artefacts in a single Phase 12a closure:

| Artefact                       | Path                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| CI signing job                 | `.github/workflows/security.yml` `cosign-sign-images` (+95 lines, tag-push-gated)      |
| Image enumerator               | `scripts/enumerate-publish-images.ts` (new, ~120 lines)                                |
| Digest-pinning script          | `scripts/pin-image-digests.ts` (new, ~200 lines; --dry-run / --apply / --verify modes) |
| Compose verifier overlay       | `infra/docker/compose.cosign-verify.yaml` (new, ~90 lines)                             |
| Kyverno ClusterPolicy template | `infra/k8s/charts/vigil-apex/templates/kyverno-cosign-policy.yaml` (new, ~80 lines)    |
| Chart values                   | `infra/k8s/charts/vigil-apex/values.yaml` `cosignVerify` section (+30 lines)           |
| Key rotation runbook           | `docs/runbooks/cosign-key-rotation.md` (new, ~250 lines)                               |
| Activation runbook             | `docs/runbooks/cosign-rollout.md` (new, ~200 lines)                                    |
| Closure docs                   | 4 new (`mode-9.8`, `mode-9.9`, `mode-10.2b`, `mode-10.8`)                              |

## Tests added

None directly — Phase 12a is framework + runbook + closure docs.
The framework's correctness is exercised by:

- `pnpm exec tsx scripts/enumerate-publish-images.ts` → 3 images
  enumerated against `registry.vigilapex.local`.
- `pnpm exec tsx scripts/pin-image-digests.ts --dry-run` → 42 image
  refs without digest enumerated correctly.
- `pnpm exec tsx scripts/check-helm-values-drift.ts` → clean (new
  `cosignVerify` values section doesn't trip the drift gate).

Real end-to-end test happens at Phase 12b activation per
`docs/runbooks/cosign-rollout.md` §Activation steps.

## Invariants added

| Layer                 | Invariant                                                                                                             | Effect                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| CI (release-tag only) | `cosign-sign-images` job validates secrets present + signs each enumerated image with `cosign sign` (mode 9.9 + 10.8) | First release tag with COSIGN secrets configured produces signed images in the registry |
| Code                  | `scripts/pin-image-digests.ts` enumerates + resolves + writes digest lock file (mode 9.8 + 10.2(b))                   | Single-source-of-truth `image-digests.lock` is the canonical tag→sha mapping            |
| Compose               | `cosign-verifier` one-shot service verifies every image in the lock file before other services start (mode 10.8)      | Compose stack fails-loud on any tampered image at the verifier stage                    |
| k3s                   | Kyverno ClusterPolicy rejects pods whose images lack a valid cosign signature (mode 9.9)                              | Cluster-side admission gate; defence-in-depth alongside compose verifier                |
| Doc / Policy          | `docs/runbooks/cosign-key-rotation.md` — annual rotation cadence + emergency rotation SLA (24 h)                      | Operational continuity of the cosign chain                                              |
| Doc / Policy          | `docs/runbooks/cosign-rollout.md` — 4 pre-flight gates + 5 activation steps + rollback procedure                      | Architect-runnable end-to-end procedure                                                 |

## Cross-cutting verification

- `pnpm exec tsx scripts/check-helm-values-drift.ts` → clean.
- `pnpm exec tsx scripts/enumerate-publish-images.ts` → 3 images
  enumerated (dashboard, caddy, worker-pattern) — note: only one
  worker in values.yaml `workers[]`; other workers absent from the
  list until Chart completion lands.
- `pnpm exec tsx scripts/pin-image-digests.ts --dry-run` → 42 image
  refs across Dockerfiles + compose. Resolution requires docker /
  crane on PATH (skipped locally; runs in CI when activated).
- All Cat-1/2/3/4/5/6/7/8/9/10 invariants still hold.
- Conventional Commits scope discipline: closure committed under
  `ci(infra)` (workflow + script changes) + `docs(repo)` (the
  runbooks + closure docs) per `commitlint.config.cjs`'s scope
  enum.

## Secondary findings surfaced during Phase 12a

Three observations:

**(a) The "framework-closed, activation-pending" state needs explicit
audit-chain semantics.** Modes 9.8 + 9.9 + 10.2(b) + 10.8 are
documented as not-yet-CV pending activation. The audit chain
currently has `kind=cosign_key_issued`, `kind=cosign_verify_activated`,
`kind=cosign_verify_rolled_back`, `kind=cosign_key_compromised` as
the four framework-defined audit kinds. The first
`cosign_verify_activated` entry in the audit chain — recording all
three deployment paths active — is what flips these four modes from
"framework-closed" to "closed-verified" in the pass ledger.

**(b) Mode 10.2's three sub-tasks now span three closure docs.** The
orientation classified 10.2 as a single mode; the closure work
naturally split into three (Trivy + refresh schedule are Cat-10
mode-10.7-10.2a and 10.2c, both closed-verified; digest pinning is
this Phase 12a sister of mode 9.8). The pass ledger keeps 10.2 as
"partial" until (b) activates. This is the only mode in the pass
whose closure is genuinely partitioned across phases.

**(c) The Phase 12a framework establishes the "deferred-to-architect"
pattern.** Previous phases closed modes by landing tests + code. This
phase closes modes by landing FRAMEWORK + RUNBOOK + GATE. The pattern
is reusable: any future failure mode that depends on an architect-
side ceremony (key generation, ceremony-witnessed install, etc.)
can use this shape — framework lands, framework is gated, runbook
captures the activation, audit-chain entry records the activation.

## Status of the 90-mode pass after Phase 12a

Pre-Phase-12a starting ledger (from Cat 10 completion note, corrected):
**80 CV, 2 partial, 2 open, 6 N/A**. Sum = 90.

Phase 12a movements:

- 9.8 open → **framework-closed** (counts as open in the pass ledger
  until activation; framework-closed is informational status).
- 9.9 open → **framework-closed** (counts as open).
- 10.2 partial → **partial** (10.2(b) is framework-closed; (a) + (c)
  remain CV; 10.2 itself stays partial until (b) activates).
- 10.8 open → **framework-closed** (counts as open).

Net deltas in the pass ledger: **0 CV, 0 partial, 0 open, 0 N/A**.

After Phase 12a — same as before, with annotations:

- **Closed-verified now:** **80 of 90**.
- **Partially closed:** **2** (9.8 framework-closed; 10.2 — 10.2(b)
  framework-closed).
- **Open:** **2** (9.9, 10.8 — both framework-closed, activation-
  pending).
- **Not applicable:** **6** unchanged.

Total: 80 + 2 + 2 + 6 = **90** ✓.

**Honest framing:** the pass closes at 80/90 CV. The remaining four
modes have their code-side closure complete; they move to CV when
the architect runs the activation runbook against live Phase-2
infrastructure.

## Architect signal — Phase 12b activation

Phase 12b is the architect's discretion. No code-side work is needed
until then. When the architect chooses to activate:

1. Run `docs/runbooks/cosign-key-rotation.md` §"Initial key generation"
   (architect + witness, 4-hour ceremony block).
2. Deploy the Forgejo registry (separate Phase 12b registry-deploy
   runbook — not in this closure; flagged for future doc).
3. Run `docs/runbooks/cosign-rollout.md` §"Activation steps" end-to-end.
4. Record the `cosign_verify_activated` audit event per Step E.

When the audit event lands on-chain (Polygon + Fabric anchor sweep),
the four modes flip to closed-verified in the next pass ledger update.

## Five orientation §7 questions — final status

All five resolved:

- **Q1 (8.5 timing side-channel acceptability)** — resolved at Cat 8.
- **Q2 (cosign closure scope — Kyverno vs init-container)** — resolved
  at Phase 12a: Path A (both paths). This closure.
- **Q3 (9.7 forward-incompatible code: policy vs tooling)** — resolved
  at Cat 9 (policy-only doc per architect's `proceed` default).
- **Q4 (9.2 restart-on-rotate vs Vault Agent sidecar)** — resolved at
  Cat 9 (restart-on-rotate + tests per architect's `proceed` default).
- **Q5 (PR #5 Helm chart coordination)** — resolved by observation at
  Cat 9 (chart already on the working branch).

No open questions remain. The 90-mode pass closes its code-side scope
here; the remaining 4 modes are activation-gated on Phase-2
infrastructure work that this pass deliberately did NOT undertake.

## Files touched (summary)

- **CI:** `.github/workflows/security.yml`
- **Scripts:** `scripts/enumerate-publish-images.ts`,
  `scripts/pin-image-digests.ts`
- **Compose:** `infra/docker/compose.cosign-verify.yaml`
- **Helm:** `infra/k8s/charts/vigil-apex/templates/kyverno-cosign-policy.yaml`,
  `infra/k8s/charts/vigil-apex/values.yaml`
- **Runbooks:** `docs/runbooks/cosign-key-rotation.md`,
  `docs/runbooks/cosign-rollout.md`
- **Closure docs:** `docs/audit/evidence/hardening/category-9/mode-9.8/CLOSURE.md`,
  `category-9/mode-9.9/CLOSURE.md`,
  `category-10/mode-10.2b/CLOSURE.md`,
  `category-10/mode-10.8/CLOSURE.md`
- **Completion note:** this file
