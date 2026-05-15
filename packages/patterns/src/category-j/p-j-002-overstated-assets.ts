import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-J-002 — Overstated asset valuation (ACFE).
 *
 * Declared fixed-asset or inventory value > independently appraised
 * value by a material margin. Source: ACFE.
 */
const PID = Ids.asPatternId('P-J-002');
const definition: PatternDef = {
  id: PID,
  category: 'J',
  source_body: 'ACFE',
  subjectKinds: ['Company'],
  title_fr: "Surévaluation d'actifs",
  title_en: 'Overstated asset valuation',
  description_fr:
    "Valeur déclarée des immobilisations ou stocks supérieure à l'évaluation indépendante. Typologie ACFE.",
  description_en:
    'Declared fixed-asset or inventory value materially above independent appraisal. ACFE typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.5,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const ratio = Number(meta.asset_overvaluation_ratio ?? 0);
    if (ratio < 0.2) return notMatched(PID, `overvaluation_ratio=${ratio} < 20%`);
    const strength = Math.min(0.95, 0.3 + ratio * 1.5);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Asset valuation ${(ratio * 100).toFixed(0)}% above independent appraisal.`,
    });
  },
};
registerPattern(definition);
export default definition;
