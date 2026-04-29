import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-C-006 — Escalation-clause abuse.
 *
 * Contract activates an escalation clause earlier than the documented trigger
 * (e.g. clause permits revision if input cost rises ≥ 15 %; revision applied
 * after 6 % rise). Detected by comparing the clause threshold to the rise
 * recorded at revision time.
 */
const ID = PID('P-C-006');

const definition: PatternDef = {
  id: ID,
  category: 'C',
  subjectKinds: ['Tender'],
  title_fr: "Activation abusive de clause de révision",
  title_en: 'Premature escalation-clause activation',
  description_fr:
    "La clause de révision a été activée avant que le seuil contractuel ne soit atteint.",
  description_en:
    'Escalation clause activated before the contractual trigger threshold was met.',
  defaultPrior: 0.16,
  defaultWeight: 0.55,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const amendment = subject.events.find((e) => e.kind === 'amendment');
    if (!amendment) return notMatched(ID, 'no amendment');
    const triggerThreshold = Number(amendment.payload['clause_trigger_threshold_pct'] ?? 0);
    const observedRise = Number(amendment.payload['observed_input_rise_pct'] ?? 0);
    if (triggerThreshold <= 0 || observedRise <= 0) return notMatched(ID, 'missing thresholds');
    if (observedRise >= triggerThreshold) return notMatched(ID, 'within threshold');
    const gap = (triggerThreshold - observedRise) / triggerThreshold;
    const strength = Math.min(1, 0.4 + gap * 0.6);
    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: [amendment.id],
      rationale: `clause activated at ${observedRise}% vs trigger ${triggerThreshold}% (premature)`,
      matchAt: 0.4,
    });
  },
};

registerPattern(definition);
export default definition;
