import { setTimeout as sleep } from 'node:timers/promises';

import { HashChain } from '@vigil/audit-chain';
import { getDb, getPool } from '@vigil/db-postgres';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  registerShutdown,
  shutdownTracing,
  startMetricsServer,
} from '@vigil/observability';

const logger = createLogger({ service: 'worker-pattern-discovery' });

/**
 * worker-pattern-discovery — FRONTIER-AUDIT Layer-1 E1.1 third element.
 *
 * Periodic (default: daily) loop that:
 *
 *   1. Queries the Neo4j entity graph for a snapshot of recent
 *      activity (default: last 90 days).
 *
 *   2. Runs all deterministic anomaly detectors from
 *      `./graph-anomalies.ts` over the snapshot.
 *
 *   3. For each anomaly candidate, optionally invokes the LLM
 *      (through SafeLlmRouter — Layer-13 input scan applies)
 *      to propose a candidate pattern definition: a one-paragraph
 *      hypothesis + an indicator-list + a suggested likelihood
 *      ratio. The LLM never auto-promotes.
 *
 *   4. Persists candidates to `pattern_discovery_candidate` (status:
 *      `awaiting_curation`). Operator dashboard surfaces them at
 *      `/audit/discovery-queue` (route to be added — gated behind
 *      `auditor` + `architect` roles).
 *
 *   5. Emits `audit.pattern_discovery_cycle` to the chain.
 *
 * The Neo4j query side is intentionally left as a placeholder until
 * Phase-2 graph schema is finalised. The pure detector logic in
 * `./graph-anomalies.ts` is exhaustively unit-tested independent of
 * any graph runtime.
 *
 * Operator curation lifecycle:
 *
 *   anomaly → candidate → architect-reviewed → formal pattern
 *
 * An operator who promotes a candidate to a formal pattern is
 * responsible for:
 *   - Writing the `detect()` function in
 *     `packages/patterns/src/category-X/p-X-NNN-name.ts`
 *   - Adding golden-fixture tests in `packages/patterns/test/...`
 *   - Adding the import to `register-all.ts`
 *   - Filing a DECISION-NNN entry citing the discovery rationale
 */
async function main(): Promise<void> {
  await initTracing({ service: 'worker-pattern-discovery' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const intervalMs = Number(process.env.PATTERN_DISCOVERY_INTERVAL_MS ?? 24 * 60 * 60_000); // 24h

  await getDb();
  const pool = await getPool();
  const chain = new HashChain(pool, logger);

  let stopping = false;
  registerShutdown('discovery-loop', () => {
    stopping = true;
  });

  logger.info({ intervalMs }, 'worker-pattern-discovery-ready');

  while (!stopping) {
    try {
      // Placeholder tick until Neo4j snapshot loader is built.
      // Operational form:
      //   const snap = await loadGraphSnapshot(neo4j, lastNDays(90));
      //   const candidates = detectAllAnomalies(snap, new Date());
      //   for each candidate, optionally call llm to draft hypothesis,
      //     then persist to pattern_discovery_candidate.
      //   await chain.append({ action: 'audit.pattern_discovery_cycle', ... });
      await chain.append({
        action: 'audit.pattern_discovery_cycle',
        actor: 'system:worker-pattern-discovery',
        subject_kind: 'system',
        subject_id: 'pattern-discovery',
        payload: {
          interval_ms: intervalMs,
          anomalies_detected: 0,
          candidates_persisted: 0,
          note: 'graph snapshot loader pending Phase-2 Neo4j schema finalisation',
        },
      });
      logger.info({}, 'pattern-discovery-tick');
    } catch (err) {
      logger.error({ err }, 'pattern-discovery-loop-error');
    }
    await sleep(intervalMs);
  }
  logger.info('worker-pattern-discovery-stopping');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'fatal-startup');
  process.exit(1);
});
