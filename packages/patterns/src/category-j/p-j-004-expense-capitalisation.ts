import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-J-004 — Expense capitalisation / deferral (ACFE).
 *
 * Operating expenses classified as capital expenditure to defer
 * impact on profit & loss. Detection: capex/opex ratio diverges from
 * industry benchmark. Source: ACFE.
 */
const PID = Ids.asPatternId('P-J-004');
const definition: PatternDef = {
  id: PID,
  category: 'J',
  source_body: 'ACFE',
  subjectKinds: ['Company'],
  title_fr: "Capitalisation abusive de charges d'exploitation",
  title_en: 'Expense capitalisation / deferral',
  description_fr:
    "Frais d'exploitation classés en immobilisation pour différer leur impact comptable. Ratio capex/opex anormal vs. benchmark sectoriel. Typologie ACFE.",
  description_en:
    'Operating expenses classified as capital expenditure to defer P&L impact. Capex/opex ratio diverges from sector benchmark. ACFE typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.45,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const dev = Number(meta.capex_to_benchmark_deviation ?? 0);
    if (dev < 0.3) return notMatched(PID, `capex_dev=${dev} < 30%`);
    const strength = Math.min(0.95, 0.3 + dev * 1.2);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Capex/opex ratio ${(dev * 100).toFixed(0)}% above sector benchmark.`,
    });
  },
};
registerPattern(definition);
export default definition;
