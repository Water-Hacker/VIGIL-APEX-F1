# Mode 9.7 — Forward-incompatible code shipped before migration

**State after closure:** N/A (closed as policy-only doc per orientation Q3 default)
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 10 / Category 9
**Branch:** `hardening/phase-1-orientation`

## The failure mode

A release that combines a code change reading a new schema shape with
the migration that creates that shape will, during the deploy window,
have **code already running against the old schema** for the duration
between code-rollout-start and migration-finish. The result is request
failures, worker crashes, or — worse — silent data corruption if the
code writes to a column that doesn't exist yet (silently dropped) or
reads a column that doesn't exist yet (NULLs everywhere).

## Why this is N/A (not OPEN, not partial-closed)

Per the orientation's §3.9 / 9.7 entry:

> No code-only mechanism exists to enforce migration-first deploy
> ordering. Practical risk is low because (i) tests run against
> current schema, (ii) Postgres DDL is usually backward-compatible,
> (iii) most code changes are additive.

This is fundamentally a **process / governance problem**. No single
file in the repo can prevent it. A tooling-level gate is possible
(schema-version snapshot + CI assertion of code-vs-schema
compatibility) but expensive (5+ days per orientation Q3) for a
currently-low-risk failure mode. Engineering time is more valuable
spent on the cosign chain (modes 9.9 + 10.8) and the medium-priority
closures (9.1 config drift, 9.2 secret rotation).

The architect's recommendation, per orientation §7 Q3: **policy-only
documentation**. This closure ratifies that recommendation by writing
the policy.

## What was added

### `docs/runbooks/migration-rollout-policy.md`

A new runbook capturing the two-phase rollout discipline:

1. **Phase 1**: schema-compatible migration ships in a deploy WITHOUT
   the dependent code change. Migration must be additive, reversible
   (`*_down.sql` round-trip gate verifies), and non-locking
   (`CONCURRENTLY` per `check-migration-locks.ts`).

2. **Phase 2**: dependent code change ships in a SEPARATE deploy.

3. **Phase 3 (when needed)**: cleanup migration drops the
   transitional shape.

The runbook includes:

- A **pre-deploy checklist** the architect signs in the PR description
  before every migration touching a production-deployed schema. Six
  items: what changes / additive / `*_down.sql` exists / `CONCURRENTLY`
  used / dependent code timing / rollback plan.

- **Three worked examples**: a safe single-deploy additive migration
  (`0008_satellite_request_tracking`), a destructive DROP COLUMN case
  needing two phases, and a NOT-NULL-on-existing-column case requiring
  the rename-via-shadow-column pattern.

- **Re-open triggers**: if a production incident traces to bypassed
  discipline, OR the schema grows beyond ad-hoc review (~100+ tables),
  OR the team grows beyond solo-architect review.

### File name choice

The orientation suggested `R9-schema-rollout.md` but the `R9` slot is
already occupied by `R9-federation-cutover.md` (the federation cutover
ceremony). Rather than renumber, the policy doc takes a non-numbered
slot — `migration-rollout-policy.md` — consistent with the operational
runbooks (`postgres.md`, `redis.md`, etc.) rather than the cutover
ceremonies (`R4-`, `R6-`, etc.). The `R-numbered` slots are reserved
for one-shot cutover ceremonies; this is recurring operational policy.

## The invariant

Three layers — none of which catch all violations, but together they
push the risk well below the practical-incident threshold:

1. **Pre-deploy checklist** (this closure) — captures architect review
   in the PR description before every migration-touching merge.
2. **Pair-existence gate** (pre-existing, `phase-gate.yml`) — ensures
   the migration has a `*_down.sql` partner for dev rollback.
3. **Round-trip gate** (mode 9.3 / 9.6 closure) — ensures the
   `*_down.sql` actually runs against an ephemeral DB.

The pre-deploy checklist is the **human gate**. The other two are the
**mechanical gates**. The human gate is the one that catches
forward-incompatible-code-before-migration, because that's a
deploy-sequencing problem and no mechanical gate sees deploys.

## What this closure does NOT include

- **No tooling-level schema-compat checker.** Per orientation Q3 +
  this closure's reasoning; flagged as a re-open trigger if practical
  risk rises.

- **No automation that asserts the checklist was filled.** A PR
  template that includes the six items as a markdown checklist could
  be added (~30 min) and is a future hardening if architect-review
  drift becomes an issue. For now the checklist lives in the runbook
  and the architect copies it into PR descriptions by hand.

- **No retrospective audit of past migrations against the checklist.**
  The 17 forward migrations + 10 `*_down.sql` files in
  `packages/db-postgres/drizzle/` predate this policy. The policy
  applies prospectively. A backfill audit is possible if the architect
  wants it but is not part of this closure.

## Files touched

- `docs/runbooks/migration-rollout-policy.md` (new, ~180 lines)
- `docs/audit/evidence/hardening/category-9/mode-9.7/CLOSURE.md` (this file)

## Verification

- The runbook exists at the canonical path and references the sister
  scripts/gates (`check-migration-pairs.ts`, `check-migration-locks.ts`,
  `check-migration-rollback.ts`) by their actual filenames at this
  commit.
- The orientation §7 Q3 default (policy-only doc) is ratified by this
  closure; the architect's `proceed` for Category 9 is on-the-record
  concurrence.

## Architect signal recorded

Orientation §7 Q3 asked: "9.7 forward-incompatible code: document policy
only, or implement a tooling-level gate? The agent's recommendation is
policy-only documentation; confirm."

The architect issued `proceed` for Category 9 on 2026-05-15 with the
preflight identifying this as the Cat-9 default. The `proceed` is
on-record concurrence with policy-only documentation.
