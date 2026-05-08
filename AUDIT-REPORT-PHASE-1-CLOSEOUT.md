# AUDIT-REPORT — Phase-1 closeout summary

> Counterpart to [AUDIT-REPORT.md](AUDIT-REPORT.md) (Phase-2 audit
> closure). This document is the architect-facing summary of the
> **Phase-1 closeout session** that drove the
> [docs/work-program/PHASE-1-COMPLETION.md](docs/work-program/PHASE-1-COMPLETION.md)
> tracker through Tier 1 → Tier 6 mechanical work, surfaced four
> Tier-3 architectural reviews, prepared Tier-4 architect-decision
> memos and Tier-5 doctrine-promotion checklists, drafted Tier-7
> institutional letters, and shipped a small fleet of new floor
> lints into CI.
>
> **Scope:** the session bracketed by the architect's "GO" on
> 2026-04-30 through the merge confirmation on 2026-05-01.

---

## 1. Headline numbers

### What was on the table

The 2026-04-30 brief opened the session with:

- the [PHASE-1-COMPLETION.md](docs/work-program/PHASE-1-COMPLETION.md)
  tracker with **47 work items** across Tracks A–F (most open);
- the AUDIT.md ledger sitting at **89 fixed findings** (Phase-2
  closure complete) with three open architect-blocked items
  (AUDIT-022, AUDIT-023, AUDIT-032, AUDIT-088) and two `info`-level
  needs-confirmation items;
- two PROVISIONAL DECISIONs (DECISION-008, DECISION-012) awaiting
  read-through promotion;
- AUDIT.md Section 10 (Phase-3 post-closure rescan) with two more
  findings (AUDIT-092 high, AUDIT-093 medium) flagged for fast-lane
  closure on a side branch.

### What landed

| Stream                                      |   Items |
| ------------------------------------------- | ------: |
| Tier-1 mechanical fixes (T1.01–T1.12)       |      12 |
| Tier-2 deferred-or-built-out (T2.01–T2.04)  |       4 |
| Tier-3 architectural reviews (REVIEW-1..4)  |       4 |
| Tier-4 architect-decision memos (T4.01-02)  |       2 |
| Tier-5 doctrine-promotion prep (T5.01-02)   |       2 |
| Tier-6 tracker / status / CI lints          |      10 |
| Tier-7 institutional templates (F1.7+F3+F4) |       3 |
| **Total commits**                           | **~57** |

Across **~35 feature branches**, all queued for sequential merge.
Branches do not push to origin from the build-agent environment;
the architect drove the merge in their own clone.

### New AUDIT findings filed

- **AUDIT-094** medium — worker-anchor `POLYGON_ANCHOR_CONTRACT`
  PLACEHOLDER guard + worker-governance null-address default. **Status:** open / umbrella-deferred (worker-anchor + worker-governance both on the umbrella restricted list).
- **AUDIT-095** medium — 14 unmigrated `<resp>.body.text()` /
  `body.json()` call sites sister-shape to AUDIT-093. **Status:** open; alert wired via the HARDEN-#8 closed-allowlist lint.
- **AUDIT-096** medium — dual Bayesian engines: legacy
  `bayesianPosterior` was `void`-discarded; canonical `assessFinding`
  drift would not surface. **Status:** **fixed** — `divergenceHoldReason()` helper + `bayesian_engine_divergence` HoldReason; 11 tests.
- **AUDIT-097** medium — pattern signal weights had no central
  registry. **Status:** **fixed (Phase A)** — `infra/patterns/weights.yaml`
  registry + CI floor lint; Phase B (in-pattern import from yaml)
  deferred.
- **AUDIT-098** high — high-significance audit-event anchor lag
  has no SLO + no Prometheus alert. **Status:** **partial** — alert rules wired (`VigilHighSigAnchorLagP95` warning + `Degraded` critical); histogram emission requires architect-approved worker-anchor edit (umbrella-deferred).
- **AUDIT-099** medium — calibration ECE power analysis missing;
  `ECE < 0.05` claim at N=30 is statistically meaningless. **Status:** **fixed** — binding addendum at [docs/source/CALIBRATION-ECE-POWER-ANALYSIS.md](docs/source/CALIBRATION-ECE-POWER-ANALYSIS.md); runtime gate at [scripts/check-calibration-power.ts](scripts/check-calibration-power.ts); 9 tests.

