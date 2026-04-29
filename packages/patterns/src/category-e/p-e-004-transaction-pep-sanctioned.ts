import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-E-004 — Transaction with PEP-controlled sanctioned vehicle.
 *
 * Highest-severity combined signal: the bidder is owned/controlled by a PEP
 * AND any related party is sanctioned. Posterior alone often crosses the
 * escalation threshold.
 */
const ID = PID('P-E-004');

const definition: PatternDef = {
  id: ID,
  category: 'E',
  subjectKinds: ['Tender', 'Company'],
  title_fr: "Transaction via un véhicule contrôlé par PPE et sanctionné",
  title_en: 'PEP-controlled sanctioned vehicle transaction',
  description_fr:
    "Le soumissionnaire est contrôlé par une PPE et une partie liée figure sur une liste de sanctions.",
  description_en:
    'Bidder is PEP-controlled and a related party is sanctioned — combined signal.',
  defaultPrior: 0.50,
  defaultWeight: 0.95,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const company = subject.canonical;
    if (!company || company.kind !== 'company') return notMatched(ID, 'no company');
    const pepControlled =
      company.is_pep || subject.related.some((r) => r.kind === 'person' && r.is_pep);
    const sanctionedRelated = subject.related.some((r) => r.is_sanctioned);
    if (!pepControlled || !sanctionedRelated) {
      return notMatched(ID, `pep=${pepControlled}, sanctioned=${sanctionedRelated}`);
    }
    return matched({
      pattern_id: ID,
      strength: 0.92,
      rationale: 'PEP-controlled bidder with sanctioned related party',
    });
  },
};

registerPattern(definition);
export default definition;
