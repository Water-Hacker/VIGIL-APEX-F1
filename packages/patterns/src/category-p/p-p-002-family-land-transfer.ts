import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readBoolWithFallback, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-P-002 — Land title to official's family member within 90 days post-award.
 *
 * Detection: 1st-degree family relation to an involved official, land
 * title transferred ≤ 90 days after a contract award decision the
 * official took part in.
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
    const linked = readBoolWithFallback(subject, 'linked_to_official', 'linked_to_official', [
      'gazette_decree',
      'company_filing',
      'audit_observation',
    ]);
    const degree = readNumericWithFallback(subject, 'relation_degree', 'relation_degree', [
      'gazette_decree',
      'company_filing',
      'audit_observation',
    ]);
    const days = readNumericWithFallback(subject, 'days_after_award', 'days_after_award', [
      'gazette_decree',
      'company_filing',
      'audit_observation',
    ]);

    if (
      !linked.value ||
      degree.value > 1 ||
      degree.from === 'none' ||
      days.value > 90 ||
      days.from === 'none'
    ) {
      return notMatched(PID, `linked=${linked.value} deg=${degree.value} days=${days.value}`);
    }
    const strength = Math.min(0.95, 0.65 + (90 - Math.max(0, days.value)) * 0.003);
    const ev = evidenceFrom([...linked.contributors, ...degree.contributors, ...days.contributors]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `1st-degree family transfer ${days.value} days post-award.`,
    });
  },
};
registerPattern(definition);
export default definition;
