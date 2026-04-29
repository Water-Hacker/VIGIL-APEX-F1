import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-A-004 — Late price-inflating amendment.
 *
 * Contract amendment increases the awarded amount by ≥ 25 % within the last
 * third of the contract period. Common cover for kickback margin.
 */
const ID = PID('P-A-004');
const INCREASE_RATIO = 1.25;

const definition: PatternDef = {
  id: ID,
  category: 'A',
  subjectKinds: ['Tender'],
  title_fr: 'Avenant tardif inflationniste',
  title_en: 'Late price-inflating amendment',
  description_fr:
    "Un avenant signé en fin d'exécution augmente le montant initial d'au moins 25 %.",
  description_en:
    'Amendment signed in the last third of the contract increases the awarded amount by ≥ 25 %.',
  defaultPrior: 0.18,
  defaultWeight: 0.6,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const award = subject.events.find((e) => e.kind === 'award');
    if (!award) return notMatched(ID, 'no award');
    const amendments = subject.events.filter((e) => e.kind === 'amendment');
    if (amendments.length === 0) return notMatched(ID, 'no amendment');

    const baseAmount = (award.payload['amount_xaf'] as number | undefined) ?? 0;
    const start = award.published_at ? new Date(award.published_at).getTime() : null;
    const declaredEnd =
      typeof award.payload['contract_end'] === 'string'
        ? new Date(award.payload['contract_end'] as string).getTime()
        : null;
    if (baseAmount === 0 || start === null || declaredEnd === null) {
      return notMatched(ID, 'missing dates or amount');
    }

    let strength = 0;
    const ids: string[] = [];
    const why: string[] = [];
    for (const am of amendments) {
      const newAmount = (am.payload['amount_xaf'] as number | undefined) ?? 0;
      if (newAmount === 0) continue;
      const ratio = newAmount / baseAmount;
      const at = am.published_at ? new Date(am.published_at).getTime() : null;
      if (at === null) continue;
      const phase = (at - start) / (declaredEnd - start);
      if (ratio >= INCREASE_RATIO && phase >= 2 / 3) {
        const s = Math.min(1, (ratio - 1) * 1.5 + (phase - 2 / 3) * 0.6);
        if (s > strength) strength = s;
        ids.push(am.id);
        why.push(`amendment +${((ratio - 1) * 100).toFixed(0)}% at phase ${(phase * 100).toFixed(0)}%`);
      }
    }
    return strength > 0
      ? matched({
          pattern_id: ID,
          strength,
          contributing_event_ids: [award.id, ...ids],
          rationale: why.join('; '),
        })
      : notMatched(ID, 'no late inflationary amendment');
  },
};

registerPattern(definition);
export default definition;
