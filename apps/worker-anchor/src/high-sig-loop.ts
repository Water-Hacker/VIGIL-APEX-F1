import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { LoopBackoff } from '@vigil/observability';

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
      // Tier-11 audit closure: setAnchorTx FIRST (the dedup gate), then
      // publicAnchorRepo.record (best-effort observability row).
      //
      // Pre-fix the ordering was publicAnchorRepo.record → setAnchorTx,
      // so a failure of the first DB write left the event in the
      // pending queue while the on-chain commit had already succeeded.
      // Next tick would re-anchor the SAME event → duplicate Polygon
      // anchor → real mainnet gas wasted + audit trail pollution.
      //
      // With setAnchorTx first, the event is durably "anchored" the
      // moment the dedup gate persists. If publicAnchorRepo.record
      // fails afterward, we lose ONLY the observability row — the
      // event itself is consistent and the on-chain commit isn't
      // duplicated. The audit-watch loop will surface the missing
      // public_anchor row separately.
      //
      // FLAGGED: a deeper idempotency fix (use the chain commitment
      // id, or pre-insert with tx=NULL then update) would close the
      // remaining gap — anchor.commit() succeeds but BOTH DB writes
      // fail. Requires architect input on VIGILAnchor.sol uniqueness
      // semantics. Documented; not changed in this PR.
      await deps.userActionRepo.setAnchorTx(ev.event_id, txHash);
      try {
        await deps.publicAnchorRepo.record({
          id: randomUUID(),
          event_id: ev.event_id,
          polygon_tx_hash: txHash,
          anchored_at: new Date(),
          is_individual: true,
        });
      } catch (recordErr) {
        const e = recordErr instanceof Error ? recordErr : new Error(String(recordErr));
        deps.logger.warn(
          {
            err_name: e.name,
            err_message: e.message,
            event_id: ev.event_id,
            txHash,
          },
          'high-sig-public-anchor-row-write-failed; on-chain commit persisted',
        );
      }
      deps.logger.info(
        { event_id: ev.event_id, event_type: ev.event_type, txHash },
        'high-sig-anchored',
      );
      count++;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      deps.logger.error(
        {
          err_name: e.name,
          err_message: e.message,
          event_id: ev.event_id,
          event_type: ev.event_type,
        },
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
  // Mode 1.6 — adaptive sleep on consecutive failures. Same contract
  // as the main anchor loop in index.ts.
  const backoff = new LoopBackoff({ initialMs: 1_000, capMs: deps.intervalMs });
  while (!isStopping()) {
    try {
      await processHighSigBatch(deps);
      backoff.onSuccess();
    } catch (err) {
      backoff.onError();
      deps.logger.error(
        { err, consecutiveFailures: backoff.consecutiveFailureCount },
        'high-sig-anchor-loop-error',
      );
    }
    await sleep(backoff.nextDelayMs());
  }
}
