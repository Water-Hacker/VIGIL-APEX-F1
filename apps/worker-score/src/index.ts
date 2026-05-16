import path from 'node:path';

import { HashChain } from '@vigil/audit-chain';
import {
  ENGINE_VERSION,
  IndependenceLookup,
  LikelihoodRatioLookup,
  assessFinding,
  loadRegistries,
  type RawSignal,
} from '@vigil/certainty-engine';
import { CertaintyRepo, FindingRepo, getDb, getPool } from '@vigil/db-postgres';
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
import { bayesianPosterior, type BayesianSignal } from '@vigil/patterns';
import {
  QueueClient,
  STREAMS,
  WorkerBase,
  newEnvelope,
  startRedisStreamScraper,
  type Envelope,
  type HandlerOutcome,
} from '@vigil/queue';
import { Constants, Routing } from '@vigil/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

const logger = createLogger({ service: 'worker-score' });

const zPayload = z.object({ finding_id: z.string().uuid() });
type Payload = z.infer<typeof zPayload>;

class ScoreWorker extends WorkerBase<Payload> {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly db: any,
    private readonly findingRepo: FindingRepo,
    private readonly certaintyRepo: CertaintyRepo,
    private readonly likelihoodRatios: LikelihoodRatioLookup,
    private readonly independence: IndependenceLookup,
    queue: QueueClient,
  ) {
    super({
      name: 'worker-score',
      stream: STREAMS.SCORE_COMPUTE,
      schema: zPayload,
      client: queue,
      logger,
      concurrency: 4,
    });
  }

  protected async handle(env: Envelope<Payload>): Promise<HandlerOutcome> {
    const { finding_id } = env.payload;
    // Block-A reconciliation §2.A.6 — filter backdated/future-timed
    // signals. `contributed_at` defaults to NOW() at insert time, but
    // a misbehaving adapter (or a code path that overrides the
    // default) can write a future timestamp. Without the bound below,
    // the certainty engine accepts the future-timed row as evidence
    // and trips the posterior. Rows with `contributed_at > NOW()` are
    // never legitimate; drop them at read time.
    const r = await this.db.execute(sql`
      SELECT id, pattern_id, source, prior, strength, weight, evidence_event_ids, evidence_document_cids, metadata
        FROM finding.signal
       WHERE finding_id = ${finding_id}
         AND contributed_at <= NOW()
    `);
    type Row = {
      id: string;
      pattern_id: string | null;
      source: string;
      prior: number | string;
      strength: number | string;
      weight: number | string;
      evidence_event_ids: string[];
      evidence_document_cids: string[];
      metadata: Record<string, unknown> | null;
    };
    const rows = r.rows as Row[];
    if (rows.length === 0) return { kind: 'ack' };

    const signals: BayesianSignal[] = rows.map((row) => ({
      pattern_id: row.pattern_id,
      prior: Number(row.prior),
      strength: Number(row.strength),
      weight: Number(row.weight),
    }));

    // Legacy single-pattern Bayesian aggregator — retained as a sanity
    // cross-check; the canonical posterior comes from the certainty engine.
    const legacyPosterior = bayesianPosterior(signals, {
      correlationDamping: 0.5,
      correlatedPairs: [
        ['P-B-001', 'P-F-002'],
        ['P-A-001', 'P-H-001'],
      ],
    });
    void legacyPosterior;

    // DECISION-011 — hand off to the Bayesian certainty engine. Each row's
    // `source` is the originating source_id ('armp-main', 'rccm-search'…)
    // for non-pattern signals; for pattern signals the source is the
    // adapter that produced the strongest contributing event, looked up
    // by the first evidence_event_id.
    const provenanceBySource = await this.lookupProvenance(rows);
    const rawSignals: RawSignal[] = rows.map((row) => {
      const sourceId = mapSourceId(row);
      const roots = provenanceBySource.get(row.id) ?? (sourceId !== null ? [sourceId] : []);
      const fallbackRoots = roots.length > 0 ? roots : [sourceId ?? `signal:${row.id}`];
      return {
        evidence_id: `signal:${row.id}`,
        pattern_id: row.pattern_id,
        source_id: sourceId,
        strength: Math.max(0, Math.min(1, Number(row.strength))),
        provenance_roots: fallbackRoots,
        verbatim_quote: extractVerbatim(row.metadata) ?? null,
        rationale: extractRationale(row.metadata) ?? '',
      };
    });

    const finding = await this.findingRepo.getById(finding_id);
    const severity = (finding?.severity ?? 'low') as 'low' | 'medium' | 'high' | 'critical';
    const promptRegistryHash = process.env.VIGIL_PROMPT_REGISTRY_HASH ?? 'unknown';
    const modelVersion = process.env.VIGIL_LLM_PINNED_MODEL ?? 'claude-opus-4-7';

    // The adversarial pipeline (devil's advocate, secondary review, order
    // randomisation) requires Claude calls; in the worker-score baseline
    // we run the deterministic-only assessment + counterfactual probe.
    // The full adversarial pipeline runs in worker-counter-evidence
    // before action_queue dispatch.
    const out = assessFinding({
      findingId: finding_id,
      signals: rawSignals,
      severity,
      modelVersion,
      promptRegistryHash,
      likelihoodRatios: this.likelihoodRatios,
      independence: this.independence,
    });
    await this.certaintyRepo.upsertAssessment({
      id: out.assessment.id,
      finding_id: out.assessment.finding_id,
      engine_version: out.assessment.engine_version,
      prior_probability: out.assessment.prior_probability.toString(),
      posterior_probability: out.assessment.posterior_probability.toString(),
      independent_source_count: out.assessment.independent_source_count,
      tier: out.assessment.tier,
      hold_reasons: [...out.assessment.hold_reasons],
      adversarial: out.assessment.adversarial,
      components: out.assessment.components,
      severity: out.assessment.severity,
      input_hash: out.assessment.input_hash,
      prompt_registry_hash: out.assessment.prompt_registry_hash,
      model_version: out.assessment.model_version,
      computed_at: new Date(out.assessment.computed_at),
    });

    await this.findingRepo.setPosterior(finding_id, out.assessment.posterior_probability);
    logger.info(
      {
        finding_id,
        engine_version: ENGINE_VERSION,
        posterior: out.assessment.posterior_probability,
        independent_source_count: out.assessment.independent_source_count,
        tier: out.tier,
        hold_reasons: out.holdReasons,
      },
      'certainty-assessment',
    );

    // 3-tier dispatch (AI-SAFETY-DOCTRINE-v1 §2.3).
    if (out.tier === 'action_queue') {
      await this.findingRepo.setState(finding_id, 'review');
      // Counter-evidence + adversarial verification before any council exposure.
      await this.config.client.publish(
        STREAMS.COUNTER_EVIDENCE,
        newEnvelope(
          'worker-score',
          { finding_id, assessment_id: out.assessment.id },
          `${finding_id}|counter`,
          env.correlation_id,
        ),
      );
    } else if (out.tier === 'investigation_queue') {
      await this.findingRepo.setState(finding_id, 'review');
    }
    // log_only — no state change, no downstream publish.

    // DECISION-010 recommendation pre-population (operator UI default
    // before the council vote opens).
    if (out.assessment.posterior_probability >= Constants.POSTERIOR_REVIEW_THRESHOLD) {
      const strongest = signals
        .filter((s) => s.pattern_id !== null)
        .sort((a, b) => b.strength * b.weight - a.strength * a.weight)[0];
      const primaryPatternId = strongest?.pattern_id ?? null;
      const parsed = primaryPatternId !== null ? Routing.parsePatternId(primaryPatternId) : null;
      const recommended = Routing.recommendRecipientBody({
        patternCategory: parsed?.category ?? 'A',
        severity,
      });
      await this.findingRepo.setRecommendedRecipientBody(finding_id, recommended, primaryPatternId);
    }
    return { kind: 'ack' };
  }

  /** Walks the signal's evidence_event_ids back to the originating source
   *  events — the primary-source roots that drive the 5-source minimum
   *  rule. Returns a map from signal_id → roots[].
   *
   *  Block-A reconciliation §2.A.6 — the previous implementation
   *  built and executed an `IN (...)` query with manual placeholders,
   *  immediately discarded the result with `void r`, then ran the
   *  same lookup via `= ANY($1::uuid[])`. Two round-trips, only the
   *  second was used. The dead query is removed; only the
   *  parameter-array form remains. */
  private async lookupProvenance(
    rows: ReadonlyArray<{ id: string; evidence_event_ids: string[] }>,
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (rows.length === 0) return map;
    const allEventIds = new Set<string>();
    for (const r of rows) for (const e of r.evidence_event_ids) allEventIds.add(e);
    if (allEventIds.size === 0) return map;
    const ids = Array.from(allEventIds);
    const r = await this.db.execute(
      sql`SELECT id, source_id FROM source.events WHERE id = ANY(${ids}::uuid[])`,
    );
    type EventRow = { id: string; source_id: string };
    const eventRows = r.rows as EventRow[];
    const eventToSource = new Map<string, string>();
    for (const er of eventRows) eventToSource.set(er.id, er.source_id);
    for (const row of rows) {
      const roots = new Set<string>();
      for (const eid of row.evidence_event_ids) {
        const s = eventToSource.get(eid);
        if (s) roots.add(s);
      }
      if (roots.size > 0) map.set(row.id, Array.from(roots));
    }
    return map;
  }
}

