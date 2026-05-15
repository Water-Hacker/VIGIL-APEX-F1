import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-L-005 — Post-award employment of decision-maker / family member (OECD / FCPA).
 *
 * Revolving-door pattern: the official who chaired the award commission
 * (or a 1st-degree family member) takes paid employment with the
 * awardee within 24 months of award. Source: OECD + FCPA enforcement
 * guidance.
 */
const PID = Ids.asPatternId('P-L-005');
const definition: PatternDef = {
  id: PID,
  category: 'L',
  source_body: 'OECD',
  subjectKinds: ['Person', 'Tender'],
  title_fr: 'Embauche post-attribution du décideur ou de sa famille',
  title_en: 'Post-award employment of decision-maker / family member',
  description_fr:
    "Porte tournante : décideur (ou parent 1er degré) embauché par l'attributaire dans les 24 mois post-attribution. Typologie OECD / FCPA.",
  description_en:
    'Revolving door: award decision-maker (or 1st-degree family member) hired by awardee within 24 months. OECD / FCPA typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.7,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const flag = meta.revolving_door_detected === true;
    const familyDegree = Number(meta.relation_degree ?? 0); // 1 = self, 2 = family
    const months = Number(meta.months_after_award ?? Infinity);
    if (!flag || months > 24) return notMatched(PID, `flag=${flag} months=${months}`);
    const strength = Math.min(0.95, 0.5 + (familyDegree === 1 ? 0.3 : 0.15) + (24 - months) * 0.01);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Decision-maker hired by awardee ${months} months post-award (relation degree ${familyDegree}).`,
    });
  },
};
registerPattern(definition);
export default definition;
