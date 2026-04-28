import { Neo4jClient, Cypher } from '@vigil/db-neo4j';
import { getDb } from '@vigil/db-postgres';
import { LlmRouter } from '@vigil/llm';
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
import { VaultClient } from '@vigil/security';
import { Ids } from '@vigil/shared';
import { z } from 'zod';

const logger = createLogger({ service: 'worker-entity' });

const zPayload = z.object({
  document_cid: z.string().optional(),
  source_event_id: z.string().uuid().optional(),
  raw_aliases: z.array(z.string()).max(50).optional(),
});
type Payload = z.infer<typeof zPayload>;

/**
 * Resolution strategy:
 *   1. Rule-pass: deterministic deduplication (RCCM number, exact-match name, NIU)
 *   2. LLM-pass: for ambiguous candidates, ask Haiku 4.5 to merge or split
 *   3. Review queue: pairs in 0.70-0.92 similarity band → er_review_queue
 *
 * Per SRD §15.5.1.
 */

const ER_SYSTEM = `
You disambiguate Cameroonian person and company aliases across French and English.
You receive a list of name strings; output their canonical clusters with a confidence score.

Output JSON shape:
{
  "clusters": [
    {"canonical": "<best canonical name>", "aliases": ["<alias1>", "..."], "kind": "person|company|public_body", "confidence": 0.0..1.0}
  ]
}

Rules:
- Treat 'Jean-Paul MBARGA', 'J.P. Mbarga', 'Mbarga J.' as the same person if context permits.
- Companies with identical RCCM numbers are the same company; otherwise treat them as distinct.
- Confidence < 0.70 → output as separate single-element clusters (let the review queue handle it).
- If you cannot disambiguate, return {"status":"insufficient_evidence","reason":"..."}.
`.trim();

const zErResp = z.object({
  clusters: z.array(
    z.object({
      canonical: z.string().min(1),
      aliases: z.array(z.string()).min(1).max(50),
      kind: z.enum(['person', 'company', 'public_body']),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

class EntityWorker extends WorkerBase<Payload> {
  constructor(
    private readonly neo4j: Neo4jClient,
    private readonly llm: LlmRouter,
    queue: QueueClient,
  ) {
    super({
      name: 'worker-entity',
      stream: STREAMS.ENTITY_RESOLVE,
      schema: zPayload,
      client: queue,
      logger,
      concurrency: 4,
    });
  }

  protected async handle(env: Envelope<Payload>): Promise<HandlerOutcome> {
    const aliases = env.payload.raw_aliases ?? [];
    if (aliases.length === 0) return { kind: 'ack' };

    try {
      const r = await this.llm.call<z.infer<typeof zErResp>>({
        task: 'entity_resolution',
        modelClassOverride: 'haiku',
        system: ER_SYSTEM,
        user: `Aliases:\n${aliases.map((a, i) => `${i + 1}. ${a}`).join('\n')}`,
        responseSchema: zErResp,
        maxTokens: 2000,
        ...(env.correlation_id && { correlationId: env.correlation_id }),
      });

      // For each cluster, upsert canonical + aliases in Neo4j
      for (const cluster of r.content.clusters) {
        const id = Ids.newEntityId() as string;
        await this.neo4j.run(Cypher.upsertEntity, {
          id,
          props: {
            display_name: cluster.canonical,
            kind: cluster.kind,
            resolution_confidence: cluster.confidence,
            resolved_by: 'llm',
          },
        });
        for (const alias of cluster.aliases) {
          await this.neo4j.run(Cypher.addAlias, {
            entity_id: id,
            alias,
            source_id: env.payload.source_event_id ?? 'unknown',
            language: /[éèêà]/.test(alias) ? 'fr' : 'en',
            first_seen: new Date().toISOString(),
          });
        }
      }
      return { kind: 'ack' };
    } catch (e) {
      logger.error({ err: e }, 'er-failed');
      return { kind: 'retry', reason: 'llm-error', delay_ms: 30_000 };
    } finally {
      // Trigger pattern detection downstream
      await this.config.client.publish(
        STREAMS.PATTERN_DETECT,
        newEnvelope(
          'worker-entity',
          { subject_kind: 'Tender', canonical_id: null, related_ids: [], event_ids: [] },
          `${env.id}|pattern`,
          env.correlation_id,
        ),
      );
    }
  }
}

async function main(): Promise<void> {
  await initTracing({ service: 'worker-entity' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());
  const neo4j = await Neo4jClient.connect();
  registerShutdown('neo4j', () => neo4j.close());
  await neo4j.bootstrapSchema();

  const vault = await VaultClient.connect();
  registerShutdown('vault', () => vault.close());
  const apiKey = await vault.read<string>('anthropic', 'api_key');
  const llm = new LlmRouter({ anthropicApiKey: apiKey });

  // Touch the postgres pool for warm health
  await getDb();

  const worker = new EntityWorker(neo4j, llm, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info('worker-entity-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
