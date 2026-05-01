# VIGIL APEX — Phase 1 Completion Work Program

> The exhaustive remaining-work list reconciled against TRUTH.md, ROADMAP.md,
> docs/weaknesses/INDEX.md, docs/decisions/log.md, and the live codebase
> as of 2026-04-29.
>
> Use this file as the master TODO. The session-level TodoWrite list mirrors
> the active subset. Architect-blocked items are tagged 🟦 and tracked but
> cannot be advanced by the build agent.

---

## Snapshot of state

**Last refreshed: 2026-05-01.** Counts move with every commit; the
prior hand-maintained "46 packages / 712 tests" snapshot drifted.
The numbers below come from a fresh sweep of the live tree.

| Dimension                        | Status                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Build (`turbo run build`)        | 39/39 ✓                                                                          |
| Typecheck                        | 56/56 ✓                                                                          |
| Lint at `--max-warnings=0`       | 56/56 ✓                                                                          |
| Tests (turbo)                    | 48/48 packages green                                                             |
| Adapters in `infra/sources.json` | 29 (TRUTH §C and SRD §10.2 aligned per Block-A reconciliation §2.A.9)            |
| Patterns built                   | 43 (target 43, 1:1 fixture coverage)                                             |
| Phase-gate lints                 | 9 green + 1 surfacing pre-existing drift (`check-source-count` resolved 19e29ca) |
| Weaknesses 🟩 closed             | 18 / 27 (no change since prior snapshot)                                         |
| Weaknesses 🟧 in progress        | 2 (W-10, W-14 — corpus already at 224 rows; W-10 native helper M3-M4)            |
| Weaknesses 🟦 architect-blocked  | 5                                                                                |
| Weaknesses ⬛ deferred           | 1 (W-16, M2 exit)                                                                |
| Decisions PROVISIONAL            | DECISION-012 + DECISION-013 + DECISION-014/14b/15/16 (read-through pending)      |
| TRUTH.md open questions          | 6                                                                                |
| In-code TODOs                    | 0 actionable (the two A7 refs are descriptive prose, not stale TODOs)            |

---

## TRACK A — Code-side completion (the build agent executes)

### A1. Anti-hallucination corpus expansion (W-14) — 🟩

Target: 200 rows. **Live state (2026-05-01):** 224 rows in
[packages/llm/**tests**/synthetic-hallucinations.jsonl](../../packages/llm/__tests__/synthetic-hallucinations.jsonl) — surpasses target.
Closed during a prior pass (no Block-B commit needed).

### A2. SafeLlmRouter per-worker migration — 🟩

All five workers covered. The doctrine chokepoint wraps every
direct LlmRouter call so the 12 AI-SAFETY-DOCTRINE-v1 layers apply
uniformly.

- A2.1 🟩 [apps/worker-extractor/](../../apps/worker-extractor/) — already migrated (SafeLlmRouterLike adapter at `src/llm-extractor.ts`).
- A2.2 🟩 [apps/worker-counter-evidence/](../../apps/worker-counter-evidence/) — already migrated (`this.safe.call(...)` at `src/index.ts:189`).
- A2.3 🟩 [apps/worker-pattern/](../../apps/worker-pattern/) — N/A (deterministic dispatcher, no Claude calls).
- A2.4 🟩 [apps/worker-tip-triage/](../../apps/worker-tip-triage/) — Block-B B.4 commit: registered `tip-triage.paraphrase` prompt; `safe.call` with PII-stripping `task` field; closed-context source for tip body; CallRecordRepo sink.
- A2.5 🟩 [apps/worker-adapter-repair/](../../apps/worker-adapter-repair/) — Block-B B.4 commit: registered `adapter-repair.selector-rederive` prompt; `safe.call` with conservative-selector `task`; closed-context source for old/new HTML; CallRecordRepo sink.

Doctrine layer mapping (both new migrations):

| Layer                              | Pre-migration | Post-migration                 |
| ---------------------------------- | ------------- | ------------------------------ |
| L1 hallucination (citations)       | N/A           | N/A                            |
| L4 prompt injection (system rules) | implicit      | uniform                        |
| L4 schema validation               | preserved     | preserved                      |
| L8 anchoring                       | N/A           | N/A                            |
| L9 prompt-version pin              | absent        | NEW                            |
| L11 daily canary                   | absent        | NEW                            |
| L11 call-record audit              | absent        | NEW                            |
| L13 jailbreak                      | T=0.0/0.2     | T=0.1 default                  |
| L14 model update                   | unpinned      | model_id pinned in call_record |

### A3. NO_TESTS packages → real tests — 🟩

All 11 listed packages now ship at least one test file (verified
2026-05-01: observability=3, db-neo4j=7, queue=2, dossier=3,
fabric-bridge=1, worker-document=4, worker-federation-agent=1,
audit-bridge=1, worker-adapter-repair=1, worker-fabric-bridge=1,
worker-pattern=1). Closed during a prior pass.

- [x] @vigil/observability
- [x] @vigil/db-neo4j
- [x] @vigil/queue
- [x] @vigil/dossier
- [x] @vigil/fabric-bridge
- [x] worker-document
- [x] worker-federation-agent
- [x] audit-bridge
- [x] worker-adapter-repair
- [x] worker-fabric-bridge
- [x] worker-pattern

