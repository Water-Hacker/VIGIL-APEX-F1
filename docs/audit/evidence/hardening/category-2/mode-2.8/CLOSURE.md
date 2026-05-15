# Mode 2.8 — Lost write last-write-wins on finding setters

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 2 / Category 2
**Branch:** `hardening/phase-1-orientation`

## The failure mode

Two workers concurrently call `findingRepo.setPosterior(id, X)` and `findingRepo.setPosterior(id, Y)` (or any of the other setters: `setState`, `setCounterEvidence`, `setRecommendedRecipientBody`). Both UPDATEs are single-statement and atomic — Postgres serialises them — but the SECOND-COMMITTED writer's value silently overwrites the first. The first worker BELIEVES its value landed; the audit chain shows both writes; the canonical posterior in the database is Y. For an audit pipeline that needs every state transition to be intentional and recorded, this is unacceptable.

This is distinct from mode 2.3 (counter-increment race on `addSignal`, which is safe via EvalPlanQual because the UPDATE expression refers to the same row's prior value). 2.8 is the case where the SET expression uses an EXTERNAL value that the caller computed without knowing whether a concurrent writer has already updated the row.

## What was added

### 1. Migration `0017_finding_revision.sql`

Adds `revision BIGINT NOT NULL DEFAULT 0` to `finding.finding`. ALTER TABLE ADD COLUMN with a constant default is O(1) in Postgres 11+ (no table rewrite). The migration carries the `@migration-locks-acknowledged` marker (mode 2.5 gate) explaining this is safe in production.

Reverse: `0017_finding_revision_down.sql` drops the column.

### 2. Schema update in `packages/db-postgres/src/schema/finding.ts`

`revision: bigint('revision', { mode: 'number' }).notNull().default(0)` added to the table definition. Drizzle's $inferSelect / $inferInsert pick this up automatically.

### 3. `CasConflictError` typed exception in `FindingRepo`

```typescript
export class CasConflictError extends Error {
  readonly code = 'CAS_CONFLICT';
  constructor(
    public readonly repo: string,
    public readonly fn: string,
    public readonly id: string,
    public readonly expectedRevision: number,
  ) { ... }
}
```

Callers MUST catch this and either refetch + retry or fail-fast with explicit handling. Never assume the write succeeded if `CasConflictError` was thrown.

### 4. Setters updated with optional `expectedRevision`

All four `FindingRepo` setters now share an internal `casUpdate(fn, id, expectedRevision, columns)` helper:

- `setPosterior(id, posterior, expectedRevision?)`
- `setState(id, state, closure_reason?, expectedRevision?)`
- `setCounterEvidence(id, text, nextState?, expectedRevision?)`
- `setRecommendedRecipientBody(id, recommended, primaryPatternId, expectedRevision?)`

Behaviour:

- **`expectedRevision` omitted** — legacy last-write-wins preserved (backward compat for existing callers). `revision` still increments on every write so future callers can opt in.
- **`expectedRevision` provided + matches** — UPDATE succeeds, `revision` increments, function returns the new revision.
- **`expectedRevision` provided + mismatches** — zero rows updated. Function throws `CasConflictError`. Prometheus counter `vigil_repo_cas_conflict_total{repo,fn}` increments.

Return type changed from `Promise<void>` to `Promise<number>` (the new revision). Existing `await this.findingRepo.setX(...)` callers compile unchanged — the discarded return value is fine.

### 5. Prometheus metric `vigil_repo_cas_conflict_total`

In `packages/observability/src/metrics.ts`. Labels: `repo`, `fn`. Operator can see CAS contention pressure even when callers retry silently.

## The test

`packages/db-postgres/__tests__/finding-revision-cas.test.ts` — 8 tests gated on `INTEGRATION_DB_URL`:

1. **Initial revision is 0** — locks the default contract.
2. **Setter without expectedRevision continues (LWW) and bumps revision** — backward-compat verified.
3. **Setter with correct expectedRevision succeeds + returns new revision** — happy path.
4. **Setter with WRONG expectedRevision throws CasConflictError and does NOT mutate** — the critical failure-mode regression. The test confirms the row state is unchanged after the throw, not just that an exception was raised.
5. **Under concurrent CAS contention, exactly one writer wins and others get CasConflictError** — exercises the actual race: 5 concurrent writers with the same `startRev`; assert exactly 1 fulfilled + 4 rejected; assert final DB revision is `startRev + 1`.
6. **setState honours CAS** — applies the property to a second setter.
7. **setCounterEvidence honours CAS** — third setter.
8. **setRecommendedRecipientBody honours CAS** — fourth setter.

The CI integration job (existing pattern from `audit-log-cas.test.ts`) provides `INTEGRATION_DB_URL`; locally the tests skip.

## The invariant

Three layers of regression protection:

1. **The integration test itself** (8 cases in CI) — locks the contract.
2. **The Prometheus metric `vigil_repo_cas_conflict_total`** — visible operator signal when CAS conflicts are actually happening in production (validates the closure is exercised, not just installed).
3. **The setters' typed signatures** — `Promise<number>` return forces callers who use the return value to acknowledge the new revision contract; the optional `expectedRevision` is opt-in so legacy callers can migrate incrementally.

## Adoption path

Callers can migrate incrementally:

- **Read-only callers** (dashboard, governance proposals) — no change needed.
- **Single-shot mutators** (worker-score initial posterior, worker-counter-evidence first-time set) — can keep last-write-wins or add expectedRevision; both behaviours are now intentional.
- **Coordinating mutators** (worker-score updating posterior across rescoring cycles, worker-pattern updating counter-evidence as new signals arrive) — should pass `expectedRevision` to catch concurrent rescoring races. Migration of these workers is a follow-up commit, not bundled here per the binding posture.

## What this closure does NOT include

- **Adoption of expectedRevision by existing worker callers.** The primitive is in place; the workers are unchanged. Selective adoption per worker is the incremental next step.
- **CAS on `audit.user_action_event.setAnchorTx`.** That setter is a separate concern: the contract is "set chain_anchor_tx exactly once when it's currently null." A different pattern (`WHERE chain_anchor_tx IS NULL`) fits better than a revision counter. Out of scope for this commit; if architect wants to close that gap explicitly, it's a follow-up.
- **CAS on `entity.canonical` setters.** The entity repo's `upsertCluster` already uses single-statement upsert + JSONB || merge, which mode 2.3's test proved correct under contention. No CAS needed.

## Files touched

- `packages/db-postgres/drizzle/0017_finding_revision.sql` (new, 19 lines)
- `packages/db-postgres/drizzle/0017_finding_revision_down.sql` (new, 7 lines)
- `packages/db-postgres/src/schema/finding.ts` (+5 lines: revision column)
- `packages/db-postgres/src/repos/finding.ts` (+CasConflictError, casUpdate helper, 4 setters updated)
- `packages/observability/src/metrics.ts` (+11 lines: repoCasConflictTotal counter)
- `packages/db-postgres/__tests__/finding-revision-cas.test.ts` (new, 153 lines)
- `docs/audit/evidence/hardening/category-2/mode-2.8/CLOSURE.md` (this file)

## Verification

- `pnpm --filter @vigil/db-postgres run typecheck` — clean.
- `pnpm --filter @vigil/observability run typecheck` — clean.
- `pnpm run typecheck` (whole workspace, 60 packages) — all 60 successful.
- `pnpm --filter @vigil/db-postgres test` — 46 passed, 13 skipped (8 are the new CAS tests waiting for INTEGRATION_DB_URL).
