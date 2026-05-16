import { createHash } from 'node:crypto';

import { HashChain } from '@vigil/audit-chain';
import { SourceRepo, getDb, getPool } from '@vigil/db-postgres';
import {
  auditFeatureFlagsAtBoot,
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
  type FeatureFlagAuditEmit,
} from '@vigil/observability';
import {
  QueueClient,
  STREAMS,
  WorkerBase,
  newEnvelope,
  startRedisStreamScraper,
  type Envelope,
  type HandlerOutcome,
} from '@vigil/queue';
import { Ids, Schemas } from '@vigil/shared';
import { fileTypeFromBuffer } from 'file-type';
import { create as kuboCreate } from 'kubo-rpc-client';
import { request } from 'undici';
import { z } from 'zod';

import { extractDocContent } from './content-extractor.js';
import { detectLanguage } from './lang.js';
import { OcrPool } from './ocr-pool.js';
import { extractPdfMetadata } from './pdf-metadata.js';
import { extractPdfTextLayer } from './pdf-text.js';

export { detectLanguage };

const logger = createLogger({ service: 'worker-document' });

/**
 * Document fetch pipeline (SRD §14):
 *   adapter.event has document_url(s) → fetch → sha256 → MIME → language →
 *   OCR if applicable → IPFS pin → persist source.documents → emit
 *   downstream events to ENTITY_RESOLVE / PATTERN_DETECT.
 */

const zDocFetchPayload = z.object({
  source_id: z.string(),
  source_event_id: z.string(),
  document_url: z.string().url(),
  expected_kind: z.string().optional(),
});

type DocPayload = z.infer<typeof zDocFetchPayload>;

class DocumentWorker extends WorkerBase<DocPayload> {
  constructor(
    private readonly sourceRepo: SourceRepo,
    private readonly ipfsApiUrl: string,
    private readonly ocrPool: OcrPool,
    queue: QueueClient,
  ) {
    super({
      name: 'worker-document',
      stream: STREAMS.DOCUMENT_FETCH,
      schema: zDocFetchPayload,
      client: queue,
      logger,
      concurrency: 4,
      maxRetries: 5,
    });
  }