function mapSourceId(row: {
  pattern_id: string | null;
  source: string;
  metadata: Record<string, unknown> | null;
}): string | null {
  // For non-pattern signals (tip / satellite / corroboration / manual) we
  // treat the signal source as the source id.
  if (row.pattern_id === null) return row.source;
  // For pattern signals, use the adapter id stored in metadata if present;
  // otherwise leave null and rely on provenance lookup via evidence events.
  const adapter = row.metadata?.['adapter_id'];
  return typeof adapter === 'string' ? adapter : null;
}

function extractVerbatim(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const v = metadata['verbatim_quote'];
  return typeof v === 'string' ? v : null;
}

function extractRationale(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const v = metadata['rationale'];
  return typeof v === 'string' ? v : null;
}

async function main(): Promise<void> {
  await initTracing({ service: 'worker-score' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());

  const scraper = startRedisStreamScraper(queue, {
    streams: [STREAMS.COUNTER_EVIDENCE],
    logger,
  });
  registerShutdown('redis-stream-scraper', () => scraper.stop());

  const db = await getDb();
  const pool = await getPool();
  const chain = new HashChain(pool, logger);
  const emit: FeatureFlagAuditEmit = async (event) => {
    await chain.append({
      action: event.action,
      actor: 'worker-score',
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      payload: event.payload,
    });
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-score', emit });

  const findingRepo = new FindingRepo(db);
  const certaintyRepo = new CertaintyRepo(db);

  const registryDir =
    process.env.VIGIL_CERTAINTY_REGISTRY_DIR ?? path.resolve(process.cwd(), 'infra', 'certainty');
  const registries = await loadRegistries(registryDir);
  const lr = new LikelihoodRatioLookup(registries.likelihoodRatios);
  const indep = new IndependenceLookup(registries.independence);
  logger.info(
    {
      registryDir,
      lrVersion: registries.likelihoodRatios.version,
      indepVersion: registries.independence.version,
      patternCount: registries.likelihoodRatios.ratios.length,
    },
    'certainty-registries-loaded',
  );

  const worker = new ScoreWorker(db, findingRepo, certaintyRepo, lr, indep, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info('worker-score-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
