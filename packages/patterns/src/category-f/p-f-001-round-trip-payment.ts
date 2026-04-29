import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-F-001 — Round-trip payment.
 *
 * Funds disbursed to supplier A return — directly or after one or two hops —
 * to an account controlled by the awarding authority's officer (or their
 * known kin). Detected from `paid_to` / `paid_by` graph edges plus PEP /
 * family flags.
 */
const ID = PID('P-F-001');

const definition: PatternDef = {
  id: ID,
  category: 'F',
  subjectKinds: ['Tender', 'Payment'],
  title_fr: 'Retour de fonds vers l\'autorité contractante',
  title_en: 'Round-trip payment back to awarding authority',
  description_fr:
    "Les fonds versés au fournisseur reviennent — directement ou en 1-2 sauts — sur un compte lié à l'ordonnateur.",
  description_en:
    'Funds paid to the supplier return — directly or in 1-2 hops — to an account linked to the awarding authority.',
  defaultPrior: 0.40,
  defaultWeight: 0.9,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    // The graph layer (Neo4j) has the `paid_to` / `paid_by` edges. We rely on
    // a precomputed `roundTripDetected` flag on the canonical metadata so this
    // pattern stays pure; the graph traversal lives in worker-pattern's subject loader.
    const company = subject.canonical;
    if (!company) return notMatched(ID, 'no canonical');
    const flag = company.metadata['roundTripDetected'] === true;
    const hops = Number(company.metadata['roundTripHops'] ?? 0);
    if (!flag) return notMatched(ID, 'no round-trip path');
    const strength = hops <= 1 ? 0.9 : hops === 2 ? 0.7 : 0.55;
    return matched({
      pattern_id: ID,
      strength,
      rationale: `round-trip detected at ${hops} hop(s)`,
    });
  },
};

registerPattern(definition);
export default definition;
