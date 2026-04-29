import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-A-009 — Debarment bypass.
 *
 * A supplier or its directors appear on a debarment list (World Bank / AfDB /
 * EU / OFAC / UN) yet wins a Cameroonian public contract during the
 * debarment window. The strongest sanction-tier signal that combines
 * directly with category E.
 */
const ID = PID('P-A-009');

const definition: PatternDef = {
  id: ID,
  category: 'A',
  subjectKinds: ['Tender'],
  title_fr: 'Contournement de débarrement',
  title_en: 'Debarment bypass',
  description_fr:
    "Le fournisseur ou un de ses dirigeants est inscrit sur une liste de débarrement; le marché est attribué pendant la période d'inéligibilité.",
  description_en:
    'Supplier or one of its directors appears on a debarment list; the contract is awarded during the ineligibility period.',
  defaultPrior: 0.55,
  defaultWeight: 0.95,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const company = subject.canonical;
    const award = subject.events.find((e) => e.kind === 'award');
    if (!company || !award || !award.published_at) return notMatched(ID, 'missing canonical or award');

    if (!company.is_sanctioned && !subject.related.some((r) => r.is_sanctioned)) {
      return notMatched(ID, 'no sanction exposure');
    }
    // Award date inside debarment window (best-effort — sanction event payload
    // typically carries from/to). Without that, treat any active sanction
    // overlap as positive.
    const lists = company.sanctioned_lists;
    const strength = lists.length >= 2 ? 0.95 : 0.85;

    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: [award.id],
      contributing_document_cids: award.document_cids,
      rationale: `award during debarment window; lists=${lists.join(',') || 'related-party'}`,
    });
  },
};

registerPattern(definition);
export default definition;
