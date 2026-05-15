import { createHash, randomUUID } from 'node:crypto';

import {
  detectAllAnomalies,
  type DiscoveryCandidate,
  type GraphSnapshot,
} from './graph-anomalies.js';

import type { HashChain } from '@vigil/audit-chain';
import type { PatternDiscoveryRepo } from '@vigil/db-postgres';
import type { Logger } from '@vigil/observability';

export interface DiscoveryCycleContext {
  readonly repo: PatternDiscoveryRepo;
  readonly chain: HashChain;
  readonly logger: Logger;
  readonly loadSnapshot: (windowDays: number) => Promise<GraphSnapshot>;
  readonly windowDays?: number;
  readonly now?: () => Date;
}

export interface DiscoveryCycleResult {
  readonly anomalies_detected: number;
  readonly candidates_persisted: number;
  readonly candidates_already_seen: number;
}

/**
 * Compute a deterministic dedup key from candidate content. The key
 * groups the same anomaly across daily runs so the repo's UPSERT path
 * collapses recurring hits into one row with an updated `last_seen_at`.
 *
 * Component:
 *   kind | sorted(entity_ids) | first 16 hex of sha256(rationale)
 *
 * Rationale-hashing makes the key stable when entity_ids overlap but
 * the underlying graph reasoning changes, OR when the same entities
 * surface under a different reasoning (the two are distinct candidates).
 */
export function candidateDedupKey(c: DiscoveryCandidate): string {
  const sortedIds = [...c.entity_ids_involved].sort().join(',');
  const rationaleHash = createHash('sha256').update(c.rationale).digest('hex').slice(0, 16);
  return `${c.kind}|${sortedIds}|${rationaleHash}`;
}

/**
 * One discovery cycle: load the snapshot, run all detectors, upsert
 * every candidate, emit one chain row summarising the cycle. Idempotent
 * across daily invocations.
 */
export async function runDiscoveryCycle(ctx: DiscoveryCycleContext): Promise<DiscoveryCycleResult> {
  const windowDays = ctx.windowDays ?? 90;
  const now = ctx.now ?? (() => new Date());

  const snapshot = await ctx.loadSnapshot(windowDays);
  const candidates = detectAllAnomalies(snapshot, now());

  let inserted = 0;
  let already = 0;
  for (const c of candidates) {
    const result = await ctx.repo.upsertCandidate({
      id: randomUUID(),
      dedup_key: candidateDedupKey(c),
      kind: c.kind,
      strength: c.strength.toFixed(4),
      entity_ids_involved: [...c.entity_ids_involved],
      rationale: c.rationale,
      evidence: c.evidence,
      status: 'awaiting_curation',
    });
    if (result.inserted) inserted += 1;
    else already += 1;

    await ctx.chain.append({
      action: 'audit.pattern_anomaly_detected',
      actor: 'system:worker-pattern-discovery',
      subject_kind: 'system',
      subject_id: c.kind,
      payload: {
        dedup_key: candidateDedupKey(c),
        strength: c.strength,
        entity_count: c.entity_ids_involved.length,
        reused: !result.inserted,
      },
    });
  }

  ctx.logger.info(
    {
      window_days: windowDays,
      anomalies_detected: candidates.length,
      candidates_persisted: inserted,
      candidates_already_seen: already,
      snapshot_nodes: snapshot.nodes.length,
      snapshot_edges: snapshot.edges.length,
    },
    'pattern-discovery-cycle-complete',
  );

  return {
    anomalies_detected: candidates.length,
    candidates_persisted: inserted,
    candidates_already_seen: already,
  };
}
