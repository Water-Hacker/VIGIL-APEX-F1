import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-N-002 — UBO changed within 90 days before award (EITI 2.5).
 *
 * Recent UBO change immediately preceding a contract award is a
 * specific Cameroonian AML decree red flag (Loi 2010/012) and an
 * EITI Standard 2.5 disclosure marker.
 */
const PID = Ids.asPatternId('P-N-002');
const definition: PatternDef = {
  id: PID,
  category: 'N',
  source_body: 'EITI',
  subjectKinds: ['Company', 'Tender'],
  title_fr: 'Changement de bénéficiaire effectif dans les 90 jours pré-attribution',
  title_en: 'UBO changed within 90 days before award',
  description_fr:
    "Changement récent de bénéficiaire effectif juste avant l'attribution. Signal AML Loi 2010/012 + EITI 2.5.",
  description_en:
    'Recent UBO change immediately preceding award. AML Loi 2010/012 + EITI 2.5 marker.',
  defaultPrior: 0.05,
  defaultWeight: 0.55,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const days = Number(meta.days_ubo_change_to_award ?? Infinity);
    if (days > 90) return notMatched(PID, `days_ubo_change_to_award=${days} > 90`);
    const strength = Math.min(0.95, 0.4 + (90 - Math.max(0, days)) * 0.005);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `UBO changed ${days} days before award.`,
    });
  },
};
registerPattern(definition);
export default definition;
