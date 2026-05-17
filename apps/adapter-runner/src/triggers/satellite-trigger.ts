import { randomUUID } from 'node:crypto';

import { SatelliteRequestRepo } from '@vigil/db-postgres';
import { type Logger } from '@vigil/observability';
import { SatelliteClient, polygonFromCentroidMeters } from '@vigil/satellite-client';
import { sql } from 'drizzle-orm';

/**
 * satellite-trigger — DECISION-010.
 *
 * Periodically scans `source.events` for `investment_project` and `award`
 * events whose payload carries a GPS centroid + a contract window, and
 * fans out SatelliteRequest envelopes via the satellite-client. Idempotent
 * on (project_id, contract_window) via the dossier.satellite_request
 * tracker; the adapter does not enqueue twice for the same project unless
 * the contract_window changes.
 *
 * Provider chain priority is environment-configurable; the default favours
 * the free-tier providers in cost order (NICFI 4.77 m → Sentinel-2 10 m →
 * Sentinel-1 10 m SAR for cloud-penetration). Maxar / Airbus are gated off
 * unless `SATELLITE_MAX_COST_PER_REQUEST_USD > 0` and the corresponding
 * API key env is populated.
 */

export interface SatelliteTriggerDependencies {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly db: any;
  readonly satellite: SatelliteClient;
  readonly trackingRepo: SatelliteRequestRepo;
  readonly logger: Logger;
  readonly bufferMeters: number;
  readonly maxCloudPct: number;
  readonly maxCostUsd: number;
  readonly providers: ReadonlyArray<'nicfi' | 'sentinel-2' | 'sentinel-1' | 'maxar' | 'airbus'>;
  /** Maximum number of new requests to dispatch per tick (rate-limit). */
  readonly perTickCap?: number;
}

interface ProjectCandidate {
  readonly project_id: string;
  readonly lat: number;
  readonly lon: number;
  readonly contract_start: Date;
  readonly contract_end: Date;
}

const DEFAULT_PER_TICK_CAP = 50;

/**
 * Pure SQL query that returns the candidate list. Extracted for testability.
 * Looks at the most recent contract-bearing event per project. Production
 * implementations of investment_project / award include a `gps: {lat, lon}`
 * and a `contract_window: {start, end}` in payload (see
 * `packages/shared/src/schemas/source.ts`).
 */
const CANDIDATES_SQL = sql`
  WITH bearing AS (
    SELECT
      e.id,
      e.kind,
      (e.payload ->> 'project_id')::uuid                AS project_id,
      (e.payload -> 'gps' ->> 'lat')::numeric           AS lat,
      (e.payload -> 'gps' ->> 'lon')::numeric           AS lon,
      (e.payload -> 'contract_window' ->> 'start')::timestamptz AS contract_start,
      (e.payload -> 'contract_window' ->> 'end')::timestamptz   AS contract_end,
      e.observed_at
      FROM source.events e
     WHERE e.kind IN ('investment_project', 'award')
       AND e.payload ? 'project_id'
       AND e.payload ? 'gps'
       AND e.payload ? 'contract_window'
       AND (e.payload -> 'gps' ->> 'lat') IS NOT NULL
       AND (e.payload -> 'gps' ->> 'lon') IS NOT NULL
       AND (e.payload -> 'contract_window' ->> 'start') IS NOT NULL
       AND (e.payload -> 'contract_window' ->> 'end') IS NOT NULL
  )
  SELECT DISTINCT ON (project_id)
         project_id, lat, lon, contract_start, contract_end
    FROM bearing
   ORDER BY project_id, observed_at DESC
   LIMIT 500
`;

