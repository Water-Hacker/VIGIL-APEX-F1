/**
 * Pure reconciliation logic — testable without a database, Fabric peer,
 * Polygon RPC, or queue. The worker shell in `index.ts` wires this up
 * to real adapters.
 *
 * Closes FIND-005 from whole-system-audit doc 10 — the missing
 * automated reconciliation job between the three audit-chain witnesses
 * (Postgres `audit.actions`, Postgres `audit.fabric_witness` mirror of
 * the Fabric chaincode ledger, and Postgres `audit.anchor_commitment`
 * for the Polygon mainnet anchor).
 *
 * The pure function `computeReconciliationPlan(state)` answers two
 * questions over a seq range [from, to]:
 *   1. Which Postgres rows have NO matching Fabric witness?
 *   2. Which Postgres rows have NO containing Polygon anchor commitment?
 *
 * It does NOT do remediation; it returns a plan. The worker decides
 * which actions to take (republish to fabric-bridge queue, trigger
 * the anchor worker, alert).
 */

export interface ActionsRow {
  readonly seq: string;
  readonly body_hash: string; // lowercase hex
}

export interface FabricWitnessRow {
  readonly seq: string;
  readonly body_hash: string; // lowercase hex
}

export interface AnchorCommitmentRow {
  readonly seq_from: string;
  readonly seq_to: string;
  readonly root_hash: string; // lowercase hex
  readonly polygon_tx_hash: string | null;
}

export interface ReconciliationState {
  readonly actions: ReadonlyArray<ActionsRow>;
  readonly fabricWitnesses: ReadonlyArray<FabricWitnessRow>;
  readonly anchorCommitments: ReadonlyArray<AnchorCommitmentRow>;
}

export interface ReconciliationPlan {
  /** Seqs present in Postgres `audit.actions` but missing from Fabric. */
  readonly missingFromFabric: ReadonlyArray<{ seq: string; body_hash: string }>;
  /** Seqs in Postgres with no containing anchor commitment. */
  readonly missingFromPolygon: ReadonlyArray<{ seq: string; body_hash: string }>;
  /**
   * Hash divergence cases — Postgres and Fabric disagree on body_hash for
   * the same seq. NON-RECOVERABLE; the worker MUST surface a fatal alert
   * rather than attempting backfill.
   */
  readonly divergent: ReadonlyArray<{
    seq: string;
    pgBodyHash: string;
    fabricBodyHash: string;
  }>;
  /** Total Postgres rows considered in this reconciliation pass. */
  readonly totalChecked: number;
}

/**
 * Compute the reconciliation plan for a range. Pure; no I/O.
 *
 * Note on `missingFromPolygon`: anchor commitments cover seq RANGES
 * (`seq_from..seq_to`). A Postgres row is considered "covered" if any
 * anchor commitment's range contains its seq AND that commitment has
 * actually been broadcast to Polygon (non-null `polygon_tx_hash`).
 * The high-sig fast-lane anchor (each seq pinned individually) is also
 * represented as a single-row range (seq_from == seq_to).
 *
 * Tier-19 audit closure: previously the coverage check ignored
 * `polygon_tx_hash`. A row with the field set to NULL — i.e. a
 * commitment row that worker-anchor created but never finished
 * broadcasting to the chain — silently counted as "covered". A
 * compromised or wedged anchor worker could leave thousands of seqs
 * with pending-but-never-sent commitments, and the reconciler would
 * report `missing_polygon: 0` while the Polygon mainnet had no
 * record. The fix filters ranges to only those where the tx-hash is
 * present.
 */
export function computeReconciliationPlan(state: ReconciliationState): ReconciliationPlan {
  const fabricBySeq = new Map<string, string>();
  for (const f of state.fabricWitnesses) {
    fabricBySeq.set(f.seq, f.body_hash.toLowerCase());
  }

  const missingFromFabric: { seq: string; body_hash: string }[] = [];
  const divergent: { seq: string; pgBodyHash: string; fabricBodyHash: string }[] = [];

  for (const a of state.actions) {
    const pgHash = a.body_hash.toLowerCase();
    const fabHash = fabricBySeq.get(a.seq);
    if (fabHash === undefined) {
      missingFromFabric.push({ seq: a.seq, body_hash: pgHash });
      continue;
    }
    if (fabHash !== pgHash) {
      divergent.push({ seq: a.seq, pgBodyHash: pgHash, fabricBodyHash: fabHash });
    }
  }

  // Anchor coverage: only commitments with a non-null Polygon tx hash
  // count as "covered". Parse ranges to BigInt once, then test each seq.
  const ranges = state.anchorCommitments
    .filter((c) => c.polygon_tx_hash !== null && c.polygon_tx_hash !== '')
    .map((c) => ({
      from: BigInt(c.seq_from),
      to: BigInt(c.seq_to),
    }));
  const isCovered = (seq: string): boolean => {
    const n = BigInt(seq);
    for (const r of ranges) {
      if (n >= r.from && n <= r.to) return true;
    }
    return false;
  };

  const missingFromPolygon: { seq: string; body_hash: string }[] = [];
  for (const a of state.actions) {
    if (!isCovered(a.seq)) {
      missingFromPolygon.push({ seq: a.seq, body_hash: a.body_hash.toLowerCase() });
    }
  }

  return {
    missingFromFabric,
    missingFromPolygon,
    divergent,
    totalChecked: state.actions.length,
  };
}

/**
 * Summarise a plan for one-line structured log output. Keeps the worker
 * log line tidy at info-level; full detail goes to the audit chain row.
 */
export function planSummary(plan: ReconciliationPlan): {
  readonly total: number;
  readonly missing_fabric: number;
  readonly missing_polygon: number;
  readonly divergent: number;
  readonly clean: boolean;
} {
  return {
    total: plan.totalChecked,
    missing_fabric: plan.missingFromFabric.length,
    missing_polygon: plan.missingFromPolygon.length,
    divergent: plan.divergent.length,
    clean:
      plan.missingFromFabric.length === 0 &&
      plan.missingFromPolygon.length === 0 &&
      plan.divergent.length === 0,
  };
}
