# Block D — completion summary

> **Status:** all 12 work commits + opening allowlist commit shipped on
> branch `fix/blockA-worker-entity-postgres-write-and-rulepass`. Awaiting
> architect review.
> **Branch tip:** `1e5d1d2` (D.11 / SRD §30 draft).
> **Span:** 2533430 (Block-D opener) → 1e5d1d2 (D.11). 13 commits.
> **Author:** build agent (Claude).

---

## 1. Commit summary

| #    | SHA       | Item                               | Verdict                                                                                                                                               |
| ---- | --------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D.0  | `2533430` | B5 allowlist                       | extended LEGACY_EXEMPT to D-000..D-016 per architect option (b). Phase-gate green on opening.                                                         |
| D.0  | `86cd127` | plan                               | `docs/work-program/BLOCK-D-PLAN.md` (12 commits + 4 batched hold-points).                                                                             |
| D.1  | `3fc985c` | C1 smoke                           | `scripts/smoke-stack.sh` (~150 lines) — compose up + healthcheck wait + dashboard probes.                                                             |
| D.2  | `30048e7` | C2 vault                           | Vault Shamir init verification status section in `docs/runbooks/vault-shamir-init.md`.                                                                |
| D.3  | `4801fe3` | C3 tor                             | `TorOnionDown` (>30m) + `TorOnionStale` (>2h) prometheus alerts.                                                                                      |
| D.4a | `2dbd5cb` | C4 data + workers                  | `vigil-data-plane.json` + `vigil-workers.json` (templated by `$worker`).                                                                              |
| D.4b | `fd0beae` | C4 LLM + findings                  | `vigil-llm.json` + `vigil-findings-pipeline.json`.                                                                                                    |
| D.4c | `bd36739` | C4 governance + overview + archive | `vigil-governance.json` + `vigil-operator-overview.json` + `archive-from-block-d/README.md` (14 archived dashboards justified per architect signoff). |
| D.5  | `98ba43f` | C5 falco                           | option (e)→(ii) replace shell rule; (a)→(α) refactor priv-esc; +3 NEW (b/c/d). 11 rules total. `RULE-TESTS.md` per-rule test matrix.                  |
| D.6  | `dd8bb26` | C6 sentinel                        | orchestration moved into `@vigil/observability`; integration test gated on 3 sentinel ports + 1 UDS; 6 cases all pass.                                |
| D.7  | `9238399` | C7 synthetic                       | `scripts/synthetic-failure.ts` + `.github/workflows/synthetic-failure.yml` — 5 violations, 5/5 REJECTED locally.                                      |
| D.8  | `7a31aae` | C8 PR + commitlint                 | broken `IMPLEMENTATION-PLAN.md` ref fixed; commitlint smoke-tested 4 cases (PASS / type-enum / scope-enum / header-max-length).                       |
| D.9  | `7bd178b` | C9 backup                          | extended `verify-backup-config.sh` with 5 architect-spec coverage warnings; new `docs/runbooks/backup.md`.                                            |
| D.10 | `fc95ca0` | C10 secret-scan                    | 2 false positives triaged (EU sanctions public token; k8s ExternalSecrets path). 0 leaks post-allowlist.                                              |
| D.11 | `1e5d1d2` | A8 SRD §30 draft                   | `docs/source/SRD-30-enumeration-draft.md` — 39 CITED + 20 INFERRED tests across §30.1..§30.7.                                                         |

---

## 2. Architect-action items surfaced

The block deliberately surfaced (not silently fixed) the following
items for architect resolution:

### 2.1 Vault Shamir runbook drift (from D.2)

`docs/runbooks/vault-shamir-init.md` describes `--recipient` flags
the live `infra/host-bootstrap/03-vault-shamir-init.sh` does not
accept. **Architect-action options:**

