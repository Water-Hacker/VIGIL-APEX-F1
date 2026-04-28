import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-E-002 — Indirect sanctioned-entity exposure.
 *
 * The bidder itself is not sanctioned, but a related party (parent, subsidiary,
 * sibling-incorporation, common shareholder) is. Strength scales with the
 * directness of the link.
 */
const ID = PID('P-E-002');

const definition: PatternDef = {
  id: ID,
  category: 'E',
  subjectKinds: ['Tender', 'Company'],
  title_fr: "Exposition indirecte à une entité sanctionnée",
  title_en: 'Indirect sanctioned-entity exposure',
  description_fr:
    "Une partie liée du soumissionnaire (filiale, société sœur, actionnaire commun) figure sur une liste de sanctions.",
  description_en:
    'A related party of the bidder (subsidiary, sibling, common shareholder) is on a sanctions list.',
  defaultPrior: 0.30,
  defaultWeight: 0.7,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const company = subject.canonical;
    if (!company || company.kind !== 'company') return notMatched(ID, 'no company');
    if (company.is_sanctioned) return notMatched(ID, 'subject directly sanctioned (use P-E-001)');
    const sanctioned = subject.related.filter((r) => r.is_sanctioned);
    if (sanctioned.length === 0) return notMatched(ID, 'no related sanctioned party');
    const strength = Math.min(0.85, 0.45 + 0.1 * sanctioned.length);
    return matched({
      pattern_id: ID,
      strength,
      rationale: `${sanctioned.length} related sanctioned partie(s)`,
    });
  },
};

registerPattern(definition);
export default definition;