export async function runSatelliteTrigger(
  deps: SatelliteTriggerDependencies,
): Promise<{ enqueued: number; skipped: number; failed: number }> {
  const cap = deps.perTickCap ?? DEFAULT_PER_TICK_CAP;
  const r = await deps.db.execute(CANDIDATES_SQL);
  const candidates = (
    r.rows as Array<{
      project_id: string;
      lat: string | number;
      lon: string | number;
      contract_start: string | Date;
      contract_end: string | Date;
    }>
  ).map(
    (row): ProjectCandidate => ({
      project_id: row.project_id,
      lat: typeof row.lat === 'string' ? Number.parseFloat(row.lat) : row.lat,
      lon: typeof row.lon === 'string' ? Number.parseFloat(row.lon) : row.lon,
      contract_start:
        row.contract_start instanceof Date ? row.contract_start : new Date(row.contract_start),
      contract_end:
        row.contract_end instanceof Date ? row.contract_end : new Date(row.contract_end),
    }),
  );

  let enqueued = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of candidates) {
    if (enqueued >= cap) {
      deps.logger.info(
        { enqueued, cap, remaining: candidates.length - enqueued },
        'rate-cap-reached',
      );
      break;
    }
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) {
      skipped++;
      continue;
    }
    if (c.contract_end <= c.contract_start) {
      skipped++;
      continue;
    }

    try {
      const existing = await deps.trackingRepo.findByProjectWindow(
        c.project_id,
        c.contract_start,
        c.contract_end,
      );
      if (existing) {
        skipped++;
        continue;
      }

      const aoi = polygonFromCentroidMeters({
        centroid: { lat: c.lat, lon: c.lon },
        radiusMeters: deps.bufferMeters,
      });
      const requestId = randomUUID();
      const request = {
        request_id: requestId,
        project_id: c.project_id,
        finding_id: null,
        aoi_geojson: aoi,
        contract_window: {
          start: c.contract_start.toISOString(),
          end: c.contract_end.toISOString(),
        },
        providers: [...deps.providers] as Array<
          'nicfi' | 'sentinel-2' | 'sentinel-1' | 'maxar' | 'airbus'
        >,
        max_cloud_pct: deps.maxCloudPct,
        max_cost_usd: deps.maxCostUsd,
        requested_by: 'satellite-trigger',
      };

      // Persist the tracking row first, then publish. If publish fails the
      // tracker stays in 'queued' status and the worker will pick it up via
      // the trailing pending-requests sweep (or a subsequent run cleans up).
      await deps.trackingRepo.create({
        id: randomUUID(),
        project_id: c.project_id,
        contract_start: c.contract_start.toISOString().slice(0, 10),
        contract_end: c.contract_end.toISOString().slice(0, 10),
        request_id: requestId,
        status: 'queued',
      });
      await deps.satellite.request(request);
      enqueued++;
    } catch (err) {
      // Tier-64 log-convention sweep: err_name/err_message.
      const e = err instanceof Error ? err : new Error(String(err));
      deps.logger.error(
        { err_name: e.name, err_message: e.message, project_id: c.project_id },
        'satellite-trigger-publish-failed',
      );
      failed++;
    }
  }

  deps.logger.info(
    { enqueued, skipped, failed, total: candidates.length },
    'satellite-trigger-tick',
  );
  return { enqueued, skipped, failed };
}

export function defaultProviderChain(): ReadonlyArray<
  'nicfi' | 'sentinel-2' | 'sentinel-1' | 'maxar' | 'airbus'
> {
  const raw = process.env.SATELLITE_PROVIDER_CHAIN;
  if (raw && raw.trim() !== '') {
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(
        (s): s is 'nicfi' | 'sentinel-2' | 'sentinel-1' | 'maxar' | 'airbus' =>
          s === 'nicfi' ||
          s === 'sentinel-2' ||
          s === 'sentinel-1' ||
          s === 'maxar' ||
          s === 'airbus',
      );
  }
  // Free-first chain. NICFI requires PLANET_API_KEY; the worker drops it
  // from the chain at runtime if the key is absent.
  return ['nicfi', 'sentinel-2', 'sentinel-1'];
}
