# BLOCK C — completion summary (2026-05-01)

> **Status:** all six items in the Block-C plan §2 running order
> shipped. Halting for architect review before opening Block D.
>
> Block-C scope was Track B (B1–B5) per architect's explicit
> instruction. Track C (operational readiness, C1–C10) is
> **Block D**, NOT this block.

---

## Commits (this block)

| #              | Item                                                                                          | Commit    |
| -------------- | --------------------------------------------------------------------------------------------- | --------- |
| 0              | Block-C plan + 4 batched hold-points                                                          | `a369e14` |
| C.1            | B1 pattern catalogue generator + strict CI gate                                               | `8383cab` |
| C.2 (template) | revised worker-entity + R4/R6 canonicals                                                      | `0b9311c` |
| C.2.a          | infra-plane runbooks (postgres/neo4j/redis/ipfs/vault/keycloak/fabric) + worker-entity R3 fix | `beb2a9c` |
| C.2.b          | worker-plane runbooks (15 services)                                                           | `f726aa4` |
| C.2.c          | edge-plane runbooks (4 services)                                                              | `7d22f44` |
| C.2.d          | Phase-2/3 scaffolded runbooks (3 services)                                                    | `df3cd5e` |
| C.3            | DR rehearsal script + runbook                                                                 | `7dde223` |
| C.4            | TRUTH.md selective drift reconciliation                                                       | `2007cb8` |
| C.5            | decision-log cross-link audit + lint                                                          | `841e086` |

(plus the C.6 commit landing this summary.)

11 commits total this block.

---

## What landed

### B1 — Pattern catalogue (generator + strict registry-field check)

- `scripts/generate-pattern-catalogue.ts` — extends an existing
  per-pattern doc generator with strict-fail mode + `--check`
  mode + a new rolled-up `docs/patterns/catalogue.md`.
- `docs/patterns/catalogue.md` — 1129 lines, 43 sections, single-
  page with description_fr/en + prior + weight + fixture link +
  calibration link per pattern.
- CI lint at `phase-gate.yml`: missing registry field on any
  pattern fails the gate.
- All 43 patterns satisfy the strict contract on first run.
- `.prettierignore` extended so prettier can't reflow tables and
  break the byte-exact `--check` comparison.

### B2 — Worker runbooks (23 services + R4/R6 canonicals)

Hybrid bilingual layout per architect signoff (P-3):

- 23 service runbooks at `docs/runbooks/<service>.md`.
- Single file per service with FR + EN narrative sub-blocks; all
  language-neutral content (metric tables, command snippets, file
  paths, env vars, error codes, P0–P3 thresholds, step numbering)
  single-source.
- Split health-check (binary, page-worthy) vs SLO (latency/error/
  lag, investigate-worthy) tables per architect note 4.
- Per-service R3 (credential rotation) tailored per architect note
  1: YubiKey-protected (worker-anchor), LLM-using
  (worker-counter-evidence, worker-extractor, worker-tip-triage,
  worker-adapter-repair, worker-dossier narrative,
  worker-conac-sftp narrative), DB/cache (postgres, neo4j, redis),
  mTLS (worker-minfi-api), SSH-key + GPG (worker-conac-sftp),
  Shamir-share ceremony (vault), N/A (audit-bridge,
  worker-document, worker-image-forensics, etc.).
- Per-service R5 incident table tailored per architect note 2
  (e.g., postgres P0 on data corruption; worker-anchor P0 on
  high-sig anchor lag > 5 min; vault P0 on sealed > 60s post-restart).
- SRD back-links per architect note 5.
- R4 dropped from per-worker template; canonical at
  [`R4-council-rotation.md`](../runbooks/R4-council-rotation.md);
  full content lives only on worker-governance + dashboard.
- R6 always points at the canonical
  [`R6-dr-rehearsal.md`](../runbooks/R6-dr-rehearsal.md).

### B3 — DR rehearsal (script + runbook)

- [`scripts/dr-rehearsal.ts`](../../scripts/dr-rehearsal.ts) — 10-step simulation:
  baseline → snapshot → fresh stack → restore Postgres → restore
  IPFS → restore Vault + mock unseal → workers up + first event
  → audit chain walk → baseline-vs-restored comparison →
  teardown.
- Pre-flight refuses without the dr-rehearsal compose profile,
  /mnt/nas-dr-test mount, and Shamir fixture (architect-provided,
  gitignored).
- `--dry-run` for procedure validation; `--report=path` for JSON
  timing emit.
- SLA: RTO ≤ 6 h, RPO ≤ 5 min, audit-chain clean post-restore.

### B4 — TRUTH.md reconciliation (5 selective lines)

Per architect's "5 highest-architectural-weight" default:

1. Source-count flipped to 29 (already shipped at `19e29ca`).
2. LLM tier 0 pricing keyed by model_id.
3. LLM tier 1 Bedrock cost accounting.
4. NEW: LLM doctrine chokepoint — SafeLlmRouter universal coverage.
5. NEW: Neo4j mirror state — column + gauge + alerts.
6. NEW: Audit-export salt custody — Vault path + rotation cadence.

