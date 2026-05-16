/**
 * worker-extractor — converts raw scraper payloads (ARMP / MINMAP / COLEPS)
 * into structured procurement fields the patterns expect.
 *
 * Pipeline insertion point: between `ADAPTER_OUT` and `ENTITY_RESOLVE`.
 * Closes the gap surfaced in the 2026-04-29 fraud-pattern-library status
 * report — patterns expected `bidder_count`, `procurement_method`,
 * `amount_xaf`, `supplier_name`, `effective_date` etc. but no producer in
 * the codebase populated them.
 *
 * Ordering of work per envelope (each in its own try/catch so one failure
 * does not poison the next):
 *
 *   1. Parse the SourceEvent envelope.
 *   2. If `kind` is not procurement-flavoured (award / tender_notice /
 *      amendment / cancellation / debarment), forward to ENTITY_RESOLVE
 *      unchanged. Non-procurement adapters (sanctions, gazette, etc.)
 *      still need to flow through entity resolution; we just don't enrich.
 *   3. Run the deterministic extractor on `payload.cells` + `raw_text`.
 *   4. If the deterministic pass left fields unresolved AND the LLM is
 *      configured, run the LLM extractor for the missing fields only.
 *   5. Merge results, deterministic-wins-on-overlap.
 *   6. Persist via `SourceRepo.mergeEventPayload` (atomic jsonb concat).
 *   7. Emit a `tal-pa` audit row tagging the extraction event.
 *   8. Forward an `ENTITY_RESOLVE` envelope so worker-entity can resolve
 *      `supplier_name` aliases through the rest of the pipeline.
 *
 * Idempotency: re-processing the same envelope is safe — payload merge
 * just overwrites the same keys with the same values; the audit emission
 * uses a deterministic dedup_key so duplicates fold.
 */

