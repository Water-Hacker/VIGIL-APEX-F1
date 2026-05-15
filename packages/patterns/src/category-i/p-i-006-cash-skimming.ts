import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-I-006 — Cash skimming (ACFE).
 *
 * Receipts taken before being recorded in the books. Detection from
 * cash-vs-deposit reconciliation: declared cash receipts persistently
 * below benchmarked-volume for entity type. Source: ACFE.
 */
const PID = Ids.asPatternId('P-I-006');
const definition: PatternDef = {
  id: PID,
  category: 'I',
  source_body: 'ACFE',
  subjectKinds: ['Company'],
  title_fr: 'Détournement de recettes en espèces',
  title_en: 'Cash skimming (unrecorded receipts)',
  description_fr:
    'Recettes en espèces non enregistrées : volume déclaré durablement inférieur au benchmark sectoriel ratio dépôts/transactions. Typologie ACFE.',
  description_en:
    'Cash receipts pocketed before recording: declared receipts persistently below sector benchmark for entity type. ACFE typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.5,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const ratio = Number(meta.deposit_to_expected_ratio ?? NaN);
    const sustainedMonths = Number(meta.sustained_low_deposit_months ?? 0);
    if (!Number.isFinite(ratio) || ratio >= 0.75)
      return notMatched(PID, `deposit_ratio=${ratio} not low`);
    if (sustainedMonths < 3) return notMatched(PID, `sustained_months=${sustainedMonths} < 3`);
    const strength = Math.min(0.95, 0.3 + (0.75 - ratio) * 1.5 + sustainedMonths * 0.04);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Cash receipts at ${(ratio * 100).toFixed(0)}% of benchmark for ${sustainedMonths} months.`,
    });
  },
};
registerPattern(definition);
export default definition;
