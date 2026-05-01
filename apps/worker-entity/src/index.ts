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
  neo4jMirrorStateTotal,
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
  readonly via: 'rccm' | 'niu' | 'normalised_name_corroborated';
}

interface NameOnlyCandidate {
  readonly alias: string;
  readonly matchedCanonicalId: string;
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
   * Rule-pass — deterministic deduplication. Three buckets:
   *
   *   - `resolved`           — RCCM or NIU exact match. Auto-merge:
   *                            attach the alias to the existing
   *                            canonical. The unique-id corroborates
   *                            the resolution; auto-merge is safe.
   *   - `nameOnlyCandidates` — normalised-name exact match WITHOUT
   *                            an RCCM/NIU corroborator in the same
   *                            alias batch. Held aside for the
   *                            corroboration check below; if no
   *                            RCCM/NIU points to the same canonical,
   *                            the alias goes to `entity.er_review_queue`
   *                            (NOT auto-merged — Block-A reconciliation
   *                            §5.c). Two real distinct companies can
   *                            share a display name; merging on name
   *                            alone is silent corruption.
   *   - `unresolved`         — no rule-pass hit. Sent to the LLM pass.
   *
   * The corroboration step runs AFTER all aliases are tagged so the
   * "in the same batch" semantics are preserved across the whole
   * envelope. After corroboration, name-only candidates either
   * promote to `resolved` (with via='normalised_name_corroborated')
   * or fall through to the review queue.
   */
  protected async rulePass(aliases: ReadonlyArray<string>): Promise<{
    resolved: RuleMatch[];
    nameOnlyCandidates: NameOnlyCandidate[];
    unresolved: string[];
  }> {
    const resolved: RuleMatch[] = [];
    const nameOnlyCandidates: NameOnlyCandidate[] = [];
    const unresolved: string[] = [];

    // First pass: classify each alias.
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

      // (c) Normalised name — held as a candidate, NOT auto-merged.
      const normalised = normalizeName(alias);
      if (normalised !== '') {
        const hit = await this.entityRepo.findCanonicalByNormalizedName(alias);
        if (hit) {
          nameOnlyCandidates.push({ alias, matchedCanonicalId: hit.id });
          continue;
        }
      }

      unresolved.push(alias);
    }

