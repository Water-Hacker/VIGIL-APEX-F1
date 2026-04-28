import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-A-007 — Narrow specification (favoured-bidder fingerprint).
 *
 * The tender's technical specifications are so narrowly drawn that only one
 * supplier could realistically meet them. Heuristic signals:
 *   - exact part numbers / proprietary identifiers in spec text
 *   - prior contract referenced as a "model" for the new spec
 *   - bid count <= 2 with all eliminated except the favoured bidder
 *
 * Specs come in via the document pipeline; the worker classifies them and
 * stamps `payload.spec_proprietary_terms = number` on the tender event.
 */
const ID = PID('P-A-007');

const definition: PatternDef = {
  id: ID,
  category: 'A',
  subjectKinds: ['Tender'],
  title_fr: 'Spécification rédigée pour un fournisseur',
  title_en: 'Narrow specification favouring a single supplier',
  description_fr:
    "Termes propriétaires ou références exclusives dans le cahier des charges, peu de soumissionnaires retenus.",
  description_en:
    'Proprietary terms or exclusive references in the specification, very few bids accepted.',
  defaultPrior: 0.18,
  defaultWeight: 0.6,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const tender = subject.events.find((e) => e.kind === 'tender_notice');
    const award = subject.events.find((e) => e.kind === 'award');
    if (!tender) return notMatched(ID, 'no tender notice');
    const proprietaryTerms = (tender.payload['spec_proprietary_terms'] as number | undefined) ?? 0;
    const bidderCount = (award?.payload['bidder_count'] as number | undefined) ?? null;

    let strength = 0;
    const why: string[] = [];
    if (proprietaryTerms >= 3) {
      strength += Math.min(0.5, proprietaryTerms * 0.12);
      why.push(`proprietary terms=${proprietaryTerms}`);
    }
    if (bidderCount !== null && bidderCount <= 2) {
      strength += 0.25;
      why.push(`bidders=${bidderCount}`);
    }
    return strength === 0
      ? notMatched(ID, 'no narrow-spec signal')
      : matched({
          pattern_id: ID,
          strength,
          contributing_event_ids: [tender.id, ...(award ? [award.id] : [])],
          contributing_document_cids: [
            ...tender.document_cids,
            ...(award?.document_cids ?? []),
          ],
          rationale: why.join('; '),
        });
  },
};

registerPattern(definition);
export default definition;