Plus AUDIT-085 (CAS integration harness skipped in CI) closed via
T1.02 (durable CI gate against silent skip).

### New decisions / doctrine

- **DECISION-017 PROVISIONAL** (legacy migration doctrine) —
  declares the eight pre-discipline migrations
  (`0000_bootstrap..0008`) permanently forward-only; round-trip
  mandate from 0009 onward; closed legacy allowlist.
- **DECISION-018 / 019 (drafted, not yet entered)** — corresponding
  to the AUDIT-032 (tip-key rotation) and AUDIT-088 (historical
  contentHash) memos. The architect picks an option from each memo
  before the formal entry is committed.
- **CALIBRATION-ECE-POWER-ANALYSIS** binding addendum to DECISION-011.

### New CI floor lints

| Script                                                                                 | Purpose                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [scripts/assert-cas-test-ran.sh](scripts/assert-cas-test-ran.sh)                       | Hardens the AUDIT-085 / A5 CAS integration harness against silent skip — re-runs vitest with `--reporter=verbose` and fails if "↓"/"skipped" markers appear or the suite name is absent.             |
| [scripts/check-safellmrouter-contract.ts](scripts/check-safellmrouter-contract.ts)     | A2.1/A2.2/A2.3 floor — every LLM call in worker-extractor / worker-counter-evidence MUST flow through SafeLlmRouter; worker-pattern stays LLM-free until it explicitly opts in.                      |
| [scripts/check-pattern-weights-registry.ts](scripts/check-pattern-weights-registry.ts) | AUDIT-097 — every pattern's `(defaultPrior, defaultWeight)` must agree with `infra/patterns/weights.yaml`. Two modes: `--check` (CI gate) and `--write` (architect-approved refresh after a change). |
| [scripts/check-calibration-power.ts](scripts/check-calibration-power.ts)               | AUDIT-099 — runtime gate (NOT CI) on calibration headline-claim sample-size adequacy. 5 verdict states: `OK`, `WAIVED`, `UNDER_WAY`, `FAIL_BELOW_PHASE_9`, `FAIL_INCONCLUSIVE`.                      |
| [scripts/check-phase-gate-workflow.ts](scripts/check-phase-gate-workflow.ts)           | C7 self-lint — fails CI if the phase-gate workflow loses a load-bearing `check-*.ts` step or flips trigger from `pull_request` to `push`.                                                            |
| [scripts/measure-test-ratio.ts](scripts/measure-test-ratio.ts)                         | T2.04 / HARDEN-#5 — measurement-only (NOT a CI gate); per-workspace `test_files / source_files` and `test_loc / source_loc`.                                                                         |
| [scripts/smoke-stack.sh](scripts/smoke-stack.sh)                                       | C1 — local smoke test: `pnpm compose:up`, poll until every container healthy, probe `/api/health`. Operator-side, not CI.                                                                            |

Plus two new ESLint floor rules:

- **HARDEN-#7** — `no-restricted-syntax` ban on `Math.random()` outside the 3-site allowlist (worker.ts instanceId, anthropic.ts customId, toast.tsx).
- **HARDEN-#8** — `no-restricted-syntax` ban on `<resp>.body.text()` / `<resp>.body.json()` outside `_bounded-fetch.ts`. Closed allowlist for the 14 AUDIT-095 legacy call sites.

### New Prometheus alerts

- `VigilHighSigAnchorLagP95` (warning) at P95 > 60 s for 5 min.
- `VigilHighSigAnchorLagP95Degraded` (critical) at P95 > 300 s for 5 min.

Both wired ahead of the histogram metric they evaluate; alerts return "no series" until worker-anchor begins emitting `vigil_audit_high_sig_anchor_lag_seconds_bucket` (umbrella-deferred).

---

## 2. What changed at the workspace level

### `packages/shared/src/schemas/certainty.ts`

