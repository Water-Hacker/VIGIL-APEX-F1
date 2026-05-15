import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-L-004 — Pre-award gift / travel to decision-maker (OECD).
 *
 * A material gift (luxury watch, hospitality, sponsored conference
 * travel) provided to the contract decision-maker in the 12 months
 * preceding award. Source: OECD Foreign Bribery Report,
 * UK Bribery Act §1 hospitality conversion test.
 */
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
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const giftXaf = Number(meta.pre_award_gift_value_xaf ?? 0);
    const months = Number(meta.gift_months_before_award ?? Infinity);
    if (giftXaf < 500_000 || months > 12)
      return notMatched(PID, `gift=${giftXaf} months=${months}`);
    const strength = Math.min(0.95, 0.3 + Math.log10(giftXaf / 500_000) * 0.2);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Pre-award gift valued ${giftXaf.toLocaleString('fr-CM')} XAF, ${months} months before award.`,
    });
  },
};
registerPattern(definition);
export default definition;