### A4. worker-federation-receiver test failure — 🟩

`pnpm --filter worker-federation-receiver run test` reports
**40/40 pass, 3 files** (verified 2026-05-01). Closed during a
prior pass.

### A5. CAS integration harness in CI — 🟩

- A5.1 🟩 — postgres:16.2-alpine service in `.github/workflows/ci.yml:84-96`.
- A5.2 🟩 — `pnpm --filter @vigil/db-postgres run migrate` step at line 116-119.
- A5.3 🟩 — `INTEGRATION_DB_URL` exported to the test job at line 129+134.
- A5.4 🟩 — Block-B regression pin (commit `04175f9`):
  new CI step "audit-log CAS race regression must execute (not skip)"
  re-runs the CAS test with `--reporter=verbose` and greps for the
  test name; fails the job if the test doesn't appear in the output
  OR appears with a skip marker.

**A5 deferred follow-up (Block E scope, architect-confirmed 2026-05-01).**
Salt-collision CI alert: when two consecutive
`audit.public_export.salt_fingerprint` values match, the operator
forgot the quarterly rotation. The
[`audit.public_export_salt_collisions`](../../packages/db-postgres/drizzle/0012_audit_export_salt_fingerprint.sql)
view exists; the CI alert that fires on a non-empty result is
**deferred-not-dropped**, target Block E. No urgency — quarterly
cron only, 90-day detection window before the next export.

### A6. DECISION-012 PROVISIONAL → FINAL — agent prep done; A6.5 🟦 architect-blocked

Block-B B.6 ships A6.1 + A6.3 + A6.4 in
[docs/decisions/decision-012-promotion-prep.md](../decisions/decision-012-promotion-prep.md).

- A6.1 🟩 Cross-reference audit: 29 doctrine paths verified resolved 2026-05-01.
- A6.2 🟩 Architect read-through checklist already exists at [docs/decisions/decision-012-readthrough-checklist.md](../decisions/decision-012-readthrough-checklist.md).
- A6.3 🟩 Schema side-by-side: `audit.user_action_event` + `audit.user_action_chain` vs doctrine §3 / SRD §17 — no discrepancies.
- A6.4 🟩 Salt rotation operations: format, custody, cadence, runbook, DR procedure, failure modes.
- **A6.5 🟦 architect-blocked.** Architect committed 2026-05-01 to
  the read-through "this week". Tracked here; no agent action.
  Promotion procedure documented in
  [decision-012-readthrough-checklist.md](../decisions/decision-012-readthrough-checklist.md).

### A7. Stale TODOs sweep — 🟩

Both files re-checked 2026-05-01:

- A7.1 `vote-ceremony.tsx` carries only a descriptive
  `(challenge from /api/council/vote/challenge — DECISION-008 C5b)`
  reference, not a stale TODO marker.
- A7.2 `challenge/route.ts` says `Closes the C5b TODO` past-tense
  in its doc comment.

Closed during a prior pass.

### A8. End-to-end fixture script — 🟩 (with SRD §30 enumeration deferred to Block D)

Both files exist and the audit-coverage doc is shipped:

- [scripts/e2e-fixture.sh](../../scripts/e2e-fixture.sh) — 134-line Bash runner; seed → assert dashboard → assert chain → assert pattern → teardown.
- [scripts/seed-fixture-events.ts](../../scripts/seed-fixture-events.ts) — 108-line deterministic seed (1 investment_project + 1 treasury_disbursement + 1 finding stub).
- [docs/work-program/E2E-FIXTURE-COVERAGE.md](./E2E-FIXTURE-COVERAGE.md) — Block-B audit doc (B.5 commit). Maps every §30 entry to coverage status.

**Key audit finding.** SRD §30.1–§30.7 carry milestone titles but
NO enumerated tests; only §30.8 has named tests (CT-01..CT-06).
The fixture covers what it can within a 5-second synthetic run.

**A8 follow-up (Block D scope, architect-confirmed 2026-05-01) — 🟩
draft shipped.**

Block-D D.11 / 2026-05-01: agent drafted the SRD §30.1–§30.7
enumeration at
[docs/source/SRD-30-enumeration-draft.md](../source/SRD-30-enumeration-draft.md).
Per architect signoff option (b) "detailed draft" with [INFERRED]
markers vs citation separation: every test entry tagged exactly
one of `[CITED Table N]` (verbatim from SRD-v3 Tables 186-192),
`[INFERRED §29.X]` (agent inference from milestone narrative), or
`[INFERRED — agent recommendation]` (industry-standard milestone-
gate practice).

Counts: §30.1=4 CITED + 5 INFERRED; §30.2=4+4; §30.3=7+4;
§30.4=6+2; §30.5=8+0 (Table 190 renumbered); §30.6=2+3; §30.7=2+2;
§30.8=6+0 (unchanged). Total: 39 CITED + 20 INFERRED = 59 if all
accepted. Architect may accept all / partial / reject INFERRED.

