import { z } from 'zod';

/**
 * Canonical structured-field schema for procurement events (`tender_notice`,
 * `award`, `amendment`, `cancellation`, `debarment`).
 *
 * Populated by `worker-extractor` from raw scraper payloads
 * (ARMP / MINMAP / COLEPS) before pattern detection runs. Fields are merged
 * into `source.events.payload` at the top level so the existing patterns
 * (P-A-001..P-A-009, P-C-*, P-H-*) read them without refactor.
 *
 * **Provenance contract.** Every extracted field's origin is recorded in
 * `_extraction_provenance` so an auditor can trace each value back to:
 *   - the deterministic-rule that fired, OR
 *   - the LLM call_record id (which itself traces back to a registered
 *     prompt via `llm.call_record.prompt_template_hash`).
 *
 * **Soft schema** — every field is optional because raw listings vary in
 * completeness. A pattern that depends on a field not present must fail
 * closed (return matched: false), never throw.
 */

export const zProcurementMethod = z.enum([
  'appel_offres_ouvert', // open tender (competitive)
  'appel_offres_restreint', // restricted tender
  'gre_a_gre', // sole-source / single-source ("gré à gré")
  'marche_negocie', // negotiated contract
  'consultation_simplifie', // simplified consultation
  'concours', // design competition
  'unknown',
]);
export type ProcurementMethod = z.infer<typeof zProcurementMethod>;

/** ISO-8601 date string, YYYY-MM-DD. */
export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const zProcurementLineItem = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().nonnegative().nullable(),
  unit: z.string().max(40).nullable(),
  unit_price_xaf: z.number().nonnegative().nullable(),
  total_xaf: z.number().nonnegative().nullable(),
});
export type ProcurementLineItem = z.infer<typeof zProcurementLineItem>;

export const zExtractionMethodTag = z.enum(['deterministic', 'llm', 'hybrid', 'adapter']);
export type ExtractionMethodTag = z.infer<typeof zExtractionMethodTag>;

export const zExtractionFieldProvenance = z.object({
  /** Which extractor produced this field. */
  method: zExtractionMethodTag,
  /** For `deterministic`: the named rule (e.g. `bidder-count.numeric-cue`).
   *  For `llm`: the llm.call_record id.
   *  For `adapter`: the source_id (e.g. `cm-armp-main`). */
  detail: z.string().max(200),
  /** Confidence in [0,1]. Deterministic rules pin to 1.0; LLM uses verbatim-grounding score. */
  confidence: z.number().min(0).max(1),
});
export type ExtractionFieldProvenance = z.infer<typeof zExtractionFieldProvenance>;

/**
 * Structured fields the extractor produces. ALL fields are top-level on
 * `event.payload` after merge — patterns read e.g. `payload['bidder_count']`.
 * This object exists for typed orchestration inside the worker.
 */
export const zProcurementFields = z.object({
  bidder_count: z.number().int().nonnegative().nullable(),
  procurement_method: zProcurementMethod.nullable(),
  supplier_name: z.string().min(1).max(300).nullable(),
  supplier_rccm: z.string().max(40).nullable(),
  supplier_niu: z.string().max(40).nullable(),
  amount_xaf: z.number().nonnegative().nullable(),
  effective_date: zIsoDate.nullable(),
  award_date: zIsoDate.nullable(),
  tender_close_date: zIsoDate.nullable(),
  tender_publication_date: zIsoDate.nullable(),
  contracting_authority_name: z.string().max(300).nullable(),
  region: z.string().max(60).nullable(),
  /** Top-level text indication that an escalation/price-revision clause is referenced. */
  has_escalation_clause: z.boolean().nullable(),
  /** Line-item table when present (max 200 rows; truncate beyond). */
  line_items: z.array(zProcurementLineItem).max(200).nullable(),
  /** Free-form keywords surfaced for pattern signals (e.g. "exclusion", "résilié"). */
  status_keywords: z.array(z.string().min(1).max(60)).max(20).nullable(),
});
export type ProcurementFields = z.infer<typeof zProcurementFields>;

/**
 * Provenance record co-stored at `event.payload._extraction_provenance`.
 *
 * Maps every populated key in `ProcurementFields` to its origin so the audit
 * trail survives field-level interrogation. Schema is keyed by field name.
 */
export const zProcurementExtractionProvenance = z.object({
  extracted_at: z.string(), // ISO-8601 datetime
  extractor_version: z.string(), // semver tag of worker-extractor
  /** Per-field origin map. Keys are `keyof ProcurementFields`. */
  fields: z.record(zExtractionFieldProvenance),
  /** Did the deterministic rules fire alone, or did the LLM contribute? */
  llm_call_record_id: z.string().uuid().nullable(),
  /** SHA-256 of the raw input text the extractor consumed (for diff-detection). */
  input_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ProcurementExtractionProvenance = z.infer<typeof zProcurementExtractionProvenance>;

/** Convenience union of every key the extractor may populate. */
export const PROCUREMENT_FIELD_KEYS = [
  'bidder_count',
  'procurement_method',
  'supplier_name',
  'supplier_rccm',
  'supplier_niu',
  'amount_xaf',
  'effective_date',
  'award_date',
  'tender_close_date',
  'tender_publication_date',
  'contracting_authority_name',
  'region',
  'has_escalation_clause',
  'line_items',
  'status_keywords',
] as const;
export type ProcurementFieldKey = (typeof PROCUREMENT_FIELD_KEYS)[number];

/**
 * Cameroonian regions — pinned list because event payloads tag the region
 * for the per-region calibration the certainty engine wants (SRD §19.5).
 */
export const CAMEROON_REGIONS = [
  'Adamaoua',
  'Centre',
  'Est',
  'Extrême-Nord',
  'Littoral',
  'Nord',
  'Nord-Ouest',
  'Ouest',
  'Sud',
  'Sud-Ouest',
] as const;
export type CameroonRegion = (typeof CAMEROON_REGIONS)[number];
