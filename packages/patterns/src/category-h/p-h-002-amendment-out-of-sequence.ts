import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-H-002 — Amendment dated out-of-sequence with disbursement.
 *
 * A treasury disbursement is dated BEFORE the contract amendment that
 * supposedly authorised it. Either the amendment is fictive or the payment
 * preceded the legal authorisation.
 */
const ID = PID('P-H-002');

const definition: PatternDef = {
  id: ID,
  category: 'H',
  subjectKinds: ['Tender'],
  title_fr: "Décaissement antérieur à son avenant",
  title_en: 'Disbursement dated before authorising amendment',
  description_fr:
    "Le mandat de paiement est daté avant l'avenant qui en constitue le fondement légal.",
  description_en:
    'Treasury disbursement is dated before the amendment that legally authorised it.',
  defaultPrior: 0.30,
  defaultWeight: 0.75,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const amendments = subject.events.filter((e) => e.kind === 'amendment');
    const payments = subject.events.filter(
      (e) => e.kind === 'treasury_disbursement' || e.kind === 'payment_order',
    );
    if (amendments.length === 0 || payments.length === 0) return notMatched(ID, 'missing events');
    let strongest = 0;
    const why: string[] = [];
    for (const am of amendments) {
      if (!am.published_at) continue;
      const amDate = new Date(am.published_at).getTime();
      for (const pay of payments) {
        if (!pay.published_at) continue;
        const payDate = new Date(pay.published_at).getTime();
        const refersToAm = (pay.payload['authorising_amendment_id'] as string | undefined) === am.id;
        if (!refersToAm) continue;
        if (payDate < amDate) {
          const days = (amDate - payDate) / 86_400_000;
          const s = Math.min(1, days / 30);
          if (s > strongest) strongest = s;
          why.push(`payment ${days.toFixed(0)}d before authorising amendment`);
        }
      }
    }
    return strongest === 0
      ? notMatched(ID, 'no out-of-sequence pair')
      : matched({
          pattern_id: ID,
          strength: strongest,
          rationale: why.slice(0, 5).join('; '),
        });
  },
};

registerPattern(definition);
export default definition;
