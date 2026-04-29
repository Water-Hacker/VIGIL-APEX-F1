import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-C-004 — Inflation divergence.
 *
 * The price escalation applied to a multi-year contract is materially higher
 * than the official Cameroon CPI for the period. Suggests a non-standard
 * escalation clause being abused.
 */
const ID = PID('P-C-004');

const definition: PatternDef = {
  id: ID,
  category: 'C',
  subjectKinds: ['Tender'],
  title_fr: 'Indexation supérieure à l\'inflation officielle',
  title_en: 'Escalation above official CPI',
  description_fr:
    "L'indexation appliquée au marché dépasse l'inflation officielle (BEAC) sur la période, sans clause publiée.",
  description_en: 'Escalation applied to the contract exceeds official BEAC CPI over the period.',
  defaultPrior: 0.14,
  defaultWeight: 0.55,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const award = subject.events.find((e) => e.kind === 'award');
    if (!award) return notMatched(ID, 'no award');
    const escalation = Number(award.payload['escalation_pct'] ?? 0);
    const cpiOverPeriod = Number(award.payload['cpi_pct_over_period'] ?? 0);
    if (escalation === 0 || cpiOverPeriod === 0) return notMatched(ID, 'missing escalation or CPI');
    const gap = escalation - cpiOverPeriod;
    if (gap < 3) return notMatched(ID, `gap=${gap.toFixed(1)}pp`);
    const strength = Math.min(1, gap / 12);
    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: [award.id],
      rationale: `escalation=${escalation}% vs CPI=${cpiOverPeriod}%; gap=${gap.toFixed(1)}pp`,
      matchAt: 0.35,
    });
  },
};

registerPattern(definition);
export default definition;
