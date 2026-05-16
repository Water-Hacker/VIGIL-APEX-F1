/**
 * Mode 3.2 — Silent drop on witness failure.
 *
 * The republish helper for the missing-from-Fabric recovery path.
 * Extracted from index.ts so it can be tested directly without
 * spinning up Postgres / Redis / Fabric.
 *
 * Contract:
 *   - INPUT: a list of {seq, body_hash} gaps (rows present in
 *     Postgres `audit.actions` but missing from `audit.fabric_witness`).
 *   - OUTPUT: published envelopes to `STREAMS.AUDIT_PUBLISH` with
 *     `reconcil:<seq>` dedup keys, capped at `maxPerTick`.
 *   - INVARIANT: each gap row must remain in Postgres regardless of
 *     republish outcome — this function NEVER deletes or mutates the
 *     `audit.actions` row. If the queue.publish itself fails, we log
 *     and continue (the next reconciliation tick will pick the gap up
 *     again because it's still in Postgres + still absent from
 *     `audit.fabric_witness`).
 */

import { QueueClient, STREAMS, newEnvelope } from '@vigil/queue';

import type { Logger } from '@vigil/observability';

export interface RepublishResult {
  /** Number of envelopes successfully published this tick. */
  readonly published: number;
  /** Number of envelopes that failed to publish this tick (caller
   *  logs; next tick retries because the audit.actions row is still
   *  present and still absent from audit.fabric_witness). */
  readonly failed: number;
}

export async function republishToFabricBridge(
  queue: QueueClient,
  gaps: ReadonlyArray<{ seq: string; body_hash: string }>,
  maxPerTick: number,
  logger: Logger,
): Promise<RepublishResult> {
  const slice = gaps.slice(0, maxPerTick);
  let published = 0;
  let failed = 0;
  for (const gap of slice) {
    const env = newEnvelope(
      'worker-reconcil-audit',
      { seq: gap.seq, body_hash: gap.body_hash },
      `reconcil:${gap.seq}`,
    );
    try {
      await queue.publish(STREAMS.AUDIT_PUBLISH, env);
      published += 1;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      logger.error(
        { err_name: e.name, err_message: e.message, seq: gap.seq },
        'reconcil-republish-failed',
      );
      failed += 1;
    }
  }
  return { published, failed };
}