Added `bayesian_engine_divergence` to `zHoldReason` (AUDIT-096). The
new HoldReason is the only schema-level change shipped this session;
every downstream consumer treats `hold_reasons` as a string array,
so the addition is forward-compatible.

### `apps/worker-score/src/`

- New file `divergence.ts` — pure helper `divergenceHoldReason()`.
- `index.ts` — replaces `void legacyPosterior;` with the divergence
  computation; appends the new HoldReason when threshold exceeded;
  `logger.warn('bayesian-engine-divergence', …)` on every divergence.
- New tests `__tests__/audit-096-divergence.test.ts` (11 cases)
  - `__tests__/contract.test.ts` (4 cases pinning DECISION-011 wiring,
    added during T1.12 graduation off the AUDIT-069 zero-test allowlist).
- `package.json`: `test: vitest run` (drops `--passWithNoTests`).

### `packages/federation-stream/src/`

- `server.ts` — `start()` now returns `Promise<number>` (the OS-
  assigned port from `bindAsync` callback), eliminating the close-
  then-rebind race that produced the A4 flaky test.
- New `server-bound-port.test.ts` (3 cases) pinning the contract.

### `packages/patterns/`

No source change; `infra/patterns/weights.yaml` (43 entries) is the
new auto-generated source-of-truth registry feeding the AUDIT-097
gate. Phase B (patterns import from yaml at boot rather than
declaring inline) is deferred for an architect-approved per-pattern
edit pass.

### `apps/worker-satellite/`

- `nicfi.py` — `_has_credentials()` and `_bearer_signer()` reject
  `PLACEHOLDER` literals (A9 / T1.04). Without this, NICFI activated
  with a literal `PLACEHOLDER` value and every Planet API call
  returned 401 instead of falling through to Sentinel-2.
- `main.py` — provider gate mirrors the same guard.
- `tests/test_provider_chain.py` — new test pinning both consumers.

### `apps/worker-extractor/__tests__/a2-safellmrouter-contract.test.ts`

4 source-grep regressions pinning that every LLM call routes through
`SafeLlmRouter`. Companion to the cross-worker
`scripts/check-safellmrouter-contract.ts`.

### `apps/dashboard/`

- `src/app/council/proposals/[id]/vote-ceremony.tsx` and
  `src/app/api/council/vote/challenge/route.ts` — A7 stale-TODO
  sweep; `\bC5b\b` references replaced with DECISION-008 anchors.
- `__tests__/a7-no-stale-c5b-refs.test.ts` — pinning regression test.

### `eslint.config.mjs`

