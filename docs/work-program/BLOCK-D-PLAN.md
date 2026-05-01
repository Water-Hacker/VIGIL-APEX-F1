# BLOCK D — plan (Track C C1–C10 + A8 SRD §30 draft)

> **Status:** awaiting architect counter-signature on §3 hold-points.
> **Date:** 2026-05-01.
> **Author:** build agent (Claude).
>
> Plan-first per architect operating posture. Block-D opening commit
> (`2533430`) already shipped: extends B5 cross-link allowlist to
> D-000..D-016 per architect resolution option (b). Block D opens
> with phase-gate.yml CI green.
>
> Architect note: "Block D specifically expected to take longer than
> Block C because Track C touches infrastructure where mistakes have
> production consequences. That's expected. Don't compress."

---

## 1. State reconciliation

Pre-flight against the live tree. Track C is **partially shipped**;
this block fills gaps + adds the 3 architect-spec'd new artefacts
(C4 6 dashboards, C5 5 Falco rules, C7 synthetic-failure test).

| Item   | Spec                                                                                                                 | Live state                                                                                                                                                         | Delta                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| C1     | `scripts/smoke-stack.sh` — compose up + healthcheck wait + dashboard /api/health=200                                 | **MISSING**. No `scripts/smoke-stack.sh`.                                                                                                                          | NEW: write the script + wire into compose-up runbook.                                               |
| C2     | Vault Shamir init working end-to-end + architect runbook                                                             | `infra/host-bootstrap/03-vault-shamir-init.sh` exists. `docs/runbooks/vault-shamir-init.md` exists. Need EE verification.                                          | Walk end-to-end against dev Vault; document the pass/fail; runbook delta if needed.                 |
| C3     | Tor onion health monitor                                                                                             | `scripts/sentinel-tor-check.ts` exists. Need wiring into the sentinel-monitor cron schedule + dashboard alert.                                                     | Wire + alert rule.                                                                                  |
| **C4** | **6 dashboards (architect-specified)**                                                                               | 14 existing JSON files at `infra/docker/grafana/dashboards/`; not aligned to the 6-dashboard spec. Audit needed.                                                   | Audit existing → design the 6 (architect-specified) → consolidate / add / leave-existing-alongside. |
| **C5** | **5 Falco rules tied to THREAT-MODEL-CMR.md**                                                                        | 8 existing rules at `infra/observability/falco/vigil-rules.yaml` (different scope: vault-binary-execed, postgres-from-non-app, etc.). Architect's 5 are different. | Add the 5 architect-spec'd rules + tests; existing 8 stay (broader scope, complementary).           |
| C6     | Sentinel 2-of-3 quorum + integration test + audit row emit                                                           | `scripts/sentinel-quorum.ts` exists. Verify the audit row + integration test.                                                                                      | Verify, fill any gap; integration test gated on three sentinel ports.                               |
| **C7** | **Synthetic-failure test workflow + 5 specific deliberate violations**                                               | `.github/workflows/phase-gate.yml` exists; **NO synthetic-failure test workflow**.                                                                                 | NEW: weekly-cron workflow that asserts every gate fires.                                            |
| C8     | PR template + commitlint                                                                                             | `.github/PULL_REQUEST_TEMPLATE.md` exists; `commitlint.config.cjs` enforces Conventional Commits.                                                                  | Verify; flip 🟩 if no gap.                                                                          |
| C9     | Backup script verification (Postgres + Vault + IPFS pinset + git + audit-chain export, GPG-encrypted, NAS + Hetzner) | `scripts/verify-backup-config.sh` exists; `infra/host-bootstrap/10-vigil-backup.sh` per spec.                                                                      | Verify the script does what the spec says; runbook + test.                                          |
| C10    | gitleaks baseline + pre-commit + CI                                                                                  | `.gitleaks.toml` exists; `.husky/pre-commit` runs gitleaks; `.github/workflows/secret-scan.yml` exists.                                                            | Verify; flip 🟩 if no gap.                                                                          |
| A8     | SRD §30.1–§30.7 enumeration draft (Block-D follow-up, agent drafts per architect)                                    | NOT drafted. SRD §30 sub-sections are empty headings; the de facto template lives in C.2 worker runbooks (R1–R6) and `E2E-FIXTURE-COVERAGE.md`.                    | NEW draft document under `docs/source/_drafts/` for architect read-through.                         |

**Net actionable items:** all 10 C-items + A8. Some are
quick-verifies (C8/C10), others are larger NEW work (C1, C4, C5,
C7, A8).

