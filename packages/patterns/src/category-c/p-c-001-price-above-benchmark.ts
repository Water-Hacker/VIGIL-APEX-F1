import { Ids } from '@vigil/shared';

import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-C-001 — Price materially above benchmark.
 *
 * Fires when an awarded amount exceeds the moving median of comparable
 * tenders by ≥ 30 % (configurable). Reference pattern for category C.
 */
const PATTERN_ID = Ids.asPatternId('P-C-001');
const BENCHMARK_MULTIPLE = 1.3;

const definition: PatternDef = {
  id: PATTERN_ID,
  category: 'C',
  subjectKinds: ['Tender'],
  title_fr: 'Prix sensiblement supérieur au repère',
  title_en: 'Price materially above benchmark',
  description_fr:
    'Le montant attribué dépasse de plus de 30 % la médiane mobile des marchés comparables.',
  description_en:
    'Awarded amount exceeds the moving-median benchmark of comparable tenders by ≥ 30 %.',
  defaultPrior: 0.12,
  defaultWeight: 0.6,
  status: 'live',

  async detect(subject, ctx) {
    const award = subject.events.find((e) => e.kind === 'award');
    if (!award) return empty('no award');
    const amount =
      typeof award.payload['amount_xaf'] === 'number' ? (award.payload['amount_xaf'] as number) : null;
    const benchmark =
      typeof award.payload['benchmark_amount_xaf'] === 'number'
        ? (award.payload['benchmark_amount_xaf'] as number)
        : null;
    if (amount === null || benchmark === null || benchmark <= 0) {
      return empty('amount or benchmark missing');
    }
    const ratio = amount / benchmark;
    let strength = 0;
    const why: string[] = [];
    if (ratio >= BENCHMARK_MULTIPLE) {
      strength = Math.min(1, (ratio - 1) / 2); // ratio 1.3 → 0.15, 3.0 → 1.0
      why.push(`ratio=${ratio.toFixed(2)}`);
    }
    ctx.logger.info('p-c-001-evaluated', { ratio, strength });
    return {
      pattern_id: PATTERN_ID,
      matched: strength >= 0.3,
      strength,
      contributing_event_ids: [award.id],
      contributing_document_cids: award.document_cids,
      rationale: why.join('; ') || 'within benchmark',
    };
  },
};

function empty(reason: string) {
  return {
    pattern_id: PATTERN_ID,
    matched: false,
    strength: 0,
    contributing_event_ids: [],
    contributing_document_cids: [],
    rationale: reason,
  };
}

registerPattern(definition);
export default definition;
