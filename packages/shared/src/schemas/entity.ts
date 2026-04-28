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
