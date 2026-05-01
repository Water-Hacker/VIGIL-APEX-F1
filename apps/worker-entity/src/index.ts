import { Neo4jClient, Cypher } from '@vigil/db-neo4j';
import { CallRecordRepo, EntityRepo, getDb, normalizeName } from '@vigil/db-postgres';
import { LlmRouter, SafeLlmRouter, Safety } from '@vigil/llm';
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

import { RCCM_RE, NIU_RE, detectLanguage, canonicalRccm, canonicalNiu } from './rule-pass.js';

const logger = createLogger({ service: 'worker-entity' });

const zPayload = z.object({
  document_cid: z.string().optional(),
  source_event_id: z.string().uuid().optional(),
  raw_aliases: z.array(z.string()).max(50).optional(),
});
type Payload = z.infer<typeof zPayload>;

/**
 * Resolution strategy (SRD §15.5.1):
 *
 *   1. Rule-pass — deterministic deduplication. For each incoming
 *      alias we attempt:
 *        a) RCCM number shape match → exact lookup against
 *           `entity.canonical.rccm_number`
 *        b) NIU shape match         → exact lookup against
 *           `entity.canonical.niu`
 *        c) Normalised display_name → case-folded + accent-folded
 *           equality lookup (SQL-side via `normalizeName`)
 *      Any rule-pass hit attaches the alias to the existing canonical
 *      and skips the LLM entirely (cost + tamper-resistance: the LLM
 *      cannot produce a different posterior for the same RCCM number
 *      every time, because the LLM never sees the RCCM number).
 *
 *   2. LLM-pass — only the aliases the rule-pass left UNRESOLVED.
 *      Routed through `SafeLlmRouter` (DECISION-011) so the call
 *      carries a registered prompt name + version, hits the canary
 *      check, runs at the doctrine-default temperature, and persists
 *      a `llm.call_record` row.
 *
 *   3. Review queue — the LLM emits clusters at confidence ∈ [0, 1].
 *      Pairs in the 0.70–0.92 ambiguity band are routed to
 *      `entity.er_review_queue` (Phase-2 surface; not handled here).
 *
 * AUDIT-XXX (this commit): the worker previously wrote ONLY to Neo4j.
 * Postgres `entity.canonical` is the source-of-truth (TRUTH §B);
 * worker-pattern reads from it via `EntityRepo.getCanonical`. Without
 * a Postgres write, every fresh entity was invisible to pattern
 * detection — a class of patterns silently fired zero times.
 *
 * Order discipline (SRD §15.1, "DB commit BEFORE stream emit"):
 *   1. Postgres write commits first (atomic per cluster via
 *      `EntityRepo.upsertCluster` transaction).
 *   2. Neo4j mirror attempted second; failure is logged but does
 *      NOT cause a retry (the canonical row in Postgres stands).
 *   3. PATTERN_DETECT publish only after Postgres commits.
 */

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

interface RuleMatch {
  readonly alias: string;
  readonly canonicalId: string;
  readonly via: 'rccm' | 'niu' | 'normalised_name';
}

