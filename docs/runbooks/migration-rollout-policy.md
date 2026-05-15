# Runbook — Schema migration rollout policy

> Operational policy, not a cutover ceremony. Captures the two-phase
> deployment discipline that protects against mode 9.7 (forward-
> incompatible code shipped before its dependent schema migration).
>
> **Audience:** every engineer shipping a `packages/db-postgres/drizzle/NNNN_*.sql`
> migration alongside code that reads or writes the affected columns.
>
> **Authority:** the architect signs the pre-deploy checklist for every
> migration touching a production-deployed schema. This document is the
> reference for what they sign against.

---

## Background — what mode 9.7 actually fails on

A typical schema migration involves two artefacts:

1. The SQL migration (`drizzle/NNNN_<slug>.sql`).
2. The code that reads from or writes to the new schema shape (one or
   more workers, the dashboard, repos under
   `packages/db-postgres/src/repos/`).

If both artefacts ship in the same release **but the code rolls out
before the migration runs**, the code crashes against the old schema.
This is mode 9.7. It is a process problem, not a code problem — no
single-file change to the codebase can prevent it. Orientation §3.9 /
9.7 classifies it as N/A for code-level closure on those grounds.

Risk in practice is low because:

- The CI pipeline runs migrations before the test suite (`ci.yml`
  applies `pnpm --filter @vigil/db-postgres run migrate` before
  `pnpm run test`); broken-against-current-schema code fails CI.
