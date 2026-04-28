import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-C-005 — Currency arbitrage on a contract.
 *
 * Contract awarded in XAF but invoiced in EUR/USD using a stale conversion
 * rate that materially favours the supplier vs the BEAC fixing on the
 * payment date. ≥ 4 % gap is considered material.
 */
const ID = PID('P-C-005');

const definition: PatternDef = {
  id: ID,
  category: 'C',
  subjectKinds: ['Tender'],
  title_fr: 'Arbitrage de change en faveur du fournisseur',
  title_en: 'Supplier-favouring currency arbitrage',
  description_fr:
    "Conversion XAF/EUR ou XAF/USD appliquée à la facturation différant de plus de 4 % du fixing BEAC du jour.",
  description_en:
    'XAF/EUR or XAF/USD invoicing rate diverges from the BEAC fixing of the payment date by ≥ 4 %.',
  defaultPrior: 0.10,
  defaultWeight: 0.5,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const payment = subject.events.find((e) => e.kind === 'payment_order' || e.kind === 'treasury_disbursement');
    if (!payment) return notMatched(ID, 'no payment event');
    const invoiced = Number(payment.payload['invoice_rate'] ?? 0);
    const beacFixing = Number(payment.payload['beac_fixing_rate'] ?? 0);
    if (invoiced === 0 || beacFixing === 0) return notMatched(ID, 'missing rates');
    const gap = Math.abs(invoiced - beacFixing) / beacFixing;
    if (gap < 0.04) return notMatched(ID, `gap=${(gap * 100).toFixed(2)}%`);
    const strength = Math.min(1, (gap - 0.04) * 8);
    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: [payment.id],
      rationale: `invoiced=${invoiced} vs BEAC=${beacFixing}; gap=${(gap * 100).toFixed(2)}%`,
    });
  },
};

registerPattern(definition);
export default definition;
