import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readBoolWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-N-003 — Tax-haven holding without economic substance (OECD BEPS).
 *
 * Detection: `ubo_link_in_haven_list` AND `ubo_link_no_economic_substance`
 * from `audit_observation` / `company_filing` events. Falls back to
 * metadata fields.
 *
 * The haven-list lookup is performed upstream by an enrichment adapter
 * that joins each UBO-chain link's jurisdiction against the OECD BEPS
 * Action 5 harmful regime list + EU non-cooperative list. The economic-
 * substance test uses the BEPS Action 5 criteria (employees, office,
 * revenue in the jurisdiction).
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
    const haven = readBoolWithFallback(
      subject,
      'ubo_link_in_haven_list',
      'ubo_link_in_haven_list',
      ['audit_observation', 'company_filing'],
    );
    const noSub = readBoolWithFallback(
      subject,
      'ubo_link_no_economic_substance',
      'ubo_link_no_economic_substance',
      ['audit_observation', 'company_filing'],
    );
    if (!haven.value || !noSub.value) {
      return notMatched(PID, `haven=${haven.value} noSubstance=${noSub.value}`);
    }
    const ev = evidenceFrom([...haven.contributors, ...noSub.contributors]);
    return matched({
      pattern_id: PID,
      strength: 0.85,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: 'UBO link in OECD/EU haven list without economic substance.',
    });
  },
};
registerPattern(definition);
export default definition;
