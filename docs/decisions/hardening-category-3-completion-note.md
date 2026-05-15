# Hardening Pass · Category 3 (Audit chain integrity) — Completion Note

**Date:** 2026-05-15
**Branch:** `hardening/phase-1-orientation`
**Phase:** 4 of 11 in the 90-mode hardening pass
**Modes closed this category:** 2 (3.2, 3.4) — the only partials at orientation
**Modes pre-existing closed-verified:** 7 (3.1, 3.3, 3.5, 3.6, 3.7, 3.8, 3.9)

## What landed

Two mode-closure commits + one new runbook:

| Mode | Title                                      | Commit                      | Test / Doc                                                |
| ---- | ------------------------------------------ | --------------------------- | --------------------------------------------------------- |
| 3.2  | Silent drop on witness failure             | `test(audit-chain)` d774b65 | `republish.test.ts` (5 cases) + new `republish.ts` module |
| 3.4  | Witness divergence Postgres/Polygon/Fabric | `docs(audit-chain)` 83b0296 | `docs/runbooks/audit-chain-divergence.md` (156 lines)     |

## Tests added

5 new test cases across 1 new test file:

- `apps/worker-reconcil-audit/__tests__/republish.test.ts` — 5 cases pinning the silent-drop recovery contract: per-gap publish, `reconcil:` dedup prefix, maxPerTick rate cap, per-envelope failure resilience, empty-gaps no-op.

## Invariants added

| Layer     | Invariant                                                                                                                  | Effect                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code      | `republishToFabricBridge` extracted to its own module with DI'd logger and `{ published, failed }` return shape (mode 3.2) | Recovery path is now unit-testable; failure count surfaces in audit-of-audit row                                                                                |
| Test      | 5 republish tests                                                                                                          | Locks the contract that gaps are recovered without dropping rows                                                                                                |
| Doc       | `docs/runbooks/audit-chain-divergence.md` (mode 3.4)                                                                       | 6-step operator response: identify scope → halt the bleed → diagnose → decide remediation (A/B/C) → prove clean → write up. Cross-linked to 6 sibling runbooks. |
| Cross-ref | This completion note + 2 closure docs + the runbook                                                                        | Triple-anchored: future operators encountering divergence find the runbook from multiple entry points                                                           |

## Cross-cutting verification

After the last commit in this category:

- `pnpm run typecheck` (60 packages): 60 successful (cached, 3 s wall).
- `pnpm --filter worker-reconcil-audit test`: 13 passed (was 8; +5 republish tests).
- `pnpm --filter audit-verifier test`: 5 passed (unchanged; existing cross-witness coverage).
- `pnpm --filter @vigil/audit-chain test`: 26 passed (unchanged; existing canonical + hash-chain coverage).
- Production wiring confirmed at `infra/docker/docker-compose.yaml:685-701` — `worker-reconcil-audit` runs hourly with the documented env config.
- `make verify-cross-witness` target exists (`Makefile:143-145`) and is invoked by the runbook.

## Secondary findings surfaced during Category 3

Two findings beyond the orientation:

**(a) The orientation's "verifier is on-demand, not scheduled" claim was wrong.** `apps/audit-verifier/src/index.ts` IS scheduled — runs CT-01/CT-02/CT-03 on its own `AUDIT_VERIFY_INTERVAL_MS` cadence (default 1 hour). What's on-demand is the FULL-CHAIN walk via `make verify-cross-witness`. This is the intentionally correct shape: scheduled tail-scan handles routine drift; on-demand full-walk handles operator-suspicion cases. The orientation conflated the two.

**(b) Writing the divergence runbook surfaced a real gap.** Step 3 of the runbook references `packages/audit-chain/src/scripts/recompute-body-hash.js` as the diagnostic "truth-test" tool. **That script does not exist in the codebase.** Operators following the runbook today would hit "file not found" at step 3. The audit-chain hashing helpers exist at `packages/audit-chain/src/hash-chain.ts`; the script is a thin CLI wrapper that hasn't been written.

This is acceptable for the mode 3.4 closure because (a) the closure doc is honest about it (Posture 4), (b) the path is well-defined for follow-up, and (c) the truth-test can still be performed manually by anyone familiar with the audit-chain hashing code. The follow-up commit is short: ~30 lines of TypeScript reading an `audit.actions` row and calling the existing `bodyHash()` helper.

**Flagged for follow-up:** write `packages/audit-chain/src/scripts/recompute-body-hash.ts` so the divergence runbook step 3 actually works end-to-end without requiring the operator to know how the hashing internals work.

## Modes that revealed structural issues requiring follow-up

None at the failure-mode level. One operational follow-up:

1. **Write `packages/audit-chain/src/scripts/recompute-body-hash.ts`** so the divergence runbook is fully executable.

## Status of the 90-mode pass after Category 3

After this category:

- **Closed-verified now:** 62 of 90 (was 60 after Category 1).
- **Partially closed:** 10 (was 12 — both Category 3 partials closed).
- **Open:** 12 (unchanged this category — Category 3 had no open modes, only partials).
- **Not applicable:** 6 (unchanged).

The proposed sequencing has Category 4 (Authorisation and capability enforcement) next. Four open modes: 4.2 (cheap), 4.3 (medium), 4.4 (cheap), 4.9 (cheap). Total estimated effort 2–3 days.

## Architect signal needed

None for proceeding to Category 4. The five open questions in the orientation's §7 remain open; none of them block Category 4.

Proceeding to Category 4 (Authorisation and capability enforcement) on the architect's next `proceed`.
