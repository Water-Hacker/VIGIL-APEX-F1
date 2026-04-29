import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import type { PolygonAnchor } from '@vigil/audit-chain';
import type { PublicAnchorRepo, UserActionEventRepo } from '@vigil/db-postgres';

/**
 * DECISION-012 — fast-lane Polygon anchor for TAL-PA high-significance
 * events. Lifted out of `index.ts` so it can be unit-tested.
 */

export interface HighSigAnchorDeps {
  readonly anchor: PolygonAnchor;
  readonly userActionRepo: UserActionEventRepo;
  readonly publicAnchorRepo: PublicAnchorRepo;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly logger: any;
  readonly intervalMs: number;
}

/**
 * Run one batch of high-sig events through the anchor. Returns the count
 * processed. Used by both the driver loop and the unit tests.
 */
export async function processHighSigBatch(
  deps: Omit<HighSigAnchorDeps, 'intervalMs'>,
): Promise<number> {
  const pending = await deps.userActionRepo.listPendingHighSig(50);
  let count = 0;
  for (const ev of pending) {
    try {
      const ts = Math.floor(new Date(ev.timestamp_utc).getTime() / 1000);
      const seq = ts; // monotonic-ish; unique enough for a single-leaf commit
      const txHash = await deps.anchor.commit(seq, seq, ev.record_hash);
      await deps.publicAnchorRepo.record({
        id: randomUUID(),
        event_id: ev.event_id,
        polygon_tx_hash: txHash,
        anchored_at: new Date(),
        is_individual: true,
      });
      await deps.userActionRepo.setAnchorTx(ev.event_id, txHash);
      deps.logger.info(
        { event_id: ev.event_id, event_type: ev.event_type, txHash },
        'high-sig-anchored',
      );
      count++;
    } catch (err) {
      deps.logger.error(
        { err, event_id: ev.event_id, event_type: ev.event_type },
        'high-sig-anchor-failed',
      );
    }
  }
  return count;
}

/**
 * Driver loop. Polls the pending high-sig queue every `intervalMs` ms
 * until `isStopping()` returns true.
 */
export async function runHighSigAnchorLoop(
  deps: HighSigAnchorDeps,
  isStopping: () => boolean,
): Promise<void> {
  while (!isStopping()) {
    try {
      await processHighSigBatch(deps);
    } catch (err) {
      deps.logger.error({ err }, 'high-sig-anchor-loop-error');
    }
    await sleep(deps.intervalMs);
  }
}
