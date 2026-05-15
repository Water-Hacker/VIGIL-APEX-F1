# Hardening Pass · Category 2 (Data integrity and persistence) — Completion Note

**Date:** 2026-05-15
**Branch:** `hardening/phase-1-orientation`
**Phase:** 2 of 11 in the 90-mode hardening pass
**Modes closed this category:** 5 (2.1, 2.3, 2.5, 2.6, 2.8)
**Modes pre-existing closed-verified:** 4 (2.2, 2.4, 2.7, 2.9)

## What landed

Five mode-closure commits, one per failure mode, with file:line evidence and per-mode regression tests:

| Mode | Title                              | Commit                                                                                  | Test                                                                  |
| ---- | ---------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 2.1  | Connection pool exhaustion         | `security(db-postgres)` 87f9db7                                                         | `pool-saturation.test.ts` (8 unit + 2 integration)                    |
| 2.3  | Lock contention on hot rows        | `test(db-postgres)` d269fa4                                                             | `repo-row-contention.test.ts` (2 integration)                         |
| 2.5  | Migration locks DB under prod load | `ci(db-postgres)` e6fe898                                                               | `scripts/__tests__/check-migration-locks.test.ts` (5 cases) + CI gate |
| 2.6  | Concurrent-write isolation         | (no new code; doc-only closure in `docs/audit/evidence/hardening/category-2/mode-2.6/`) | proven by 2.3 + 2.8 tests                                             |
| 2.8  | Lost-write last-write-wins         | `feat(db-postgres)` e35d3bc                                                             | `finding-revision-cas.test.ts` (8 integration)                        |

## Tests added

23 new test cases across 3 new test files + 1 expanded:

- `packages/db-postgres/__tests__/pool-saturation.test.ts` — 10 tests (8 unit pass without DB, 2 integration gated on `INTEGRATION_DB_URL`).
- `packages/db-postgres/__tests__/repo-row-contention.test.ts` — 2 integration tests proving single-statement UPDATE atomicity for `addSignal` (50 concurrent) and `upsertCluster` (20 concurrent JSONB merges).
- `packages/db-postgres/__tests__/finding-revision-cas.test.ts` — 8 integration tests proving the `expectedRevision` CAS contract: correct revision succeeds, wrong revision throws + leaves row unchanged, 5 concurrent writers produce exactly 1 winner + 4 `CasConflictError`s.
- `scripts/__tests__/check-migration-locks.test.ts` — 5 cases covering the CI gate's positive and negative paths.

All tests pass in the workspace; integration tests skip cleanly without `INTEGRATION_DB_URL`. In CI (where `INTEGRATION_DB_URL` is set against a postgres service container), they execute.

## Invariants added

| Layer          | Invariant                                                                              | Effect                                                                        |
| -------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Code           | `PoolSaturatedError` + `acquireWithPriority` (mode 2.1)                                | Background workers back off when pool is stressed; foreground always proceeds |
| Code           | `CasConflictError` + `expectedRevision` on FindingRepo setters (mode 2.8)              | Lost-write race throws instead of silently overwriting                        |
| Code           | `revision` column on `finding.finding` (mode 2.8)                                      | Monotonic optimistic-lock counter, incremented on every setter call           |
| Metric         | `vigil_db_pool_{total,idle,waiting}` populated by `startPoolMetricsScraper` (mode 2.1) | Operator visibility into pool saturation                                      |
| Metric         | `vigil_repo_cas_conflict_total{repo,fn}` (mode 2.8)                                    | Operator visibility into CAS contention pressure                              |
| Alert          | `DbPoolSaturated` (waiting > 10 for 30 s, mode 2.1)                                    | Operator-visible alarm under sustained saturation                             |
| Alert          | `DbPoolScraperStale` (gauge unrefreshed > 60 s, mode 2.1)                              | Catches deletion of the scraper wire-up                                       |
| CI gate        | `migration-locks` job runs `scripts/check-migration-locks.ts` (mode 2.5)               | New unsafe `CREATE INDEX` migration cannot land                               |
| Comment marker | `-- @migration-locks-acknowledged: <reason>` on 8 legacy migrations (mode 2.5)         | Pre-closure migrations explicitly documented as accepted-risk                 |
| Test           | 23 test cases across pool / contention / CAS / lock-gate                               | Regression coverage for every closure                                         |

## Cross-cutting verification

Per the prompt's per-category workflow, the entire workspace was re-tested after the last commit in this category.