Out of scope per the selectivity bar: operational hardenings live
in PHASE-1-COMPLETION.md + per-worker runbooks rather than TRUTH.

### B5 — Decision-log cross-link audit + lint

- `scripts/check-decision-cross-links.ts` — permissive contract;
  LEGACY_EXEMPT for D-000..D-006; D-007+ must satisfy
  AT LEAST ONE `AUDIT-NNN` AND ONE of {W-NN, 7+-char commit sha,
  `commit:` line}.
- `docs/decisions/cross-link-audit.md` — first-run audit doc.
- Wired into `phase-gate.yml`.
- **Architect-action surfaced**: 10 of 19 entries currently fail
  the contract (D-009..D-016). Per "do not retrofit" the agent
  does NOT backfill. CI red on this lint until the architect picks
  resolution option (a) backfill in a separate session, (b) extend
  legacy allowlist, (c) loosen contract, (d) accept temporary red.

---

## CI gate state

After this block, `phase-gate.yml` runs **12** scripted lints.
Expected post-push state:

| Lint                                  | Expected | Notes                                                             |
| ------------------------------------- | -------- | ----------------------------------------------------------------- |
| dry-run-decision GO check             | ✅       |                                                                   |
| check-decisions.ts                    | ✅       |                                                                   |
| audit-decision-log.ts                 | ✅       |                                                                   |
| check-pattern-coverage.ts             | ✅       | 43 ↔ 43.                                                          |
| check-weaknesses-index.ts             | ✅       |                                                                   |
| check-migration-pairs.ts              | ✅       |                                                                   |
| check-test-coverage-floor.ts          | ✅       |                                                                   |
| check-source-count.ts                 | ✅       | 29 == 29 == 29 since `19e29ca`.                                   |
| check-llm-pricing.ts                  | ✅       | 3 models, 3 defaults all priced.                                  |
| **check-decision-cross-links.ts**     | **❌**   | **Surfaces 10 D-009..D-016 failures (intended; architect call).** |
| generate-pattern-catalogue.ts --check | ✅       | All 43 satisfy strict registry-field contract.                    |
| (existing CI workflow checks)         | ✅       | Same as Block B close.                                            |

The Block-C-introduced lints (catalogue freshness + cross-links)
are the only delta from Block-B's CI gate state.

---

## Architect-action items surfaced for close (4)

### A.5.4 (carried from Block B) — Salt-collision CI alert

Deferred to Block E. Quarterly cron only; 90-day detection window.

### A.6.5 (carried from Block B) — DECISION-012 PROVISIONAL → FINAL

Architect-blocked. Procedure documented in
`docs/decisions/decision-012-readthrough-checklist.md`. No agent
action.

### A.8 (carried from Block B) — SRD §30 enumeration

Default Option B per architect: agent drafts the §30.1–§30.7
enumeration in Block D based on the inferred mapping in
`E2E-FIXTURE-COVERAGE.md §3` + the de facto template adopted by
the C.2 worker runbooks for §31.1–§31.6.

### B5 first-run failures (NEW, surfaced this block)

10 of 19 decision-log entries fail the cross-link contract on
first run (D-009..D-016). Architect picks one of:

- (a) Backfill in a separate architect session.
- (b) Extend legacy allowlist to cover D-009..D-016.
- (c) Loosen contract (drop the W-NN/commit-sha clause; require
  only AUDIT-NNN — would still leave D-012..016 failing).
- (d) Accept temporary red CI as forcing function.

Until the architect resolves, the `phase-gate.yml` CI lint will be
red on this single check.

---

## Process notes (going forward)

- **Spot-verifications:** acknowledged the architect's process
  note from Block B. Continued to fold the SafeLlmRouter
  before/after diff into the C.2 first-runbook status update.
- **First-runbook checkpoint:** worked. The 5 architect changes
  improved the template materially and the staged replication
  (C.2.a–C.2.d) was mechanical after that.
- **Skinny-where-skinny-fits:** audit-bridge runbook is ~50
  lines per architect's specification; vault is ~150 (warranted by
  the Shamir ceremony complexity); Phase-2/3 scaffolded runbooks
  are appropriately concise.
- **No-halt-between-groups (C.2.a–d) policy:** worked; the
  staging kept commit boundaries clean while letting the work
  flow.

---

## Hand-off to Block D

Block D is **Track C — Operational readiness** (items C1–C10 per
PHASE-1-COMPLETION.md). Authorised in advance per architect
signoff but **NOT to start until** the architect has reviewed this
Block-C close.

Per architect: "Do not start D until C closes and I've reviewed."

Block D scope when started:

- **C1** Compose stack smoke test
- **C2** Vault Shamir initialization
- **C3** Tor onion service health monitor
- **C4** Grafana dashboards
- **C5** Falco rules
- **C6** Sentinel quorum check
- **C7** Phase-gate CI workflow validation
- **C8** PR template + commitlint config
- **C9** Backup script verification
- **C10** Secret-scan baseline

Plus the deferred A.8 follow-up (SRD §30.1–§30.7 enumeration draft)
slotted into Block D per architect signoff 2026-05-01.

---

## Halt

Block C closed. Awaiting architect review.
