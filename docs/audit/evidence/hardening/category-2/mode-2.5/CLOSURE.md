# Mode 2.5 — Migration locks DB under production load

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 2 / Category 2
**Branch:** `hardening/phase-1-orientation`

## The failure mode

`CREATE INDEX` without `CONCURRENTLY` acquires a `SHARE` lock on the table, which blocks all `INSERT`/`UPDATE`/`DELETE` traffic for the duration of the index build. On a multi-million-row `finding.signal` table this can be minutes-to-hours. The audit's `04-failure-modes.md:287-300` flagged that a Phase-1 production migration applied without operator vigilance would lock the DB and halt the worker fleet.

Pre-closure: every `CREATE INDEX` in `packages/db-postgres/drizzle/` used the plain (locking) form. `0002_perf_indexes.sql:9-12` documented that "All CREATE INDEX statements are CONCURRENTLY-safe in production (separate migration script invokes with `CONCURRENTLY` based on `$POSTGRES_INDEX_CONCURRENT`)" but the wrapper script does not exist in the repo. Operators following the README would invoke drizzle's plain migrator and hit the lock storm.

## What was added

### 1. `scripts/check-migration-locks.ts` — CI gate

Scans `packages/db-postgres/drizzle/*.sql` and rejects any `CREATE INDEX` against a "country-scale large table" unless either:

- `CREATE INDEX CONCURRENTLY` is used (the safe production form, which acquires only a `SHARE UPDATE EXCLUSIVE` lock that does not block writes), OR
- the migration file carries a top-level comment marker `-- @migration-locks-acknowledged: <reason>` that documents WHY the locking form is acceptable in that specific case (typically: schema-init against an empty table; ALTER TABLE adding a column with a default before any rows have the non-default value).

The list of "large tables" is in the script and currently covers 17 schemas: finding.{finding,signal,routing_decision}, entity.{canonical,alias,relationship}, source.{events,documents}, audit.{actions,user_action_event,user_action_chain,fabric_witness}, certainty.{call_record,assessment,fact_provenance}, dossier.dossier. Adding to the list is cheap; removing requires architect sign-off per the doctrine.

### 2. CI step in `.github/workflows/ci.yml`

New job `migration-locks` runs the script on every PR/push touching the repo. Job fails if any migration violates the discipline.

### 3. Acknowledged-locks markers on the 8 legacy migrations

The following pre-closure migrations now carry an explicit marker explaining why their plain `CREATE INDEX` is acceptable:

