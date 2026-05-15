import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-P-003 — Real-estate acquisition by contractor's UBO concurrent with state payment.
 *
 * Detection: `days_after_state_payment` ≤ 90 AND `property_value_xaf`
 * ≥ 50M. Both fields come from a `gazette_decree` or `audit_observation`
 * event (property registry adapter writes them). Falls back to metadata.
 */
const PID = Ids.asPatternId('P-P-003');
const definition: PatternDef = {
  id: PID,
  category: 'P',
  source_body: 'OCCRP',
  subjectKinds: ['Person', 'Payment'],
  title_fr: "Acquisition immobilière par l'UBO concomitante à un paiement de l'État",
  title_en: "Real-estate acquisition by contractor's UBO concurrent with state payment",
  description_fr:
    "UBO de l'attributaire acquiert un bien immobilier dans les 90 jours suivant un paiement matériel de l'État. Typologie OCCRP.",
  description_en:
    "Awardee's UBO acquires real estate within 90 days of a material state payment. OCCRP typology.",
  defaultPrior: 0.04,
  defaultWeight: 0.6,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const days = readNumericWithFallback(
      subject,
      'days_after_state_payment',
      'days_after_state_payment',
      ['gazette_decree', 'audit_observation', 'company_filing'],
    );
    const value = readNumericWithFallback(subject, 'property_value_xaf', 'property_value_xaf', [
      'gazette_decree',
      'audit_observation',
      'company_filing',
    ]);
    if (
      days.from === 'none' ||
      value.from === 'none' ||
      days.value > 90 ||
      value.value < 50_000_000
    ) {
      return notMatched(PID, `days=${days.value} property_xaf=${value.value}`);
    }
    const strength = Math.min(
      0.95,
      0.55 + Math.log10(value.value / 50_000_000) * 0.15 + (90 - days.value) * 0.003,
    );
    const ev = evidenceFrom([...days.contributors, ...value.contributors]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `UBO acquired property valued ${value.value.toLocaleString('fr-CM')} XAF ${days.value} days post-state-payment.`,
    });
  },
};
registerPattern(definition);
export default definition;
