import { HashChain } from '@vigil/audit-chain';
import { Neo4jClient } from '@vigil/db-neo4j';
import { EntityRepo, FindingRepo, SourceRepo, getDb, getPool } from '@vigil/db-postgres';
import {
  auditFeatureFlagsAtBoot,
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
  getServiceTracer,
  withSpan,
  type FeatureFlagAuditEmit,
} from '@vigil/observability';
import {
  PatternRegistry,
  dispatchPatterns,
  type PatternContext,
  type SubjectInput,
} from '@vigil/patterns';
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
import { z } from 'zod';

import { registerAllPatterns } from './_register-patterns.js';

const logger = createLogger({ service: 'worker-pattern' });
const tracer = getServiceTracer('worker-pattern');

const zEntitySubject = z.object({
  finding_id: z.string().uuid().optional(),
  subject_kind: z.enum(['Tender', 'Company', 'Person', 'Project', 'Payment']),
  canonical_id: z.string().uuid().nullable(),
  related_ids: z.array(z.string().uuid()).default([]),
  event_ids: z.array(z.string().uuid()).default([]),
});
type Payload = z.infer<typeof zEntitySubject>;

/** Convert a Postgres canonical row to the Schemas.EntityCanonical shape. */
function rowToCanonical(
  row: NonNullable<Awaited<ReturnType<EntityRepo['getCanonical']>>>,
): Schemas.EntityCanonical {
  return {
    id: row.id,
    kind: row.kind as Schemas.EntityCanonical['kind'],
    display_name: row.display_name,
    rccm_number: row.rccm_number,
    niu: row.niu,
    jurisdiction: row.jurisdiction,
    region: row.region as Schemas.EntityCanonical['region'],
    eth_address: row.eth_address as Schemas.EntityCanonical['eth_address'],
    is_pep: row.is_pep,
    is_sanctioned: row.is_sanctioned,
    sanctioned_lists: row.sanctioned_lists,
    first_seen: row.first_seen.toISOString(),
    last_seen: row.last_seen.toISOString(),
    resolution_confidence: row.resolution_confidence,
    resolved_by: row.resolved_by as Schemas.EntityCanonical['resolved_by'],
    // W-19b — propagate the runtime metadata bag the DB already stores.
    // Network/structure fields (roundTripDetected, communityId, tags…)
    // are written by upstream workers (worker-fabric-bridge, Louvain
    // pass, audit-chain backfill); read here without transformation so
    // pattern fixtures match production semantics.
    metadata: (row.metadata as Schemas.EntityCanonical['metadata']) ?? {},
  };
}

function rowToEvent(
  row: Awaited<ReturnType<SourceRepo['getEventsByIds']>>[number],
): Schemas.SourceEvent {
  return {
    id: row.id,
    source_id: row.source_id,
    kind: row.kind as Schemas.SourceEvent['kind'],
    dedup_key: row.dedup_key,
    published_at: row.published_at ? row.published_at.toISOString() : null,
    observed_at: row.observed_at.toISOString(),
    payload: row.payload as Record<string, unknown>,
    document_cids: row.document_cids,
    provenance: row.provenance as Schemas.SourceEvent['provenance'],
  };
}

function rowToFinding(
  row: Awaited<ReturnType<FindingRepo['listByEntity']>>[number],
): Schemas.Finding {
  return {
    id: row.id,
    state: row.state as Schemas.Finding['state'],
    primary_entity_id: row.primary_entity_id,
    related_entity_ids: row.related_entity_ids,
    amount_xaf: row.amount_xaf,
    region: row.region as Schemas.Finding['region'],
    severity: row.severity as Schemas.Finding['severity'],
    posterior: row.posterior,
    signal_count: row.signal_count,
    title_fr: row.title_fr,
    title_en: row.title_en,
    summary_fr: row.summary_fr,
    summary_en: row.summary_en,
    counter_evidence: row.counter_evidence,
    detected_at: row.detected_at.toISOString(),
    last_signal_at: row.last_signal_at.toISOString(),
    council_proposal_index: row.council_proposal_index,
    council_voted_at: row.council_voted_at ? row.council_voted_at.toISOString() : null,
    council_yes_votes: row.council_yes_votes,
    council_no_votes: row.council_no_votes,
    council_recused_addresses: row.council_recused_addresses,
    closed_at: row.closed_at ? row.closed_at.toISOString() : null,
    closure_reason: row.closure_reason,
    // DECISION-010
    recommended_recipient_body:
      row.recommended_recipient_body as Schemas.Finding['recommended_recipient_body'],
    primary_pattern_id: row.primary_pattern_id as Schemas.Finding['primary_pattern_id'],
  };
}