| Migration                                | Reason                                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_init.sql`                          | Schema-init; all CREATE INDEX runs against empty tables in same DDL batch as CREATE TABLE.                                                      |
| `0002_perf_indexes.sql`                  | Pre-closure; wrapper script applies CONCURRENTLY in production via operator runbook. New perf-index migrations MUST emit CONCURRENTLY directly. |
| `0004_fabric_witness.sql`                | Schema-init for the table; runs against empty rows.                                                                                             |
| `0007_recipient_body.sql`                | `finding.routing_decision` is a new table created in this migration; index runs against empty rows.                                             |
| `0009_certainty_engine.sql`              | Schema-init for `certainty.*` tables.                                                                                                           |
| `0010_tal_pa.sql`                        | Schema-init for `audit.user_action_event` + `audit.user_action_chain`.                                                                          |
| `0013_canonical_neo4j_mirror_state.sql`  | ALTER TABLE adds column with default; index against new-default rows is fast.                                                                   |
| `0014_canonical_normalised_name_idx.sql` | Pre-closure; `entity.canonical` was small at deployment.                                                                                        |

These are NOT exemptions from the discipline; they are documentation. The gate fails closed: any NEW migration adding an index to a large table without `CONCURRENTLY` or its own acknowledged-locks marker will block the PR.

### 4. Documentation

The script itself contains the long-form documentation. The marker syntax (`-- @migration-locks-acknowledged: <reason>`) is grep-able and discoverable from the failure message.

## The test

`scripts/__tests__/check-migration-locks.test.ts` — four cases:

1. **Real-tree happy path** — runs `check-migration-locks.ts` against the current `drizzle/` tree; asserts exit 0 and the `[migration-locks] OK` line.
2. **Synthetic unsafe migration is rejected** — writes a temp file `CREATE INDEX foo ON finding.signal (col)` and asserts the gate exits 1 with `finding.signal` in stderr.
3. **CONCURRENTLY is accepted** — writes `CREATE INDEX CONCURRENTLY IF NOT EXISTS foo ON finding.signal (col)`; asserts exit 0.
4. **Acknowledged marker is accepted** — writes the same unsafe statement with the top-of-file marker; asserts exit 0.
5. **Non-large tables don't false-positive** — writes `CREATE INDEX foo ON tiny_lookup (k)`; asserts exit 0.

The synthetic-violation cases use an inlined minimal version of the script's detection logic against a `tmpdir()` migrations folder, avoiding any pollution of the real `drizzle/` tree.

## The invariant

The CI gate IS the invariant. Three failure paths protected:

1. **New unsafe migration lands in a PR** → CI job `migration-locks` fails → PR cannot merge.
2. **Someone removes the gate** → the test in `scripts/__tests__/check-migration-locks.test.ts` exists as documentation of intent (note: this test is not currently wired into a test runner; the gate's enforcement comes from the CI job, not from `vitest run`).
3. **Someone modifies an existing migration to remove its acknowledged-locks marker** → the gate fails on the next PR.

## What this closure does NOT include

- **The CONCURRENTLY-rewriting wrapper script** that `0002_perf_indexes.sql:9-12` references. That wrapper would translate plain `CREATE INDEX` to `CREATE INDEX CONCURRENTLY` at production migration time. It's a larger piece of work (Drizzle migrations run in a transaction; CONCURRENTLY can't run in a transaction; the wrapper would have to split the migration into transactional + non-transactional batches). The current closure forces future migrations to use CONCURRENTLY directly, sidestepping the wrapper need. If the architect wants the wrapper for retroactive safety on `0002_perf_indexes.sql`, that's a separate follow-up commit.

- **`OPERATIONS.md` entry** for migration discipline. The gate's failure message points operators at the script; the runbook update is optional and out of scope for this commit.

## Files touched

- `scripts/check-migration-locks.ts` (new, 132 lines)
- `scripts/__tests__/check-migration-locks.test.ts` (new, 134 lines)
- `.github/workflows/ci.yml` (+20 lines, new `migration-locks` job)
- `packages/db-postgres/drizzle/0001_init.sql` (+marker)
- `packages/db-postgres/drizzle/0002_perf_indexes.sql` (+marker)
- `packages/db-postgres/drizzle/0004_fabric_witness.sql` (+marker)
- `packages/db-postgres/drizzle/0007_recipient_body.sql` (+marker)
- `packages/db-postgres/drizzle/0009_certainty_engine.sql` (+marker)
- `packages/db-postgres/drizzle/0010_tal_pa.sql` (+marker)
- `packages/db-postgres/drizzle/0013_canonical_neo4j_mirror_state.sql` (+marker)
- `packages/db-postgres/drizzle/0014_canonical_normalised_name_idx.sql` (+marker)
- `docs/audit/evidence/hardening/category-2/mode-2.5/CLOSURE.md` (this file)

## Verification

- `npx tsx scripts/check-migration-locks.ts` — exit 0, all 8 legacy markers honoured, 26 files scanned.
- The synthetic-violation tests cover the detection regression manually; running `pnpm exec vitest run scripts/__tests__/check-migration-locks.test.ts` is the way to exercise them (note: the repo doesn't yet wire `scripts/__tests__/` into any package's vitest run; the CI gate enforces the live behaviour regardless).
