import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-B-003 — Jurisdiction shopping (offshore / opacity-friendly registries).
 *
 * Bidder is incorporated in a jurisdiction known for opaque beneficial-owner
 * disclosure (BVI, Seychelles, Mauritius, Marshall Islands, Liechtenstein,
 * Belize, etc.) AND has no Cameroonian RCCM record AND won a Cameroonian
 * public contract.
 */
const ID = PID('P-B-003');

const OPAQUE_JURISDICTIONS = new Set(
  ['vg', 'sc', 'mu', 'mh', 'li', 'bz', 'pa', 'ai', 'bs', 'gg', 'je', 'im', 'cy', 'lc', 'kn', 'vc'].map(
    (s) => s.toLowerCase(),
  ),
);

const definition: PatternDef = {
  id: ID,
  category: 'B',
  subjectKinds: ['Company'],
  title_fr: 'Optimisation de juridiction (paradis opaque)',
  title_en: 'Opaque-jurisdiction shopping',
  description_fr:
    "Soumissionnaire constitué dans une juridiction à divulgation faible (BVI, Seychelles, Maurice, Belize…) sans présence camerounaise.",
  description_en:
    'Bidder incorporated in a low-disclosure jurisdiction (BVI, Seychelles, Mauritius, Belize…) with no Cameroonian registry footprint.',
  defaultPrior: 0.30,
  defaultWeight: 0.75,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const company = subject.canonical;
    if (!company || company.kind !== 'company') return notMatched(ID, 'no company subject');
    const j = (company.jurisdiction ?? '').toLowerCase();
    const opaque = OPAQUE_JURISDICTIONS.has(j);
    const noRccm = company.rccm_number === null;
    if (!opaque) return notMatched(ID, `jurisdiction=${j} not opaque`);

    let strength = 0.55;
    const why = [`jurisdiction=${j}`];
    if (noRccm) {
      strength += 0.25;
      why.push('no Cameroonian RCCM record');
    }
    if (company.is_pep || subject.related.some((r) => r.is_pep)) {
      strength += 0.15;
      why.push('PEP linkage');
    }
    return matched({
      pattern_id: ID,
      strength: Math.min(1, strength),
      rationale: why.join('; '),
    });
  },
};

registerPattern(definition);
export default definition;
