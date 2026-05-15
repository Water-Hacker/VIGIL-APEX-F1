import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-J-003 — Concealed off-books liabilities (ACFE).
 *
 * Material obligations (long-term debt, pending litigation, contingent
 * liabilities) absent from filed financial statements. Source: ACFE.
 */
const PID = Ids.asPatternId('P-J-003');
const definition: PatternDef = {
  id: PID,
  category: 'J',
  source_body: 'ACFE',
  subjectKinds: ['Company'],
  title_fr: 'Dissimulation de passifs hors bilan',
  title_en: 'Concealed off-books liabilities',
  description_fr:
    'Engagements matériels (dette, litiges pendants, garanties) absents des états financiers déposés. Typologie ACFE.',
  description_en: 'Material obligations absent from filed financial statements. ACFE typology.',
  defaultPrior: 0.03,
  defaultWeight: 0.55,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const hiddenXaf = Number(meta.hidden_liabilities_xaf ?? 0);
    if (hiddenXaf < 100_000_000) return notMatched(PID, `hidden=${hiddenXaf} < 100M XAF`);
    const strength = Math.min(0.95, 0.3 + Math.log10(hiddenXaf / 100_000_000) * 0.25);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `${hiddenXaf.toLocaleString('fr-CM')} XAF in liabilities not reflected on filed balance sheet.`,
    });
  },
};
registerPattern(definition);
export default definition;
