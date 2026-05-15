import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readBoolWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

const PID = Ids.asPatternId('P-I-005');
const definition: PatternDef = {
  id: PID,
  category: 'I',
  source_body: 'ACFE',
  subjectKinds: ['Payment'],
  title_fr: 'Note de frais fictive',
  title_en: 'Fictitious expense reimbursement',
  description_fr:
    'Remboursement avec reçu non vérifiable : vendeur inexistant, numéro de reçu impossible, doublon. Typologie ACFE.',
  description_en:
    'Reimbursement with unverifiable receipt: nonexistent vendor, impossible receipt-number sequence, duplicate. ACFE typology.',
  defaultPrior: 0.06,
  defaultWeight: 0.45,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const sources: ReadonlyArray<Schemas.SourceEventKind> = ['payment_order', 'audit_observation'];
    const noVendor = readBoolWithFallback(
      subject,
      'receipt_vendor_unknown',
      'receipt_vendor_unknown',
      sources,
    );
    const invalidNumber = readBoolWithFallback(
      subject,
      'receipt_number_invalid',
      'receipt_number_invalid',
      sources,
    );
    const dup = readBoolWithFallback(
      subject,
      'duplicate_of_prior_claim',
      'duplicate_of_prior_claim',
      sources,
    );
    const flags: string[] = [];
    if (noVendor.value) flags.push('vendor_unknown');
    if (invalidNumber.value) flags.push('receipt_number_invalid');
    if (dup.value) flags.push('duplicate_claim');
    if (flags.length === 0) return notMatched(PID, 'no fictitious-expense markers');
    const strength = Math.min(0.95, 0.55 + flags.length * 0.15);
    const ev = evidenceFrom([
      ...noVendor.contributors,
      ...invalidNumber.contributors,
      ...dup.contributors,
    ]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Expense markers: ${flags.join(', ')}.`,
    });
  },
};
registerPattern(definition);
export default definition;
