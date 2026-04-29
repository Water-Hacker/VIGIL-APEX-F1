import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-C-003 — Quantity mismatch (specified vs delivered).
 *
 * The quantity invoiced or paid is materially larger than the quantity
 * specified in the tender (≥ 30 % over). Common signal of inflation post-
 * award without a documented amendment.
 */
const ID = PID('P-C-003');

const definition: PatternDef = {
  id: ID,
  category: 'C',
  subjectKinds: ['Tender'],
  title_fr: 'Quantités facturées supérieures à la spécification',
  title_en: 'Invoiced quantity exceeds specified quantity',
  description_fr:
    "Au moins une ligne facturée dépasse la quantité prévue de plus de 30 %, sans avenant correspondant.",
  description_en:
    'At least one invoiced line exceeds the specified quantity by > 30 % without a recorded amendment.',
  defaultPrior: 0.15,
  defaultWeight: 0.6,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const award = subject.events.find((e) => e.kind === 'award');
    const payment = subject.events.find((e) => e.kind === 'payment_order' || e.kind === 'treasury_disbursement');
    if (!award || !payment) return notMatched(ID, 'missing award or payment event');
    const specified = (award.payload['line_items'] as Array<{ qty: number; description?: string }> | undefined) ?? [];
    const invoiced = (payment.payload['line_items'] as Array<{ qty: number; description?: string }> | undefined) ?? [];
    if (specified.length === 0 || invoiced.length === 0) return notMatched(ID, 'no line items');

    const bySpecDesc = new Map(specified.map((s) => [normalise(s.description ?? ''), s.qty]));
    let strength = 0;
    const why: string[] = [];
    for (const li of invoiced) {
      const spec = bySpecDesc.get(normalise(li.description ?? ''));
      if (spec === undefined || spec <= 0) continue;
      const ratio = li.qty / spec;
      if (ratio > 1.3) {
        const s = Math.min(1, (ratio - 1.3) * 2);
        if (s > strength) strength = s;
        why.push(`${li.description ?? 'line'} +${((ratio - 1) * 100).toFixed(0)}%`);
      }
    }
    return strength === 0
      ? notMatched(ID, 'no quantity overrun')
      : matched({
          pattern_id: ID,
          strength,
          contributing_event_ids: [award.id, payment.id],
          rationale: why.slice(0, 5).join('; '),
          matchAt: 0.4,
        });
  },
};

function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

registerPattern(definition);
export default definition;
