import { randomUUID } from 'node:crypto';

import { HashChain } from '@vigil/audit-chain';
import {
  FindingRepo,
  SatelliteRequestRepo,
  getDb,
  getPool,
} from '@vigil/db-postgres';
import { QueueClient } from '@vigil/queue';
import {
  SatelliteClient,
  polygonFromCentroidMeters,
  type Provider,
} from '@vigil/satellite-client';
import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

/**
 * POST /api/findings/[id]/satellite-recheck
 *
 * Operator-driven on-demand satellite verification (DECISION-010 § B7).
 *
 * Body: optional override of provider chain / cost ceiling. Default: NICFI →
 * Sentinel-2 → Sentinel-1, free providers only.
 *
 * Idempotent on (project_id, contract_window) for 24 h: if a recent
 * `dossier.satellite_request` row already exists in 'queued' or
 * 'in_progress' state, the existing request_id is returned.
 *
 * Auth (middleware): operator | architect.
 */
export const dynamic = 'force-dynamic';

const PROVIDERS = ['nicfi', 'sentinel-2', 'sentinel-1', 'maxar', 'airbus'] as const;

const BodySchema = z
  .object({
    providers: z.array(z.enum(PROVIDERS)).min(1).max(5).optional(),
    max_cloud_pct: z.number().min(0).max(100).optional(),
    max_cost_usd: z.number().min(0).optional(),
  })
  .default({});

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const findingId = ctx.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(findingId)) {
    return NextResponse.json({ error: 'invalid-finding-id' }, { status: 400 });
  }
  const json = (await req.json().catch(() => ({}))) as unknown;
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid-body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const providers: ReadonlyArray<Provider> =
    parsed.data.providers ?? ['nicfi', 'sentinel-2', 'sentinel-1'];
  const maxCloudPct = parsed.data.max_cloud_pct ?? 20;
  const maxCostUsd = parsed.data.max_cost_usd ?? 0;

  const db = await getDb();
  const findingRepo = new FindingRepo(db);
  const trackingRepo = new SatelliteRequestRepo(db);
  const finding = await findingRepo.getById(findingId);
  if (!finding) {
    return NextResponse.json({ error: 'finding-not-found' }, { status: 404 });
  }

  // Resolve project_id, GPS centroid, and contract window from the finding's
  // evidence trail. We look at the strongest signal's evidence_event_ids for
  // an investment_project / award event with `gps` + `contract_window` in
  // payload. If absent, the operator must seed those fields on the source
  // event before the recheck can run.
  const eventRow = await db.execute(sql`
    SELECT
      (e.payload ->> 'project_id')::uuid                         AS project_id,
      (e.payload -> 'gps' ->> 'lat')::numeric                    AS lat,
      (e.payload -> 'gps' ->> 'lon')::numeric                    AS lon,
      (e.payload -> 'contract_window' ->> 'start')::timestamptz  AS contract_start,
      (e.payload -> 'contract_window' ->> 'end')::timestamptz    AS contract_end
      FROM source.events e
      JOIN finding.signal s
        ON e.id::text = ANY(s.evidence_event_ids::text[])
     WHERE s.finding_id = ${findingId}::uuid
       AND e.kind IN ('investment_project','award')
       AND e.payload ? 'gps'
       AND e.payload ? 'contract_window'
     ORDER BY e.observed_at DESC
     LIMIT 1
  `);
  const row = (
    eventRow as unknown as {
      rows: ReadonlyArray<{
        project_id: string | null;
        lat: string | number | null;
        lon: string | number | null;
        contract_start: string | Date | null;
        contract_end: string | Date | null;
      }>;
    }
  ).rows[0];
  if (
    !row ||
    row.project_id === null ||
    row.lat === null ||
    row.lon === null ||
    row.contract_start === null ||
    row.contract_end === null
  ) {
    return NextResponse.json(
      { error: 'no-gps-bearing-event-linked-to-finding' },
      { status: 422 },
    );
  }

  const projectId = row.project_id;
  const lat = typeof row.lat === 'string' ? Number.parseFloat(row.lat) : row.lat;
  const lon = typeof row.lon === 'string' ? Number.parseFloat(row.lon) : row.lon;
  const contractStart =
    row.contract_start instanceof Date ? row.contract_start : new Date(row.contract_start);
  const contractEnd =
    row.contract_end instanceof Date ? row.contract_end : new Date(row.contract_end);

  // Idempotency.
  const existing = await trackingRepo.findByProjectWindow(
    projectId,
    contractStart,
    contractEnd,
  );
  if (existing) {
    return NextResponse.json(
      { requestId: existing.request_id, status: existing.status, deduplicated: true },
      { status: 200 },
    );
  }

  const queue = new QueueClient({});
  await queue.ping();
  try {
    const sat = new SatelliteClient(queue);
    const aoi = polygonFromCentroidMeters({
      centroid: { lat, lon },
      radiusMeters: Number(process.env.SATELLITE_AOI_BUFFER_METERS ?? '500'),
    });
    const requestId = randomUUID();
    await trackingRepo.create({
      id: randomUUID(),
      project_id: projectId,
      contract_start: contractStart.toISOString().slice(0, 10),
      contract_end: contractEnd.toISOString().slice(0, 10),
      request_id: requestId,
      status: 'queued',
    });
    await sat.request({
      request_id: requestId,
      project_id: projectId,
      finding_id: findingId,
      aoi_geojson: aoi,
      contract_window: {
        start: contractStart.toISOString(),
        end: contractEnd.toISOString(),
      },
      providers: [...providers],
      max_cloud_pct: maxCloudPct,
      max_cost_usd: maxCostUsd,
      requested_by: req.headers.get('x-vigil-username') ?? 'unknown',
    });

    try {
      const pool = await getPool();
      const chain = new HashChain(pool);
      await chain.append({
        action: 'satellite.recheck_requested',
        actor: req.headers.get('x-vigil-username') ?? 'unknown',
        subject_kind: 'finding',
        subject_id: findingId,
        payload: { project_id: projectId, request_id: requestId, providers, maxCloudPct, maxCostUsd },
      });
    } catch (err) {
      console.error('audit-emit-failed', err);
    }

    return NextResponse.json({ requestId, status: 'queued' }, { status: 202 });
  } finally {
    await queue.close();
  }
}
