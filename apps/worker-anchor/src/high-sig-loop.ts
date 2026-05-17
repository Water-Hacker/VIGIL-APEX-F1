import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { LoopBackoff, type Logger } from '@vigil/observability';

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
  readonly logger: Logger;
  readonly intervalMs: number;
}

/**
 * Tier-53 audit closure — bail-out threshold for consecutive per-event
 * failures within a single batch. Pre-fix, a hard outage (signer down,
 * Polygon RPC partitioned) hit all 50 events in the batch one-by-one;
 * each event burned a network round-trip + emitted an error log. With
 * 50 events × ~5s each, one batch could spend 4+ minutes on a doomed
 * pass. Bail at the first 5 consecutive failures so the LoopBackoff
 * at the driver level can apply a real backoff instead of being reset
 * by partial success on every batch.
 */
const MAX_CONSECUTIVE_BATCH_FAILURES = 5;

export interface HighSigBatchResult {
  readonly succeeded: number;
  readonly failed: number;
  readonly attempted: number;
  /** True when the batch was cut short by consecutive failures. */
  readonly bailedOut: boolean;
}

/**
 * Run one batch of high-sig events through the anchor. Returns a
 * structured result so the driver loop can route on succeeded vs
 * failed (the previous shape returned ONLY count of successes, which
 * masked partial-failure storms).
 */
export async function processHighSigBatch(
  deps: Omit<HighSigAnchorDeps, 'intervalMs'>,
): Promise<HighSigBatchResult> {
  const pending = await deps.userActionRepo.listPendingHighSig(50);
  let succeeded = 0;
  let failed = 0;
  let consecutiveFailures = 0;
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
      succeeded++;
      consecutiveFailures = 0;
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
      failed++;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_BATCH_FAILURES) {
        // Tier-53: bail out so the driver loop's LoopBackoff applies a
        // real backoff instead of being reset by partial success on
        // every batch. The unprocessed events stay in
        // `listPendingHighSig` for the next driver-loop iteration.
        deps.logger.error(
          {
            consecutiveFailures,
            threshold: MAX_CONSECUTIVE_BATCH_FAILURES,
            pendingRemaining: pending.length - succeeded - failed,
          },
          'high-sig-batch-bail-out; driver loop will back off',
        );
        return {
          succeeded,
          failed,
          attempted: succeeded + failed,
          bailedOut: true,
        };
      }
    }
  }
  return {
    succeeded,
    failed,
    attempted: succeeded + failed,
    bailedOut: false,
  };
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
      const result = await processHighSigBatch(deps);
      // Tier-53: route on the structured result, not just the absence
      // of a throw. A batch that bailed-out OR a batch where >50% of
      // attempts failed should count as a failure for the LoopBackoff,
      // even though no exception escaped.
      if (result.bailedOut || (result.attempted > 0 && result.failed > result.succeeded)) {
        backoff.onError();
      } else {
        backoff.onSuccess();
      }
    } catch (err) {
      backoff.onError();
      // Tier-53: structured err_name / err_message rather than the raw
      // err object, matching the convention enforced elsewhere
      // (T13/T15/T16/T17/T19/T21/T24/T29/T35/T46/T49).
      const e = err instanceof Error ? err : new Error(String(err));
      deps.logger.error(
        {
          err_name: e.name,
          err_message: e.message,
          consecutiveFailures: backoff.consecutiveFailureCount,
        },
        'high-sig-anchor-loop-error',
      );
    }
    await sleep(backoff.nextDelayMs());
  }
}
