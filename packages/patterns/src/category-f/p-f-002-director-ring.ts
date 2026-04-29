import { Ids } from '@vigil/shared';

import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-F-002 — Director-sharing ring.
 *
 * Multiple companies within a tight cluster share ≥ 2 directors, yet bid
 * against each other in the same tender bracket — the canonical bid-rigging
 * pattern. Reference pattern for category F (network anomalies).
 *
 * The actual directorRings query lives in @vigil/db-neo4j; this pattern
 * consults its precomputed metric.
 */

const PATTERN_ID = Ids.asPatternId('P-F-002');

const definition: PatternDef = {
  id: PATTERN_ID,
  category: 'F',
  subjectKinds: ['Tender', 'Company'],
  title_fr: 'Anneau de dirigeants partagés',
  title_en: 'Shared-director ring',
  description_fr:
    "Plusieurs sociétés concurrentes sur le même marché partagent au moins deux dirigeants — schéma classique d’entente.",
  description_en:
    'Multiple competing bidders share ≥ 2 directors — canonical bid-rigging signal.',
  defaultPrior: 0.30,
  defaultWeight: 0.85,
  status: 'live',

  async detect(subject, ctx) {
    const sharedDirCount = subject.related.filter(
      (r) => r.kind === 'person' && (r.metadata?.['directorRingFlag'] === true),
    ).length;
    if (sharedDirCount < 2) {
      return {
        pattern_id: PATTERN_ID,
        matched: false,
        strength: 0,
        contributing_event_ids: [],
        contributing_document_cids: [],
        rationale: `only ${sharedDirCount} shared director(s)`,
      };
    }
    // Strength scales with cluster size up to a cap
    const strength = Math.min(1, 0.4 + 0.15 * sharedDirCount);
    ctx.logger.info('p-f-002-evaluated', { sharedDirCount, strength });
    return {
      pattern_id: PATTERN_ID,
      matched: true,
      strength,
      contributing_event_ids: subject.events.map((e) => e.id).slice(0, 5),
      contributing_document_cids: [],
      rationale: `${sharedDirCount} directors shared across competing bidders`,
    };
  },
};

registerPattern(definition);
export default definition;
