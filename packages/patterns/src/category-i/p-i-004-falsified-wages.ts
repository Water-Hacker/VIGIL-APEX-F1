import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-I-004 — Falsified wages / overtime (ACFE Fraud Tree).
 *
 * Payroll fraud where actual hours / rate are inflated. Detection
 * from upstream HR-feed reconciliation: payroll `gross_amount` >
 * declared `contractual_amount × allowed_overtime_max` for the period,
 * across >= 3 consecutive periods. Source: ACFE.
 */
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
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const consec = Number(meta.consecutive_overpaid_periods ?? 0);
    const excessRatio = Number(meta.payroll_excess_ratio ?? 0);
    if (consec < 3) return notMatched(PID, `consecutive_overpaid_periods=${consec} < 3`);
    if (excessRatio < 0.15) return notMatched(PID, `payroll_excess_ratio=${excessRatio} < 0.15`);
    const strength = Math.min(0.95, 0.3 + consec * 0.08 + Math.min(0.4, excessRatio));
    return matched({
      pattern_id: PID,
      strength,
      rationale: `payroll over-pay across ${consec} periods, excess ratio ${(excessRatio * 100).toFixed(0)}%.`,
    });
  },
};
registerPattern(definition);
export default definition;
