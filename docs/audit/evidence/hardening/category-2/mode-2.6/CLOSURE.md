# Mode 2.6 — Data corruption from concurrent writes without proper isolation

**State after closure:** closed-verified (no new code in this commit; closed transitively by modes 2.3 + 2.8)
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 2 / Category 2
**Branch:** `hardening/phase-1-orientation`

## The failure mode

The repo (operating under Postgres's default READ COMMITTED isolation level) lets concurrent writes to the same logical entity corrupt or lose data. The audit's prior pattern — explicit FOR UPDATE in `audit-log.ts:52-99` plus a CAS race test at `audit-log-cas.test.ts:74-125` — proved the pattern works for the audit chain. The orientation flagged that the SAME discipline was not applied to the `finding` and `entity` repos.

## What was found during re-investigation

The orientation framed mode 2.6 as "mirror the audit-log FOR UPDATE pattern on finding and entity." Closer reading shows the situation is more granular than that:

1. **Single-statement counter increments** (`finding.addSignal` updating `signal_count`, `entity.upsertCluster` merging metadata JSONB) are safe under READ COMMITTED via Postgres's EvalPlanQual mechanism — they do NOT need explicit FOR UPDATE. This was proven in mode 2.3's closure: `packages/db-postgres/__tests__/repo-row-contention.test.ts` races 50 concurrent `addSignal` and 20 concurrent `upsertCluster` calls and asserts no lost increments / no lost merge keys. The test is the regression invariant.

2. **External-value updates** (`finding.setPosterior` writing a posterior computed elsewhere, `setState`, `setCounterEvidence`, `setRecommendedRecipientBody`) genuinely had the lost-write problem. These were closed in mode 2.8 with a `revision` column + optional `expectedRevision` CAS pattern, and an 8-case integration test at `packages/db-postgres/__tests__/finding-revision-cas.test.ts` proves the contract under contention.

3. **The audit-log path** (`UserActionEventRepo.insertAndAdvanceChain`) already had the pessimistic FOR UPDATE pattern, with the CAS test at `audit-log-cas.test.ts` proving the contract.

Together, the three closures span every concurrent-write pattern in the finding/entity/audit repos:

| Pattern                                       | Mechanism                         | Test                                      |
| --------------------------------------------- | --------------------------------- | ----------------------------------------- |
| Same-row arithmetic UPDATE                    | EvalPlanQual under READ COMMITTED | `repo-row-contention.test.ts` (mode 2.3)  |
| JSONB merge in INSERT...ON CONFLICT DO UPDATE | Same                              | `repo-row-contention.test.ts` (mode 2.3)  |
| External-value UPDATE on hot row              | revision-CAS via expectedRevision | `finding-revision-cas.test.ts` (mode 2.8) |
| Chain-head advance with sequence constraint   | FOR UPDATE within transaction     | `audit-log-cas.test.ts` (pre-existing)    |

Mode 2.6 as a distinct failure mode therefore has no further code work to close — it was the union of three sub-modes, and each sub-mode now has a closure with a regression test.

## What this closure document does

It's the cross-reference. A future reviewer auditing mode 2.6 finds this file and is pointed at the three real closures. No new code is introduced.

## Files touched

- `docs/audit/evidence/hardening/category-2/mode-2.6/CLOSURE.md` (this file, cross-reference only)

## Verification

- All three referenced tests exist and pass (or skip cleanly without `INTEGRATION_DB_URL`):
  - `audit-log-cas.test.ts` (pre-existing; CI-gated by `INTEGRATION_DB_URL` + asserted-running-in-CI at `.github/workflows/ci.yml:144-159`)
  - `repo-row-contention.test.ts` (mode 2.3; integration only)
  - `finding-revision-cas.test.ts` (mode 2.8; integration only)
- `pnpm --filter @vigil/db-postgres test`: 46 passed, 13 skipped (the skipped ones are the integration tests waiting for `INTEGRATION_DB_URL`).
