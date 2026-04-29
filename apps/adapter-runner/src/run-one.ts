import { createHash } from 'node:crypto';

import type { Adapter, ProxyManager } from '@vigil/adapters';
import { DailyRateLimiter, RobotsChecker } from '@vigil/adapters';
import type { SourceRepo } from '@vigil/db-postgres';
import {
  adapterRunsTotal,
  withCorrelation,
  type Logger,
} from '@vigil/observability';
import { QueueClient, STREAMS, newEnvelope } from '@vigil/queue';
import { Constants, Errors, type Schemas } from '@vigil/shared';

/**
 * Payload fields adapters use to advertise a downstream document URL.
 * Order matters only for documentation: each is checked independently.
 * Mirrors the conventions across the 26 adapters (cour-des-comptes →
 * report_url, minfi-portal → document_url, ARMP → award_pdf, generic
 * scrapers → href, etc.).
 */
const DOCUMENT_URL_FIELDS = [
  'document_url',
  'report_url',
  'pdf_url',
  'attachment_url',
  'gazette_url',
  'decision_url',
  'award_pdf',
  'href',
] as const;

const DOCUMENT_KIND_BY_FIELD: Record<(typeof DOCUMENT_URL_FIELDS)[number], string> = {
  document_url: 'document',
  report_url: 'audit_report',
  pdf_url: 'document',
  attachment_url: 'attachment',
  gazette_url: 'gazette',
  decision_url: 'decision',
  award_pdf: 'award',
  href: 'document',
};

interface DocumentFetchExtraction {
  readonly request: {
    readonly source_id: string;
    readonly source_event_id: string;
    readonly document_url: string;
    readonly expected_kind: string;
  };
  readonly dedupKey: string;
}

function extractDocumentFetchRequests(
  ev: Schemas.SourceEvent,
): readonly DocumentFetchExtraction[] {
  const payload = ev.payload as Record<string, unknown> | null | undefined;
  if (!payload) return [];

  const out: DocumentFetchExtraction[] = [];
  const seen = new Set<string>();

  for (const field of DOCUMENT_URL_FIELDS) {
    const raw = payload[field];
    if (typeof raw !== 'string') continue;
    const url = raw.trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    const urlHash = createHash('sha256').update(url).digest('hex').slice(0, 16);
    out.push({
      request: {
        source_id: ev.source_id,
        source_event_id: ev.id,
        document_url: url,
        expected_kind: DOCUMENT_KIND_BY_FIELD[field],
      },
      dedupKey: `doc:${ev.id}:${urlHash}`,
    });
  }

  return out;
}

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
  readonly rateLimiter?: DailyRateLimiter;
  readonly robotsChecker?: RobotsChecker;
}

export async function runOne(args: RunOneArgs): Promise<void> {
  const {
    src,
    adapter,
    proxyMgr,
    queue,
    sourceRepo,
    correlationId,
    logger,
    rateLimiter,
    robotsChecker,
  } = args;
  const childLogger = logger.child({ source: src.id, correlation_id: correlationId });

  await withCorrelation(correlationId, 'adapter-runner', async () => {
    const previous = await sourceRepo.getHealth(src.id).catch(() => null);
    const wasBlocked = previous?.status === 'blocked';

    // Tier 3 pre-flight: refuse to fetch if today's daily cap is reached.
    if (rateLimiter && Number(src.daily_request_cap) > 0) {
      const allowed = await rateLimiter.allow(src.id, Number(src.daily_request_cap));
      if (!allowed) {
        const count = await rateLimiter.count(src.id);
        childLogger.warn(
          { cap: src.daily_request_cap, count },
          'rate-limit-cap-reached; skipping run',
        );
        await sourceRepo.upsertHealth({
          source_id: src.id,
          status: previous?.status ?? 'green',
          last_run_at: new Date(),
          last_success_at: previous?.last_success_at ?? null,
          last_error: 'rate-limit-cap-reached',
          consecutive_failures: previous?.consecutive_failures ?? 0,
          rows_in_last_run: 0,
          next_scheduled_at: null,
        });
        return;
      }
    }

    // Tier 3 pre-flight: robots.txt honoring (registry-driven).
    if (robotsChecker && src.honor_robots && src.url) {
      const ua = Constants.getAdapterUserAgent();
      const allowed = await robotsChecker.isAllowed(src.url, ua);
      if (!allowed) {
        childLogger.warn({ url: src.url, ua }, 'robots-disallow; skipping run');
        await sourceRepo.upsertHealth({
          source_id: src.id,
          status: 'amber',
          last_run_at: new Date(),
          last_success_at: previous?.last_success_at ?? null,
          last_error: 'robots-disallow',
          consecutive_failures: previous?.consecutive_failures ?? 0,
          rows_in_last_run: 0,
          next_scheduled_at: null,
        });
        return;
      }
    }

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

          // A2 — adapter → document pipeline bridge.
          // When the adapter event carries a document URL (PDF, scanned form,
          // image, gazette, etc.), publish a `vigil:document:fetch` envelope so
          // worker-document fetches the bytes, hashes, OCRs, and pins them.
          // This is the missing handoff identified by the audit (closes the
          // ADAPTER_OUT → DOCUMENT_FETCH gap).
          for (const { request, dedupKey } of extractDocumentFetchRequests(ev)) {
            await queue.publish(
              STREAMS.DOCUMENT_FETCH,
              newEnvelope('adapter-runner', request, dedupKey, correlationId),
            );
          }
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

      if (rateLimiter) {
        await rateLimiter.increment(src.id);
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
