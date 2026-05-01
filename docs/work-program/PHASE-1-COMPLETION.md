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

**A8 follow-up (Block D scope, architect-confirmed 2026-05-01).**
The agent drafts the SRD §30.1–§30.7 enumeration in Block D based
on the inferred mapping in
[E2E-FIXTURE-COVERAGE.md §3](./E2E-FIXTURE-COVERAGE.md#3-inferred-phase-1-milestone-gates--fixture-step-mapping).
Architect reviews and edits in place. Until then the fixture
operates against the inferred list.

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

### C3. Tor onion service health monitor

`/tip` is Tor-native (W-09 🟩). Add a sentinel that pings the .onion
hourly from the Hetzner sentinel monitors and alerts if down for

> 30 min.

- File: [apps/sentinel-monitor/src/checks/tor-tip-onion.ts](apps/sentinel-monitor/src/checks/tor-tip-onion.ts)

### C4. Grafana dashboards (JSON)

Phase 1 dashboards: ingestion-throughput, pattern-fire-rate,
calibration-bands, audit-chain-tail, polygon-anchor-cost,
council-vote-lag, tip-volume, llm-cost-per-finding.

- 8 dashboards under [infra/observability/grafana/dashboards/](infra/observability/grafana/dashboards/)

### C5. Falco rules

Custom rules for: vault-binary-execed, yubikey-removed-mid-session,
unsigned-commit-on-main, postgres-from-non-app, audit-actions-direct-write.

- File: [infra/observability/falco/vigil-rules.yaml](infra/observability/falco/vigil-rules.yaml)

### C6. Sentinel quorum check

3 VPS (Helsinki, Tokyo, NYC), 2-of-3 quorum for outage attestation.
Verify the existing `apps/sentinel-monitor/` actually wires this and
emit a `sentinel.quorum_outage` audit row when 2-of-3 say down.

- Integration test gated on three sentinel ports.

### C7. Phase-gate CI workflow validation

`.github/workflows/phase-gate.yml` exists per OPERATIONS §8. Verify it
reads the current phase from the decision log and enforces.

- C7.1 Read [.github/workflows/phase-gate.yml](.github/workflows/phase-gate.yml).
- C7.2 Add a test that mutates a Phase-2 file in a Phase-1 PR and asserts the workflow rejects.

### C8. PR template + commitlint config

- C8.1 [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) (verify).
- C8.2 `commitlint.config.cjs` enforces Conventional Commits.

### C9. Backup script verification

`infra/host-bootstrap/10-vigil-backup.sh` runs nightly. Verify it
backs up Postgres + Vault snapshot + IPFS pinset + git repo +
audit-chain export, all encrypted with the architect's GPG key, all
mirrored to NAS-replica + Hetzner archive.

### C10. Secret-scan baseline

`gitleaks` baseline plus pre-commit hook plus CI step. No exceptions.

- File: [.gitleaks.toml](.gitleaks.toml)
- Hook: [.husky/pre-commit](.husky/pre-commit)

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