Until architect resolution, the fixture operates against the
inferred list in
[E2E-FIXTURE-COVERAGE.md §3](./E2E-FIXTURE-COVERAGE.md#3-inferred-phase-1-milestone-gates--fixture-step-mapping)
which the draft's 20 `[INFERRED]` entries supersede with explicit
naming.

### A9. Production-placeholder sweep

Every PLACEHOLDER value in `.env.example`, `infra/sources.json`,
`infra/docker/*.yaml`, `infra/host-bootstrap/*.sh` either needs (a) a
real dev default that boots, or (b) an explicit `refuse-to-boot` guard
with a clear error message naming the env var.

- A9.1 Audit: `grep -r PLACEHOLDER /home/kali/vigil-apex` minus `node_modules` and `dist`.
- A9.2 For each: classify (dev-default-acceptable | architect-must-set | runtime-injection-from-vault).
- A9.3 Tier-1 boot guards (per DECISION-008): refuse to start with PLACEHOLDER for production-critical configs.

### A10. Pattern coverage gate — 🟩

[scripts/check-pattern-coverage.ts](../../scripts/check-pattern-coverage.ts)
exists and is wired in [phase-gate.yml](../../.github/workflows/phase-gate.yml).
Verified 2026-05-01: 43 source patterns ↔ 43 paired fixtures, gate
exits 0. Closed during a prior pass.

---

## TRACK B — Documentation completeness

### B1. Pattern catalogue — 🟩

Block-C C.1 (architect signoff 2026-05-01: option (a) generator):
[scripts/generate-pattern-catalogue.ts](../../scripts/generate-pattern-catalogue.ts)
ships strict-fail registry-field validation + a `--check` mode
wired into [phase-gate.yml](../../.github/workflows/phase-gate.yml).

Outputs (43 patterns, all priced + fixtures paired):

- [docs/patterns/catalogue.md](../patterns/catalogue.md) — rolled-up single-page catalogue with description_fr/en, prior, weight, fixture link, calibration link per entry.
- [docs/patterns/index.md](../patterns/index.md) — TOC table.
- [docs/patterns/P-X-NNN.md](../patterns/) × 43 — per-pattern docs (auto-generated header + architect-prose tail preserved across regenerations).

Strict contract enforced: every `PatternDef` MUST declare title_fr,
title_en, description_fr, description_en, defaultPrior, defaultWeight,
status AND ship a paired fixture-test in
`packages/patterns/test/category-X/`. CI fails with a clear field-list
error on any missing registry field.

### B2. Worker runbooks — 🟩

Block-C C.2 (template + 4 staged group commits) shipped 23
runbooks at `docs/runbooks/<service>.md`, one per service. Hybrid
bilingual layout (P-3): single file per service, FR + EN narrative
sub-blocks; language-neutral content single-source.

Plus two canonical R-runbooks for system-wide ceremonies:

- [R4-council-rotation.md](../runbooks/R4-council-rotation.md) — pillar rotation procedure.
- [R6-dr-rehearsal.md](../runbooks/R6-dr-rehearsal.md) — DR rehearsal (script in C.3).

R-procedure structure per service: R1 routine deploy, R2 restore
from backup, R3 credential rotation (per-service flavor:
YubiKey / Vault password / API-key / mTLS / N/A), R5 incident
response (P0–P3 tailored per service). R4 only on services that
touch council state (worker-governance, dashboard); else points
at canonical. R6 always points at canonical.

### B3. Disaster-recovery rehearsal script — 🟩

Block-C C.3:

- [scripts/dr-rehearsal.ts](../../scripts/dr-rehearsal.ts) — 10-step
  simulation; pre-flight refuses without dr-rehearsal compose
  profile + /mnt/nas-dr-test mount + Shamir fixture; --dry-run for
  pre-flight validation; --report for JSON timing emit.
- [docs/runbooks/R6-dr-rehearsal.md](../runbooks/R6-dr-rehearsal.md) — operator runbook.
- SLA: RTO ≤ 6 h, RPO ≤ 5 min, audit-chain clean post-restore.

### B4. TRUTH.md reconciliation — 🟩

Block-C C.4 (selective scope per architect's "5 highest-
architectural-weight" default):

1. Source-count: 26 → 29 (commit `19e29ca`, Block-A reconciliation §2.A.9).
2. LLM tier 0: pricing keyed by model_id (commit `9b4b274`, Block-A §2.A.4).
3. LLM tier 1: Bedrock cost accounting (commit `2db2271`, Block-A §2.A.5).
4. LLM doctrine chokepoint (NEW row): SafeLlmRouter universal coverage (Block-B A2 / commit `10dac28`).
5. Neo4j mirror state (NEW row): column + Prometheus gauge (Block-A §5.b / commit `3bc1250`).
6. Audit-export salt custody (NEW row): Vault path + rotation cadence (DECISION-012).

Out of scope per the selectivity bar: operational hardenings (POLYGON_ANCHOR_CONTRACT regex, A9 PLACEHOLDER sweep details) live in PHASE-1-COMPLETION.md + per-worker runbooks.

### B5. Decision log cross-link audit — 🟩 (with surfaced architect-action)

Block-C C.5:

- [scripts/check-decision-cross-links.ts](../../scripts/check-decision-cross-links.ts) — permissive contract; LEGACY_EXEMPT = D-000..D-006; D-007+ must satisfy AT LEAST ONE AUDIT-NNN AND ONE of {W-NN, 7+-char commit-sha, "commit:" line}.
- [docs/decisions/cross-link-audit.md](../decisions/cross-link-audit.md) — first-run audit doc.
- Wired into phase-gate.yml.

**Surfaced architect-action.** First run reports 10 of 19 entries failing (D-009..D-016). Per architect's "do not retrofit" the agent does NOT backfill. CI red on this single check until architect picks resolution option (a)/(b)/(c)/(d) per the audit doc.

(B5 follow-up note: a separate orthogonal lint at
[scripts/audit-decision-log.ts](../../scripts/audit-decision-log.ts)
already verifies markdown link resolution; the new lint adds
cross-reference completeness on top of link-validity.)

---

## TRACK C — Operational readiness

### C1. Compose stack smoke test — 🟩

Block-D D.1 ships [scripts/smoke-stack.sh](../../scripts/smoke-stack.sh).
Brings the stack up via `infra/docker/docker-compose.yaml`, waits
up to 5 minutes (`--timeout-s` overridable) for every
healthcheck-declaring container to report `healthy`, then probes
five dashboard edge surfaces:

- `GET /api/health` → 200
- `GET /api/audit/public?limit=5` → 200
- `GET /public/audit` → 200
- `GET /tip` → 200
- `GET /verify` → 200

Soft pre-flight warning when Tier-1 critical env vars
(`GPG_FINGERPRINT`, `TIP_OPERATOR_TEAM_PUBKEY`,
`AUDIT_PUBLIC_EXPORT_SALT`, `POLYGON_ANCHOR_CONTRACT`) are
PLACEHOLDER — affected workers refuse to boot per Block-A A9 /
Block-B B.2, so the script flags the cause-of-failure before the
healthcheck stage.

Modes: default = full bring-up + verify + leave running for inspection.
`--no-up` = verify only against an already-running stack.
`--down` = teardown on success.
Failure mode: prints last 50 log lines per unhealthy container
so CI-log walking surfaces the cause immediately.

### C2. Vault Shamir initialization — 🟩 (with M0c-action items)

[docs/runbooks/vault-shamir-init.md](../runbooks/vault-shamir-init.md)
exists. Block-D D.2 added a "Verification status" section
documenting:

- Static walk only — EE verification deferred to architect-driven M0c ceremony per EXEC §43.2.
- **Drift identified**: runbook describes `--recipient` flags the live `03-vault-shamir-init.sh` doesn't accept. Architect picks (A) match runbook to script OR (B) extend script to match runbook during M0c walk-through.
- Other observations: age-plugin-yubikey version pin, DECISION-013 reuse warning, audit-bridge event-type registration check.

Architect-action items captured at the end of the runbook for the
M0c ceremony.

### C3. Tor onion service health monitor — 🟩

Stack:

- [scripts/sentinel-tor-check.ts](../../scripts/sentinel-tor-check.ts) — hourly probe via SOCKS5h to the local Tor daemon; emits `vigil_tor_onion_up{target}` to the Prometheus pushgateway. Targets: `tip`, `verify` (via env `TIP_ONION_HOSTNAME` / `VERIFY_ONION_HOSTNAME`).
- [infra/host-bootstrap/systemd/vigil-sentinel-tor.service](../../infra/host-bootstrap/systemd/vigil-sentinel-tor.service) + [.timer](../../infra/host-bootstrap/systemd/vigil-sentinel-tor.timer) — `OnCalendar=*:23:00` (hourly at :23 to avoid colliding with anchor + replication bursts on the hour).
- Block-D D.3 added two Prometheus alerts in [infra/docker/prometheus/alerts/vigil.yml](../../infra/docker/prometheus/alerts/vigil.yml):
  - `TorOnionDown` — `vigil_tor_onion_up == 0` for 30m → warning.
  - `TorOnionStale` — `absent(vigil_tor_onion_up)` for 2h → warning (catches sentinel-cron-itself-down distinct from onion-down).

### C4. Grafana dashboards — 🟩

Block-D D.4a + D.4b + D.4c shipped the architect's 6 spec'd
dashboards (option (c) map+add+archive). Canonical set under
`infra/docker/grafana/dashboards/`:

1. [vigil-data-plane.json](../../infra/docker/grafana/dashboards/vigil-data-plane.json) — Postgres + Neo4j + Redis + IPFS health/saturation.
2. [vigil-workers.json](../../infra/docker/grafana/dashboards/vigil-workers.json) — per-worker queue lag, throughput, error rates (templated by `$worker`).
3. [vigil-llm.json](../../infra/docker/grafana/dashboards/vigil-llm.json) — daily cost, calls, hallucination rate, provider tier, schema-validation failure rate.
4. [vigil-findings-pipeline.json](../../infra/docker/grafana/dashboards/vigil-findings-pipeline.json) — detection rate, scoring tier, counter-evidence hold, action-queue depth, posterior + pattern-strength distributions.
5. [vigil-governance.json](../../infra/docker/grafana/dashboards/vigil-governance.json) — proposal lifecycle, vote distribution, pillar activity, recusal rate.
6. [vigil-operator-overview.json](../../infra/docker/grafana/dashboards/vigil-operator-overview.json) — KPIs across the 5 detail dashboards with deep-link panels.

The previous 14 dashboards moved to
[infra/docker/grafana/dashboards/archive-from-block-d/](../../infra/docker/grafana/dashboards/archive-from-block-d/)
with [README.md](../../infra/docker/grafana/dashboards/archive-from-block-d/README.md)
listing per-file justification (superseded / out-of-scope-for-MVP /
Phase-2-only). Architect-required single source of truth for "why
isn't there a dashboard for X?" questions.

### C5. Falco rules — 🟩

11 rules at [infra/observability/falco/vigil-rules.yaml](../../infra/observability/falco/vigil-rules.yaml).
Block-D D.5 work (architect signoff option (e)→ii + (a)→α + 3 NEW):

Refactored (NOT delete-and-readd):

- `shell_in_vigil_container` — same matcher + output + priority; fresher comment naming the generic threat (AUDITABLE-OPERATOR-PRESENCE; Cameroon TTPs are infrastructure/social, not container-runtime).
- `privilege_escalation_in_container` — broadened scope from `vigil_app_containers OR vigil_db_containers` to `container.id != host` (any container — picks up keycloak/tor/caddy/fabric-peer infra previously missed).

Added (NEW per architect spec):

- `worker_outbound_to_non_allowlisted_host` (b) — DATA-EXFILTRATION-OR-C2. Allowlist: vigil-internal subnet + vault + anthropic.com + bedrock-runtime.\* + polygon RPC. adapter-runner exempt (its outbound is the adapter contract).
- `cross_container_secret_read` (c) — CREDENTIAL-THEFT. Per-secret container ownership map (anthropic_api_key → LLM workers; postgres_password → postgres; etc.).
- `data_volume_write_from_non_owner` (d) — DATA-TAMPERING-OR-PERSISTENCE. /srv/vigil/{postgres,neo4j,ipfs}/data/ — only the owning store's container may write.

Tests: [infra/observability/falco/RULE-TESTS.md](../../infra/observability/falco/RULE-TESTS.md).
Per-rule trigger + expected log line documented. 2 of 11 sandbox-
testable; 9 require host-side bind mounts / privileged Falco /
real network egress allowlist — production-only verification per
architect spec, walked during M0c hardening week.

### C6. Sentinel quorum check — 🟩

3 VPS (Helsinki, Tokyo, NYC), 2-of-3 quorum for outage attestation.

Status, Block-D D.6 / 2026-05-01:

- The wiring is via systemd timer, not an `apps/` workspace —
  `infra/host-bootstrap/systemd/vigil-sentinel-quorum.{service,timer}`
  fires `scripts/sentinel-quorum.ts` every 5 min (offset 47s from the
  wall-clock minute boundary so it doesn't collide with the high-sig
  anchor's 5s tick). No `apps/sentinel-monitor/` is needed.
- The orchestration moved from `scripts/sentinel-quorum.ts` into
  [packages/observability/src/sentinel-quorum.ts](../../packages/observability/src/sentinel-quorum.ts)
  so the integration test can drive `runSentinelQuorum` against
  localhost mocks without spawning a subprocess. The script becomes
  a thin CLI shim. Pure `quorumDecide` already lived in the package
  (9 unit tests).
- Integration test:
  [packages/observability/\_\_tests\_\_/sentinel-quorum-integration.test.ts](../../packages/observability/__tests__/sentinel-quorum-integration.test.ts)
  spins up 3 ephemeral-port HTTP servers (sentinel mocks) + 1 UDS
  socket (audit-bridge mock) and runs 6 cases:
  - 3-of-3 down → emits `system.health_degraded` to UDS
  - 2-of-3 down → emits, attesting_sites = [helsinki, tokyo]
  - 2-of-3 up → no emit
  - 1 up + 1 down + 1 unknown → inconclusive, no emit
  - sentinel returns 503 → mapped to `unknown`
  - skip-suite guard if any of the 4 binds fail (sandboxed CI runners)

Architect-spec drift acknowledged: the spec said
`sentinel.quorum_outage` but the live action enum
([packages/shared/src/schemas/audit.ts:18](../../packages/shared/src/schemas/audit.ts#L18))
has `system.health_degraded`. Block-D commits the live name; if the
architect prefers the spec name, the rename is a one-enum-add + one
script-change in a follow-up.

### C7. Phase-gate CI workflow validation — 🟩

`.github/workflows/phase-gate.yml` exists per OPERATIONS §8 — 10 lints
gating every PR (current-phase reader; DRY-RUN-DECISION GO check;
check-decisions; audit-decision-log; check-pattern-coverage;
check-weaknesses-index; check-migration-pairs;
check-test-coverage-floor; check-source-count; check-llm-pricing;
generate-pattern-catalogue --check; check-decision-cross-links).

Status, Block-D D.7 / 2026-05-01:

- C7.1 🟩 Phase-gate workflow walked end-to-end; 10 lints documented
  in the workflow comments are the live set. The workflow reads
  `**Current phase: Phase-N**` from `docs/decisions/log.md` and gates
  via `DRY-RUN-DECISION.md`. (No code change needed.)
- C7.2 🟩 Architect-spec'd option (b) on-the-fly mutation harness:
  [scripts/synthetic-failure.ts](../../scripts/synthetic-failure.ts) +
  [.github/workflows/synthetic-failure.yml](../../.github/workflows/synthetic-failure.yml).
  Five mutually-different mutation surfaces (markdown append, single-
  line text patch, JSON edit, src-file add, src-file add) drive the
  five lints chosen for cross-coverage of mutation kind:
  1. `check-decision-cross-links` — DECISION-099 with no AUDIT/W/sha
  2. `check-source-count` — TRUTH.md "29 sources" → "30 sources"
  3. `check-llm-pricing` — pricing.json models map emptied
  4. `check-pattern-coverage` — `p-a-999-synthetic.ts` with no fixture
  5. `check-migration-pairs` — `9999_synthetic.sql` with no `_down.sql`

  Each case mutates → spawns the lint → restores in a try/finally so
  the working tree is clean even on harness failure. Verified locally
  2026-05-01: 5/5 REJECTED with exit 1, working tree restored,
  baseline lints still pass. The harness exits 1 on any ESCAPED case
  (lint passed on broken input) so the workflow fails loud if a gate
  silently breaks.

  Workflow triggers: PR-on-touch (the lint scripts, the harness, or
  any of the input surfaces); weekly cron (Monday 04:00 UTC); manual
  `workflow_dispatch`. Per-gate REJECTED log line per architect spec:
  `[<gate-name>] ✓ REJECTED (exit 1)`.

  Architect-action item recorded in the harness header: when a future
  phase-gate lint joins the batch, also add a synthetic-failure case.
  The 1:1 invariant (every lint has a synthetic-failure case) is the
  unit-test of the gate itself.

### C8. PR template + commitlint config — 🟩

Status, Block-D D.8 / 2026-05-01:

- C8.1 🟩 [.github/PULL_REQUEST_TEMPLATE.md](../../.github/PULL_REQUEST_TEMPLATE.md)
  ships: ring (0..5) + scope, description, 10-item self-critique
  checklist (SRD compliance, input validation, Vault-only secrets,
  idempotency, structured logging, ≥80% coverage, non-root container,
  audit trail, fabrication-resistance, YAGNI), AT-?-?? acceptance-
  test pointer, DECISION-???: pointer, architect sign-off line.
  Block-D fixed the broken `IMPLEMENTATION-PLAN.md` ref to point at
  `docs/IMPLEMENTATION-PLAN.md`.
- C8.2 🟩 [commitlint.config.cjs](../../commitlint.config.cjs)
  declares 12 allowed types (feat / fix / docs / chore / refactor /
  perf / test / build / ci / security / deps / revert) and a closed
  scope-enum (top-level + every package + every worker app + the 6
  ring-level scopes + 3 Phase-2 MOU-gated adapter scopes). Subject
  rules: never upper/pascal/start-case, never empty, never
  trailing-period, header ≤100 chars, body ≤100 chars per line.
- C8.3 🟩 [.husky/commit-msg](../../.husky/commit-msg) runs
  `pnpm exec commitlint --edit "$1"` on every commit; rejects on any
  rule violation.
- C8.4 🟩 [.husky/pre-commit](../../.husky/pre-commit) blocks
  staging of `personal/{calibration-seed,council-candidates,prompts/
*.local.md}` and any `.env` file (whitelist `.env.example`); runs
  `lint-staged` + `gitleaks protect --staged` if available.

Verified Block-D D.8 / 2026-05-01: smoke-tested commitlint locally
against four cases — bad type ✓ rejects with `[type-enum]`; bad
scope ✓ rejects with `[scope-enum]`; header >100 chars ✓ rejects
with `[header-max-length]`; valid commit ✓ silent pass.

### C9. Backup script verification — 🟩 (verified + gaps documented)

`infra/host-bootstrap/10-vigil-backup.sh` runs nightly under systemd
timer `vigil-backup.timer` at 02:30 Africa/Douala (RandomizedDelaySec
±10 min).

Status, Block-D D.9 / 2026-05-01:

- C9.1 🟩 [scripts/verify-backup-config.sh](../../scripts/verify-backup-config.sh)
  walked end-to-end (CI mode `CI=1`): all hard-error checks pass —
  bootstrap script present + executable; vigil-backup.service +
  vigil-backup.timer wired; pg_basebackup / btrfs / neo4j-admin /
  ipfs / GPG_FINGERPRINT / synology coverage; .env.example
  documents the 4 required env vars; backup pipeline referenced in
  decision log.
- C9.2 🟩 [docs/runbooks/backup.md](../runbooks/backup.md) authored:
  what the pipeline writes (per-step source / how / output file
  table); pre-flight verification commands (gpg --verify +
  sha256sum -c MANIFEST.sha256); architect-spec coverage gap table;
  what the runbook does NOT cover (cross-references to RESTORE.md,
  dr-rehearsal.md, R6, EXEC §34.6).

**Architect-spec coverage gaps (5 items, surfaced as warnings).**
The verifier was extended with five `[architect-spec]` checks that
emit yellow warnings (not hard errors) so the gap is visible in CI
without blocking. Each row points the operator at
docs/runbooks/backup.md for the architect-action context.

| Spec item                   | Current                             | Gap                                                 | Action             |
| --------------------------- | ----------------------------------- | --------------------------------------------------- | ------------------ |
| Vault snapshot              | btrfs-of-/srv/vigil/vault           | no `vault operator raft snapshot save` (raft-aware) | M0c week           |
| Git repo backup             | none on backup host                 | source on github + architect's working tree only    | M0c week           |
| Audit-chain explicit export | inside postgres dump only           | no separate signed CSV/JSONL of audit.actions       | M0c week           |
| Encrypted-at-rest archive   | manifest signed, contents plaintext | NAS stores plaintext basebackup + dumps             | M0c week           |
| Hetzner archive mirror      | only Synology rclone target         | no second-region mirror                             | Phase-2 (post-MOU) |

These are defence-in-depth additions, not blockers — the current
pipeline meets the 6-hour RTO target for host loss + btrfs
corruption + Postgres corruption (the failure modes RESTORE.md is
written for). None can be silently extended by the build agent;
each touches a key the architect controls (Vault root token, GPG
passphrase) or a paid resource (Hetzner Storage Box).

### C10. Secret-scan baseline — 🟩

`gitleaks` baseline + pre-commit hook + CI workflow. No exceptions.

Status, Block-D D.10 / 2026-05-01:

- C10.1 🟩 [.gitleaks.toml](../../.gitleaks.toml) extends the default
  ruleset (Anthropic, AWS, GitHub PAT, Stripe, Slack, generic high-
  entropy) and ships 6 allowlist blocks covering: synthetic IPFS
  CIDs in the anti-hallucination corpus; deterministic placeholder
  hashes / hex strings under `**/__tests__/`; PLACEHOLDER markers
  in `.env.example` + `docs/` + `*.md`; architect / sample emails
  in docs; **NEW Block-D** EU sanctions list public token (European
  Commission open-data portal); **NEW Block-D** Vault path
  references in k8s ExternalSecrets manifests (`key: vigil/...`
  lines name paths, not secret values); repo-wide path exclusions
  (`node_modules/`, lockfiles, `dist/`, `build/`, `.next/`,
  `.turbo/`, `graphify-out/`).
- C10.2 🟩 [.husky/pre-commit](../../.husky/pre-commit) runs
  `gitleaks protect --staged --redact -v --no-banner` if the
  binary is available. Verified end-to-end during D.6/D.7/D.8/D.9
  commit pre-flight (every staged-files commit logged
  `[pre-commit] OK` after gitleaks scan).
- C10.3 🟩 [.github/workflows/secret-scan.yml](../../.github/workflows/secret-scan.yml)
  runs two scanners on every push + every PR + daily at 03:17 UTC:
  - `gitleaks/gitleaks-action@v2` against full git history with
    artifact upload + actor notification
  - `trufflesecurity/trufflehog@main` with `--only-verified` (live
    secret check via vendor APIs — very low false-positive rate)
- C10.4 🟩 False-positive triage:
  - `apps/adapter-runner/src/adapters/eu-sanctions.ts:21` —
    `?token=dG9rZW4tMjAxNw` is the EU sanctions list public download
    token (published in EU open-data documentation; access controlled
    by IP allowlist + rate limit, not the token). Allowlisted.
  - `infra/k8s/charts/vigil-apex/templates/externalsecret-workers.yaml:23`
    — `key: vigil/vault-tokens/worker` is a Vault path identifier,
    not a secret value (ExternalSecrets resolves the value at runtime).
    Allowlisted with a path-scoped regex covering all
    `infra/k8s/charts/**/*.{yaml,yml}` ExternalSecrets manifests.

Verified Block-D D.10 / 2026-05-01:
`gitleaks detect --no-git --redact -v` → 0 leaks (was 2 before
the Block-D allowlist extension); pre-commit gitleaks scan green
on every Block-D commit.

---

## TRACK D — Test quality (additional integration / E2E)

### D1. Council vote ceremony E2E

Mock 5 council members, run a 3-of-5 escalation vote, assert: vote
events emitted, posterior crosses 0.85, dossier render enqueued, all
high-sig events anchored individually.

### D2. Tip portal Tor flow E2E

Submit a tip via a Tor SOCKS proxy, assert: ciphertext stored,
council 3-of-5 decryption works, paraphrase generated, raw text never
crosses the council boundary.

### D3. CONAC SFTP delivery E2E

Spin a local SFTP server, render a dossier, deliver, ack, assert
audit rows + delivery row + receipt row + Polygon anchor.

### D4. Federation stream E2E

Sign an envelope on the agent, replay protection check, signature
verification, region-prefix enforcement, payload-cap rejection.

### D5. WebAuthn → secp256k1 path

Per W-10. The native libykcs11 helper is deferred to M3-M4; the
WebAuthn fallback path is shipped and needs an E2E test asserting
the fallback works for a sample council member.

### D6. Dashboard a11y CI

Per OPERATIONS, a11y is enforced. Wire `playwright test tests/a11y/`
into `.github/workflows/ci.yml` (currently the dashboard `test`
target only runs vitest).

### D7. Visual regression tests

Per SRD §03.5 (UI consistency). Snapshot the 19 dashboard pages on a
canonical fixture; fail on visual diff > threshold.

---

## TRACK E — Security

### E1. Snyk Pro vulnerability scan

Per OPERATIONS §4 CI gates. Wire Snyk into CI; blocking on Critical,
warning on High.

### E2. Threat-model code-coverage matrix

Cross-reference `THREAT-MODEL-CMR.md` threats × code mitigations.
Output: a CSV / matrix doc showing every threat has either a code
mitigation or an explicit "out of scope" note.

### E3. Dependency rotation

Quarterly dependency audit; renovate-bot config; blocking on Critical
CVE within 7 days.

### E4. Pre-commit secret scan

Already in C10 — covered.

### E5. SBOM generation

Software Bill of Materials per package; generated on release; signed.

---

## TRACK F — Architect-blocked (🟦 — tracked, not actionable by agent)

### F1. Council formation (5 pillars)

- F1.1 Identify governance pillar candidate
- F1.2 Identify judicial pillar candidate
- F1.3 Identify civil-society pillar candidate
- F1.4 Identify audit pillar candidate
- F1.5 Identify technical pillar candidate
- F1.6 Vetting against EXEC §10 worksheet
- F1.7 First-contact letters drafted (agent can draft templates per EXEC §11)
- F1.8 YubiKey provisioning ceremony per pillar
- F1.9 First dry-run vote on testnet

### F2. Backup architect (W-17)

- F2.1 Identify candidate
- F2.2 Retainer letter (~€400/mo) signed
- F2.3 Vault Shamir share + Polygon Shamir share allocated
- F2.4 Forgejo + GitHub mirror access
- F2.5 Quarterly DR rehearsal calendar

### F3. CONAC engagement (W-25 institutional half)

- F3.1 Engagement letter draft (agent can draft per EXEC §11)
- F3.2 In-person meeting
- F3.3 Schema negotiation (format-adapter selection)
- F3.4 Counter-signature

### F4. ANTIC declaration (W-23)

- F4.1 Counsel engaged
- F4.2 Loi N° 2010/021 declaration filed
- F4.3 Acknowledgement received

### F5. YubiKey procurement (Phase 1 precondition)

- F5.1 8 × YubiKey 5 (5 NFC + 1 architect + 1 polygon-signer 5C + 1 spare)
- F5.2 9th YubiKey for off-jurisdiction deep-cold backup (W-08)
- F5.3 Customs clearance (W-18 budget)
- F5.4 Enrollment ceremony per HSK-v1 §05

### F6. Polygon mainnet contract deployment (Phase 7 precondition)

- F6.1 Polygon-signer YubiKey provisioned
- F6.2 Wallet funded (~$50 MATIC for deployment + 6mo operation)
- F6.3 `VIGILAnchor.sol` deployed
- F6.4 `VIGILGovernance.sol` deployed
- F6.5 Contract addresses recorded in TRUTH.md + decision log
- F6.6 First testnet anchor + first mainnet anchor

### F7. Calibration seed (W-16, deferred to M2 exit)

- F7.1 30 historical CONAC published cases researched (per EXEC §25)
- F7.2 Architect grades ground-truth labels
- F7.3 Seed loaded into `calibration.entry`
- F7.4 First reliability-band run

### F8. Off-jurisdiction safe-deposit-box (W-08)

- F8.1 Choose city (Geneva / Lisbon / Zurich — TRUTH §L Q5)
- F8.2 Open box
- F8.3 Seal 9th YubiKey + share envelopes

### F9. Domain + cloud accounts

- F9.1 Register `vigilapex.cm` at Gandi
- F9.2 Cloudflare DNS + DNSSEC
- F9.3 CAA records to Let's Encrypt only
- F9.4 ProtonMail or Postfix on N02
- F9.5 Hetzner CPX31 provisioned
- F9.6 Anthropic API account
- F9.7 AWS Bedrock account (sovereignty failover)
- F9.8 Alchemy / Infura Polygon RPC
- F9.9 Sentinel monitors (Helsinki / Tokyo / NYC)

### F10. TRUTH.md open questions

Per TRUTH §L:

- F10.1 Council pillar names (overlaps F1)
- F10.2 Backup architect identity (overlaps F2)
- F10.3 Hosting choice (Hetzner Falkenstein vs OVH Strasbourg) — DECISION-001 pending
- F10.4 Operational domain (`vigil.gov.cm` vs `vigilapex.cm`) — currently assumes `vigilapex.cm`
- F10.5 Off-jurisdiction safe-deposit-box city (overlaps F8)
- F10.6 Format-adapter Plan B target (Cour des Comptes recommended)

---

## Execution order

This order maximises agent leverage (do everything possible without architect
input first) and surfaces architect-blocked items early so the architect can
work them in parallel.

1. **Track A** — code-side completion. Agent executes start-to-finish.
2. **Track B** — documentation completeness. Agent executes; architect reviews.
3. **Track C** — operational readiness. Agent executes the code parts; architect runs the ceremony parts.
4. **Track D** — test quality. Agent executes.
5. **Track E** — security. Agent executes the code parts; counsel handles legal.
6. **Track F** — architect-blocked. Tracked but not actionable by agent. Agent can draft template letters / scripts / checklists.

---

## How to use this file

- Every section has a stable anchor; reference these in commit messages and PRs.
- When a Track-A item completes, mark it `🟩` here and remove from session
  TodoWrite.
- When an architect-blocked item completes, the architect updates this file
  - writes a decision-log entry.
- Quarterly review: re-baseline against TRUTH.md and the weakness index.
