import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-D-002 — Incomplete construction (signed off as complete).
 *
 * The contract was signed off as complete (`completion_certificate` event)
 * but satellite imagery shows partial construction (activity 0.2-0.6).
 * Distinct from P-D-001 (no activity at all); this one fires on attested
 * completion with visible incompleteness.
 */
const ID = PID('P-D-002');

const definition: PatternDef = {
  id: ID,
  category: 'D',
  subjectKinds: ['Project'],
  title_fr: "Réception prononcée alors que l'ouvrage est incomplet",
  title_en: 'Project signed off as complete despite visible incompleteness',
  description_fr:
    "Procès-verbal de réception alors que l'imagerie satellite révèle une construction partielle.",
  description_en:
    'Completion certificate signed while satellite imagery shows the work is partial.',
  defaultPrior: 0.30,
  defaultWeight: 0.85,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const completion = subject.events.find(
      (e) =>
        e.kind === 'investment_project' && e.payload['completion_certified'] === true,
    );
    const sat = subject.events.find((e) => e.kind === 'satellite_imagery');
    if (!completion || !sat) return notMatched(ID, 'missing completion or satellite event');
    const activity = Number(sat.payload['activity_score'] ?? -1);
    if (activity < 0) return notMatched(ID, 'no activity_score');
    if (activity >= 0.7) return notMatched(ID, `activity=${activity}`);
    const strength = Math.min(1, (0.7 - activity) * 1.5);
    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: [completion.id, sat.id],
      contributing_document_cids: [...completion.document_cids, ...sat.document_cids],
      rationale: `completion certified but satellite activity=${activity.toFixed(2)}`,
    });
  },
};

registerPattern(definition);
export default definition;