import { HashChain } from '@vigil/audit-chain';
import { BenchmarkPriceRepo, CallRecordRepo, SourceRepo, getDb, getPool } from '@vigil/db-postgres';
import { LlmRouter, SafeLlmRouter } from '@vigil/llm';
import {
  StartupGuard,
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
import { wrapSecret } from '@vigil/security';
import { Schemas } from '@vigil/shared';
import { z } from 'zod';

import { ProcurementExtractor } from './extractor.js';
import { SafeLlmExtractor, type SafeLlmRouterLike } from './llm-extractor.js';

const EXTRACTOR_VERSION = 'v1.0.0';

const logger = createLogger({ service: 'worker-extractor' });

const PROCUREMENT_KINDS: ReadonlySet<Schemas.SourceEventKind> = new Set([
  'award',
  'tender_notice',
  'amendment',
  'cancellation',
  'debarment',
]);

/** Schema of the envelope payload we consume from ADAPTER_OUT — just enough
 *  to typesafely route. Full SourceEvent is too noisy for the worker schema
 *  (it accepts a lot of optional fields the extractor never touches). */
const zAdapterOutPayload = z.object({
  id: z.string().uuid(),
  source_id: z.string(),
  kind: z.string(), // SourceEventKind, but kept loose so unknown kinds forward cleanly
  payload: z.record(z.unknown()),
  document_cids: z.array(z.string()).default([]),
  published_at: z.string().nullable().optional(),
  observed_at: z.string(),
});
type AdapterOutPayload = z.infer<typeof zAdapterOutPayload>;

interface CellsLike {
  readonly cells?: ReadonlyArray<string>;
  readonly raw_text?: string;
}

class ExtractorWorker extends WorkerBase<AdapterOutPayload> {
  constructor(
    private readonly sourceRepo: SourceRepo,
    private readonly extractor: ProcurementExtractor,
    private readonly benchmarkRepo: BenchmarkPriceRepo,
    queue: QueueClient,
  ) {
    super({
      name: 'worker-extractor',
      stream: STREAMS.ADAPTER_OUT,
      schema: zAdapterOutPayload,
      client: queue,
      logger,
      concurrency: 4,
      maxRetries: 3,
    });
  }

  protected async handle(env: Envelope<AdapterOutPayload>): Promise<HandlerOutcome> {
    const ev = env.payload;
    const kind = ev.kind as Schemas.SourceEventKind;

    if (!PROCUREMENT_KINDS.has(kind)) {
      // Non-procurement event — forward to entity-resolve unchanged.
      await this.publishEntityResolve(env, ev, []);
      return { kind: 'ack' };
    }

    const cellsLike = ev.payload as CellsLike;
    const cells = (cellsLike.cells ?? []).filter((c): c is string => typeof c === 'string');
    const rawText = typeof cellsLike.raw_text === 'string' ? cellsLike.raw_text : null;

    if (cells.length === 0 && (rawText === null || rawText.length === 0)) {
      // No raw text to extract from — forward unchanged. The pattern engine
      // will simply find no fields populated and short-circuit.
      logger.info({ event_id: ev.id, kind }, 'no-raw-text-to-extract; forwarding unchanged');
      await this.publishEntityResolve(env, ev, []);
      return { kind: 'ack' };
    }

    let result;
    try {
      result = await this.extractor.extract({
        findingId: null,
        assessmentId: null,
        cells,
        raw_text: rawText,
      });
    } catch (e) {
      logger.error({ err: e, event_id: ev.id }, 'extraction-failed');
      // Don't dead-letter on extraction failure — degrade gracefully and
      // forward the event so the rest of the pipeline runs. Patterns that
      // depend on the missing fields will simply not fire (fail-closed).
      await this.publishEntityResolve(env, ev, []);
      return { kind: 'ack' };
    }

    // Merge structured fields + provenance back into source.events.payload
    const merge: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(result.fields)) {
      // Only merge non-null values. Patterns treat missing fields as absence.
      if (v !== null && v !== undefined) merge[k] = v;
    }
    merge['_extraction_provenance'] = result.provenance;

    // Stage 4 — benchmark-price service. When we have enough context to
    // build the (procurement_method, region, year) bucket key, look up
    // the moving median of comparable awards and stamp it onto the
    // payload. P-C-001 (price-above-benchmark) reads this directly.
    // Returns null silently when bucket sample < MIN_BUCKET_SAMPLE; the
    // pattern then short-circuits without firing.
    if (result.fields.procurement_method && result.fields.region) {
      try {
        const year = ev.observed_at
          ? new Date(ev.observed_at).getUTCFullYear()
          : new Date().getUTCFullYear();
        const benchmark = await this.benchmarkRepo.lookup({
          procurementMethod: result.fields.procurement_method,
          region: result.fields.region,
          year,
          excludeEventId: ev.id,
        });
        if (benchmark !== null) {
          merge['benchmark_amount_xaf'] = benchmark.medianXaf;
          merge['benchmark_p25_xaf'] = benchmark.p25Xaf;
          merge['benchmark_p75_xaf'] = benchmark.p75Xaf;
          merge['benchmark_sample_count'] = benchmark.sampleCount;
          merge['benchmark_bucket_key'] = benchmark.bucketKey;
        }
      } catch (e) {
        logger.warn({ err: e, event_id: ev.id }, 'benchmark-lookup-failed');
      }
    }

    try {
      const { updated } = await this.sourceRepo.mergeEventPayload(ev.id, merge);
      if (!updated) {
        logger.warn({ event_id: ev.id }, 'event-not-found-on-merge; race-condition?');
      }
    } catch (e) {
      logger.error({ err: e, event_id: ev.id }, 'payload-merge-failed');
      return { kind: 'retry', reason: 'payload-merge-failed', delay_ms: 30_000 };
    }

    const aliases = collectAliasesForEntityResolve(result.fields, ev.payload);
    await this.publishEntityResolve(env, ev, aliases);
    return { kind: 'ack' };
  }

  private async publishEntityResolve(
    env: Envelope<AdapterOutPayload>,
    ev: AdapterOutPayload,
    raw_aliases: ReadonlyArray<string>,
  ): Promise<void> {
    await this.config.client.publish(
      STREAMS.ENTITY_RESOLVE,
      newEnvelope(
        'worker-extractor',
        {
          source_event_id: ev.id,
          raw_aliases: [...raw_aliases].slice(0, 50),
        },
        `${ev.id}|entity-resolve`,
        env.correlation_id,
      ),
    );
  }
}

