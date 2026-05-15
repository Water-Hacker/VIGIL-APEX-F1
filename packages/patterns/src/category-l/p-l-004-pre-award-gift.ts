import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

const PID = Ids.asPatternId('P-L-004');
const definition: PatternDef = {
  id: PID,
  category: 'L',
  source_body: 'OECD',
  subjectKinds: ['Tender'],
  title_fr: 'Cadeau / voyage pré-attribution au décideur',
  title_en: 'Pre-award gift / travel to decision-maker',
  description_fr:
    "Cadeau matériel ou voyage offert au décideur dans les 12 mois précédant l'attribution. Test OECD / UK Bribery Act §1.",
  description_en:
    'Material gift or hospitality provided to award decision-maker within 12 months preceding award. OECD / UK Bribery Act §1 conversion test.',
  defaultPrior: 0.04,
  defaultWeight: 0.5,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const gift = readNumericWithFallback(
      subject,
      'pre_award_gift_value_xaf',
      'pre_award_gift_value_xaf',
      ['gazette_appointment', 'audit_observation', 'court_judgement'],
    );
    const months = readNumericWithFallback(
      subject,
      'gift_months_before_award',
      'gift_months_before_award',
      ['gazette_appointment', 'audit_observation', 'court_judgement'],
    );
    if (gift.value < 500_000 || months.from === 'none' || months.value > 12) {
      return notMatched(PID, `gift=${gift.value} months=${months.value}`);
    }
    const strength = Math.min(0.95, 0.5 + Math.log10(gift.value / 500_000) * 0.18);
    const ev = evidenceFrom([...gift.contributors, ...months.contributors]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Pre-award gift valued ${gift.value.toLocaleString('fr-CM')} XAF, ${months.value} months before award.`,
    });
  },
};
registerPattern(definition);
export default definition;
