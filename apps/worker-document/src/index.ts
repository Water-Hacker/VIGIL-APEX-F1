import { createHash } from 'node:crypto';

import { SourceRepo, getDb } from '@vigil/db-postgres';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';
import {
  QueueClient,
  STREAMS,
  WorkerBase,
  newEnvelope,
  type Envelope,
  type HandlerOutcome,
} from '@vigil/queue';
import { Ids, Schemas } from '@vigil/shared';
import { create as kuboCreate } from 'kubo-rpc-client';
import { fileTypeFromBuffer } from 'file-type';
import { franc } from 'franc';
import { request } from 'undici';
import { z } from 'zod';

import { OcrPool } from './ocr-pool.js';

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
        metadata: {},
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
        metadata: {},
      });

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
    return (allowed.includes(hint as Schemas.DocumentKind) ? hint : 'other') as Schemas.DocumentKind;
  }
}

/**
 * Map an ISO-639-3 code (franc output) to the DocumentLanguage enum
 * stored in `source.documents.language`. Cameroon's primary language is
 * French; Fulfulde and Ewondo are recognised as `unknown` until Phase 2
 * Pulaar/Ewondo adapters land. `und` (undetermined) defaults to French
 * for procurement-flow docs but to `unknown` for structured payloads.
 */
function detectLanguage(text: string | null, mime: Schemas.DocumentMime): Schemas.DocumentLanguage {
  if (mime === 'application/json' || mime === 'application/xml') return 'unknown';
  if (!text || text.trim().length < 24) {
    // Too little text to detect — fall back to FR (Cameroonian default).
    return 'fr';
  }
  const code = franc(text, { minLength: 24 });
  switch (code) {
    case 'fra':
      return 'fr';
    case 'eng':
      return 'en';
    case 'ful': // Fulfulde — Cameroon Adamawa region
    case 'ewo': // Ewondo — Centre / South region
      return 'unknown';
    default:
      return 'fr';
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

  const db = await getDb();
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
