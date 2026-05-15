import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-I-005 — Fictitious expense reimbursement (ACFE).
 *
 * Reimbursement claim with receipt that does not match a real
 * transaction (vendor doesn't exist, receipt number sequence
 * impossible, duplicate of an earlier claim). Source: ACFE.
 */
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
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const flags: string[] = [];
    if (meta.receipt_vendor_unknown === true) flags.push('vendor_unknown');
    if (meta.receipt_number_invalid === true) flags.push('receipt_number_invalid');
    if (meta.duplicate_of_prior_claim === true) flags.push('duplicate_claim');
    if (flags.length === 0) return notMatched(PID, 'no fictitious-expense markers');
    const strength = Math.min(0.95, 0.4 + flags.length * 0.2);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Expense markers: ${flags.join(', ')}.`,
    });
  },
};
registerPattern(definition);
export default definition;
