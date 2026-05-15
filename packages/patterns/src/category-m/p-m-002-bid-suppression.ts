import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readBoolWithFallback, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-M-002 — Bid suppression (WB INT / OECD).
 *
 * Detection: `bid_withdrawal_rate` ≥ 0.5 on `audit_observation` or
 * `tender_notice` events, paired with `same_winner_post_withdrawals:true`
 * on the same tender. Falls back to metadata for both fields.
 */
const PID = Ids.asPatternId('P-M-002');
const definition: PatternDef = {
  id: PID,
  category: 'M',
  source_body: 'WORLD_BANK_INT',
  subjectKinds: ['Tender'],
  title_fr: 'Suppression de soumissions',
  title_en: 'Bid suppression',
  description_fr:
    "Retrait délibéré de soumissions après l'ouverture pour libérer un attributaire pré-sélectionné. Typologie WB INT.",
  description_en:
    'Bidders deliberately withdraw after open period to clear a pre-selected winner. WB INT typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.65,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const rate = readNumericWithFallback(subject, 'bid_withdrawal_rate', 'bid_withdrawal_rate', [
      'audit_observation',
      'tender_notice',
      'cancellation',
    ]);
    const consistent = readBoolWithFallback(
      subject,
      'same_winner_post_withdrawals',
      'same_winner_post_withdrawals',
      ['audit_observation', 'award'],
    );
    if (rate.value < 0.5 || !consistent.value) {
      return notMatched(
        PID,
        `withdrawal_rate=${rate.value.toFixed(2)}, consistent_winner=${consistent.value}`,
      );
    }
    const strength = Math.min(0.95, 0.4 + rate.value * 0.5);
    const ev = evidenceFrom([...rate.contributors, ...consistent.contributors]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `${(rate.value * 100).toFixed(0)}% withdrawal rate with consistent post-withdrawal winner.`,
    });
  },
};
registerPattern(definition);
export default definition;
