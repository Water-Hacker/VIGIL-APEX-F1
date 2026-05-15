import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

const PID = Ids.asPatternId('P-I-004');
const definition: PatternDef = {
  id: PID,
  category: 'I',
  source_body: 'ACFE',
  subjectKinds: ['Person'],
  title_fr: 'Salaires ou heures supplémentaires falsifiés',
  title_en: 'Falsified wages / overtime',
  description_fr:
    'Montant brut payé supérieur au plafond contractuel + heures sup. autorisées pendant au moins 3 périodes consécutives. Typologie ACFE.',
  description_en:
    'Gross payroll exceeds contractual cap + permitted overtime for ≥ 3 consecutive periods. ACFE typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.5,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const consec = readNumericWithFallback(
      subject,
      'consecutive_overpaid_periods',
      'consecutive_overpaid_periods',
      ['payment_order', 'audit_observation'],
    );
    const excess = readNumericWithFallback(
      subject,
      'payroll_excess_ratio',
      'payroll_excess_ratio',
      ['payment_order', 'audit_observation'],
    );
    if (consec.value < 3)
      return notMatched(PID, `consecutive_overpaid_periods=${consec.value} < 3`);
    if (excess.value < 0.15) return notMatched(PID, `payroll_excess_ratio=${excess.value} < 0.15`);
    const strength = Math.min(0.95, 0.5 + consec.value * 0.05 + Math.min(0.3, excess.value));
    const ev = evidenceFrom([...consec.contributors, ...excess.contributors]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `payroll over-pay across ${consec.value} periods, excess ratio ${(excess.value * 100).toFixed(0)}%.`,
    });
  },
};
registerPattern(definition);
export default definition;
