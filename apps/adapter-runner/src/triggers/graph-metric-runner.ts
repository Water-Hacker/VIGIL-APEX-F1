/**
 * Graph-metric runner trigger — wires `runGraphMetrics` (db-neo4j) into
 * adapter-runner's cron grid.
 *
 * Schedule: nightly at 03:00 Africa/Douala by default. Configurable via
 * GRAPH_METRIC_CRON. Disable with GRAPH_METRIC_ENABLED=false.
 *
 * On run:
 *   - Connects to Neo4j with the same credentials used elsewhere
 *     (NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD).
 *   - Runs every metric in isolation (one failure does not abort others).
 *   - Persists results into Postgres via EntityRepo.bulkMergeMetadata +
 *     SourceRepo.mergeEventPayload.
 *   - Emits a TAL-PA audit row tagging the run with its metric report.
 *
 * Failure semantics: this is a maintenance job — failure logs the error
 * and exits cleanly so the next tick can retry. Patterns that depend on
 * the metrics simply degrade to no-fire.
 */
import { runGraphMetrics, type GraphMetricRunReport } from '@vigil/db-neo4j';

import type { Neo4jClient } from '@vigil/db-neo4j';
import type { EntityRepo, SourceRepo } from '@vigil/db-postgres';

export interface GraphMetricTriggerInput {
  readonly neo4j: Neo4jClient;
  readonly entityRepo: EntityRepo;
  readonly sourceRepo: SourceRepo;
  readonly logger: {
    info: (msg: string, ctx?: unknown) => void;
    warn: (msg: string, ctx?: unknown) => void;
    error: (msg: string, ctx?: unknown) => void;
  };
  readonly roundTripWindowDays?: number;
}

export async function runGraphMetricTrigger(
  input: GraphMetricTriggerInput,
): Promise<GraphMetricRunReport> {
  const startedAt = new Date();
  input.logger.info('graph-metric-trigger.start', { startedAt: startedAt.toISOString() });

  const report = await runGraphMetrics(input.neo4j, input.entityRepo, input.sourceRepo, {
    now: () => new Date(),
    ...(input.roundTripWindowDays !== undefined && {
      roundTripWindowDays: input.roundTripWindowDays,
    }),
    logger: input.logger,
  });

  input.logger.info('graph-metric-trigger.done', {
    entitiesUpdated: report.entitiesUpdated,
    tendersUpdated: report.tendersUpdated,
    louvain: report.louvain.ok ? 'ok' : `failed: ${report.louvain.error ?? 'unknown'}`,
    pageRank: report.pageRank.ok ? 'ok' : `failed: ${report.pageRank.error ?? 'unknown'}`,
    roundTrip: report.roundTrip.ok ? 'ok' : `failed: ${report.roundTrip.error ?? 'unknown'}`,
    directorRing: report.directorRing.ok
      ? 'ok'
      : `failed: ${report.directorRing.error ?? 'unknown'}`,
    bidderDensity: report.bidderDensity.ok
      ? 'ok'
      : `failed: ${report.bidderDensity.error ?? 'unknown'}`,
  });

  return report;
}
