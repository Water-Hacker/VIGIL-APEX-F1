/**
 * Graph-metric runner — orchestrates Louvain + PageRank + round-trip BFS +
 * director-ring detection + bidder-density and persists the per-entity
 * results to Postgres `entity.canonical.metadata` (and bidder-density
 * onto each award event's payload).
 *
 * Schedule: nightly at 03:00 Africa/Douala via adapter-runner. The job
 * consumes Neo4j (which is itself rebuilt from Postgres on a faster
 * cadence) and writes back to Postgres so the patterns read a single
 * authoritative source for both their event signals and their graph
 * metrics.
 *
 * Hardening:
 *   - Each metric runs in its own try/catch — one Cypher failure does
 *     not abort the others.
 *   - Outputs are accumulated in-memory then persisted in a single
 *     bulk-merge phase — a partial graph computation does not result
 *     in partial/inconsistent metadata writes.
 *   - Run timestamp is recorded under `metadata._graph_metrics_at` so
 *     downstream tools can detect stale metadata.
 */

import { computeBidderDensity, type BidderDensity } from './bidder-density.js';
import { detectDirectorRings, type DirectorRingDetection } from './director-ring.js';
import { louvain, type LouvainResult } from './louvain.js';
import { pageRank, type PageRankResult } from './page-rank.js';
import { detectRoundTrips, type RoundTripDetection } from './round-trip.js';

import type { Neo4jClient } from '../client.js';

export interface MetadataMergeSink {
  bulkMergeMetadata(
    updates: ReadonlyArray<{ id: string; additions: Record<string, unknown> }>,
  ): Promise<{ updated: number }>;
}

export interface EventPayloadMergeSink {
  mergeEventPayload(id: string, additions: Record<string, unknown>): Promise<{ updated: boolean }>;
}

export interface GraphMetricRunOptions {
  /** Optional reference to "now" for deterministic test runs. */
  readonly now?: () => Date;
  /** Round-trip lookback window in days. Default 365. */
  readonly roundTripWindowDays?: number;
  /** When false, skip the named metric (used by integration tests). */
  readonly enable?: {
    louvain?: boolean;
    pageRank?: boolean;
    roundTrip?: boolean;
    directorRing?: boolean;
    bidderDensity?: boolean;
  };
  /** Logger interface (optional). */
  readonly logger?: {
    info: (msg: string, ctx?: unknown) => void;
    warn: (msg: string, ctx?: unknown) => void;
    error: (msg: string, ctx?: unknown) => void;
  };
}

export interface GraphMetricRunReport {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly louvain: { ok: boolean; communityCount: number; modularity: number; error?: string };
  readonly pageRank: { ok: boolean; nodeCount: number; iterations: number; error?: string };
  readonly roundTrip: { ok: boolean; detections: number; error?: string };
  readonly directorRing: { ok: boolean; ringMembers: number; error?: string };
  readonly bidderDensity: { ok: boolean; tendersComputed: number; error?: string };
  readonly entitiesUpdated: number;
  readonly tendersUpdated: number;
}

const DEFAULT_ENABLE = {
  louvain: true,
  pageRank: true,
  roundTrip: true,
  directorRing: true,
  bidderDensity: true,
};