- Postgres DDL is usually backward-compatible (adding columns,
  adding indexes, adding tables — none of these break old code that
  doesn't reference them).
- Most code changes are additive (`SELECT new_column` from a new
  column, `INSERT` into a new column with a default — fine if the
  migration ran first).

The risk **rises** when:

- The migration is **destructive** (DROP COLUMN, DROP TABLE,
  RENAME, NOT NULL added without DEFAULT, CHECK constraint added
  to existing rows).
- The migration is **schema-incompatible** (changes column type,
  changes FK target, adds a UNIQUE that some old rows violate).
- The code change **assumes** the migration ran (calls a stored
  procedure that doesn't exist yet, reads from a column whose old
  values aren't backfilled, etc.).

For these high-risk cases the two-phase rollout discipline below is
mandatory.

---

## The two-phase rollout discipline

The principle: **schema goes first, code follows in a separate
deploy.** Concretely:

### Phase 1 — schema-compatible migration

The migration ships in a deploy that **does not** include the
dependent code change. The migration must be:

- **Additive** (new column with default, new table, new index,
  new constraint that doesn't violate any existing row).
- **Reversible** via the paired `*_down.sql` (mode 9.3 / 9.6 round-trip
  gate in `ci.yml`).
- **Non-locking** (uses `CONCURRENTLY` for index creation per the
  `@migration-locks-acknowledged` discipline in
  `scripts/check-migration-locks.ts`).

The deploy runs the migration, the code stays on the old shape but
tolerates the new shape (e.g., the new column is nullable; the old
code ignores it; both old and new code paths work).

### Phase 2 — code that uses the new schema

A separate deploy lands the code change. The schema is already in
place. The code can write the new column unconditionally; old running
instances continue to work because the column has a default. After
this deploy, only the new code path is active.

### Phase 3 (only when needed) — cleanup migration

If Phase 1's migration was a transitional shape (e.g., new column
added with a default that the new code overrides), a Phase 3
migration removes the old shape (drops the now-unused column, drops
the default, tightens a NOT NULL). This too is a separate deploy.

**One migration per deploy. One code change per deploy.** A single
release that combines both is the failure mode.

---

## Pre-deploy checklist (architect signs)

Every migration touching a production-deployed schema requires the
architect to sign the following before the deploy is initiated. The
checklist is recorded in the PR description; no checklist, no merge.

1. **What the migration changes** (one sentence per table/column).
2. **Is it additive only?** (Yes / No. If No, describe the
   destructive change.)
3. **Does the paired `*_down.sql` exist and pass `check-migration-rollback`
   in CI?** (Yes / No.)
4. **Does the migration use `CONCURRENTLY` for any CREATE INDEX
   against a country-scale table?** (Yes / No / N/A — check the
   `@migration-locks-acknowledged` marker.)
5. **Is the dependent code change shipping in THIS deploy or a
   FOLLOW-UP deploy?**
   - **If this deploy** — confirm the migration is strictly additive
     and old code paths continue to work without the new column.
     (Phase 2 collapsed into Phase 1 is allowed only for purely
     additive migrations.)
   - **If follow-up deploy** — confirm the dependent code change is
     in a separate PR and queued for a follow-up release. Note the
     target follow-up date.
6. **What is the rollback plan?**
   - For Phase 1: re-deploy the previous image, leaving the schema
     in place. The new column is unused; the old code ignores it.
     No `*_down.sql` execution.
   - For Phase 3 (cleanup): re-deploy the previous image AND
     run the paired `*_down.sql` on the dev DB to confirm
     reversibility. Production rollback uses PITR per `docs/RESTORE.md`.

---

## Examples

### Safe — purely additive (single deploy)

`0008_satellite_request_tracking.sql` adds three columns to a new table
and one index. No existing code reads or writes the new table; the
adapter-worker code change that uses it is in the same release.
Outcome: safe because old code paths are unaffected.

**Checklist answer**: additive=Yes; dependent-code=this-deploy;
rollback=re-deploy previous image.

### Two-phase required — destructive

A hypothetical `0099_drop_finding_legacy_score.sql` that drops a
`finding.legacy_score` column. Worker-score is the only writer;
worker-pattern reads the column for the dashboard's legacy view.

- **Phase 1 deploy**: a code change to worker-pattern that stops
  reading `legacy_score`, falling back to `posterior` instead.
  Schema unchanged.
- **Phase 2 deploy**: the `0099_drop_finding_legacy_score.sql`
  migration. Old code paths no longer reference the column.

A SINGLE deploy that does both: worker-pattern fails on the column
read for the duration between deploy-start and migration-finish.
Mode 9.7 manifests.

**Checklist answer for Phase 2 deploy**: additive=No (drops a
column); dependent-code=already-deployed-in-Phase-1; rollback=re-deploy
the previous image AND no `*_down.sql` needed because the previous
image already tolerates the column being absent (Phase 1 made it
optional).

### Two-phase required — NOT NULL on existing column

A migration adding `NOT NULL` to `finding.score_at` where some rows
have NULL. The migration fails on existing data.

- **Phase 1 deploy**: code change + migration that adds `score_at_v2`
  with a default + backfills it from `score_at` (NULL handled).
  Workers write `score_at_v2`.
- **Phase 2 deploy**: migration drops `score_at`, renames `score_at_v2`
  to `score_at`. Workers continue writing `score_at` (the renamed
  column).

This is the rename-via-shadow-column pattern; a single-deploy `NOT NULL`
addition is not safe.

---

## Tooling-level gate — explicitly out of scope

A tooling-level gate (snapshot of "production schema version" tracked
in git + CI assertion that current code is compatible) was considered.
The architect chose **policy-only documentation** because:

- The schema-compat snapshot would require an extra deploy step that
  uploads `pg_dump --schema-only` to a known location after every prod
  migration.
- The CI assertion would have to inspect every TypeScript file under
  `packages/db-postgres/src/repos/` and every worker query and verify
  it against the snapshot — meaningful work (5+ days) for a mode
  whose practical risk is already low (CI runs against current
  schema; Postgres DDL usually backward-compatible).
- Engineering time is more valuable spent on the cosign chain (modes
  9.9 + 10.8, ~6–12 days).

This decision is logged in `docs/audit/hardening-orientation.md` §7
question 3, agent's recommendation: policy-only documentation.

---

## Re-open trigger

Re-open mode 9.7 (move it from N/A toward closure) if:

1. **A production incident traces to a forward-incompatible
   deploy.** The two-phase discipline was bypassed; the cost of
   tooling-gate becomes justifiable in hindsight.
2. **The schema becomes large enough that ad-hoc review can't
   reliably spot incompatibility.** Currently ~17 forward migrations
   - 28 schemas/tables; a future state with 100+ tables would
     justify the gate.
3. **The team grows beyond solo-architect review.** The architect
   currently signs every checklist; a multi-engineer team would
   need an automated gate to enforce what the architect now reviews
   by hand.

If any of these fires, the closure path is in orientation §7 Q3:
schema-version snapshot in git + CI assertion. Estimated 5+ days.

---

## Related

- `scripts/check-migration-pairs.ts` — pair-existence gate (every
  `NNNN_*.sql` ≥ 0009 has a matching `*_down.sql`).
- `scripts/check-migration-locks.ts` — `CONCURRENTLY` discipline
  for country-scale tables.
- `scripts/check-migration-rollback.ts` — forward → down → forward
  round-trip gate (mode 9.3 + 9.6 closure).
- `docs/RESTORE.md` — production rollback via PITR, NOT migration
  reverse.
- `docs/audit/evidence/hardening/category-9/mode-9.3-9.6/CLOSURE.md`
  — sister closure that this policy depends on.
