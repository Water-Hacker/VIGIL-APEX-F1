import { FabricBridge, type FabricCommitment } from '@vigil/fabric-bridge';
import { createLogger, type Logger } from '@vigil/observability';

import type { Pool } from 'pg';

/**
 * Cross-witness verification (Phase I1, scaffolded in G4).
 *
 * Compares three independent witnesses of every audit row:
 *   (a) Postgres `audit.actions.body_hash` — application source of
 *       truth, hash-linked.
 *   (b) Postgres `audit.anchor_commitment.root_hash` — Polygon-anchored
 *       Merkle root over a seq range.
 *   (c) Fabric `audit-witness.GetCommitment(seq).bodyHash` — second
 *       cryptographic witness.
 *
 * (c) MUST equal (a) for every seq the worker has bridged. Divergence
 * is non-recoverable — the function fails fast.
 */

export interface CrossWitnessReport {
  readonly checked: number;
  /** Seqs present in Postgres but absent from Fabric. Recoverable
   *  (republish via fabric-bridge queue). */
  readonly missingFromFabric: ReadonlyArray<string>;
  /** Seqs present in Fabric but absent from Postgres. NON-RECOVERABLE
   *  in the normal direction (Postgres is source of truth); a non-empty
   *  list means either Fabric was written directly (bug or adversary)
   *  or Postgres was rolled back. Closes FIND-013 from
   *  whole-system-audit doc 10. */
  readonly missingFromPostgres: ReadonlyArray<string>;
  /** Seqs where Postgres and Fabric disagree on body_hash for the same
   *  seq. NON-RECOVERABLE. */
  readonly divergentSeqs: ReadonlyArray<{
    seq: string;
    pgBodyHash: string;
    fabricBodyHash: string;
  }>;
}

/**
 * Tier-9 audit closure: hard cap on the seq-range scanned in a single
 * verifyCrossWitness invocation. Pre-cap, a caller could request the
 * entire chain (range.to - range.from = N million seqs) which would
 * load every row + every Fabric commitment into memory, eating both
 * the PG pool and the worker's heap. Callers that need to cover the
 * full chain should iterate windows. 500k seqs/window is generous
 * for a 7-day chain at ~50 events/sec and bounded for memory.
 */
export const CROSS_WITNESS_MAX_RANGE = 500_000n;

export async function verifyCrossWitness(
  pool: Pool,
  bridge: FabricBridge,
  range: { from: bigint; to: bigint },
  logger?: Logger,
): Promise<CrossWitnessReport> {
  const log = logger ?? createLogger({ service: 'audit-verifier' });

  if (range.to < range.from) {
    throw new Error(`cross-witness range invalid: to (${range.to}) < from (${range.from})`);
  }
  const span = range.to - range.from + 1n;
  if (span > CROSS_WITNESS_MAX_RANGE) {
    throw new Error(
      `cross-witness range ${span} exceeds cap ${CROSS_WITNESS_MAX_RANGE}; ` +
        `iterate windows instead of one mega-scan`,
    );
  }

  // Read both sides in seq order. Both are paginable; we do a single
  // sweep here because the cross-witness verifier is meant to be run
  // off-peak (cron / on-demand), not in the hot path.
  const pgRes = await pool.query<{ seq: string; body_hash: Buffer }>(
    `SELECT seq::text, body_hash
       FROM audit.actions
      WHERE seq BETWEEN $1::bigint AND $2::bigint
      ORDER BY seq ASC`,
    [String(range.from), String(range.to)],
  );

  const fabRows = await bridge.listCommitments(range.from, range.to);
  const fabBySeq = new Map<string, FabricCommitment>();
  // Tier-9 audit closure: lowercase Fabric bodyHash defensively. The
  // chaincode at chaincode/audit-witness/src/contract.ts:42 already
  // lowercases before storing, but a future chaincode rev or a
  // peer-side migration could break that invariant. The equality
  // check at line below compares hex strings — case-sensitive
  // mismatch would mis-report a divergence.
  for (const c of fabRows) {
    fabBySeq.set(c.seq, { ...c, bodyHash: c.bodyHash.toLowerCase() });
  }

  // Postgres-side hash lookup for the reverse scan (FIND-013).
  const pgBySeq = new Map<string, string>();
  for (const r of pgRes.rows) {
    pgBySeq.set(r.seq, r.body_hash.toString('hex').toLowerCase());
  }

  const missing: string[] = [];
  const divergent: CrossWitnessReport['divergentSeqs'] extends ReadonlyArray<infer T>
    ? T[]
    : never = [];
  for (const row of pgRes.rows) {
    const pgHash = row.body_hash.toString('hex').toLowerCase();
    const fab = fabBySeq.get(row.seq);
    if (!fab) {
      missing.push(row.seq);
      continue;
    }
    if (fab.bodyHash !== pgHash) {
      divergent.push({
        seq: row.seq,
        pgBodyHash: pgHash,
        fabricBodyHash: fab.bodyHash,
      });
    }
  }

  // FIND-013 closure: reverse scan. Any Fabric commitment in the range
  // that has no corresponding Postgres row is a defence-in-depth red
  // flag — Postgres is the source of truth and should always be written
  // before Fabric. If Fabric has a seq Postgres doesn't, either:
  //   - the chaincode was called out of band (bug or adversary)
  //   - Postgres was rolled back (backup restore that missed Fabric)
  // Either case demands operator review; the audit chain reconciliation
  // worker (FIND-005) will additionally surface it via a structured
  // alert if it observes the same condition on its hourly scan.
  const missingFromPostgres: string[] = [];
  for (const seq of fabBySeq.keys()) {
    if (!pgBySeq.has(seq)) missingFromPostgres.push(seq);
  }
  // Stable order for deterministic snapshots / log lines.
  missingFromPostgres.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));

  const report: CrossWitnessReport = {
    checked: pgRes.rows.length,
    missingFromFabric: missing,
    missingFromPostgres,
    divergentSeqs: divergent,
  };

  log.info(
    {
      from: range.from.toString(),
      to: range.to.toString(),
      checked: report.checked,
      missing_fabric: missing.length,
      missing_postgres: missingFromPostgres.length,
      divergent: divergent.length,
    },
    'cross-witness-report',
  );

  return report;
}
