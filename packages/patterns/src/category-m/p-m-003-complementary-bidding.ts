import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-M-003 — Complementary bidding (WB INT / OECD).
 *
 * Detection: `bid_spread_evenness_score` and `losing_bid_defect_rate`
 * from `audit_observation` events. Falls back to metadata fields.
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
    const even = readNumericWithFallback(
      subject,
      'bid_spread_evenness_score',
      'bid_spread_evenness_score',
      ['audit_observation', 'tender_notice'],
    );
    const defects = readNumericWithFallback(
      subject,
      'losing_bid_defect_rate',
      'losing_bid_defect_rate',
      ['audit_observation', 'tender_notice'],
    );
    if (even.value < 0.7 && defects.value < 0.5) {
      return notMatched(
        PID,
        `evenness=${even.value.toFixed(2)}, defects=${defects.value.toFixed(2)}`,
      );
    }
    const strength = Math.min(0.95, 0.5 + even.value * 0.3 + defects.value * 0.2);
    const ev = evidenceFrom([...even.contributors, ...defects.contributors]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Spread-evenness ${even.value.toFixed(2)}, losing-bid defect rate ${(defects.value * 100).toFixed(0)}%.`,
    });
  },
};
registerPattern(definition);
export default definition;