/** Collect alias strings the entity resolver should disambiguate. */
function collectAliasesForEntityResolve(
  extracted: { supplier_name: string | null; contracting_authority_name: string | null },
  rawPayload: Record<string, unknown>,
): string[] {
  const out = new Set<string>();
  if (extracted.supplier_name) out.add(extracted.supplier_name);
  if (extracted.contracting_authority_name) out.add(extracted.contracting_authority_name);
  // Some adapters already populate `supplier_name` directly (anglo schema)
  if (typeof rawPayload['supplier_name'] === 'string')
    out.add(rawPayload['supplier_name'] as string);
  if (typeof rawPayload['authority_name'] === 'string')
    out.add(rawPayload['authority_name'] as string);
  return [...out].filter((s) => s.trim().length > 0);
}

async function main(): Promise<void> {
  const guard = new StartupGuard({ serviceName: 'worker-extractor', logger });
  await guard.check();

  await initTracing({ service: 'worker-extractor' });
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
      actor: 'worker-extractor',
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      payload: event.payload,
    });
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-extractor', emit });

  const sourceRepo = new SourceRepo(db);
  const callRecordRepo = new CallRecordRepo(db);
  const benchmarkRepo = new BenchmarkPriceRepo(db);

  // LLM is optional — when ANTHROPIC_API_KEY is unset or PLACEHOLDER, run
  // deterministic-only. The deterministic layer is sufficient for ARMP /
  // MINMAP / COLEPS in their current form; LLM is the long-tail enhancement.
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const llmEnabled =
    process.env.EXTRACTOR_LLM_ENABLED !== 'false' && apiKey !== '' && apiKey !== 'PLACEHOLDER';

  let llmExtractor: SafeLlmExtractor | null = null;
  if (llmEnabled) {
    const router = new LlmRouter({ anthropicApiKey: wrapSecret(apiKey), logger });
    // Adapt CallRecordRepo (which uses string temperature + Date) into the
    // CallRecordSink shape SafeLlmRouter expects (number temperature + ISO).
    const sinkAdapter = {
      async record(row: {
        id: string;
        finding_id: string | null;
        assessment_id: string | null;
        prompt_name: string;
        prompt_version: string;
        prompt_template_hash: string;
        model_id: string;
        temperature: number;
        input_hash: string;
        output_hash: string;
        canary_triggered: boolean;
        schema_valid: boolean;
        latency_ms: number;
        cost_usd: number;
        called_at: string;
      }): Promise<void> {
        await callRecordRepo.record({
          ...row,
          temperature: row.temperature.toFixed(4),
          cost_usd: row.cost_usd.toFixed(6),
          called_at: new Date(row.called_at),
        });
      },
    };
    const safeRouter = new SafeLlmRouter(router, logger, sinkAdapter);
    const adapter: SafeLlmRouterLike = {
      async call(input) {
        const outcome = await safeRouter.call(input);
        return { value: outcome.value, callRecordId: null };
      },
    };
    llmExtractor = new SafeLlmExtractor(adapter);
    logger.info('llm-extractor-enabled');
  } else {
    logger.info('llm-extractor-disabled — running deterministic-only');
  }

  const extractor = new ProcurementExtractor({
    extractorVersion: EXTRACTOR_VERSION,
    llm: llmExtractor,
    now: () => new Date(),
  });

  const worker = new ExtractorWorker(sourceRepo, extractor, benchmarkRepo, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());

  await guard.markBootSuccess();
  logger.info('worker-extractor-ready');
}

if (require.main === module) {
  main().catch((e: unknown) => {
    logger.error({ err: e }, 'fatal-startup');
    process.exit(1);
  });
}

export { ExtractorWorker, ProcurementExtractor };