  protected async handle(env: Envelope<DocPayload>): Promise<HandlerOutcome> {
    const { document_url, source_id } = env.payload;
    try {
      const resp = await request(document_url, { method: 'GET', maxRedirections: 5 });
      if (resp.statusCode >= 500) {
        return { kind: 'retry', reason: `upstream ${resp.statusCode}`, delay_ms: 30_000 };
      }
      if (resp.statusCode >= 400) {
        return { kind: 'dead-letter', reason: `upstream ${resp.statusCode}` };
      }
      const buf = Buffer.from(await resp.body.arrayBuffer());
      const sha256 = createHash('sha256').update(buf).digest('hex');

      // Dedup: if we already have it, just emit the downstream event with the cid.
      const existing = await this.sourceRepo.getDocumentBySha256(sha256);
      if (existing) {
        return { kind: 'ack' };
      }

      const ft = await fileTypeFromBuffer(buf);
      const mime = (ft?.mime ?? 'application/octet-stream') as Schemas.DocumentMime;
      const kind = this.classifyKind(env.payload.expected_kind ?? 'other');

      // OCR for image / scanned-PDF via shared worker pool. Tesseract runs
      // 'fra+eng' so the model handles bilingual government documents; we
      // then run franc on the extracted text to record the canonical
      // language tag (SRD §14.4 — replaces hard-coded 'fr').
      let ocrEngine: Schemas.DocumentOcrEngine = 'none';
      let ocrConfidence: number | null = null;
      let textChars: number | null = null;
      let detectedText: string | null = null;
      if (mime.startsWith('image/')) {
        try {
          const ocr = await this.ocrPool.recognise(buf);
          ocrEngine = 'tesseract';
          ocrConfidence = ocr.confidence;
          textChars = ocr.text.length;
          detectedText = ocr.text;
        } catch (e) {
          logger.warn({ err: e }, 'tesseract-failed');
        }
      }
      const language = detectLanguage(detectedText, mime);

      // PDF info-dict extraction — populates event.payload.document_metadata
      // for P-G-001 (backdated-document) and P-G-003 (metadata-anomaly).
      let documentMetadata: Record<string, unknown> | null = null;
      let pdfAnomalyFlags: ReadonlyArray<string> = [];
      if (mime === 'application/pdf') {
        try {
          const m = extractPdfMetadata(buf);
          documentMetadata = {
            title: m.title,
            author: m.author,
            subject: m.subject,
            creator: m.creator,
            producer: m.producer,
            creation_date: m.creation_date,
            mod_date: m.mod_date,
            keywords: m.keywords,
            extracted_ok: m.extracted_ok,
          };
          pdfAnomalyFlags = m.anomaly_flags;
        } catch (e) {
          logger.warn({ err: e }, 'pdf-metadata-extraction-failed');
        }
      }

      // IPFS pin
      const kubo = kuboCreate({ url: this.ipfsApiUrl });
      const added = await kubo.add(buf, { pin: true, cidVersion: 1 });
      const cid = added.cid.toString();

      const doc: Schemas.Document = {
        id: Ids.newEventId() as string,
        cid,
        source_id,
        kind,
        mime,
        language,
        bytes: buf.byteLength,
        sha256,
        source_url: document_url,
        fetched_at: new Date().toISOString(),
        ocr_engine: ocrEngine,
        ocr_confidence: ocrConfidence,
        text_extract_chars: textChars,
        pinned_at_ipfs: true,
        mirrored_to_synology: false, // rclone hourly job picks it up
        metadata:
          documentMetadata !== null
            ? { pdf: documentMetadata, anomaly_flags: pdfAnomalyFlags }
            : {},
      };

      await this.sourceRepo.insertDocument({
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
        ocr_confidence: ocrConfidence !== null ? String(ocrConfidence) : null,
        text_extract_chars: textChars,
        pinned_at_ipfs: true,
        mirrored_to_synology: false,
        metadata: doc.metadata,
      });

      // Merge document_metadata + effective_date onto the source event
      // payload so the patterns (P-G-001, P-G-003, P-H-001) read them.
      if (documentMetadata !== null && env.payload.source_event_id) {
        try {
          const additions: Record<string, unknown> = {
            document_metadata: documentMetadata,
            document_anomaly_flags: pdfAnomalyFlags,
          };
          // creation_date doubles as a default effective_date for documents
          // that don't carry an explicit one in their content.
          if (documentMetadata['creation_date']) {
            const cd = documentMetadata['creation_date'] as string;
            const datePart = cd.slice(0, 10); // YYYY-MM-DD
            if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
              additions['effective_date'] = datePart;
            }
          }
          await this.sourceRepo.mergeEventPayload(env.payload.source_event_id, additions);
        } catch (e) {
          logger.warn(
            { err: e, source_event_id: env.payload.source_event_id },
            'merge-document-metadata-failed',
          );
        }
      }

      // DECISION-014c — content-extractor pass. Routes by event kind to
      // surface protest_disposition (P-A-008) for cour-des-comptes
      // audit_observation events and progress_pct (P-D-005) for
      // minepat-bip investment_project events.
      //
      // DECISION-015 — for non-OCR PDFs (text-extractable), pull the
      // text layer directly via extractPdfTextLayer before falling back
      // to "no text available". This closes the gap noted earlier where
      // PDFs with a real text layer were skipped because Tesseract only
      // ran on image MIME types.
      if (detectedText === null && mime === 'application/pdf' && env.payload.source_event_id) {
        try {
          const layerText = extractPdfTextLayer(buf);
          if (layerText !== null && layerText.length > 0) {
            detectedText = layerText;
            textChars = layerText.length;
            ocrEngine = 'pdf-text-layer';
          }
        } catch (e) {
          logger.warn({ err: e }, 'pdf-text-layer-extraction-failed');
        }
      }

      if (detectedText !== null && env.payload.source_event_id) {
        try {
          const ev = await this.sourceRepo.getEventById(env.payload.source_event_id);
          if (ev !== null) {
            const docContent = extractDocContent({
              sourceId: ev.source_id,
              eventKind: ev.kind,
              ocrText: detectedText,
            });
            if (Object.keys(docContent.additions).length > 0) {
              await this.sourceRepo.mergeEventPayload(env.payload.source_event_id, {
                ...docContent.additions,
                _doc_content_provenance: docContent.provenance,
              });
            }
          }
        } catch (e) {
          logger.warn(
            { err: e, source_event_id: env.payload.source_event_id },
            'doc-content-extraction-failed',
          );
        }
      }

      // Downstream — entity resolution + pattern engine
      await this.config.client.publish(
        STREAMS.ENTITY_RESOLVE,
        newEnvelope(
          'worker-document',
          { document_cid: cid, source_event_id: env.payload.source_event_id },
          `${cid}|entity`,
          env.correlation_id,
        ),
      );
      return { kind: 'ack' };
    } catch (e) {
      logger.error({ err: e, url: document_url }, 'doc-fetch-failed');
      return { kind: 'retry', reason: 'fetch-error', delay_ms: 60_000 };
    }
  }

  private classifyKind(hint: string): Schemas.DocumentKind {
    const allowed: ReadonlyArray<Schemas.DocumentKind> = [
      'tender',
      'award',
      'amendment',
      'budget',
      'audit_report',
      'court_judgement',
      'gazette',
      'press_release',
      'company_filing',
      'sanction_list',
      'satellite_imagery',
      'robots',
      'tos',
      'other',
    ];
    return (
      allowed.includes(hint as Schemas.DocumentKind) ? hint : 'other'
    ) as Schemas.DocumentKind;
  }
}

async function main(): Promise<void> {
  await initTracing({ service: 'worker-document' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());

  const scraper = startRedisStreamScraper(queue, {
    streams: [STREAMS.ENTITY_RESOLVE],
    logger,
  });
  registerShutdown('redis-stream-scraper', () => scraper.stop());

  const db = await getDb();
  const pool = await getPool();
  const chain = new HashChain(pool, logger);
  const emit: FeatureFlagAuditEmit = async (event) => {
    await chain.append({
      action: event.action,
      actor: 'worker-document',
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      payload: event.payload,
    });
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-document', emit });

  const sourceRepo = new SourceRepo(db);
  const ipfsApiUrl = process.env.IPFS_API_URL ?? 'http://vigil-ipfs:5001';

  const ocrPool = new OcrPool(Number(process.env.OCR_POOL_SIZE ?? 4));
  await ocrPool.init();
  registerShutdown('ocr-pool', () => ocrPool.close());

  const worker = new DocumentWorker(sourceRepo, ipfsApiUrl, ocrPool, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info('worker-document-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
