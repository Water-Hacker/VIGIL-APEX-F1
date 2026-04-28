import type { Adapter, ProxyManager } from '@vigil/adapters';
import type { SourceRepo } from '@vigil/db-postgres';
import {
  adapterRunsTotal,
  withCorrelation,
  type Logger,
} from '@vigil/observability';
import { QueueClient, STREAMS, newEnvelope } from '@vigil/queue';
import { Errors, type Schemas } from '@vigil/shared';

/**
 * runOne — execute a single adapter run end-to-end.
 *
 * Sequence (SRD §11):
 *   1. Pick proxy endpoint from ProxyManager
 *   2. Adapter.run(ctx)
 *   3. Persist events to source.events (Postgres dedup at db layer)
 *   4. Publish each event envelope to vigil:adapter:out
 *   5. Persist documents (deduped by sha256)
 *   6. Update adapter_health snapshot
 *
 * On adapter failure:
 *   - blocked → record escalation in proxy mgr; mark adapter health 'blocked'
 *   - parse failure → first-contact archive already triggered by base; mark 'first_contact_failed'
 *   - other → mark 'red' with consecutive_failures incremented
 */
export interface RunOneArgs {
  readonly src: Schemas.SourceRegistryEntry;
  readonly adapter: Adapter;
  readonly proxyMgr: ProxyManager;
  readonly queue: QueueClient;
  readonly sourceRepo: SourceRepo;
  readonly correlationId: string;
  readonly logger: Logger;
}

export async function runOne(args: RunOneArgs): Promise<void> {
  const { src, adapter, proxyMgr, queue, sourceRepo, correlationId, logger } = args;
  const childLogger = logger.child({ source: src.id, correlation_id: correlationId });

  await withCorrelation(correlationId, 'adapter-runner', async () => {
    const previous = await sourceRepo.getHealth(src.id).catch(() => null);
    const wasBlocked = previous?.status === 'blocked';

    const proxy = proxyMgr.endpointFor(src.id, wasBlocked);
    childLogger.info({ proxy: proxy.tier }, 'adapter-run-start');

    let resultRows = 0;
    let lastError: string | null = null;
    let outcome: 'green' | 'amber' | 'red' | 'blocked' | 'first_contact_failed' = 'green';

    try {
      const result = await adapter.run({ correlationId, proxy, logger: childLogger });
      resultRows = result.events.length;

      // Persist events + publish envelopes (DB commit BEFORE stream publish per SRD §15.1)
      for (const ev of result.events) {
        const { inserted } = await sourceRepo.insertEvent({
          id: ev.id,
          source_id: ev.source_id,
          kind: ev.kind,
          dedup_key: ev.dedup_key,
          published_at: ev.published_at ? new Date(ev.published_at) : null,
          observed_at: new Date(ev.observed_at),
          payload: ev.payload,
          document_cids: ev.document_cids,
          provenance: ev.provenance,
        });
        if (inserted) {
          await queue.publish(
            STREAMS.ADAPTER_OUT,
            newEnvelope('adapter-runner', ev, ev.dedup_key, correlationId),
          );
        }
      }

      // Persist documents
      for (const doc of result.documents) {
        await sourceRepo.insertDocument({
          id: doc.id,
          cid: doc.cid,
          source_id: doc.source_id,
          kind: doc.kind,
          mime: doc.mime,
          language: doc.language,
          bytes: doc.bytes,
          sha256: doc.sha256,
          source_url: doc.source_url,
          fetched_at: new Date(doc.fetched_at),
          ocr_engine: doc.ocr_engine,
          ocr_confidence: doc.ocr_confidence !== null ? String(doc.ocr_confidence) : null,
          text_extract_chars: doc.text_extract_chars,
          pinned_at_ipfs: doc.pinned_at_ipfs,
          mirrored_to_synology: doc.mirrored_to_synology,
          metadata: doc.metadata,
        });
      }

      childLogger.info(
        { events: resultRows, docs: result.documents.length, elapsed_ms: result.elapsed_ms },
        'adapter-run-ok',
      );
    } catch (e) {
      const ve = Errors.asVigilError(e);
      lastError = ve.message;
      if (ve.code === 'ADAPTER_SOURCE_BLOCKED') {
        outcome = 'blocked';
        proxyMgr.recordEscalation(src.id, proxy.tier);
      } else if (ve.code === 'ADAPTER_PARSE_FAILURE') {
        outcome = 'first_contact_failed';
      } else {
        outcome = 'red';
      }
      adapterRunsTotal.labels({ source: src.id, outcome }).inc();
      childLogger.error({ err: ve, code: ve.code }, 'adapter-run-failed');
    }

    // Health snapshot
    const consecutiveFailures =
      outcome === 'green' ? 0 : (previous?.consecutive_failures ?? 0) + 1;
    await sourceRepo.upsertHealth({
      source_id: src.id,
      status: outcome,
      last_run_at: new Date(),
      last_success_at: outcome === 'green' ? new Date() : (previous?.last_success_at ?? null),
      last_error: lastError,
      consecutive_failures: consecutiveFailures,
      rows_in_last_run: resultRows,
      next_scheduled_at: null,
    });
  });
}