    // Second pass: corroborate name-only candidates against the
    // RCCM/NIU resolutions we just collected. If any RCCM/NIU match
    // in this batch points to the same canonical, the name-only
    // alias is corroborated and promotes to `resolved`. Otherwise
    // it stays in `nameOnlyCandidates` for the caller to route to
    // the review queue.
    const corroborated: RuleMatch[] = [];
    const stillUncorroborated: NameOnlyCandidate[] = [];
    const idsWithStrongMatch = new Set(resolved.map((r) => r.canonicalId));
    for (const c of nameOnlyCandidates) {
      if (idsWithStrongMatch.has(c.matchedCanonicalId)) {
        corroborated.push({
          alias: c.alias,
          canonicalId: c.matchedCanonicalId,
          via: 'normalised_name_corroborated',
        });
      } else {
        stillUncorroborated.push(c);
      }
    }
    return {
      resolved: [...resolved, ...corroborated],
      nameOnlyCandidates: stillUncorroborated,
      unresolved,
    };
  }

  protected async handle(env: Envelope<Payload>): Promise<HandlerOutcome> {
    const aliases = env.payload.raw_aliases ?? [];
    if (aliases.length === 0) return { kind: 'ack' };

    // Block-A reconciliation §5.d — `source_id` cannot fall back to
    // a sentinel string. The unique constraint on `entity.alias`
    // includes `source_id`; collapsing every missing source to
    // `'unknown'` deduplicates aliases that should remain distinct.
    // We require the field on the envelope and dead-letter when
    // missing. The operator alert is the existing dead-letter path.
    const sourceId = env.payload.source_event_id;
    if (sourceId === undefined || sourceId === '') {
      logger.error(
        { document_cid: env.payload.document_cid, alias_count: aliases.length },
        'er-rejected-missing-source-event-id',
      );
      return { kind: 'dead-letter', reason: 'missing-source-event-id' };
    }

    try {
      // ─── Step 1: rule-pass ───────────────────────────────────
      const { resolved, nameOnlyCandidates, unresolved } = await this.rulePass(aliases);
      logger.info(
        {
          resolved: resolved.length,
          name_only_held: nameOnlyCandidates.length,
          unresolved: unresolved.length,
          total: aliases.length,
        },
        'rule-pass-complete',
      );

      const now = new Date();

      // For each rule-pass match, attach the alias to the existing
      // canonical (Postgres only — no Neo4j mirror needed because
      // the canonical already exists in Neo4j; the gap with
      // previously-failed Neo4j mirrors is the subject of Block-A
      // reconciliation §5.b, addressed when the architect signs the
      // schema-change plan).
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

      // For each name-only candidate that did NOT corroborate via
      // RCCM/NIU in this batch, write to entity.er_review_queue.
      // Block-A reconciliation §5.c — the alias is NOT attached to
      // any canonical in entity.alias; the operator's review-queue
      // decision is what triggers a subsequent attach (or refuse-to-
      // merge). Until a human decides, the alias is held.
      for (const c of nameOnlyCandidates) {
        const placeholderId = Ids.newEntityId() as string;
        await this.entityRepo.addReviewQueueRow({
          candidateExistingId: c.matchedCanonicalId,
          candidatePlaceholderId: placeholderId,
          similarity: 1.0,
          proposedAction: 'merge',
          rationale: {
            alias: c.alias,
            source_event_id: sourceId,
            reason:
              'normalised-name exact match without RCCM/NIU corroboration; ambiguity requires human review per Block-A reconciliation §5.c',
          },
        });
        logger.warn(
          {
            existing_canonical_id: c.matchedCanonicalId,
            alias: c.alias,
            source_event_id: sourceId,
          },
          'name-only-match-routed-to-review-queue',
        );
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

        // (b) Neo4j SECOND — best-effort mirror with bounded inline
        // retries. Block-A reconciliation §5.b: try up to N times
        // (default 3, env NEO4J_MIRROR_MAX_RETRIES). On final failure
        // the canonical row's neo4j_mirror_state flips to 'failed';
        // on success it flips to 'synced'. Either way the Postgres
        // canonical row stands (SRD §15.1 invariant). The reconcile
        // worker that picks up `failed` rows is OUT OF SCOPE for
        // Block A.
        const maxRetries = Number.parseInt(process.env.NEO4J_MIRROR_MAX_RETRIES ?? '3', 10);
        let attempt = 0;
        let mirrorOk = false;
        let lastErr: unknown = null;
        while (attempt < Math.max(1, maxRetries)) {
          attempt += 1;
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
            mirrorOk = true;
            break;
          } catch (e) {
            lastErr = e;
            logger.warn(
              { err: e, canonical_id: id, attempt, max_retries: maxRetries },
              'neo4j-mirror-attempt-failed',
            );
          }
        }
        if (mirrorOk) {
          await this.entityRepo.markNeo4jSynced(id);
        } else {
          // Postgres canonical row stands; the Neo4j mirror is now
          // recorded as 'failed' so oncall (and the deferred
          // reconcile worker) can find it.
          logger.error(
            { err: lastErr, canonical_id: id, attempts: attempt },
            'neo4j-mirror-failed; postgres canonical stands; state=failed',
          );
          await this.entityRepo.markNeo4jFailed(id);
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

  // Block-A reconciliation §5.b — periodic mirror-state gauge tick.
  // The gauge is a derived count grouped by neo4j_mirror_state; we
  // recompute on a 60s interval (env NEO4J_MIRROR_GAUGE_INTERVAL_MS).
  // Cheap query thanks to the index added in 0013.
  const gaugeIntervalMs = Number.parseInt(
    process.env.NEO4J_MIRROR_GAUGE_INTERVAL_MS ?? '60000',
    10,
  );
  const gaugeTick = async (): Promise<void> => {
    try {
      const counts = await entityRepo.neo4jMirrorStateCounts();
      neo4jMirrorStateTotal.set({ state: 'synced' }, counts.synced);
      neo4jMirrorStateTotal.set({ state: 'pending' }, counts.pending);
      neo4jMirrorStateTotal.set({ state: 'failed' }, counts.failed);
    } catch (e) {
      logger.warn({ err: e }, 'neo4j-mirror-gauge-tick-failed');
    }
  };
  await gaugeTick();
  const gaugeTimer = setInterval(() => {
    void gaugeTick();
  }, gaugeIntervalMs);
  registerShutdown('mirror-gauge', () => {
    clearInterval(gaugeTimer);
    return Promise.resolve();
  });

  logger.info({ modelId }, 'worker-entity-ready');
}

if (require.main === module) {
  main().catch((e: unknown) => {
    logger.error({ err: e }, 'fatal-startup');
    process.exit(1);
  });
}