- (A) Match runbook to script (drop the `--recipient` language;
  document the script's actual interface).
- (B) Extend script to support `--recipient` flags (more flexible
  but a script change).

Default: M0c hardening week — operator picks during the actual Vault
ceremony.

### 2.2 Sentinel-quorum action-name drift (from D.6)

Architect's spec said `sentinel.quorum_outage`; the live action enum
(`packages/shared/src/schemas/audit.ts:18`) has `system.health_degraded`.
Block-D commits the live name. **Architect-action:** if the spec name
is preferred, the rename is a one-enum-add + one-script-change in a
follow-up.

### 2.3 Backup architect-spec coverage gaps (from D.9)

Five architect-spec'd backup items not yet in
`infra/host-bootstrap/10-vigil-backup.sh`. The verifier surfaces them
as yellow warnings (not hard errors); the runbook's gap table records
each with an action target:

| Spec item                   | Action target      |
| --------------------------- | ------------------ |
| Vault snapshot (raft-aware) | M0c hardening week |
| Git repo backup             | M0c hardening week |
| Audit-chain explicit export | M0c hardening week |
| Encrypted-at-rest archive   | M0c hardening week |
| Hetzner archive mirror      | Phase-2 (post-MOU) |

These are defence-in-depth additions, not blockers — the current
pipeline meets the 6-hour RTO target for the failure modes RESTORE.md
is written for.

### 2.4 SRD §30 enumeration: 20 INFERRED entries (from D.11)

Architect reviews `docs/source/SRD-30-enumeration-draft.md` and
accepts / edits / rejects the 20 `[INFERRED]` entries. The 39
`[CITED]` entries are verbatim from existing Tables 186-192 and need
no decision — only relocation under §30.1..§30.7 sub-headings.

After architect resolution:

1. Build agent merges accepted set into SRD-v3.md §30.
2. `e2e-fixture.sh` coverage matrix re-runs against the architect-
   blessed enumeration; new `AT-NNN` entries become fixture
   line-items.
3. PR-template's `AT-?-??:` placeholder becomes architect-named.

### 2.5 Falco rule production-only verification (from D.5)

Of 11 Falco rules, only 2 are sandbox-testable
(`shell_in_vigil_container`, `privilege_escalation_in_container`).
The other 9 require host-side bind mounts / privileged Falco / real
network egress allowlist. The `infra/observability/falco/RULE-TESTS.md`
matrix documents the production-only verification commands; operator
runs them during the M0c hardening week against the production-Falco
stack and captures pass/fail per rule.

---

## 3. Phase-gate state

`.github/workflows/phase-gate.yml` runs 10 lints. Block-D opening
commit (`2533430`) widened the cross-link allowlist from D-000..006
to D-000..016, resolving the only red lint. **Phase-gate is green
on Block-D close.**

The Block-D D.7 synthetic-failure workflow now proves 5 of those 10
lints actually reject broken input — exit-code-validated end-to-end.
Architect-action item recorded in `scripts/synthetic-failure.ts`
header: when a future phase-gate lint joins the batch, also add a
synthetic-failure case.

---

## 4. Track-C status flip in PHASE-1-COMPLETION.md

| Item | Pre-Block-D | Post-Block-D                          |
| ---- | ----------- | ------------------------------------- |
| C1   | (open)      | 🟩                                    |
| C2   | (open)      | 🟩 (verified + drift surfaced)        |
| C3   | (open)      | 🟩                                    |
| C4   | (open)      | 🟩 (6 spec'd + 14 archived)           |
| C5   | (open)      | 🟩 (8 → 11 rules, 2 sandbox-testable) |
| C6   | (open)      | 🟩                                    |
| C7   | (open)      | 🟩 (5/5 REJECTED locally)             |
| C8   | (open)      | 🟩 (verified + 1 minor fix)           |
| C9   | (open)      | 🟩 (verified + gap table documented)  |
| C10  | (open)      | 🟩 (2 false positives triaged)        |
| A8   | partial     | 🟩 (draft shipped)                    |

Track C is operationally complete; the items above flip per the
architect's "verify or fix; surface scope drift" posture, not as
blanket green-lights.

---

## 5. Block E pre-authorised scope (architect-confirmed)

Per architect's Block-D plan signoff (BLOCK-D-PLAN §4):

- Track D (test quality D1–D7).
- Track E (security E1–E5).
- The deferred A5.4 salt-collision CI alert.

Block-E entry awaits architect review of this summary.

---

## 6. Operating-posture observations (for the architect's record)

- Per architect's "halt and surface judgment" instruction, Block-D
  surfaced four scope-drift instances rather than silently fixing
  them: D.5 (existing Falco rules vs spec'd 5), D.6 (action name),
  D.9 (5 backup gaps), D.11 (the entire INFERRED vs CITED tagging
  discipline).
- Per "spot-verifications are how I keep ground truth on what's
  actually shipping; dropping them three times in a row erodes that"
  feedback: every Block-D commit shipped its own verified-locally
  step in the body (gitleaks scan, lint smoke, harness run, etc.).
- Per "don't compress": Block-D took 13 commits across D.0..D.11
  with C4 sub-split into 3 commits per architect-spec'd
  decomposition.
- Pre-commit lint-staged + commitlint + gitleaks gates fired on
  every commit; all green.

---

## 7. Halt-for-review

Block D is feature-complete. The architect signs off on:

- [ ] Block-D commits 2533430..1e5d1d2 acceptable for merge to main.
- [ ] §2.1..§2.5 architect-action items acknowledged (resolution can
      be deferred to M0c week / Phase-2 / follow-up commit).
- [ ] Track-C status flips in PHASE-1-COMPLETION.md accepted.
- [ ] Block-E entry approved (Track D + Track E + A5.4).

Once signed, the build agent opens Block E with the same plan-first
posture.
