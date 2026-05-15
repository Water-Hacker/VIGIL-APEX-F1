import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-I-007 — Cash larceny (ACFE).
 *
 * Cash that was recorded in the books is subsequently stolen. Detection:
 * recorded-deposits vs. bank-statement-deposits gap; pattern persists
 * across multiple reconciliation periods. Source: ACFE.
 */
const PID = Ids.asPatternId('P-I-007');
const definition: PatternDef = {
  id: PID,
  category: 'I',
  source_body: 'ACFE',
  subjectKinds: ['Company'],
  title_fr: 'Vol de caisse (espèces enregistrées puis détournées)',
  title_en: 'Cash larceny (recorded then stolen)',
  description_fr:
    'Écart durable entre dépôts enregistrés et dépôts effectivement constatés en banque. Typologie ACFE.',
  description_en:
    'Persistent gap between recorded deposits and bank-statement deposits. ACFE typology.',
  defaultPrior: 0.03,
  defaultWeight: 0.55,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const gapXaf = Number(meta.deposit_reconciliation_gap_xaf ?? 0);
    const periods = Number(meta.gap_periods ?? 0);
    if (gapXaf < 1_000_000 || periods < 2)
      return notMatched(PID, `gap=${gapXaf} periods=${periods}`);
    const strength = Math.min(
      0.95,
      0.3 + Math.min(0.4, Math.log10(gapXaf / 1_000_000) * 0.2) + periods * 0.06,
    );
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Reconciliation gap of ${gapXaf.toLocaleString('fr-CM')} XAF across ${periods} periods.`,
    });
  },
};
registerPattern(definition);
export default definition;