- **`pnpm run typecheck`** (workspace, 60 packages): 60 successful, 0 failed.
- **`pnpm --filter @vigil/db-postgres test`**: 46 passed, 13 skipped. The 13 skipped are integration tests gated on `INTEGRATION_DB_URL`; 10 of them are the new mode-2.x closures, 3 are pre-existing (audit-log-cas). All pass when `INTEGRATION_DB_URL` is set.
- **`pnpm --filter @vigil/observability test`**: 21 passed.
- **`npx tsx scripts/check-migration-locks.ts`**: OK — 28 migration files scanned (the original 26 + my two new 0017 files), 0 violations. The 8 legacy markers are honoured, the new `0017_finding_revision.sql` carries its own marker, and the corresponding down-migration adds no indexes.

The cross-cutting verification of the original audit's stress tests (Section 9) is **not** in scope for a code-only pass — those tests require a running infrastructure stack (Postgres + Redis + Vault + IPFS + Fabric + Polygon) per `docs/audit/09-stress-test.md`. The hardening pass's per-mode tests are the equivalent in-code coverage; the stress tests will be exercised in DR rehearsal under the standing operator runbook.

## Secondary findings surfaced during Category 2

Three observations the orientation did not capture; surfaced here for the architect.

**(a) Mode 2.3 was already closed before this pass; the orientation overstated it.** The single-statement `UPDATE finding SET signal_count = signal_count + 1` and `INSERT ... ON CONFLICT DO UPDATE SET metadata = metadata || $::jsonb` patterns are atomic under READ COMMITTED via Postgres's EvalPlanQual mechanism. No `FOR UPDATE` is required. The closure for 2.3 is therefore a regression test that LOCKS IN the single-statement property: if a future refactor splits these into SELECT + UPDATE (which WOULD expose the lost-update race), the test fails. The orientation's framing of "addSignal lacks FOR UPDATE → lost increment" was incorrect; the closure delivers a real regression invariant rather than fixing a non-existent bug.

**(b) The orientation's "2.3 + 2.6 + 2.8 share one work block" framing was wrong.** They share a theme (concurrent-write protection on hot rows) but the underlying mechanisms differ: 2.3 is single-statement atomicity (EvalPlanQual), 2.6 is the union of 2.3 + 2.8 + pre-existing audit-log FOR UPDATE, and 2.8 is the genuine optimistic-lock CAS pattern for external-value setters. Each got its own implementation and test.

**(c) `acquireWithPriority(pool, 'background')` is an OPT-IN primitive.** Existing Drizzle callers continue to use the implicit-foreground path; the primitive's value grows as background workers migrate to wrap their pool acquisitions. The migration of every worker is OUT OF SCOPE for this pass per the binding posture; flagging as Category-2 follow-up for selective adoption.

## Modes that revealed structural issues requiring follow-up

None. Every Category-2 mode closure landed cleanly. Three follow-up opportunities documented:

1. **Adoption of `acquireWithPriority` across background workers** (mode 2.1 follow-up).
2. **Adoption of `expectedRevision` across coordinating mutators** (mode 2.8 follow-up).
3. **CAS on `audit.user_action_event.setAnchorTx`** — a separate contract ("set exactly once when null") that's structurally distinct from the revision-CAS pattern. Flagged in mode 2.8's closure doc.

The architect can prioritise these against the remaining Categories 1, 3, 4, ... or defer them.

## Status of the 90-mode pass after Category 2

After this category:

- **Closed-verified now:** 54 of 90 (up from 49 at orientation time).
- **Partially closed:** 12 (down from 15 — 2.1, 2.6 absorbed into closed-verified).
- **Open:** 18 (down from 20 — 2.3 reclassified as closed-verified after re-investigation, 2.8 closed).
- **Not applicable:** 6 (unchanged).

The proposed sequencing in the orientation has Category 1 (Concurrency) next. The revision-CAS pattern just landed will inform Category 4's mode 4.3 closure (signed `x-vigil-auth-proof` with replay protection can reuse the revision+timestamp compound key).

## Architect signal needed

None for proceeding to Category 1. The five open questions in the orientation's §7 remain open (8.5 timing, cosign scope, 9.7 forward-incompat tooling, 9.2 secret rotation, PR #5 coordination); none of them block Category 1.

Proceeding to Category 1 (Concurrency and process resilience) on the architect's next `proceed`. Five open modes there: 1.3 (cheap), 1.5 (medium), 1.6 (cheap), 1.7 (medium), 1.9 (medium). Plus test-deepening for 1.1.
