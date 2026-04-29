import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-B-006 — UBO mismatch.
 *
 * The ultimate beneficial owner declared in the procurement filing differs
 * materially from the UBO listed in the company registry (RCCM / OpenCorporates).
 * Either source may be partial, but a mismatch on the controlling shareholder
 * (>= 25 %) is a documented red flag under OHADA UBO disclosure rules.
 */
const ID = PID('P-B-006');

const definition: PatternDef = {
  id: ID,
  category: 'B',
  subjectKinds: ['Company'],
  title_fr: 'Incohérence sur le bénéficiaire effectif',
  title_en: 'UBO mismatch',
  description_fr:
    "Le bénéficiaire effectif déclaré dans la procédure de marché diffère du registre commercial.",
  description_en:
    'Beneficial owner declared in the procurement filing differs from the commercial registry.',
  defaultPrior: 0.25,
  defaultWeight: 0.75,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const company = subject.canonical;
    if (!company || company.kind !== 'company') return notMatched(ID, 'no company');

    const declaredUbo = company.metadata['declared_ubo'] as string | undefined;
    const registryUbo = company.metadata['registry_ubo'] as string | undefined;
    if (!declaredUbo || !registryUbo) return notMatched(ID, 'UBO sources missing');
    if (normalise(declaredUbo) === normalise(registryUbo)) return notMatched(ID, 'UBO match');

    return matched({
      pattern_id: ID,
      strength: 0.7,
      rationale: `declared UBO '${declaredUbo}' ≠ registry UBO '${registryUbo}'`,
    });
  },
};

function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

registerPattern(definition);
export default definition;
