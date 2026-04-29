import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-A-006 — Suspicious bid-spread.
 *
 * Bid distribution shows the winning bid 5-12 % below the next bid, the next
 * three bids tightly clustered, then a single outlier far above — the
 * classic "complementary bidding" rigging signature.
 */
const ID = PID('P-A-006');

const definition: PatternDef = {
  id: ID,
  category: 'A',
  subjectKinds: ['Tender'],
  title_fr: 'Distribution suspecte des offres',
  title_en: 'Complementary-bidding distribution',
  description_fr:
    "Distribution typique d'une entente: gagnant 5-12 % sous le suivant, trois offres groupées, une aberrante.",
  description_en:
    'Classic complementary-bidding shape: winner 5-12 % under the next, three clustered, one far above.',
  defaultPrior: 0.20,
  defaultWeight: 0.65,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const award = subject.events.find((e) => e.kind === 'award');
    if (!award) return notMatched(ID, 'no award');
    const bids = (award.payload['bids'] as Array<{ amount_xaf: number }> | undefined) ?? [];
    if (bids.length < 5) return notMatched(ID, 'fewer than 5 bids');

    const sorted = [...bids].map((b) => Number(b.amount_xaf)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (sorted.length < 5) return notMatched(ID, 'invalid bid amounts');

    const winner = sorted[0]!;
    const next = sorted[1]!;
    const winRatio = next / winner; // > 1
    const cluster = sorted.slice(1, 4);
    const clusterMean = cluster.reduce((a, b) => a + b, 0) / cluster.length;
    const clusterStdev = Math.sqrt(
      cluster.reduce((acc, v) => acc + (v - clusterMean) ** 2, 0) / cluster.length,
    );
    const clusterCv = clusterStdev / clusterMean; // coefficient of variation
    const outlier = sorted[sorted.length - 1]!;
    const outlierRatio = outlier / clusterMean;

    let strength = 0;
    const why: string[] = [];
    if (winRatio >= 1.05 && winRatio <= 1.12) {
      strength += 0.35;
      why.push(`win-gap=${((winRatio - 1) * 100).toFixed(1)}%`);
    }
    if (clusterCv < 0.04) {
      strength += 0.3;
      why.push(`tight-cluster cv=${clusterCv.toFixed(3)}`);
    }
    if (outlierRatio >= 1.5) {
      strength += 0.3;
      why.push(`outlier=${outlierRatio.toFixed(1)}x`);
    }

    return strength === 0
      ? notMatched(ID, 'distribution not suspicious')
      : matched({
          pattern_id: ID,
          strength,
          contributing_event_ids: [award.id],
          contributing_document_cids: award.document_cids,
          rationale: why.join('; '),
        });
  },
};

registerPattern(definition);
export default definition;
