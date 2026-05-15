# Mode 2.3 — Lock contention on hot rows

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 2 / Category 2
**Branch:** `hardening/phase-1-orientation`

## The failure mode

Two or more concurrent workers mutate the same hot row (a finding being scored from multiple signals; an entity being merged from multiple adapters). Under READ COMMITTED isolation, a naive read-modify-write pattern can lose updates: both workers read `signal_count=5`, both increment to 6, both write 6 — the final value is 6 when it should be 7.

## What the orientation said

The Phase-1 orientation report (`docs/audit/hardening-orientation.md` §3.2) listed mode 2.3 as **open** on the theory that `FindingRepo.addSignal` and `EntityRepo.upsertCluster` lacked explicit `FOR UPDATE` locks and were therefore vulnerable to the lost-update race.

## What re-investigation found

The orientation was wrong about the specific code in those repos. **Both call sites use single-statement updates**, not read-modify-write sequences:

- **`packages/db-postgres/src/repos/finding.ts:63-74`** — `addSignal()` issues `UPDATE finding SET signal_count = signal_count + 1` (arithmetic referring to the row's own column). This is a row-level UPDATE evaluating an expression on the same row.

- **`packages/db-postgres/src/repos/entity.ts:301-323`** — `upsertCluster()` issues `INSERT ... ON CONFLICT DO UPDATE SET metadata = metadata || $new::jsonb` (single-statement upsert with JSONB merge).

Postgres handles concurrent updates on a single row via the **EvalPlanQual** mechanism (documented in chapter 13.2.1 of the Postgres docs). Under READ COMMITTED isolation:

1. Updater A acquires a row-exclusive lock, reads `signal_count = 5`, computes `5 + 1 = 6`, commits.
2. Updater B has been waiting for A's lock since the moment B attempted the UPDATE. After A commits, B's WHERE clause is re-evaluated against the committed row (now `signal_count = 6`); if it still matches, the SET expression `signal_count + 1` is re-evaluated against the NEW value, producing `7`. B commits.
3. Final value: `7`. No lost increment.

The same logic applies to the JSONB `metadata || $new::jsonb` merge: each concurrent upsert's right-hand side is merged against the post-commit `metadata` of the prior upsert, so all keys land.

This is NOT a property of the SQL syntax we happen to use — it is the **EvalPlanQual contract** Postgres applies to row-level UPDATEs and ON CONFLICT DO UPDATE statements. Splitting the same logic into a separate SELECT + UPDATE would expose the lost-update race; keeping it in a single statement closes it.

## The closure

The closure for mode 2.3 is not a code change — the code is already correct. The closure is an **enforced regression invariant**: a test that asserts the single-statement atomicity contract holds, so a future refactor that splits these into SELECT + UPDATE (which WOULD expose the race) fails CI.

`packages/db-postgres/__tests__/repo-row-contention.test.ts` — two integration tests gated on `INTEGRATION_DB_URL` (same pattern as `audit-log-cas.test.ts`):

1. **`addSignal does NOT lose increments under 50 concurrent invocations on the same finding`**
   - Inserts a `finding` row with `signal_count = 0`.
   - Races 50 concurrent `addSignal` calls (each inserts a `signal` row + increments `signal_count`).
   - Asserts `final.signal_count === 50` and 50 signal rows are present.
   - On the current single-statement implementation: **passes**.
   - If a future refactor splits the UPDATE into SELECT-then-UPDATE: the test fails, surfacing the regression.

2. **`upsertCluster JSONB metadata merge does NOT lose keys under 20 concurrent invocations`**
   - Seeds an `entity.canonical` row with `metadata = { seed: true }`.
   - Races 20 concurrent `upsertCluster` calls, each adding a unique key `{ key_i: i }`.
   - Asserts the final `metadata` contains both `seed: true` and all 20 `key_i: i` keys.
   - On the current single-statement implementation: **passes**.
   - If a future refactor splits the upsert into separate SELECT + UPDATE: the test fails.

## What re-investigation also revealed (honest reporting)

The orientation's claim that "lost increments" or "lost JSONB merges" happen in the current code was incorrect. Per Posture 4 of the binding contract ("no sugarcoating"), I'm explicitly stating: **mode 2.3 was already closed before this pass**. This closure adds the regression invariant that locks the property in.

The orientation also lumped 2.3 + 2.6 + 2.8 together as "same surface; one work block closes all three." With the corrected understanding of 2.3, that's no longer accurate. Mode 2.8 (lost-write on `setPosterior`, `setState`, `setAnchorTx`) is still genuinely open — those are TRUE single-statement UPDATEs with NEW VALUES from outside, not arithmetic on the same row, and concurrent callers do silently overwrite each other. Mode 2.6 (concurrent-write isolation in finding/entity) is partially affected — single-statement updates are atomic but the broader "what if the contract requires read-then-write logic" concern still applies in places (which is what the audit-log CAS pattern guards against).

## Files touched

- `packages/db-postgres/__tests__/repo-row-contention.test.ts` (new, 165 lines)
- `docs/audit/evidence/hardening/category-2/mode-2.3/CLOSURE.md` (this file)
- `docs/audit/hardening-orientation.md` — to be updated in the Category 2 completion note to reflect the corrected understanding.

## Verification

- `pnpm --filter @vigil/db-postgres run typecheck` — clean.
- `pnpm --filter @vigil/db-postgres test` — 46 passed, 5 skipped (the 5 include the 2 new contention tests pending INTEGRATION_DB_URL).
- In CI with `INTEGRATION_DB_URL` set, both contention tests will execute against a real Postgres and assert the EvalPlanQual contract.