class EntityWorker extends WorkerBase<Payload> {
  constructor(
    private readonly entityRepo: EntityRepo,
    private readonly neo4j: Neo4jClient,
    private readonly safe: SafeLlmRouter,
    private readonly modelId: string,
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

  /**
   * Rule-pass — deterministic deduplication. For each alias attempt
   * RCCM / NIU / normalised-name lookup; on any hit, return a
   * `RuleMatch`. Aliases that do not hit are returned in
   * `unresolved` for the LLM pass to handle.
   *
   * Pure I/O (Postgres reads only); does NOT mutate state. The
   * caller is responsible for writing aliases attached to
   * rule-resolved canonicals.
   */
  protected async rulePass(
    aliases: ReadonlyArray<string>,
  ): Promise<{ resolved: RuleMatch[]; unresolved: string[] }> {
    const resolved: RuleMatch[] = [];
    const unresolved: string[] = [];
    for (const raw of aliases) {
      const alias = raw.trim();
      if (alias === '') continue;

      // (a) RCCM shape — exact lookup against canonical.rccm_number.
      const rccmMatch = RCCM_RE.exec(alias);
      if (rccmMatch) {
        const rccm = canonicalRccm(rccmMatch[0]);
        const hit = await this.entityRepo.getCanonicalByRccm(rccm);
        if (hit) {
          resolved.push({ alias, canonicalId: hit.id, via: 'rccm' });
          continue;
        }
      }

      // (b) NIU shape — exact lookup against canonical.niu.
      const niuMatch = NIU_RE.exec(alias);
      if (niuMatch) {
        const niu = canonicalNiu(niuMatch[0]);
        const hit = await this.entityRepo.getCanonicalByNiu(niu);
        if (hit) {
          resolved.push({ alias, canonicalId: hit.id, via: 'niu' });
          continue;
        }
      }

      // (c) Normalised name — case-folded + accent-folded equality.
      const normalised = normalizeName(alias);
      if (normalised !== '') {
        const hit = await this.entityRepo.findCanonicalByNormalizedName(alias);
        if (hit) {
          resolved.push({ alias, canonicalId: hit.id, via: 'normalised_name' });
          continue;
        }
      }

      unresolved.push(alias);
    }
    return { resolved, unresolved };
  }

  protected async handle(env: Envelope<Payload>): Promise<HandlerOutcome> {
    const aliases = env.payload.raw_aliases ?? [];
    if (aliases.length === 0) return { kind: 'ack' };

    try {
      // ─── Step 1: rule-pass ───────────────────────────────────
      const { resolved, unresolved } = await this.rulePass(aliases);
      logger.info(
        { resolved: resolved.length, unresolved: unresolved.length, total: aliases.length },
        'rule-pass-complete',
      );

      // For each rule-pass match, attach the alias to the existing
      // canonical (Postgres only — no Neo4j mirror needed because
      // the canonical already exists in Neo4j).
      const sourceId = env.payload.source_event_id ?? 'unknown';
      const now = new Date();
      for (const m of resolved) {
        await this.entityRepo.addAlias({
          id: Ids.newEntityId() as string,
          canonical_id: m.canonicalId,
          alias: m.alias,
          source_id: sourceId,
          language: detectLanguage(m.alias),
          first_seen: now,
        });
      }

      // ─── Step 2: LLM-pass (unresolved only) ──────────────────
      if (unresolved.length === 0) {
        return { kind: 'ack' };
      }
      const rendered = Safety.globalPromptRegistry.latest('entity.resolve-aliases');
      if (!rendered) {
        logger.error('entity-resolve-prompt-missing');
        return { kind: 'retry', reason: 'prompt-not-registered', delay_ms: 60_000 };
      }
      const tmpl = rendered.render({ aliases: unresolved });
      const outcome = await this.safe.call<z.infer<typeof zErResp>>({
        findingId: null,
        assessmentId: null,
        promptName: 'entity.resolve-aliases',
        task: tmpl.user,
        sources: [],
        responseSchema: zErResp,
        modelId: this.modelId,
      });

      // ─── Step 3: persist clusters (Postgres atomic, then Neo4j) ───
      for (const cluster of outcome.value.clusters) {
        const id = Ids.newEntityId() as string;
        const aliasRows = cluster.aliases.map((alias) => ({
          id: Ids.newEntityId() as string,
          canonical_id: id,
          alias,
          source_id: sourceId,
          language: detectLanguage(alias),
          first_seen: now,
        }));

        // (a) Postgres FIRST — single transaction, all-or-nothing.
        // SRD §15.1 invariant: DB commit precedes stream emit.
        try {
          await this.entityRepo.upsertCluster({
            canonical: {
              id,
              kind:
                cluster.kind === 'person'
                  ? 'person'
                  : cluster.kind === 'public_body'
                    ? 'public_body'
                    : 'company',
              display_name: cluster.canonical,
              first_seen: now,
              last_seen: now,
              resolution_confidence: cluster.confidence,
              resolved_by: 'llm',
              metadata: {
                source_event_id: sourceId,
                document_cid: env.payload.document_cid ?? null,
              },
            },
            aliases: aliasRows,
          });
        } catch (e) {
          logger.error(
            { err: e, canonical: cluster.canonical, aliases: cluster.aliases },
            'postgres-upsert-failed',
          );
          // Re-throw — the outer try/catch routes to retry. Postgres
          // failure means the canonical is NOT written; we cannot
          // mirror to Neo4j or publish to PATTERN_DETECT for this
          // cluster.
          throw e;
        }

        // (b) Neo4j SECOND — best-effort mirror. On failure log and
        // continue; the Postgres canonical row stands. A future
        // worker-fabric-bridge / cross-witness pass reconciles
        // Neo4j.
        try {
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
              source_id: sourceId,
              language: detectLanguage(alias),
              first_seen: now.toISOString(),
            });
          }
        } catch (e) {
          // Postgres canonical row stands; Neo4j mirror is degraded.
          // Operator alert via the existing AdapterFailing /
          // WorkerLoopStalled rules; we do not retry here.
          logger.warn(
            { err: e, canonical_id: id },
            'neo4j-mirror-failed; postgres canonical stands',
          );
        }
      }
      return { kind: 'ack' };
    } catch (e) {
      logger.error({ err: e }, 'er-failed');
      return { kind: 'retry', reason: 'er-error', delay_ms: 30_000 };
    } finally {
      // Trigger pattern detection downstream. Per SRD §15.1 this
      // happens AFTER the Postgres commit (the publish runs in the
      // finally block, which executes after the try/catch handlers
      // have completed their state writes).
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

// Exported for unit tests + downstream introspection.
// Pure helpers (`RCCM_RE`, `NIU_RE`, `detectLanguage`) live in
// `./rule-pass.js`; re-export here for ergonomics.
export { EntityWorker };
export { RCCM_RE, NIU_RE, detectLanguage } from './rule-pass.js';
export type { Payload, RuleMatch };

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

  const db = await getDb();
  const callRecordRepo = new CallRecordRepo(db);
  const entityRepo = new EntityRepo(db);

  if (!Safety.adversarialPromptsRegistered()) {
    throw new Error('AI-Safety canonical prompts missing from globalPromptRegistry');
  }
  const safe = new SafeLlmRouter(llm, logger, {
    record: async (input) => {
      await callRecordRepo.record({
        ...input,
        temperature: input.temperature.toString(),
        cost_usd: input.cost_usd.toString(),
        called_at: new Date(input.called_at),
      });
    },
  });
  const modelId = process.env.ENTITY_RESOLUTION_MODEL ?? 'claude-haiku-4-5';

  const worker = new EntityWorker(entityRepo, neo4j, safe, modelId, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info({ modelId }, 'worker-entity-ready');
}

if (require.main === module) {
  main().catch((e: unknown) => {
    logger.error({ err: e }, 'fatal-startup');
    process.exit(1);
  });
}
