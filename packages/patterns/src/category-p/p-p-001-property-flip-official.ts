import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-P-001 — Property flip: official purchases post-award at low price (OECD / OCCRP).
 *
 * A public official involved in a procurement decision acquires real
 * estate post-award at a price materially below market. Pattern of
 * latent-bribery conversion to a hard asset.
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
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    if (!(meta.is_official === true)) return notMatched(PID, 'subject not a public official');
    const acquisitionRatio = Number(meta.acquisition_price_to_market_ratio ?? 1);
    const daysPostAward = Number(meta.days_post_award_of_decision ?? Infinity);
    if (acquisitionRatio > 0.7 || daysPostAward > 730) {
      return notMatched(PID, `ratio=${acquisitionRatio} days=${daysPostAward}`);
    }
    const strength = Math.min(0.95, 0.4 + (0.7 - acquisitionRatio) * 1.2);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Acquired at ${(acquisitionRatio * 100).toFixed(0)}% of market ${daysPostAward} days post-award decision.`,
    });
  },
};
registerPattern(definition);
export default definition;
