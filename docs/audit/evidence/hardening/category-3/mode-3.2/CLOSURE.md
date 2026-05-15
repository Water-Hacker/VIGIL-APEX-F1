# Mode 3.2 — Silent drop on witness failure

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 4 / Category 3
**Branch:** `hardening/phase-1-orientation`

## The failure mode

The audit chain has three witnesses (Postgres `audit.actions`, Hyperledger Fabric `audit-witness` chaincode, Polygon `VIGILAudit` anchor commitments). The emit path writes the Postgres row + user-action-chain advance in a single transaction; Fabric submission is async via the `STREAMS.AUDIT_PUBLISH` queue. If the Fabric submission fails after the Postgres write commits, the row remains in Postgres with no matching `audit.fabric_witness` entry — a witness gap. Without reconciliation, the gap is silent: the operator only notices if they happen to manually verify the chain.

## What was already in place

- `packages/audit-log/src/emit.ts:103-202` + `halt.ts:24-34` — Postgres write + user-action-chain advance run in one transaction; emit failure propagates via `AuditEmitterUnavailableError`. No silent swallow at emit time.
- `apps/worker-fabric-bridge/src/index.ts:65-101` — Fabric bridge consumes `STREAMS.AUDIT_PUBLISH`; on failure the envelope dead-letters but the Postgres row is untouched.
- `apps/worker-reconcil-audit/src/reconcile.ts` + `index.ts` — reconciliation worker runs hourly, computes a plan over a tail seq range, and republishes missing-from-Fabric gaps back to `STREAMS.AUDIT_PUBLISH` with a `reconcil:` dedup prefix.
- `apps/worker-reconcil-audit/__tests__/reconcile.test.ts` — 8 cases covering the pure-function `computeReconciliationPlan` behaviour (missing-from-Fabric, missing-from-Polygon, divergence, multi-mode, 64-bit seq, uppercase hex).

**What was missing:** an explicit test for the full end-to-end recovery path — "Postgres write OK → Fabric submit fails → reconciliation republishes the envelope without dropping the Postgres row." The reconcile.test.ts cases test the plan computation; they do NOT exercise the actual republish I/O.

## What was added

### 1. Refactor: `apps/worker-reconcil-audit/src/republish.ts`

Extracted `republishToFabricBridge` from `index.ts` into its own module so it can be unit-tested directly with mock dependencies. The function takes `(queue, gaps, maxPerTick, logger)` and returns `{ published, failed }`. The logger is now injected (previously closed over module-level `logger`) so tests can capture log assertions.

`index.ts` now imports `republishToFabricBridge` from `./republish.js` and adapts to the new return shape (`r.published`).

### 2. `apps/worker-reconcil-audit/__tests__/republish.test.ts` — 5 cases

The 5 cases together pin down the silent-drop closure:

1. **`publishes a recovery envelope for each gap`** — 3 gaps → 3 publishes; each carries seq + body_hash. Locks the contract that recovery is observable through queue activity.

2. **`dedup_key carries the 'reconcil:' prefix`** — proves the dedup convention. Without this prefix the fabric-bridge would treat the republish as a brand-new audit row (creating a duplicate); with it, the bridge sees the same dedup_key on retry and idempotently writes the original record.

3. **`respects maxPerTick`** — 50 gaps + maxPerTick=10 → exactly 10 publishes. Locks the rate cap so a large backlog doesn't overwhelm the queue in a single tick.

4. **`continues past per-envelope publish failures`** — the critical regression test. A queue that fails on seq=2 must still publish seqs 1, 3, 4 + LOG the seq=2 failure + return `{published: 3, failed: 1}`. The audit.actions row for seq=2 is preserved (no DB call in this code path); the next tick will see seq=2 still missing and retry. This is the actual silent-drop closure.

5. **`empty gaps list is a no-op`** — clean-state tick produces zero publishes; safety property for normal operation.

### 3. Refactor surface confirmed

`index.ts:194-199` now reads:

```typescript
const r = await republishToFabricBridge(
  queue,
  plan.missingFromFabric,
  cfg.maxRepublishPerTick,
  logger,
);
republished = r.published;
```

The existing `reconcile-tick` audit-of-audit row at `index.ts:230-242` still records `republished_fabric: republished` for operator observability.

## The invariant

Three layers protect against regression:

1. **The 5 republish tests** lock the recovery contract: each gap is published, with the correct envelope, with the correct dedup prefix, respecting the rate cap, even when individual publishes fail.
2. **The 8 reconcile-plan tests** lock the gap-detection contract: missing-from-Fabric is correctly identified.
3. **The reconciliation worker's `LoopBackoff` (added in mode 1.6)** ensures the worker keeps retrying on its own cadence even if a Postgres / Redis / Fabric dependency is temporarily down — sustained failure backs off exponentially but never gives up.

Together: a row written to Postgres with a failed Fabric submit will be (a) detected as a gap on the next tick, (b) republished to the queue, and (c) eventually written to Fabric. The Postgres row never disappears; the Fabric witness eventually catches up. No silent drop.

## What this closure does NOT include

- **An integration test against a real Postgres + Redis + Fabric peer.** That belongs in the stress-test suite at `docs/audit/09-stress-test.md` (CT-03 cross-witness). The unit-level tests above are the in-code regression invariant.

- **A Prometheus metric for `vigil_reconcil_republished_total{seq}`.** Currently the count is logged in the `reconcil-tick` info log + recorded in the audit-of-audit chain row. A graph-friendly counter is a nice-to-have, flagged for follow-up.

- **The Polygon-witness recovery path.** Mode 3.2 is specifically about Fabric witnesses. The Polygon path is different: the anchor worker reads `MAX(seq_to)` from `audit.anchor_commitment` and naturally includes the gap on its next tick. The reconciliation worker just records `missing_polygon` for observability (no active republish). The "silent drop on Polygon witness failure" sub-case is closed by the anchor worker's own next-tick behaviour; flagged in the closure doc here for completeness.

## Files touched

- `apps/worker-reconcil-audit/src/republish.ts` (new, 55 lines)
- `apps/worker-reconcil-audit/src/index.ts` (refactor: extract republish; +5 lines, -27 lines)
- `apps/worker-reconcil-audit/__tests__/republish.test.ts` (new, 154 lines)
- `docs/audit/evidence/hardening/category-3/mode-3.2/CLOSURE.md` (this file)

## Verification

- `pnpm --filter worker-reconcil-audit run typecheck` — clean.
- `pnpm --filter worker-reconcil-audit test` — 13 passed (was 8; +5 republish tests).
