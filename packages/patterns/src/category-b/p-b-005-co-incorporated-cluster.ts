import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-B-005 — Co-incorporated cluster (same address / same date).
 *
 * Multiple companies share an incorporation date or registered address with
 * the subject company within a tight window. Combined with director-ring
 * (P-F-002) this typically lights up the canonical shell-cluster pattern.
 *
 * The cluster size is supplied via subject.metrics.communityId from the
 * Louvain community-detection pass; we count siblings in the same community.
 */
const ID = PID('P-B-005');

const definition: PatternDef = {
  id: ID,
  category: 'B',
  subjectKinds: ['Company'],
  title_fr: 'Constitution simultanée en grappe',
  title_en: 'Co-incorporated cluster',
  description_fr:
    "Plusieurs sociétés constituées à la même date ou à la même adresse dans une fenêtre courte.",
  description_en: 'Multiple companies incorporated at the same date or address within a short window.',
  defaultPrior: 0.20,
  defaultWeight: 0.7,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const company = subject.canonical;
    if (!company || company.kind !== 'company') return notMatched(ID, 'no company');
    const myCommunity = subject.metrics?.communityId;
    if (myCommunity === undefined) return notMatched(ID, 'community not computed');
    const sameCommunity = subject.related.filter(
      (r) => r.kind === 'company' && r.metadata?.['communityId'] === myCommunity,
    );
    if (sameCommunity.length < 3) return notMatched(ID, `cluster=${sameCommunity.length}`);

    const strength = Math.min(1, 0.4 + 0.06 * sameCommunity.length);
    return matched({
      pattern_id: ID,
      strength,
      rationale: `cluster of ${sameCommunity.length} co-incorporated peers`,
    });
  },
};

registerPattern(definition);
export default definition;
