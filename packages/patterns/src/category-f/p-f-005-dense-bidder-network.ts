import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-F-005 — Dense bidder network.
 *
 * The set of bidders for a tender forms a dense subgraph in the entity graph
 * (≥ 60 % pairwise relatedness via shared directors / addresses / shareholders).
 * Strong bid-rigging signal even when shared directors are individually below
 * the P-F-002 threshold.
 */
const ID = PID('P-F-005');

const definition: PatternDef = {
  id: ID,
  category: 'F',
  subjectKinds: ['Tender'],
  title_fr: 'Réseau dense de soumissionnaires',
  title_en: 'Dense bidder network',
  description_fr:
    "Les soumissionnaires d'un même appel d'offres forment un sous-graphe dense (parts d'administrateurs, adresses, actionnaires).",
  description_en:
    'Bidders for the same tender form a dense subgraph (shared directors / addresses / shareholders).',
  defaultPrior: 0.22,
  defaultWeight: 0.7,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const award = subject.events.find((e) => e.kind === 'award');
    if (!award) return notMatched(ID, 'no award');
    const density = Number(award.payload['bidder_graph_density'] ?? 0);
    if (density < 0.6) return notMatched(ID, `density=${density.toFixed(2)}`);
    const strength = Math.min(1, (density - 0.6) * 2.5);
    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: [award.id],
      rationale: `bidder graph density ${density.toFixed(2)}`,
      matchAt: 0.2,
    });
  },
};

registerPattern(definition);
export default definition;
