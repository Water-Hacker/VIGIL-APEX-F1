import { z } from 'zod';

import { zIsoInstant, zSourceId, zUuid } from './common.js';

/**
 * Source schemas — adapter inputs and the raw events they emit.
 *
 * The 26 sources from SRD §10 are registered in `infra/sources.json`; the
 * SourceRegistryEntry schema validates that file at startup.
 */

/* =============================================================================
 * Source registry entry — one per row in infra/sources.json
 * ===========================================================================*/

export const zSourceRegistryEntry = z.object({
  id: zSourceId,
  name_fr: z.string().min(3).max(200),
  name_en: z.string().min(3).max(200),
  url: z.string().url(),
  jurisdiction: z.enum(['CMR', 'CEMAC', 'INTL']),
  evidence_grade: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  cron: z.string().min(1).max(80), // node-cron expression
  rate_interval_ms: z.number().int().min(500).max(600_000),
  daily_request_cap: z.number().int().positive(),
  fetch_strategy: z.enum(['playwright', 'fetch', 'api', 'sftp']),
  honor_robots: z.boolean().default(true),
  contact: z
    .object({
      ministry: z.string().nullable(),
      email: z.string().email().nullable(),
      tier: z.enum(['public-no-contact', 'public-with-courtesy', 'public-with-engagement']),
    })
    .partial({ ministry: true, email: true })
    .extend({
      ministry: z.string().nullable().optional(),
      email: z.string().email().nullable().optional(),
    }),
  fallback_urls: z.array(z.string().url()).default([]),
  notes: z.string().optional(),
});
export type SourceRegistryEntry = z.infer<typeof zSourceRegistryEntry>;

export const zSourceRegistry = z.object({
  version: z.number().int().min(1),
  generated_at: zIsoInstant,
  sources: z.array(zSourceRegistryEntry).min(1),
});
export type SourceRegistry = z.infer<typeof zSourceRegistry>;

/* =============================================================================
 * Source events — the canonical adapter output
 * ===========================================================================*/

export const zSourceEventKind = z.enum([
  'tender_notice',
  'award',
  'amendment',
  'cancellation',
  'debarment',
  'sanction',
  'budget_line',
  'payment_order',
  'treasury_disbursement',
  'investment_project',
  'company_filing',
  'court_judgement',
  'audit_observation',
  'gazette_decree',
  'gazette_appointment',
  'pep_match',
  'press_article',
  'satellite_imagery',
  'other',
]);
export type SourceEventKind = z.infer<typeof zSourceEventKind>;

/**
 * DECISION-010 — canonical satellite_imagery event payload.
 *
 * Emitted by `worker-satellite` (Python) after each STAC fetch + activity
 * computation. Consumed by category-D patterns (P-D-001 ghost-project,
 * P-D-002 incomplete-construction, P-D-003 site-mismatch,
 * P-D-005 progress-fabrication). The shape is also written to
 * `dossier.satellite_request.activity_score` and pinned to IPFS as
 * `result_cid` for downstream verification.
 */
export const zSatelliteSceneFinding = z.object({
  scene_id: z.string().min(1),
  sensor: z.string().min(1), // e.g. 'sentinel-2-l2a', 'planet-nicfi-monthly', 'sentinel-1-rtc'
  captured_at: z.string().datetime({ offset: true }),
  cloud_pct: z.number().min(0).max(100),
  ndvi_mean: z.number().min(-1).max(1).optional(),
  ndbi_mean: z.number().min(-1).max(1).optional(),
  activity_centroid: z
    .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
    .optional(),
  rationale: z.string().min(1).max(2000),
});
export type SatelliteSceneFinding = z.infer<typeof zSatelliteSceneFinding>;

export const zSatelliteImageryPayload = z.object({
  /** 0..1 — main signal patterns key off. 0 = no detected change. */
  activity_score: z.number().min(0).max(1),
  /** Centroid of the highest-activity pixel cluster, when computed. */
  activity_centroid: z
    .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
    .optional(),
  /** Trend over the contract window (-1..1). */
  activity_trend: z.number().min(-1).max(1).optional(),
  ndvi_delta: z.number().min(-2).max(2).optional(),
  ndbi_delta: z.number().min(-2).max(2).optional(),
  pixel_change_pct: z.number().min(0).max(100).optional(),
  /** Per-scene breakdown (typically 2: before + after). */
  scene_findings: z.array(zSatelliteSceneFinding).max(20).default([]),
  contract_window: z
    .object({
      start: z.string().datetime({ offset: true }),
      end: z.string().datetime({ offset: true }),
    })
    .optional(),
  /** GeoJSON Polygon describing the AOI requested. */
  aoi_geojson: z
    .object({
      type: z.literal('Polygon'),
      coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
    })
    .optional(),
  /** Provider chain entry that produced the result. */
  provider: z.enum(['nicfi', 'sentinel-2', 'sentinel-1', 'maxar', 'airbus']),
  cost_usd: z.number().min(0).default(0),
  /** IPFS CID of the full result JSON + low-res NDVI delta PNG. */
  result_cid: z.string().regex(/^b[a-z2-7]{55,}$/).nullable(),
});
export type SatelliteImageryPayload = z.infer<typeof zSatelliteImageryPayload>;

export const zSourceEvent = z.object({
  // Synthetic — assigned by adapter base
  id: zUuid,
  source_id: zSourceId,
  kind: zSourceEventKind,
  // Deterministic dedup key — same input MUST produce same key (SRD §11.5)
  dedup_key: z.string().min(8).max(200),
  // When the source published this content (best-effort)
  published_at: zIsoInstant.nullable(),
  // When we observed it
  observed_at: zIsoInstant,
  // Free-form structured payload, validated separately by the consumer worker
  payload: z.record(z.unknown()),
  // Optional document references attached at extraction time
  document_cids: z.array(z.string()).default([]),
  // Provenance bundle — URL, http status, response hash
  provenance: z.object({
    url: z.string().url(),
    http_status: z.number().int().min(100).max(599),
    response_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    fetched_via_proxy: z.string().nullable(),
    user_agent: z.string(),
  }),
});
export type SourceEvent = z.infer<typeof zSourceEvent>;

/* =============================================================================
 * Adapter health snapshot — written periodically by the runner
 * ===========================================================================*/

export const zAdapterHealthStatus = z.enum([
  'green',
  'amber',
  'red',
  'blocked',
  'first_contact_failed',
  'paused',
]);
export type AdapterHealthStatus = z.infer<typeof zAdapterHealthStatus>;

export const zAdapterHealthSnapshot = z.object({
  source_id: zSourceId,
  status: zAdapterHealthStatus,
  last_run_at: zIsoInstant.nullable(),
  last_success_at: zIsoInstant.nullable(),
  last_error: z.string().nullable(),
  consecutive_failures: z.number().int().nonnegative(),
  rows_in_last_run: z.number().int().nonnegative().nullable(),
  next_scheduled_at: zIsoInstant.nullable(),
});
export type AdapterHealthSnapshot = z.infer<typeof zAdapterHealthSnapshot>;
