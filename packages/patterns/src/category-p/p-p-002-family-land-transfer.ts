import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-P-002 — Land title to official's family member within 90 days of contract (FATF R.32).
 *
 * Family-member proxy used to receive value transfer. ANIF Loi 2018/011
 * (Patrimoine Inexpliqué) lists this exactly.
 */
const PID = Ids.asPatternId('P-P-002');
const definition: PatternDef = {
  id: PID,
  category: 'P',
  source_body: 'FATF',
  subjectKinds: ['Person'],
  title_fr: 'Transfert de titre foncier à un proche de fonctionnaire ≤ 90 j post-attribution',
  title_en: "Land title to official's family member ≤ 90 days post-award",
  description_fr:
    "Titre foncier transféré à un parent 1er degré d'un fonctionnaire impliqué dans une attribution, dans les 90 jours. ANIF Loi 2018/011.",
  description_en:
    'Land title transferred to a 1st-degree family member of an involved official within 90 days. ANIF Loi 2018/011.',
  defaultPrior: 0.03,
  defaultWeight: 0.7,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const linkedOfficial = meta.linked_to_official === true;
    const relationDegree = Number(meta.relation_degree ?? 0);
    const days = Number(meta.days_after_award ?? Infinity);
    if (!linkedOfficial || relationDegree > 1 || days > 90) {
      return notMatched(PID, `linked=${linkedOfficial} deg=${relationDegree} days=${days}`);
    }
    const strength = Math.min(0.95, 0.6 + (90 - Math.max(0, days)) * 0.003);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `1st-degree family transfer ${days} days post-award.`,
    });
  },
};
registerPattern(definition);
export default definition;
