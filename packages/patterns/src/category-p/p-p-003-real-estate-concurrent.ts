import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-P-003 — Real-estate acquisition by contractor's UBO concurrent with state payment.
 *
 * UBO of the awardee acquires real estate (in Cameroon or abroad)
 * within 90 days of receiving a material state payment. Source:
 * OCCRP / Pandora Papers acquisition-pattern analyses.
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
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const days = Number(meta.days_after_state_payment ?? Infinity);
    const propertyXaf = Number(meta.property_value_xaf ?? 0);
    if (days > 90 || propertyXaf < 50_000_000) {
      return notMatched(PID, `days=${days} property_xaf=${propertyXaf}`);
    }
    const strength = Math.min(
      0.95,
      0.4 + Math.log10(propertyXaf / 50_000_000) * 0.15 + (90 - days) * 0.003,
    );
    return matched({
      pattern_id: PID,
      strength,
      rationale: `UBO acquired property valued ${propertyXaf.toLocaleString('fr-CM')} XAF ${days} days post-state-payment.`,
    });
  },
};
registerPattern(definition);
export default definition;