---

## 2. Proposed Block D execution order

Twelve commits + the close summary. Architect's "don't compress"
note is honoured by per-commit decomposition; some C-items
sub-split where the work is large.

| #    | Item                                         | Output                                                                                                       |
| ---- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| D.0  | (DONE) extend B5 allowlist to D-000..D-016   | commit `2533430`                                                                                             |
| D.1  | C1 — compose stack smoke test                | `scripts/smoke-stack.sh` (NEW) + smoke-stack runbook section                                                 |
| D.2  | C2 — Vault Shamir init verification          | walk + record EE result; runbook delta if needed                                                             |
| D.3  | C3 — Tor onion health monitor                | sentinel-monitor cron wiring + alert rule + (if missing) script integration                                  |
| D.4  | C4 — Grafana dashboards (6 architect-spec'd) | audit existing 14 → design 6 → land JSONs at `infra/docker/grafana/dashboards/` → README delta               |
| D.5  | C5 — Falco rules (5 architect-spec'd)        | append to `infra/observability/falco/vigil-rules.yaml` + 5 corresponding tests under `compose-test` override |
| D.6  | C6 — sentinel quorum + integration test      | verify wiring + integration test gated on 3 sentinel ports                                                   |
| D.7  | C7 — synthetic-failure test workflow         | `.github/workflows/synthetic-gate-failure-test.yml` (NEW) + the 5 deliberate-violation fixture branches      |
| D.8  | C8 — PR template + commitlint verification   | quick verify; flip 🟩                                                                                        |
| D.9  | C9 — backup verification + runbook           | verify the script + runbook delta                                                                            |
| D.10 | C10 — secret-scan baseline                   | quick verify; flip 🟩                                                                                        |
| D.11 | A8 — SRD §30 enumeration draft               | `docs/source/_drafts/SRD-v3-section30-draft.md` for architect read-through                                   |
| D.12 | Block D completion summary + halt for review | `docs/work-program/BLOCK-D-COMPLETION-SUMMARY.md`                                                            |

Stop after each commit only if a test or lint fails (per operating
posture).

---

## 3. Hold-points — batched

### Hold-point #1 — C4 Grafana dashboards: existing 14 vs spec'd 6

**The drift.** Architect spec'd 6 dashboards:

1. Data plane (postgres + neo4j + redis + ipfs)
2. Workers (queue lag, throughput, error rates per worker)
3. LLM (cost, calls, hallucination rate, tier distribution, schema-validation rate)
4. Findings pipeline (detection, scoring tier, counter-evidence hold, action-queue depth)
5. Governance (proposal lifecycle, vote distribution, pillar activity, recusal rate)
6. Operator overview (KPIs linking the 5 detail dashboards)

Live tree has 14 dashboards already at
`infra/docker/grafana/dashboards/`:

- `vigil-overview.json` — likely maps to architect's #6.
- `vigil-adapters.json` — adapter health.
- `vigil-findings.json` — likely maps to architect's #4.
- `vigil-cost.json` + `llm-cost-per-finding.json` — overlap with architect's #3.
- `vigil-audit-chain.json` + `audit-chain-tail.json` — audit chain.
- `vigil-fabric.json` — Fabric witness.
- `ingestion-throughput.json` — adapter throughput.
- `pattern-fire-rate.json` — patterns.
- `calibration-bands.json` — Bayesian calibration.
- `polygon-anchor-cost.json` — anchor cost.
- `council-vote-lag.json` — partial overlap with architect's #5.
- `tip-volume.json` — tip portal.

The architect spec'd "more than six = scope drift, halt and surface."

**Question for architect.** Three options:

- **(a) Replace the 14 with the spec'd 6.** The existing 14 are
  not formally "approved" — they were shipped incrementally during
  Phase-1 work. Replace cleanly to the 6-dashboard target.
  Risk: lose some operator views currently used.
- **(b) Add the spec'd 6 alongside the existing 14.** Final count 20. **Violates the spec's "more than six" cap.**
- **(c) Map existing → spec'd 6 + add what's missing.**
  - vigil-overview → spec #6 (Operator overview).
  - vigil-findings + pattern-fire-rate + calibration-bands → spec #4 (Findings).
  - vigil-cost + llm-cost-per-finding → spec #3 (LLM).
  - vigil-audit-chain + audit-chain-tail + polygon-anchor-cost + vigil-fabric → consolidate into a Phase-2 audit-witness dashboard (NOT in the architect's 6; surface as a deliberate addition or move to follow-up).
  - vigil-adapters + ingestion-throughput + tip-volume → adapter / ingest dashboard (NOT in the architect's 6; surface or follow-up).
  - **Missing from existing**: Data plane (postgres / neo4j / redis / ipfs aggregate); Workers (per-worker rows); Governance (proposal lifecycle).
  - Net: build the 3 missing; deprecate or re-home some of the existing; final count = architect's 6 + an "audit-witness" follow-up dashboard the architect approves separately.

**Default if unspecified.** **(c)** with the audit-witness +
ingest dashboards moved to a `archive-from-block-d/` subdirectory
(operator can opt-in if they need the legacy view) AND the 6
spec'd dashboards land as the canonical set.

**Risk.** Operator may rely on the existing dashboards. Suggest
the architect schedule a 2-week deprecation window before pruning;
in the meantime, the 6 land alongside in the canonical path and
the 14 are flagged "legacy-pending-removal" in their JSON
metadata.

### Hold-point #2 — C5 Falco rules: existing 8 vs architect-spec'd 5

**The overlap.** Architect spec'd 5 rules:

a. Container privilege escalation
b. Outbound network from worker containers to non-allowlisted hosts
c. /run/secrets/\* reads from non-owning containers
d. Writes to /srv/vigil/{postgres,neo4j,ipfs}/data/ from non-owning processes
e. Shell process spawn inside any worker container

Live tree has 8 rules at
`infra/observability/falco/vigil-rules.yaml`:

- vault-binary-execed
- yubikey-removed-mid-session
- unsigned-commit-on-main
- postgres-from-non-app
- audit-actions-direct-write
- (and 3 more I haven't inventoried fully)

Mapping:

- Architect's (a) — likely overlaps with `vault-binary-execed` partially; needs explicit privilege-escalation rule.
- Architect's (b) — NOT in existing. NEW.
- Architect's (c) — NOT in existing. NEW.
- Architect's (d) — overlaps with `audit-actions-direct-write` for the postgres path; doesn't cover neo4j / ipfs.
- Architect's (e) — NOT in existing. NEW.

**Question for architect.** The architect's spec is "5 rules tied
to THREAT-MODEL-CMR.md". Should B.5 (D.5 commit):

- **(a) Add the 5 architect-spec'd rules** alongside the existing
  8, total 13 rules. The existing 8 stay (different threat
  surface; complementary).
- **(b) Replace the existing 8 with the architect's 5**, dropping
  the unsigned-commit-on-main / yubikey-removed / etc rules.

**Default if unspecified.** **(a)** add alongside. The existing
rules cover legitimate threats not in the architect's 5; pruning
them needs a separate signoff.

### Hold-point #3 — C7 synthetic-failure test cadence

**The architect spec'd weekly cron.** "weekly is fine so the lints
don't silently rot."

The 5 deliberate-violation fixtures need to live somewhere. Two
options:

- **(a) Synthetic-failure fixture branches** in the same repo
  (`fixtures/synthetic-gate-failure-N`). The workflow checks
  out each fixture branch + runs the gate + asserts the gate
  fails. Risk: the fixture branches are kept up-to-date with
  main; drift could mask real failures.
- **(b) On-the-fly mutation in the workflow.** The workflow
  patches the fixture violations into the working copy in CI,
  runs the gate, asserts failure, reverts. Risk: the patch must
  match the current code shape; drift in the patch logic could
  mask failures.

**Default if unspecified.** **(b)** on-the-fly mutation — the
patches are short and self-explanatory in the workflow YAML;
fixture branches add a maintenance burden the agent doesn't think
is worth it for 5 violations.

### Hold-point #4 — A8 SRD §30 draft scope

**The architect spec'd Option B** (agent drafts based on the
inferred mapping).

The draft needs to enumerate §30.1–§30.7 (M0c + M1 + M2 + M3 +
Tip-portal + M4 + M5). The C.2 worker runbooks have the de facto
R1–R6 template; the E2E-FIXTURE-COVERAGE.md has the inferred Phase-1
acceptance gates. Combining these:

- §30.1 M0c: cold-start tests — derived from `infra/host-bootstrap/`.
- §30.2 M1: data plane tests — derived from existing migration tests + smoke-stack.
- §30.3 M2: intelligence plane tests — pattern fixture suite + certainty engine + entity rule-pass.
- §30.4 M3: delivery plane tests — dossier render + CONAC SFTP + public verify.
- §30.5 Tip-In Portal: tip submission + Shamir decrypt + paraphrase.
- §30.6 M4 council standup: pillar appointment + first vote ceremony.
- §30.7 M5 hardening: per-quarter drill schedule + DR rehearsal SLA.

**Question for architect.** Draft scope:

- **(a)** Brief draft (~1 page per sub-section) listing the
  inferred tests; architect fills in nuance later.
- **(b)** Detailed draft (~3 pages per sub-section) with exit
  criteria + which existing test suite covers each gate +
  identified gaps.

**Default if unspecified.** **(b)** detailed draft. Lands at
`docs/source/_drafts/SRD-v3-section30-draft.md` with a header
explicitly noting it's an agent-drafted proposal awaiting
architect read-through; not yet binding.

---

## 4. Block D operating posture (re-stated)

Per architect instruction:

- Plan first — this document. **HALT FOR ARCHITECT REVIEW.**
- Batch hold-points — 4 in §3 above.
- One commit per logical unit (some sub-split per §2).
- Update `docs/work-program/PHASE-1-COMPLETION.md` as items close.
- Stop after a commit only if a test or lint fails.
- "Don't compress" — Block D is expected to take longer than
  Block C because infrastructure mistakes have production
  consequences. Sub-commit decomposition is encouraged where it
  aids review.
- At Block D close, produce
  `docs/work-program/BLOCK-D-COMPLETION-SUMMARY.md` and halt for
  review before opening Block E.

Block-E pre-authorised scope (per architect): Track D (test
quality D1–D7) + Track E (security E1–E5) + the deferred A5.4
salt-collision CI alert.

---

## 5. What the architect signs

Four checkboxes:

- [ ] §3 hold-point #1 — C4 dashboards: (a) replace OR (b) add OR (c) map+add+archive. **Default: (c).**
- [ ] §3 hold-point #2 — C5 Falco rules: (a) add alongside OR (b) replace. **Default: (a).**
- [ ] §3 hold-point #3 — C7 synthetic-failure test: (a) fixture branches OR (b) on-the-fly mutation. **Default: (b).**
- [ ] §3 hold-point #4 — A8 SRD §30 draft: (a) brief OR (b) detailed. **Default: (b).**

When all four are signed, the agent advances to **D.1** (C1
compose stack smoke test) and proceeds top-to-bottom through §2.

---

## 6. Critical-files list (forward-looking)

Files this block will touch:

| File                                                                    | Item | Change                                                            |
| ----------------------------------------------------------------------- | ---- | ----------------------------------------------------------------- |
| `scripts/smoke-stack.sh`                                                | D.1  | NEW                                                               |
| `docs/runbooks/vault-shamir-init.md`                                    | D.2  | Verify EE; delta if needed                                        |
| `apps/sentinel-monitor/...` + alert rule yml                            | D.3  | Wire + alert rule                                                 |
| `infra/docker/grafana/dashboards/` + `archive-from-block-d/`            | D.4  | Architect's 6 land canonical; existing 14 to archive (pending #1) |
| `infra/observability/falco/vigil-rules.yaml` + tests under compose-test | D.5  | Append architect's 5 rules + 5 tests (pending #2)                 |
| Sentinel quorum integration test                                        | D.6  | Verify; gap-fill if needed                                        |
| `.github/workflows/synthetic-gate-failure-test.yml`                     | D.7  | NEW (pending #3)                                                  |
| `.github/PULL_REQUEST_TEMPLATE.md` + `commitlint.config.cjs`            | D.8  | Verify; flip 🟩                                                   |
| `scripts/verify-backup-config.sh` + runbook                             | D.9  | Verify; runbook delta if needed                                   |
| `.gitleaks.toml` + `.husky/pre-commit` + `secret-scan.yml`              | D.10 | Verify; flip 🟩                                                   |
| `docs/source/_drafts/SRD-v3-section30-draft.md`                         | D.11 | NEW (pending #4)                                                  |
| `docs/work-program/PHASE-1-COMPLETION.md`                               | each | Flip C1–C10 to 🟩 as items close                                  |
| `docs/work-program/BLOCK-D-COMPLETION-SUMMARY.md`                       | D.12 | NEW                                                               |

Existing utilities to reuse:

- `infra/observability/falco/vigil-rules.yaml` — append, don't replace (per default #2).
- `infra/docker/grafana/dashboards/` — design the 6 spec'd; archive others (per default #1).
- `scripts/sentinel-quorum.ts` + `scripts/sentinel-tor-check.ts` — wire, don't rewrite.