class PatternWorker extends WorkerBase<Payload> {
  constructor(
    private readonly neo4j: Neo4jClient,
    private readonly entityRepo: EntityRepo,
    private readonly sourceRepo: SourceRepo,
    private readonly findingRepo: FindingRepo,
    queue: QueueClient,
  ) {
    super({
      name: 'worker-pattern',
      stream: STREAMS.PATTERN_DETECT,
      schema: zEntitySubject,
      client: queue,
      logger,
      concurrency: 6,
    });
  }

  protected async handle(env: Envelope<Payload>): Promise<HandlerOutcome> {
    return withSpan(
      tracer,
      'worker.pattern.handle',
      {
        'vigil.subject_kind': env.payload.subject_kind,
        'vigil.canonical_id': env.payload.canonical_id ?? undefined,
        'vigil.finding_id': env.payload.finding_id ?? undefined,
        'vigil.event_count': env.payload.event_ids.length,
      },
      () => this.handleInner(env),
    );
  }

  private async handleInner(env: Envelope<Payload>): Promise<HandlerOutcome> {
    const { subject_kind, canonical_id, related_ids, event_ids, finding_id } = env.payload;

    const [canonical, relatedFromHint, events] = await Promise.all([
      canonical_id ? this.loadCanonical(canonical_id) : Promise.resolve(null),
      this.loadCanonicalsMany(related_ids),
      this.loadEvents(event_ids),
    ]);

    // 1-hop graph neighbours via Neo4j (falls back to Postgres relationship table).
    const graphNeighbourIds = canonical_id ? await this.loadGraphNeighbourIds(canonical_id) : [];
    const neighboursById = new Map<string, Schemas.EntityCanonical>();
    for (const r of relatedFromHint) neighboursById.set(r.id, r);
    if (graphNeighbourIds.length > 0) {
      const fetched = await this.entityRepo.getCanonicalMany(graphNeighbourIds);
      for (const row of fetched) {
        const mapped = rowToCanonical(row);
        if (!neighboursById.has(mapped.id)) neighboursById.set(mapped.id, mapped);
      }
    }

    const priorFindings = canonical_id
      ? await this.loadPriorFindings(canonical_id, finding_id)
      : [];

    const subject: SubjectInput = {
      kind: subject_kind,
      canonical,
      related: Array.from(neighboursById.values()),
      events,
      priorFindings,
    };

    const ctx: PatternContext = {
      now: new Date(),
      logger: { info: (m, c) => logger.info(c ?? {}, m), warn: (m, c) => logger.warn(c ?? {}, m) },
      graph: {
        cypher: async <T extends Record<string, unknown>>(q: string, p?: Record<string, unknown>) =>
          this.neo4j.run<T>(q, p ?? {}),
      },
    };

    const findingId = finding_id ?? (Ids.newFindingId() as string);

    // DECISION-014 Stream 3 — pattern dispatch via the hardened wrapper.
    // Provides: no-throw guarantee, per-pattern timeout (default 2000ms),
    // bounded fan-out (8 concurrent), subject-kind gate, status partition
    // (live → results, shadow → shadowResults), provenance stamping
    // (dispatch_timing_ms + dispatch_pattern_status), deterministic ordering,
    // runtime result-shape validation. Failures + shadow results are
    // surfaced for observability without poisoning the live result stream.
    const dispatch = await dispatchPatterns(subject, ctx);
    if (dispatch.failures.length > 0) {
      logger.warn(
        { failures: dispatch.failures, finding_id: findingId },
        'pattern-dispatch-failures',
      );
    }

    // Look up the pattern def (for prior/weight) by id from the registry,
    // since the dispatch annotation strips that field.
    let signalCount = 0;
    for (const result of dispatch.results) {
      if (!result.matched) continue;
      const pat = PatternRegistry.get(result.pattern_id);
      if (!pat) continue; // dispatch ran a pattern not in the registry — impossible in production but defensive
      signalCount++;
      // Persist signal — DB commit BEFORE stream emit (SRD §15.1)
      await this.findingRepo.addSignal({
        id: Ids.newSignalId() as string,
        finding_id: findingId,
        source: 'pattern',
        pattern_id: result.pattern_id,
        strength: result.strength,
        prior: pat.defaultPrior,
        weight: pat.defaultWeight,
        evidence_event_ids: [...result.contributing_event_ids],
        evidence_document_cids: [...result.contributing_document_cids],
        contributed_at: new Date(),
        metadata: {
          rationale: result.rationale,
          dispatch_timing_ms: result.dispatch_timing_ms,
          dispatch_pattern_status: result.dispatch_pattern_status,
        },
      });
    }
    // Shadow-mode patterns are observed but not folded into findings.
    if (dispatch.shadowResults.length > 0) {
      logger.info(
        {
          finding_id: findingId,
          shadow_pattern_ids: dispatch.shadowResults
            .filter((r) => r.matched)
            .map((r) => r.pattern_id),
          shadow_match_count: dispatch.shadowResults.filter((r) => r.matched).length,
        },
        'pattern-shadow-matches',
      );
    }

    if (signalCount > 0) {
      // Trigger scoring
      await this.config.client.publish(
        STREAMS.SCORE_COMPUTE,
        newEnvelope(
          'worker-pattern',
          { finding_id: findingId },
          `${findingId}|score`,
          env.correlation_id,
        ),
      );
    }

    return { kind: 'ack' };
  }

