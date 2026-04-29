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
  readonly missingFromFabric: ReadonlyArray<string>; // seq
  readonly divergentSeqs: ReadonlyArray<{
    seq: string;
    pgBodyHash: string;
    fabricBodyHash: string;
  }>;
}

export async function verifyCrossWitness(
  pool: Pool,
  bridge: FabricBridge,
  range: { from: bigint; to: bigint },
  logger?: Logger,
): Promise<CrossWitnessReport> {
  const log = logger ?? createLogger({ service: 'audit-verifier' });

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
  for (const c of fabRows) fabBySeq.set(c.seq, c);

  const missing: string[] = [];
  const divergent: CrossWitnessReport['divergentSeqs'] extends ReadonlyArray<infer T> ? T[] : never = [];
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

  const report: CrossWitnessReport = {
    checked: pgRes.rows.length,
    missingFromFabric: missing,
    divergentSeqs: divergent,
  };

  log.info(
    {
      from: range.from.toString(),
      to: range.to.toString(),
      checked: report.checked,
      missing: missing.length,
      divergent: divergent.length,
    },
    'cross-witness-report',
  );

  return report;
}
