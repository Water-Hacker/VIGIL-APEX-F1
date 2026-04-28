import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-E-003 — Payment routed via sanctioned-jurisdiction bank.
 *
 * Treasury disbursement or payment order routes funds to a bank account
 * held in a jurisdiction subject to international sanctions or with active
 * FATF strategic deficiencies.
 */
const ID = PID('P-E-003');

const HIGH_RISK_JURISDICTIONS = new Set(
  ['ir', 'kp', 'sy', 'cu', 'mm'].map((s) => s.toLowerCase()),
);

const definition: PatternDef = {
  id: ID,
  category: 'E',
  subjectKinds: ['Tender'],
  title_fr: 'Paiement vers une juridiction sanctionnée',
  title_en: 'Payment routed via a sanctioned jurisdiction',
  description_fr:
    "Compte bancaire de paiement situé dans une juridiction sous sanctions internationales (Iran, RPDC, Syrie…).",
  description_en:
    'Beneficiary bank account is located in a sanctioned jurisdiction (Iran, DPRK, Syria, …).',
  defaultPrior: 0.55,
  defaultWeight: 0.95,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const payment = subject.events.find(
      (e) => e.kind === 'payment_order' || e.kind === 'treasury_disbursement',
    );
    if (!payment) return notMatched(ID, 'no payment event');
    const j = ((payment.payload['beneficiary_bank_country'] as string | undefined) ?? '').toLowerCase();
    if (!HIGH_RISK_JURISDICTIONS.has(j)) return notMatched(ID, `country=${j}`);
    return matched({
      pattern_id: ID,
      strength: 0.95,
      contributing_event_ids: [payment.id],
      rationale: `payment routed to ${j} (sanctioned jurisdiction)`,
    });
  },
};

registerPattern(definition);
export default definition;