  private async loadCanonical(id: string): Promise<Schemas.EntityCanonical | null> {
    const row = await this.entityRepo.getCanonical(id);
    return row ? rowToCanonical(row) : null;
  }

  private async loadCanonicalsMany(
    ids: readonly string[],
  ): Promise<readonly Schemas.EntityCanonical[]> {
    if (ids.length === 0) return [];
    const rows = await this.entityRepo.getCanonicalMany(ids);
    return rows.map(rowToCanonical);
  }

  private async loadEvents(ids: readonly string[]): Promise<readonly Schemas.SourceEvent[]> {
    if (ids.length === 0) return [];
    const rows = await this.sourceRepo.getEventsByIds(ids);
    return rows.map(rowToEvent);
  }

  /**
   * Neo4j 1-hop neighbour lookup. Per SRD §08, Neo4j is the read-side index
   * for graph queries; Postgres `entity.relationship` is the source of
   * truth and serves as the fallback when Neo4j is degraded.
   */
  private async loadGraphNeighbourIds(canonicalId: string): Promise<readonly string[]> {
    try {
      const rows = await this.neo4j.run<{ id: string }>(
        `MATCH (e:Entity {id: $id})-[r]-(n:Entity)
         WHERE n.id <> $id
         RETURN DISTINCT n.id AS id
         LIMIT 64`,
        { id: canonicalId },
      );
      return rows.map((r) => r.id).filter((s): s is string => typeof s === 'string');
    } catch (err) {
      logger.warn({ err, canonicalId }, 'neo4j-1hop-failed-falling-back-to-postgres');
      const rels = await this.entityRepo.getRelationshipsForCanonical(canonicalId);
      const out = new Set<string>();
      for (const r of rels) {
        if (r.from_canonical_id === canonicalId) out.add(r.to_canonical_id);
        else out.add(r.from_canonical_id);
      }
      return Array.from(out);
    }
  }

  private async loadPriorFindings(
    canonicalId: string,
    excludeFindingId: string | undefined,
  ): Promise<readonly Schemas.Finding[]> {
    const rows = await this.findingRepo.listByEntity(canonicalId, {
      ...(excludeFindingId !== undefined && { excludeFindingId }),
      limit: 25,
    });
    return rows.map(rowToFinding);
  }
}

async function main(): Promise<void> {
  await initTracing({ service: 'worker-pattern' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());

  const scraper = startRedisStreamScraper(queue, {
    streams: [STREAMS.SCORE_COMPUTE],
    logger,
  });
  registerShutdown('redis-stream-scraper', () => scraper.stop());

  const db = await getDb();
  const pool = await getPool();
  const chain = new HashChain(pool, logger);
  const emit: FeatureFlagAuditEmit = async (event) => {
    await chain.append({
      action: event.action,
      actor: 'worker-pattern',
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      payload: event.payload,
    });
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-pattern', emit });

  const findingRepo = new FindingRepo(db);
  const entityRepo = new EntityRepo(db);
  const sourceRepo = new SourceRepo(db);
  const neo4j = await Neo4jClient.connect();
  registerShutdown('neo4j', () => neo4j.close());

  registerAllPatterns(); // imports every pattern file → registry populated
  logger.info({ patterns: PatternRegistry.count() }, 'patterns-registered');

  const worker = new PatternWorker(neo4j, entityRepo, sourceRepo, findingRepo, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info('worker-pattern-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
