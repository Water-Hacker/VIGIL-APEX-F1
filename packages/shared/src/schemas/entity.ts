import { z } from 'zod';

import { zCmrRegion, zEthAddress, zIsoInstant, zSourceId, zUuid } from './common.js';

/* =============================================================================
 * Entities — Person / Company / PublicBody / Project / Bank
 *
 * Per SRD §08: Postgres is authoritative; Neo4j is rebuilt from Postgres.
 * The `canonical` row is the de-aliased identity; `alias` rows hold every
 * surface form ever seen.
 * ===========================================================================*/

export const zEntityKind = z.enum([
  'person',
  'company',
  'public_body',
  'project',
  'bank_account',
  'unknown',
]);
export type EntityKind = z.infer<typeof zEntityKind>;

/**
 * Runtime-derived metadata bag attached to canonical entities (W-19b).
 *
 * Worker-pattern's subject-loader stamps these fields at lookup time
 * before passing the canonical to detect(): they're aggregates over the
 * graph layer (Neo4j), the audit-chain, or other workers' precomputed
 * outputs. Keeping them as named optional fields (rather than
 * `Record<string, unknown>`) gives every pattern a typed handle and
 * lets the test fixture builders write the same fields without casts.
 *
 * Adding a new metadata field is an architect decision: every reader
 * MUST tolerate the field being absent (default sentinel below).
 */
export const zEntityCanonicalMetadata = z
  .object({
    /** P-F-001 — round-trip payment back to authority. */
    roundTripDetected: z.boolean().optional(),
    roundTripHops: z.number().int().min(0).max(10).optional(),
    /** P-F-002 — director-ring graph cluster flag. */
    directorRingFlag: z.boolean().optional(),
    /** P-F-003 — supplier-circular-flow cycle length (3 = A→B→C→A). */
    supplierCycleLength: z.number().int().min(0).max(20).optional(),
    /** P-F-004 — hub-and-spoke concentration. */
    authorityConcentrationRatio: z.number().min(0).max(1).optional(),
    publicContractsCount: z.number().int().min(0).optional(),
    /** P-B-001 / P-B-005 — Louvain community membership. */
    communityId: z.number().int().optional(),
    /** P-B-002 — director / awardee tag bag. */
    tags: z.array(z.string().min(1).max(80)).optional(),
    /** P-B-006 — UBO mismatch comparison source. */
    declared_ubo: z.string().min(1).max(500).optional(),
    registry_ubo: z.string().min(1).max(500).optional(),
  })
  // Allow forward-compatible additions: an unknown field is preserved.
  .passthrough();
export type EntityCanonicalMetadata = z.infer<typeof zEntityCanonicalMetadata>;

export const zEntityCanonical = z.object({
  id: zUuid,
  kind: zEntityKind,
  display_name: z.string().min(1).max(500),
  // Resolved fields per kind — sparse
  rccm_number: z.string().min(3).max(40).nullable(),
  niu: z.string().min(3).max(40).nullable(), // tax ID
  jurisdiction: z.string().min(2).max(80).nullable(),
  region: zCmrRegion.nullable(),
  eth_address: zEthAddress.nullable(),
  is_pep: z.boolean(),
  is_sanctioned: z.boolean(),
  sanctioned_lists: z.array(z.string().min(1).max(100)).default([]),
  first_seen: zIsoInstant,
  last_seen: zIsoInstant,
  // ER metadata
  resolution_confidence: z.number().min(0).max(1),
  resolved_by: z.enum(['rule', 'llm', 'human', 'rule+llm', 'rule+human', 'llm+human']),
  // Runtime-derived metadata (W-19b). Worker-pattern's subject loader
  // populates this at request time. Always defaulted to {} so callers
  // can read `canonical.metadata.<field>` without nil checks on the
  // bag itself (each individual field is still optional).
  metadata: zEntityCanonicalMetadata.default({}),
});
export type EntityCanonical = z.infer<typeof zEntityCanonical>;

export const zEntityAlias = z.object({
  id: zUuid,
  canonical_id: zUuid,
  alias: z.string().min(1).max(500),
  source_id: zSourceId,
  language: z.enum(['fr', 'en', 'ff', 'ewo', 'unknown']), // ff = Fulfulde, ewo = Ewondo
  first_seen: zIsoInstant,
});
export type EntityAlias = z.infer<typeof zEntityAlias>;

/* =============================================================================
 * Relationships — graph edges (mirrored to Neo4j)
 * ===========================================================================*/

export const zRelationshipKind = z.enum([
  'director_of',
  'shareholder_of',
  'beneficial_owner_of',
  'employed_by',
  'contracted_by',
  'awarded_to',
  'subcontracted_to',
  'related_to',
  'paid_to',
  'paid_by',
  'family_of',
  'co_incorporator',
  'address_match',
  'phone_match',
  'bank_match',
]);
export type RelationshipKind = z.infer<typeof zRelationshipKind>;

export const zEntityRelationship = z.object({
  id: zUuid,
  kind: zRelationshipKind,
  from_canonical_id: zUuid,
  to_canonical_id: zUuid,
  evidence_strength: z.number().min(0).max(1),
  source_event_ids: z.array(zUuid).max(50),
  first_seen: zIsoInstant,
  last_seen: zIsoInstant,
  metadata: z.record(z.unknown()).default({}),
});
export type EntityRelationship = z.infer<typeof zEntityRelationship>;
