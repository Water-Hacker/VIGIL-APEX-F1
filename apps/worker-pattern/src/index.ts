import { Neo4jClient } from '@vigil/db-neo4j';
import { FindingRepo, getDb } from '@vigil/db-postgres';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';
import {
  PatternRegistry,
  type PatternContext,
  type SubjectInput,
} from '@vigil/patterns';
import {
  QueueClient,
  STREAMS,
  WorkerBase,
  newEnvelope,
  type Envelope,
  type HandlerOutcome,
} from '@vigil/queue';
import { Ids, Schemas } from '@vigil/shared';
import { z } from 'zod';

import { registerAllPatterns } from './_register-patterns.js';

const logger = createLogger({ service: 'worker-pattern' });

const zEntitySubject = z.object({
  finding_id: z.string().uuid().optional(),
  subject_kind: z.enum(['Tender', 'Company', 'Person', 'Project', 'Payment']),
  canonical_id: z.string().uuid().nullable(),
  related_ids: z.array(z.string().uuid()).default([]),
  event_ids: z.array(z.string().uuid()).default([]),
});
type Payload = z.infer<typeof zEntitySubject>;

class PatternWorker extends WorkerBase<Payload> {
  constructor(
    private readonly neo4j: Neo4jClient,
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
    const { subject_kind, canonical_id, related_ids, event_ids } = env.payload;

    // Load subject — production uses repos; this is the lean path
    const subject: SubjectInput = {
      kind: subject_kind,
      canonical: canonical_id ? await this.loadCanonical(canonical_id) : null,
      related: await this.loadRelated(related_ids),
      events: await this.loadEvents(event_ids),
      priorFindings: [],
    };

    const ctx: PatternContext = {
      now: new Date(),
      logger: { info: (m, c) => logger.info(c ?? {}, m), warn: (m, c) => logger.warn(c ?? {}, m) },
      graph: {
        cypher: async <T extends Record<string, unknown>>(q: string, p?: Record<string, unknown>) =>
          this.neo4j.run<T>(q, p ?? {}),
      },
    };

    const applicable = PatternRegistry.applicable(subject);
    const findingId = env.payload.finding_id ?? (Ids.newFindingId() as string);

    let signalCount = 0;
    for (const pat of applicable) {
      const result = await pat.detect(subject, ctx);
      if (!result.matched) continue;
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
        metadata: { rationale: result.rationale },
      });
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

  private async loadCanonical(_id: string): Promise<Schemas.EntityCanonical | null> {
    // Real impl: SELECT FROM entity.canonical. Phase-1 stub returns null —
    // worker-entity sets this during ER and only then enqueues PATTERN_DETECT.
    return null;
  }

  private async loadRelated(_ids: string[]): Promise<readonly Schemas.EntityCanonical[]> {
    return [];
  }

  private async loadEvents(_ids: string[]): Promise<readonly Schemas.SourceEvent[]> {
    return [];
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

  const db = await getDb();
  const findingRepo = new FindingRepo(db);
  const neo4j = await Neo4jClient.connect();
  registerShutdown('neo4j', () => neo4j.close());

  registerAllPatterns(); // imports every pattern file → registry populated
  logger.info({ patterns: PatternRegistry.count() }, 'patterns-registered');

  const worker = new PatternWorker(neo4j, findingRepo, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info('worker-pattern-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
