import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-M-003 — Complementary bidding (WB INT / OECD).
 *
 * Losing bidders deliberately submit non-competitive offers to give
 * the appearance of competition. Detection: bid spreads are too even
 * (variance < threshold) OR losing bids contain elementary errors
 * (round numbers, missing technical fields) at suspicious rate.
 */
const PID = Ids.asPatternId('P-M-003');
const definition: PatternDef = {
  id: PID,
  category: 'M',
  source_body: 'WORLD_BANK_INT',
  subjectKinds: ['Tender'],
  title_fr: 'Soumissions de complaisance',
  title_en: 'Complementary bidding',
  description_fr:
    'Offres perdantes délibérément non compétitives (montants ronds, champs techniques manquants) pour simuler la concurrence. Typologie WB INT.',
  description_en:
    'Losing bids deliberately uncompetitive (round numbers, missing technical fields) to simulate competition. WB INT typology.',
  defaultPrior: 0.05,
  defaultWeight: 0.6,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const evenSpreadScore = Number(meta.bid_spread_evenness_score ?? 0); // higher = more suspicious
    const losingDefectRate = Number(meta.losing_bid_defect_rate ?? 0);
    if (evenSpreadScore < 0.7 && losingDefectRate < 0.5) {
      return notMatched(PID, `evenness=${evenSpreadScore}, defects=${losingDefectRate}`);
    }
    const strength = Math.min(0.95, 0.3 + evenSpreadScore * 0.4 + losingDefectRate * 0.3);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Spread-evenness ${evenSpreadScore.toFixed(2)}, losing-bid defect rate ${(losingDefectRate * 100).toFixed(0)}%.`,
    });
  },
};
registerPattern(definition);
export default definition;
