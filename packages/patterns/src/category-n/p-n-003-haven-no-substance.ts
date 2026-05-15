import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-N-003 — Tax-haven holding without economic substance (OECD BEPS).
 *
 * UBO chain passes through a jurisdiction on the OECD BEPS Action 5
 * harmful regime list or the EU non-cooperative list, with no
 * operating employees, office, or revenue in that jurisdiction.
 */
const PID = Ids.asPatternId('P-N-003');
const definition: PatternDef = {
  id: PID,
  category: 'N',
  source_body: 'OECD',
  subjectKinds: ['Company'],
  title_fr: 'Holding offshore sans substance économique',
  title_en: 'Tax-haven holding without economic substance',
  description_fr:
    'Maillon de la chaîne UBO en juridiction OCDE/UE non-coopérative sans employés, bureau ou revenus locaux. Test substance économique BEPS Action 5.',
  description_en:
    'UBO-chain link in OECD/EU non-cooperative jurisdiction with no local employees, office or revenue. BEPS Action 5 economic-substance test.',
  defaultPrior: 0.05,
  defaultWeight: 0.6,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const inHavenList = meta.ubo_link_in_haven_list === true;
    const noSubstance = meta.ubo_link_no_economic_substance === true;
    if (!inHavenList || !noSubstance)
      return notMatched(PID, `haven=${inHavenList} noSubstance=${noSubstance}`);
    return matched({
      pattern_id: PID,
      strength: 0.85,
      rationale: 'UBO link in OECD/EU haven list without economic substance.',
    });
  },
};
registerPattern(definition);
export default definition;
