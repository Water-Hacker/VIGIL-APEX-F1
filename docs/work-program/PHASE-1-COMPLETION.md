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

### A2. SafeLlmRouter per-worker migration

The doctrine chokepoint must wrap every direct LlmRouter call so the
12 AI-SAFETY-DOCTRINE-v1 layers apply uniformly.

- A2.1 [apps/worker-extractor/](../../apps/worker-extractor/) — **🟩 already migrated.**
  [src/index.ts:288](../../apps/worker-extractor/src/index.ts#L288) instantiates `SafeLlmRouter` and passes a `SafeLlmRouterLike` adapter to the extractor.
- A2.2 [apps/worker-counter-evidence/](../../apps/worker-counter-evidence/) — **🟩 already migrated.**
  [src/index.ts:189](../../apps/worker-counter-evidence/src/index.ts#L189) calls `this.safe.call({...})`.
- A2.3 [apps/worker-pattern/](../../apps/worker-pattern/) — **🟩 N/A (no LLM calls).** The pattern dispatcher is deterministic; there is no Claude call to wrap. The `task: 'pattern_evaluate'` task class would be added if a future LLM-backed pattern lands.
- A2.4 [apps/worker-tip-triage/](../../apps/worker-tip-triage/) — **drift-corrected scope (Block-B reconciliation, architect signoff 2026-05-01).** Currently calls `LlmRouter.call` directly at [src/index.ts:122](../../apps/worker-tip-triage/src/index.ts#L122).
- A2.5 [apps/worker-adapter-repair/](../../apps/worker-adapter-repair/) — **drift-corrected scope.** Currently calls `LlmRouter.call` directly at [src/index.ts:121](../../apps/worker-adapter-repair/src/index.ts#L121).

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

### A5. CAS integration harness in CI

The `audit-log-cas.test.ts` is gated on `INTEGRATION_DB_URL`; today it skips
in CI. Wire a docker-compose service in `.github/workflows/ci.yml` that
spins up Postgres, applies migrations, and exports the env var so the
test runs.

- A5.1 GH Actions service for postgres:16
- A5.2 Run drizzle migrations as a CI step before vitest
- A5.3 Export `INTEGRATION_DB_URL=postgres://...` to the test job
- A5.4 Verify `audit-log-cas.test.ts` runs (no longer skipped)

### A6. DECISION-012 PROVISIONAL → FINAL

The TAL-PA doctrine + DECISION-012 entry is committed. Promotion needs:

- A6.1 Cross-reference audit: every file the doctrine mentions exists at the cited path.
- A6.2 Architect read-through checklist (`docs/decisions/decision-012-readthrough-checklist.md`).
- A6.3 Side-by-side: current `audit.user_action_event` schema vs SRD §17 expectations.
- A6.4 Rotate `AUDIT_PUBLIC_EXPORT_SALT` documentation (key custody, rotation cadence).
- A6.5 Update [docs/decisions/log.md](docs/decisions/log.md) to FINAL once architect signs.

### A7. Stale TODOs sweep — 🟩

Both files re-checked 2026-05-01:

- A7.1 `vote-ceremony.tsx` carries only a descriptive
  `(challenge from /api/council/vote/challenge — DECISION-008 C5b)`
  reference, not a stale TODO marker.
- A7.2 `challenge/route.ts` says `Closes the C5b TODO` past-tense
  in its doc comment.

Closed during a prior pass.

### A8. End-to-end fixture script

A single Bash/Node runner that boots docker-compose, seeds events, walks
through finding → posterior → council vote → escalation → render → SFTP
delivery → public verify, and asserts at each step. Replaces today's
"manual fixture run" in OPERATIONS.

- File: [scripts/e2e-fixture.sh](scripts/e2e-fixture.sh) (new)
- Companion: [scripts/seed-fixture-events.ts](scripts/seed-fixture-events.ts) (new)
- Coverage: every Phase 1 critical path in SRD §30 acceptance tests.

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

### B1. Pattern catalogue

One-page-per-pattern docs under `docs/patterns/P-X-NNN.md` with: signal
description, LR (likelihood ratio) reasoning, golden-fixture references,
known FP traps, calibration band history.

- 43 docs to produce. Auto-generate skeletons from the pattern definitions
  (each `PatternDef` in `packages/patterns/src/category-*/p-*-*.ts`).

### B2. Worker runbooks

Bilingual (FR + EN) runbook per worker in `docs/runbooks/`:
adapter-runner, worker-anchor, worker-audit-watch, worker-document,
worker-dossier, worker-extract, worker-counter-evidence, worker-pattern,
worker-score, worker-governance, worker-conac-sftp, worker-tip-decrypt,
worker-fabric-bridge, worker-federation-agent, worker-federation-receiver,
worker-adapter-repair, worker-satellite, audit-bridge, dashboard.

19 workers/services × 2 languages = 38 docs. Skeleton template + per-worker fill-in.

### B3. Disaster-recovery rehearsal script

Per OPERATIONS §10 "Emergency Repo Access" + SRD §27 DR plan. A
playbook the backup architect can execute during the quarterly drill.

- File: [docs/runbooks/dr-rehearsal.md](docs/runbooks/dr-rehearsal.md)
- Companion: [scripts/dr-restore-test.sh](scripts/dr-restore-test.sh)

### B4. TRUTH.md reconciliation

Re-read TRUTH §A–§L; bump "Last updated" header to 2026-04-29 and
flip any "proposed" status to "committed" if the underlying code shipped.

- B4.1 §A "Build duration" — proposed → committed
- B4.2 §E "Deep-cold backup" — proposed → committed (or 🟦 if architect not done)
- B4.3 §F "Tip portal Tor presence" — proposed → committed (W-09 is 🟩)
- B4.4 §G "Plan B recipient" — proposed → committed (DECISION-010 routes by body)
- B4.5 §G "Public verification" — proposed → committed (W-15 is 🟩)
- B4.6 §E "Council vote signing" — proposed → committed (W-10 partial; flag the libykcs11 deferred bit)

### B5. Decision log cross-link audit

Every "see DECISION-XXX" reference resolves; every "see SRD §YY"
reference resolves; every code path the log claims to have shipped
exists.

- File: [scripts/audit-decision-log.ts](scripts/audit-decision-log.ts) (new)
- CI step: blocking on broken refs.

---

## TRACK C — Operational readiness

### C1. Compose stack smoke test

`docker compose up -d && wait-for-healthy.sh && smoke-tests.sh`. Verifies
every container reaches healthy and the dashboard returns 200 on
`/api/health`.

- File: [scripts/smoke-stack.sh](scripts/smoke-stack.sh)

### C2. Vault Shamir initialization

The `infra/host-bootstrap/03-vault-shamir-init.sh` script exists; verify
it works end-to-end against a dev Vault. Document the architect's
execution checklist.

- File: [docs/runbooks/vault-shamir-init.md](docs/runbooks/vault-shamir-init.md)

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
