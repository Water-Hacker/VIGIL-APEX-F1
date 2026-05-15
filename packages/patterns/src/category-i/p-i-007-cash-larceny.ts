import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

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
    const gap = readNumericWithFallback(
      subject,
      'deposit_reconciliation_gap_xaf',
      'deposit_reconciliation_gap_xaf',
      ['audit_observation', 'company_filing'],
    );
    const periods = readNumericWithFallback(subject, 'gap_periods', 'gap_periods', [
      'audit_observation',
      'company_filing',
    ]);
    if (gap.value < 1_000_000 || periods.value < 2) {
      return notMatched(PID, `gap=${gap.value} periods=${periods.value}`);
    }
    const strength = Math.min(
      0.95,
      0.5 + Math.min(0.3, Math.log10(gap.value / 1_000_000) * 0.15) + periods.value * 0.04,
    );
    const ev = evidenceFrom([...gap.contributors, ...periods.contributors]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Reconciliation gap of ${gap.value.toLocaleString('fr-CM')} XAF across ${periods.value} periods.`,
    });
  },
};
registerPattern(definition);
export default definition;
