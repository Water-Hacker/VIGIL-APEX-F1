import { setTimeout as sleep } from 'node:timers/promises';

import { HashChain } from '@vigil/audit-chain';
import { Neo4jClient } from '@vigil/db-neo4j';
import { PatternDiscoveryRepo, getDb, getPool } from '@vigil/db-postgres';
import {
  LoopBackoff,
  StartupGuard,
  auditFeatureFlagsAtBoot,
  createLogger,
  installShutdownHandler,
  initTracing,
  registerShutdown,
  shutdownTracing,
  startMetricsServer,
  type FeatureFlagAuditEmit,
} from '@vigil/observability';

import { runDiscoveryCycle } from './discovery-loop.js';
import { loadGraphSnapshot } from './snapshot.js';

const logger = createLogger({ service: 'worker-pattern-discovery' });

/**
 * worker-pattern-discovery — FRONTIER-AUDIT Layer-1 E1.1 third element.
 *
 * Daily loop:
 *   1. Load a GraphSnapshot from Neo4j covering the last `windowDays`.
 *   2. Run all 6 deterministic anomaly detectors over the snapshot
 *      (stellar_degree, tight_community_outflow, cycle_3_to_6,
 *      sudden_mass_creation, burst_then_quiet, triangle_bridge).
 *   3. Upsert every candidate into `pattern_discovery.candidate`
 *      (idempotent on a content-derived dedup_key).
 *   4. Emit one `audit.pattern_anomaly_detected` chain row per detected
 *      candidate.
 *
 * Operator curation lifecycle:
 *   detected → awaiting_curation → (promoted | dismissed | merged)
 *
 * Promoted candidates feed into the formal pattern authoring path:
 *   - new file `packages/patterns/src/category-X/p-X-NNN-name.ts`
 *   - golden-fixture tests under `packages/patterns/test/...`
 *   - DECISION-NNN entry citing the discovery rationale
 *
 * The interval defaults to 24h; an `discovery.run-now` API surface
 * (architect-only) can trigger the cycle ad hoc when curation has
 * caught up and the architect wants a fresh sweep.
 */
async function main(): Promise<void> {
  const guard = new StartupGuard({ serviceName: 'worker-pattern-discovery', logger });
  await guard.check();

  await initTracing({ service: 'worker-pattern-discovery' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const intervalMs = Number(process.env.PATTERN_DISCOVERY_INTERVAL_MS ?? 24 * 60 * 60_000);
  const windowDays = Number(process.env.PATTERN_DISCOVERY_WINDOW_DAYS ?? 90);

  const db = await getDb();
  const pool = await getPool();
  const repo = new PatternDiscoveryRepo(db);
  const chain = new HashChain(pool, logger);

  const emit: FeatureFlagAuditEmit = async (event) => {
    await chain.append({
      action: event.action,
      actor: 'worker-pattern-discovery',
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      payload: event.payload,
    });
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-pattern-discovery', emit });

  const neo4j = await Neo4jClient.connect({ logger });
  registerShutdown('neo4j', () => neo4j.close());

  let stopping = false;
  registerShutdown('discovery-loop', () => {
    stopping = true;
  });

  await guard.markBootSuccess();
  logger.info({ intervalMs, windowDays }, 'worker-pattern-discovery-ready');

  // Mode 1.6 — adaptive sleep on consecutive failures.
  const backoff = new LoopBackoff({ initialMs: 1_000, capMs: intervalMs });
  while (!stopping) {
    try {
      await runDiscoveryCycle({
        repo,
        chain,
        logger,
        loadSnapshot: (d) => loadGraphSnapshot(neo4j, { windowDays: d }),
        windowDays,
      });
      backoff.onSuccess();
    } catch (err) {
      backoff.onError();
      logger.error(
        { err, consecutiveFailures: backoff.consecutiveFailureCount },
        'pattern-discovery-loop-error',
      );
    }
    await sleep(backoff.nextDelayMs());
  }
  logger.info('worker-pattern-discovery-stopping');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'fatal-startup');
  process.exit(1);
});