Adds two `no-restricted-syntax` rules (HARDEN-#7 + HARDEN-#8) with
their respective closed-allowlist override blocks. The Math.random
selector and the body-read selectors live in the same `CORE_RULES`
array so they share enforcement infrastructure.

### `.github/workflows/phase-gate.yml`

Two new steps: `check-safellmrouter-contract.ts` and
`check-pattern-weights-registry.ts`. Both gate merges to main.
Plus `check-phase-gate-workflow.ts` self-lint as the last step.

### `infra/docker/prometheus/alerts/vigil.yml`

Adds the AUDIT-098 SLO alerts (warning + critical pair).

### `scripts/`

Five new lint scripts (above) + `e2e-fixture.sh` rewritten to walk
six pipeline stages with timeout-and-poll (T2.02), and
`seed-fixture-events.ts` retained as the deterministic seeder.

### `docs/`

- New `docs/source/CALIBRATION-ECE-POWER-ANALYSIS.md` (binding
  addendum to DECISION-011).
- New `docs/decisions/MEMO-AUDIT-032-tip-key-rotation.md` (3
  options, recommendation A).
- New `docs/decisions/MEMO-AUDIT-088-historical-content-hash.md`
  (3 options, recommendation 2).
- New `docs/decisions/decision-008-readthrough-checklist.md` (T5.01).
- Updated `docs/decisions/decision-012-readthrough-checklist.md`
  with §12 (recent AUDIT findings) + §13 (cross-decision
  compatibility) + AUDIT-023 anchor (T5.02).
- New `docs/templates/council/` with 6 first-contact templates
  (FR + EN, one per pillar + bilingual brief; F1.7).
- New `docs/templates/institutional/` with CONAC engagement letter
  (F3.1) + ANTIC declaration (F4) + README.

---

## 3. Patterns observed

### "Already shipped, just not flipped"

13 of the 47 tracker items (B1, B2, B3, B5, C2, C4, C5, C8, C9, C10,
D6, E1, E2, E3, E4, E5) were status-flips: the underlying code or
script had landed during Phase-2 audit work but the tracker entry
had not been updated to 🟩. The remediation was a sweep of three
batches of tracker doc-edits, summarised in:

- `chore/T6-tracker-status-flips-already-shipped` (B5/C8/C10/E4/E5)
- `chore/T6-batch2-tracker-status-flips` (B1/B2/B3/C5/C9/E1/E2/E3)
- `chore/T6-batch3-C2-vault-shamir-flip` + `chore/T6-batch4-C4-grafana-flip` + `chore/T6-D6-a11y-status-flip` + `docs/B4-truth-md-status-reconciliation`

A future tracker discipline would benefit from a CI step that flags
items as "shipped, awaiting status flip" — but that requires a
machine-readable mapping of tracker items to their delivery
artefacts, which would itself be a deliberate doctrine pass.

### "Umbrella-restricted with explicit fix request"

The 2026-04-30 brief introduced a closed allowlist of
umbrella-restricted directories (`packages/llm/`,
`packages/certainty-engine/`, `packages/audit-log/`,
`packages/audit-chain/`, `worker-anchor/`, `worker-audit-watch/`,
`adapter-runner/quarterly-audit-export.ts`) that the build agent
cannot modify unless a finding is **explicitly filed against them**.
Three audits hit this constraint:

- **AUDIT-094** worker-anchor + worker-governance — filed and deferred.
- **AUDIT-098** worker-anchor histogram emission — alerts wired without source edit; histogram emission deferred.
- **A2.x** (worker-extractor / worker-counter-evidence / worker-pattern) — already wrap LLM calls in SafeLlmRouter; the contract is now CI-pinned without modifying packages/llm.

The pattern works: file the finding against the umbrella component;
the architect's decision to act on the finding is the authorisation
to touch the umbrella code. AUDIT-030 is the precedent.

### "Forward-state lints with PENDING grace"

`scripts/check-phase-gate-workflow.ts` introduces a two-tier
requirement set:

- `REQUIRED_STEPS` — must already be present (failure = exit 1)
- `FORWARD_EXPECTED` — emit `PENDING` (warning) when absent

This pattern lets a self-lint land in a session where some forward
lints are still on un-merged branches. Once the architect promotes
a step to REQUIRED in a one-line PR, the grace ends. Worth keeping
in the toolkit for similar future lockstep-merge situations.

### "Deferred to architect" with clear handoff

Five items were filed as architect-decision memos rather than
attempted unilaterally:

- **AUDIT-032** tip-key rotation cadence (3 options + recommendation).
- **AUDIT-088** historical contentHash policy (3 options + recommendation).
- **DECISION-008 PROVISIONAL → FINAL** (read-through checklist).
- **DECISION-012 PROVISIONAL → FINAL** (extended checklist).
- **C7.2** file-to-phase mutation test (requires architect-defined directory→phase map).

In each case the build agent did the maximum amount of work that
did not require a product call, then handed off with a structured
checklist. This kept the architect's review queue narrow and
discrete.

---

## 4. Remaining work

The Phase-1 closeout session's residual is small. Items remain in
three categories.

### A. Architect product calls

| Item                             | Need from architect                                                 |
| -------------------------------- | ------------------------------------------------------------------- |
| AUDIT-022 / DECISION-008 → FINAL | Sign the read-through checklist; promote in `docs/decisions/log.md` |
| AUDIT-023 / DECISION-012 → FINAL | Sign the (extended) read-through checklist; promote                 |
| AUDIT-032                        | Pick rotation cadence A / B / C from T4.01 memo                     |
| AUDIT-088                        | Pick contentHash policy 1 / 2 / 3 / defer from T4.02 memo           |
| AUDIT-098 (full)                 | Authorise worker-anchor histogram emission (umbrella)               |
| C7.2                             | Define `apps/<x>/` → phase map for the file-to-phase test           |

Each unblocks a one-line PR (or in AUDIT-098's case, a small worker-anchor edit + test).

### B. Stack-required E2E tests (D-track)

D1 (council vote ceremony), D2 (tip Tor flow), D3 (CONAC SFTP delivery), D4 (federation stream), D5 (WebAuthn → secp256k1), D7 (visual regression). All require local docker compose stack + various mock infrastructure (Tor SOCKS proxy, SFTP server, Polygon signer stub). The build agent in this environment cannot run docker-compose; D1, D4, D5 could be scaffolded as in-memory vitest E2E in a follow-up session if the architect prioritises.

### C. Institutional-only

F1 (council formation), F2 (backup architect), F3.2-3.4 (CONAC in-person + counter-signature), F5 (YubiKey procurement), F6 (Polygon mainnet contract deployment), F7 (calibration seed), F8 (off-jurisdiction safe-deposit-box), F9 (domain + cloud accounts), F10 (TRUTH.md open questions). All architect-only, by design.

---

## 5. Recommended next steps (in order)

These mirror the [AUDIT-REPORT.md](AUDIT-REPORT.md) closing list, updated to reflect what this session shipped:

1. **Promote DECISION-008 + DECISION-012 to FINAL.** The read-through
   checklists at
   [decision-008-readthrough-checklist.md](docs/decisions/decision-008-readthrough-checklist.md)
   and the updated
   [decision-012-readthrough-checklist.md](docs/decisions/decision-012-readthrough-checklist.md)
   are ready. One signing session.

2. **Decide AUDIT-032 (tip-key rotation) and AUDIT-088 (historical
   contentHash) options.** Memos are at
   [MEMO-AUDIT-032](docs/decisions/MEMO-AUDIT-032-tip-key-rotation.md)
   and
   [MEMO-AUDIT-088](docs/decisions/MEMO-AUDIT-088-historical-content-hash.md).
   Each architect choice unblocks ~3 hours of build-agent code.

3. **Wire the AUDIT-098 histogram emission.** Once the architect
   approves the worker-anchor edit, the alert that's already wired
   begins firing meaningfully. Roughly 1 day of work.

4. **Scaffold D1 / D4 / D5 in-memory E2E tests.** A follow-up build-
   agent session can do this without a running stack — the
   workflows mock the queue / repo / signer interfaces and walk
   the orchestration path end-to-end at vitest speed. ~2 days.

5. **Phase B of AUDIT-097.** Migrate the 43 pattern files to import
   their `(defaultPrior, defaultWeight)` from
   `infra/patterns/weights.yaml` rather than declaring inline. The
   registry is now the source of truth; the inline declarations
   become a CI-redundancy tier. Tracker as a separate audit if the
   architect wants the migration.

6. **Architect institutional work** — council formation (F1),
   CONAC in-person (F3.2 onward), backup architect (F2). The
   build-agent cannot accelerate these; the templates at
   [docs/templates/council/](docs/templates/council/) and
   [docs/templates/institutional/](docs/templates/institutional/)
   are ready when the architect needs them.

---

## 6. Closing

The Phase-1 closeout session brought the
[PHASE-1-COMPLETION.md](docs/work-program/PHASE-1-COMPLETION.md)
tracker from **47 mostly-open items** to **6 architect-blocked,
6 stack-required, 9 institutional-only**, with everything else
either fixed, status-flipped, or filed as architect-handoff. The
session was disciplined by:

- one-finding-one-commit-one-test;
- the umbrella-restricted directory list (only modify when an audit
  is filed against the directory);
- failing-test-first for every fix;
- structural memos rather than unilateral guesses on product calls;
- bilingual (FR + EN) institutional drafts respecting the formal
  register CLAUDE.md prescribes.

**Generated:** 2026-05-01
**Counterpart:** [AUDIT-REPORT.md](AUDIT-REPORT.md) (Phase-2 audit closure, 2026-04-30)
**Source of truth for findings:** [AUDIT.md](AUDIT.md)
**Source of truth for tracker:** [docs/work-program/PHASE-1-COMPLETION.md](docs/work-program/PHASE-1-COMPLETION.md)
