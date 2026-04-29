import { z } from 'zod';

/**
 * SatelliteRequest — what the trigger adapter (or the dashboard) writes to
 * the `vigil:satellite:request` Redis stream. Consumed by worker-satellite
 * (Python). The shape is mirrored in
 * `apps/worker-satellite/src/vigil_satellite/schemas.py` (Pydantic).
 *
 * Every field is required to make the worker's job self-contained — no
 * lookups against Postgres from Python. The adapter is responsible for
 * resolving project_id → AOI polygon + contract window before publishing.
 */

export const zProvider = z.enum(['nicfi', 'sentinel-2', 'sentinel-1', 'maxar', 'airbus']);
export type Provider = z.infer<typeof zProvider>;

export const zPolygonGeoJson = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
});
export type PolygonGeoJson = z.infer<typeof zPolygonGeoJson>;

export const zContractWindow = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
});
export type ContractWindow = z.infer<typeof zContractWindow>;

export const zSatelliteRequest = z.object({
  request_id: z.string().min(8).max(80),
  /** Either a project_id (preferred) or a finding_id triggered the request. */
  project_id: z.string().uuid().nullable(),
  finding_id: z.string().uuid().nullable(),
  aoi_geojson: zPolygonGeoJson,
  contract_window: zContractWindow,
  /** Provider chain in priority order. The worker tries each until one
   *  returns enough cloud-free imagery. */
  providers: z.array(zProvider).min(1).max(5),
  max_cloud_pct: z.number().min(0).max(100).default(20),
  max_cost_usd: z.number().min(0).default(0),
  /** Originator label for audit. */
  requested_by: z.string().min(1).max(120),
});
export type SatelliteRequest = z.infer<typeof zSatelliteRequest>;

/** Mirror of the Python worker's result shape. Used by tests + tracking repo. */
export const zChangeDetectionResult = z.object({
  request_id: z.string(),
  provider_used: zProvider,
  activity_score: z.number().min(0).max(1),
  ndvi_delta: z.number().optional(),
  ndbi_delta: z.number().optional(),
  pixel_change_pct: z.number().optional(),
  scene_count: z.number().int().nonnegative(),
  cost_usd: z.number().min(0).default(0),
  result_cid: z.string().nullable(),
  error_message: z.string().optional(),
});
export type ChangeDetectionResult = z.infer<typeof zChangeDetectionResult>;
