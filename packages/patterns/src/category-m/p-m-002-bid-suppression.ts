import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-M-002 — Bid suppression (WB INT / OECD).
 *
 * Bidders deliberately withdraw their bids after the open period
 * begins, clearing the way for a pre-selected winner. Detection:
 * withdrawal-rate for the entity submitting bids is elevated for
 * tenders won by a specific pre-determined supplier.
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
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const withdrawalRate = Number(meta.bid_withdrawal_rate ?? 0);
    const consistentWinner = meta.same_winner_post_withdrawals === true;
    if (withdrawalRate < 0.5 || !consistentWinner) {
      return notMatched(
        PID,
        `withdrawal_rate=${withdrawalRate}, consistent_winner=${consistentWinner}`,
      );
    }
    const strength = Math.min(0.95, 0.4 + withdrawalRate * 0.5);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `${(withdrawalRate * 100).toFixed(0)}% withdrawal rate with consistent post-withdrawal winner.`,
    });
  },
};
registerPattern(definition);
export default definition;
