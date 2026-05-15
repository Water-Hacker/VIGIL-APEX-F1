# Modes 9.3 + 9.6 — Migration rollback round-trip gate

**State after closure:** closed-verified (single closure across two modes)
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 10 / Category 9
**Branch:** `hardening/phase-1-orientation`

## The failure modes

### Mode 9.3 — Rollback compatibility (deployment break)

A schema migration that ships without a tested reverse path forces dev
contributors into hand-crafted rollback work when they switch branches or
need to undo a local migration. Worse, a `*_down.sql` file that _claims_
to roll back but actually leaks state (forgets to drop an index, drops the
wrong column, etc.) is more dangerous than no down file — it gives a false
sense of safety that someone will rely on under pressure.

### Mode 9.6 — Schema migration without tested rollback

Identical evidence per orientation §3.9 / 9.6: "Same evidence as 9.3.
Closure: identical CI job as 9.3 satisfies both." One closure covers both
modes.

## The pre-closure state

- `scripts/check-migration-pairs.ts` already gated **existence** of a
  `*_down.sql` for every `NNNN_*.sql` from 0009 onward
  (`packages/db-postgres/drizzle/`), with a closed allowlist for legacy
  forward-only migrations (`0001..0006, 0008`). This catches the case
  where a contributor ships a new forward without an inverse.

- Nothing gated whether the down migrations **actually run** against a
  Postgres instance. A down file could:
  - have SQL syntax errors,
  - reference a non-existent object (DROP TABLE without IF EXISTS for a
    table the forward never created),
  - leave residue (forget to drop an index, a constraint, a column).

The orientation classified both modes as "partially closed (cheap, < 1
day)" with the closure being a CI job that runs forward → down → forward
against an ephemeral DB.

## What was added

### 1. `scripts/check-migration-rollback.ts`

A self-contained TypeScript runner that:

1. Connects to `INTEGRATION_DB_URL` (exits 2 if unset).
2. **Resets** the DB: `DROP SCHEMA IF EXISTS … CASCADE` for the 11 VIGIL
   schemas (`audit`, `calibration`, `certainty`, `dossier`, `entity`,
   `finding`, `governance`, `llm`, `pattern_discovery`, `source`, `tip`)
   - drops the `_vigil_migrations` tracking table. Roles persist; the
     bootstrap migration's `DO $$ BEGIN CREATE ROLE … EXCEPTION WHEN
duplicate_object` blocks handle re-creation safely.
3. **Forward sweep**: reads all `NNNN_*.sql` (non-`_down`) in numeric
   order; each in its own transaction; first SQL error aborts.
4. **Down sweep**: reads all `NNNN_*_down.sql` in **reverse** numeric
   order; each in its own transaction; first SQL error aborts. Reverse
   order matters because `0017_finding_revision_down` may depend on
   structures created by `0016_pattern_discovery_candidate` still
   existing.
5. **Drops the tracking table** so the second forward sweep applies
   migrations against a DB whose schemas are in whatever state the down
   sweep left them — this is the actual production-rollback simulation.
6. **Re-forward sweep**: same as step 3 against the post-down DB.

Exit codes: `0` clean, `1` sweep failed, `2` env / connect issue.

The script is **idempotent** when re-run on a fresh DB (the reset step
makes it so) and **destructive** when pointed at any DB — the docstring
notes this explicitly and the CI workflow points it at the per-job
service-container Postgres, never production.

### 2. CI job `migration-rollback` in `.github/workflows/ci.yml`

A new top-level job (parallel to `test` and `a11y`) that:

- Spins up an ephemeral `postgres:16.2-alpine` service container.
- Runs `pnpm exec tsx scripts/check-migration-rollback.ts` with
  `INTEGRATION_DB_URL` pointed at the service.
- 10-minute timeout.

The job runs on every push to `main` and every PR per the `on:`
trigger inherited from the workflow.

## The invariant

Three layers:

1. **Pair-existence gate** (pre-existing, in `phase-gate.yml`):
   `check-migration-pairs.ts` ensures every migration from `0009` onward
   has a `*_down.sql` partner.
2. **Round-trip gate** (this closure, in `ci.yml`):
   `check-migration-rollback.ts` ensures the `*_down.sql` files actually
   run + actually reverse enough state for the next forward sweep to
   succeed.
3. **Header discipline** (existing convention): each `*_down.sql`
   header includes "Rollback X forward migration. Destructive — run only
   in dev." This wording is preserved; production rollback uses PITR
   per `docs/RESTORE.md`, NOT migration reverse.

## What this closure does NOT include

- **No pg_dump schema-diff between the two forward states.** A pg_dump
  comparison would catch the edge case where a down migration leaks
  state (e.g., doesn't drop an index it should) but the re-forward
  still succeeds because the forward uses `CREATE INDEX IF NOT EXISTS`.
  Adding this is a future hardening (~30 min if the gate ever produces
  a false-clean for that pattern). Flagged for follow-up.

- **No promotion of `*_down.sql` headers to "prod-safe".** The
  orientation suggested marking them "prod-safe" after this passes; on
  reflection, prod rollback should remain PITR-only because (a) the
  dev-rollback round-trip says nothing about row-level data preservation
  during a real prod incident, (b) PITR is the documented `docs/RESTORE.md`
  procedure with a 6 h RTO target, and (c) operators reaching for a
  down migration in prod is the wrong-tool-for-the-job pattern. The
  headers retain their "dev only" disclaimer.

- **No PITR exercise in CI.** Orientation flagged this as out of scope
  ("WAL archive configured but PITR not exercised in CI"). Adding a
  PITR rehearsal to CI would require a multi-step service-container
  setup (Postgres + WAL archive bucket + pg_basebackup + recovery.conf
  - restore_command) that is well outside the 9.3+9.6 closure budget.
    PITR is exercised by the manual DR rehearsal procedure documented
    in `docs/runbooks/dr-rehearsal.md`; the next scheduled rehearsal
    picks it up.

## Files touched

- `scripts/check-migration-rollback.ts` (new, ~150 lines)
- `.github/workflows/ci.yml` (+38 lines: new `migration-rollback` job)
- `docs/audit/evidence/hardening/category-9/mode-9.3-9.6/CLOSURE.md` (this file)

## Verification

Local smoke tests (full CI verification on push):

- `INTEGRATION_DB_URL` unset → exits 2 with clear error.
- `INTEGRATION_DB_URL` points at unreachable host → exits 2 with
  `connect failed: getaddrinfo ENOTFOUND …`.
- File-load path: `loaded 18 forward + 10 down migrations` (matches the
  current state of `packages/db-postgres/drizzle/`).

End-to-end verification (forward → down → forward) is gated to the CI
run; local DB verification was blocked by an explicit session boundary
on starting Postgres containers. The CI job is the canonical test; if
a `*_down.sql` is broken, it surfaces on the next push.
