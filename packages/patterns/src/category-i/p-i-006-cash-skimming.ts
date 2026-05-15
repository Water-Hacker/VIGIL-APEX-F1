import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

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
    const ratio = readNumericWithFallback(
      subject,
      'deposit_to_expected_ratio',
      'deposit_to_expected_ratio',
      ['audit_observation', 'company_filing'],
    );
    const sustained = readNumericWithFallback(
      subject,
      'sustained_low_deposit_months',
      'sustained_low_deposit_months',
      ['audit_observation', 'company_filing'],
    );
    if (ratio.from === 'none' || ratio.value >= 0.75) {
      return notMatched(PID, `deposit_ratio=${ratio.value} not low`);
    }
    if (sustained.value < 3) return notMatched(PID, `sustained_months=${sustained.value} < 3`);
    const strength = Math.min(0.95, 0.5 + (0.75 - ratio.value) * 1.2 + sustained.value * 0.03);
    const ev = evidenceFrom([...ratio.contributors, ...sustained.contributors]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Cash receipts at ${(ratio.value * 100).toFixed(0)}% of benchmark for ${sustained.value} months.`,
    });
  },
};
registerPattern(definition);
export default definition;
