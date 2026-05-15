import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readBoolWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-K-005 — Goods misclassification by HS code (FATF TBML).
 *
 * Detection: payment_order or company_filing event carrying
 * `hs_code_mismatch:true` (Cameroon Douanes reconciliation flag) and
 * optionally `hs_mismatch_implicates_sanction:true` (when the misclass
 * disguises a sanctioned-list item). Falls back to metadata.
 */
const PID = Ids.asPatternId('P-K-005');
const definition: PatternDef = {
  id: PID,
  category: 'K',
  source_body: 'FATF',
  subjectKinds: ['Payment'],
  title_fr: 'Classification SH erronée des marchandises',
  title_en: 'Goods misclassification (HS code)',
  description_fr:
    "Code SH déclaré différent de l'inspection physique : évasion tarifaire ou contournement de sanctions. Typologie FATF / WCO.",
  description_en:
    'Declared HS code differs from physical-inspection HS code: tariff evasion or sanctions evasion. FATF + WCO typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.55,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const mismatch = readBoolWithFallback(subject, 'hs_code_mismatch', 'hs_code_mismatch', [
      'payment_order',
      'company_filing',
      'audit_observation',
    ]);
    const sanctions = readBoolWithFallback(
      subject,
      'hs_mismatch_implicates_sanction',
      'hs_mismatch_implicates_sanction',
      ['payment_order', 'company_filing', 'audit_observation'],
    );
    if (!mismatch.value) return notMatched(PID, 'HS codes match');
    const strength = sanctions.value ? 0.92 : 0.6;
    const ev = evidenceFrom([...mismatch.contributors, ...sanctions.contributors]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `HS-code mismatch (sanctions-implicated: ${sanctions.value}).`,
    });
  },
};
registerPattern(definition);
export default definition;