const NOOP_LOGGER = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export async function runGraphMetrics(
  neo4j: Neo4jClient,
  entitySink: MetadataMergeSink,
  eventSink: EventPayloadMergeSink,
  opts: GraphMetricRunOptions = {},
): Promise<GraphMetricRunReport> {
  const now = opts.now ?? (() => new Date());
  const enable = { ...DEFAULT_ENABLE, ...(opts.enable ?? {}) };
  const log = opts.logger ?? NOOP_LOGGER;

  const startedAt = now().toISOString();

  // Run each metric in isolation; any failure is captured but not propagated.
  let louvainResult: LouvainResult | null = null;
  let louvainErr: string | undefined;
  if (enable.louvain) {
    try {
      louvainResult = await louvain(neo4j);
      log.info('graph-metric.louvain-ok', {
        communities: louvainResult.communities.size,
        modularity: louvainResult.modularity,
      });
    } catch (e) {
      louvainErr = String(e);
      log.error('graph-metric.louvain-failed', { err: louvainErr });
    }
  }

  let pageRankResult: PageRankResult | null = null;
  let pageRankErr: string | undefined;
  if (enable.pageRank) {
    try {
      pageRankResult = await pageRank(neo4j);
      log.info('graph-metric.pagerank-ok', {
        nodes: pageRankResult.scores.size,
        iterations: pageRankResult.iterations,
      });
    } catch (e) {
      pageRankErr = String(e);
      log.error('graph-metric.pagerank-failed', { err: pageRankErr });
    }
  }

  let roundTripResult: readonly RoundTripDetection[] = [];
  let roundTripErr: string | undefined;
  if (enable.roundTrip) {
    try {
      roundTripResult = await detectRoundTrips(neo4j, {
        windowDays: opts.roundTripWindowDays ?? 365,
      });
      log.info('graph-metric.round-trip-ok', { detections: roundTripResult.length });
    } catch (e) {
      roundTripErr = String(e);
      log.error('graph-metric.round-trip-failed', { err: roundTripErr });
    }
  }

  let directorRingResult: readonly DirectorRingDetection[] = [];
  let directorRingErr: string | undefined;
  if (enable.directorRing) {
    try {
      directorRingResult = await detectDirectorRings(neo4j);
      log.info('graph-metric.director-ring-ok', { ringMembers: directorRingResult.length });
    } catch (e) {
      directorRingErr = String(e);
      log.error('graph-metric.director-ring-failed', { err: directorRingErr });
    }
  }

  let bidderDensityResult: readonly BidderDensity[] = [];
  let bidderDensityErr: string | undefined;
  if (enable.bidderDensity) {
    try {
      bidderDensityResult = await computeBidderDensity(neo4j);
      log.info('graph-metric.bidder-density-ok', { tenders: bidderDensityResult.length });
    } catch (e) {
      bidderDensityErr = String(e);
      log.error('graph-metric.bidder-density-failed', { err: bidderDensityErr });
    }
  }

  // ---- Merge into per-entity metadata --------------------------------------
  const entityUpdates = new Map<string, Record<string, unknown>>();
  const stamp = now().toISOString();

  if (louvainResult) {
    for (const [id, community] of louvainResult.communities) {
      const additions = entityUpdates.get(id) ?? {};
      additions['communityId'] = community;
      entityUpdates.set(id, additions);
    }
  }
  if (pageRankResult) {
    for (const [id, score] of pageRankResult.scores) {
      const additions = entityUpdates.get(id) ?? {};
      additions['pageRank'] = score;
      entityUpdates.set(id, additions);
    }
  }
  for (const det of roundTripResult) {
    const additions = entityUpdates.get(det.supplierId) ?? {};
    additions['roundTripDetected'] = true;
    additions['roundTripHops'] = det.hops;
    entityUpdates.set(det.supplierId, additions);
  }
  for (const det of directorRingResult) {
    const additions = entityUpdates.get(det.personId) ?? {};
    additions['directorRingFlag'] = true;
    additions['directorRingTenderIds'] = det.sharedTenderIds;
    entityUpdates.set(det.personId, additions);
  }

  // Stamp every updated entity with the graph-metric run timestamp so a
  // downstream tool can detect "this entity's metrics are stale".
  for (const [, additions] of entityUpdates) {
    additions['_graph_metrics_at'] = stamp;
  }

  const entityBatch = [...entityUpdates.entries()].map(([id, additions]) => ({ id, additions }));
  const { updated: entitiesUpdated } = await entitySink.bulkMergeMetadata(entityBatch);

  // ---- Merge bidder-density onto award event payloads ---------------------
  // Each award event keyed by tender_id receives `bidder_graph_density`.
  // The event id is the tender's id in our schema (one award event per tender).
  let tendersUpdated = 0;
  for (const tenderDensity of bidderDensityResult) {
    try {
      const { updated } = await eventSink.mergeEventPayload(tenderDensity.tenderId, {
        bidder_graph_density: tenderDensity.density,
        _graph_metrics_at: stamp,
      });
      if (updated) tendersUpdated += 1;
    } catch (e) {
      log.warn('graph-metric.bidder-density-merge-failed', {
        tender: tenderDensity.tenderId,
        err: String(e),
      });
    }
  }

  const endedAt = now().toISOString();

  return {
    startedAt,
    endedAt,
    louvain: louvainResult
      ? {
          ok: true,
          communityCount: new Set([...louvainResult.communities.values()]).size,
          modularity: louvainResult.modularity,
        }
      : { ok: false, communityCount: 0, modularity: 0, ...(louvainErr && { error: louvainErr }) },
    pageRank: pageRankResult
      ? { ok: true, nodeCount: pageRankResult.scores.size, iterations: pageRankResult.iterations }
      : { ok: false, nodeCount: 0, iterations: 0, ...(pageRankErr && { error: pageRankErr }) },
    roundTrip: {
      ok: roundTripErr === undefined,
      detections: roundTripResult.length,
      ...(roundTripErr && { error: roundTripErr }),
    },
    directorRing: {
      ok: directorRingErr === undefined,
      ringMembers: directorRingResult.length,
      ...(directorRingErr && { error: directorRingErr }),
    },
    bidderDensity: {
      ok: bidderDensityErr === undefined,
      tendersComputed: bidderDensityResult.length,
      ...(bidderDensityErr && { error: bidderDensityErr }),
    },
    entitiesUpdated,
    tendersUpdated,
  };
}
