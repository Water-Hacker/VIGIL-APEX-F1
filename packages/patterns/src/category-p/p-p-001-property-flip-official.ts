import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readBoolWithFallback, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-P-001 — Property flip: official purchases post-award at low price.
 *
 * Detection: subject is a public official (canonical.is_pep OR
 * is_official flag on filing), acquisition_price_to_market_ratio ≤ 0.7,
 * days_post_award_of_decision ≤ 730.
 */
const PID = Ids.asPatternId('P-P-001');
const definition: PatternDef = {
  id: PID,
  category: 'P',
  source_body: 'OECD',
  subjectKinds: ['Person'],
  title_fr: 'Acquisition immobilière post-attribution sous le prix du marché par un fonctionnaire',
  title_en: 'Property flip: official purchases post-award at low price',
  description_fr:
    'Fonctionnaire impliqué dans une attribution acquiert un bien immobilier post-attribution à un prix matériellement inférieur au marché. Typologie OECD / OCCRP.',
  description_en:
    'Procurement-decision official acquires real estate post-award at materially below-market price. OECD / OCCRP typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.7,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const officialFlag = readBoolWithFallback(subject, 'is_official', 'is_official', [
      'gazette_appointment',
      'company_filing',
      'pep_match',
    ]);
    const isOfficial = subject.canonical?.is_pep === true || officialFlag.value;
    if (!isOfficial) return notMatched(PID, 'subject not a public official');

    const ratio = readNumericWithFallback(
      subject,
      'acquisition_price_to_market_ratio',
      'acquisition_price_to_market_ratio',
      ['gazette_decree', 'company_filing', 'audit_observation'],
    );
    const days = readNumericWithFallback(
      subject,
      'days_post_award_of_decision',
      'days_post_award_of_decision',
      ['gazette_decree', 'company_filing', 'audit_observation'],
    );
    // ratio = 0 means no signal; treat as no match unless event present.
    if (ratio.from === 'none' || ratio.value === 0) {
      return notMatched(PID, 'no acquisition-price evidence');
    }
    if (ratio.value > 0.7 || days.value > 730 || days.from === 'none') {
      return notMatched(PID, `ratio=${ratio.value.toFixed(2)} days=${days.value}`);
    }
    const strength = Math.min(0.95, 0.55 + (0.7 - ratio.value) * 1.2);
    const ev = evidenceFrom([
      ...officialFlag.contributors,
      ...ratio.contributors,
      ...days.contributors,
    ]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Acquired at ${(ratio.value * 100).toFixed(0)}% of market ${days.value} days post-award decision.`,
    });
  },
};
registerPattern(definition);
export default definition;
