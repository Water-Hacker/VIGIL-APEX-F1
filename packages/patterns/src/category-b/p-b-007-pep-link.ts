import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-B-007 — Politically-exposed-person linkage.
 *
 * A direct director, shareholder, family member, or known business associate
 * of the bidder is a Cameroonian Politically-Exposed Person (PEP) per the
 * ANIF registry or OpenSanctions PEP feed. Note: PEP linkage alone is NOT a
 * finding — context matters. This pattern's strength is intentionally
 * moderate; the certainty engine combines it with other signals before
 * crossing the escalation threshold.
 */
const ID = PID('P-B-007');

const definition: PatternDef = {
  id: ID,
  category: 'B',
  subjectKinds: ['Company', 'Tender'],
  title_fr: 'Lien avec une personne politiquement exposée',
  title_en: 'Politically-exposed-person linkage',
  description_fr:
    "Un dirigeant, actionnaire ou proche du soumissionnaire est inscrit comme personne politiquement exposée (PPE).",
  description_en:
    'A director, shareholder, or close associate of the bidder is recorded as a Politically-Exposed Person.',
  defaultPrior: 0.18,
  defaultWeight: 0.55,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const peps = subject.related.filter((r) => r.is_pep);
    if (peps.length === 0) return notMatched(ID, 'no PEP linkage');
    const namesUnderRedaction = peps.map((p) => p.id.slice(0, 8)); // never log names
    const strength = Math.min(0.7, 0.4 + 0.1 * peps.length);
    return matched({
      pattern_id: ID,
      strength,
      rationale: `${peps.length} PEP linkage(s) detected (ids ${namesUnderRedaction.join(',')})`,
    });
  },
};

registerPattern(definition);
export default definition;
