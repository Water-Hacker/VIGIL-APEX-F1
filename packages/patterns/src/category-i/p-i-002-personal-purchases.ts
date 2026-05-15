import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-I-002 — Personal purchases on state account (ACFE).
 *
 * Asset Misappropriation → Cash → Fraudulent Disbursements → Billing
 * → Personal Purchases.
 *
 * ACFE typology: state procurement card or vendor relationship is
 * used to buy personal goods/services for an employee or their
 * family. Detection from upstream entity-resolution:
 * `personal_purchase_indicators` flags a vendor whose merchant category
 * code (MCC) is "consumer retail" / "personal services" yet receives
 * material recurring state payments.
 *
 * Source: ACFE Fraud Tree v2; commonly seen across African public-
 * sector audits (Auditor-General reports flag these as "lifestyle
 * disbursements").
 */

const PID = Ids.asPatternId('P-I-002');

const definition: PatternDef = {
  id: PID,
  category: 'I',
  source_body: 'ACFE',
  subjectKinds: ['Payment'],
  title_fr: "Achats personnels sur compte de l'État",
  title_en: 'Personal purchases on state account',
  description_fr:
    "Détournement par achats personnels facturés à un compte public : catégorie marchande (MCC) « commerce de détail » ou « services personnels », paiements récurrents matériels provenant de l'État. Typologie ACFE.",
  description_en:
    'Asset-misappropriation via personal purchases billed to a state procurement account: vendor merchant-category code "consumer retail" or "personal services" receiving material recurring state payments. ACFE typology.',
  defaultPrior: 0.05,
  defaultWeight: 0.55,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    if (subject.kind !== 'Payment') {
      return notMatched(PID, 'subject is not a Payment');
    }
    const payments = subject.events.filter((e) => e.kind === 'payment_order');
    if (payments.length === 0) {
      return notMatched(PID, 'no payment events');
    }

    const consumerMccs = new Set([
      'consumer_retail',
      'personal_services',
      'restaurants',
      'travel_leisure',
      'jewelry_luxury',
      'electronics_personal',
    ]);

    const flagged = payments.filter((p) => {
      const mcc = ((p.payload['merchant_category'] as string | undefined) ?? '').toLowerCase();
      const isStateOrigin = p.payload['ordering_customer_country'] === 'CM';
      return isStateOrigin && consumerMccs.has(mcc);
    });

    if (flagged.length === 0) {
      return notMatched(PID, 'no consumer-MCC payment from state-origin observed');
    }

    const totalFlaggedXaf = flagged.reduce(
      (acc, p) => acc + Number(p.payload['amount_xaf'] ?? 0),
      0,
    );
    const materialThresholdXaf = 5_000_000; // 5M XAF ~= 7,500 EUR
    if (totalFlaggedXaf < materialThresholdXaf) {
      return notMatched(
        PID,
        `consumer-MCC payments below materiality threshold (${totalFlaggedXaf} XAF < ${materialThresholdXaf})`,
      );
    }

    // Strength: log-scaled with total amount + count.
    const countComponent = Math.min(0.5, flagged.length * 0.1);
    const amountComponent = Math.min(
      0.5,
      Math.log10(totalFlaggedXaf / materialThresholdXaf) * 0.25,
    );
    const strength = Math.min(0.95, countComponent + amountComponent + 0.2);

    return matched({
      pattern_id: PID,
      strength,
      rationale: `${flagged.length} consumer-MCC payment(s) totalling ${totalFlaggedXaf.toLocaleString('fr-CM')} XAF from state origin.`,
      contributing_event_ids: flagged.slice(0, 10).map((e) => e.id),
    });
  },
};

registerPattern(definition);

export default definition;
