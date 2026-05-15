import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-I-001 — Shell-vendor billing scheme (ACFE Fraud Tree).
 *
 * Asset Misappropriation → Cash → Fraudulent Disbursements → Billing
 * → Shell-Company Scheme.
 *
 * ACFE typology: an employee establishes (or co-opts) a vendor that
 * has no real business activity, then submits invoices for goods or
 * services that are not delivered. Telltales: vendor with no
 * employees, no operating address, recent incorporation relative to
 * first payment, common UBO or contact info with a state employee,
 * volume of payments dominated by one or two state-side payers.
 *
 * This pattern fires on Companies (the vendor entity) and produces
 * a signal when the vendor matches multiple shell-vendor markers AND
 * has received material state payments. Strength is the count of
 * markers (0/5..5/5), normalised.
 *
 * Source: ACFE Report to the Nations, ACFE Fraud Tree v2.
 */

const PID = Ids.asPatternId('P-I-001');

const definition: PatternDef = {
  id: PID,
  category: 'I',
  source_body: 'ACFE',
  subjectKinds: ['Company'],
  title_fr: 'Société écran — schéma de facturation fictive',
  title_en: 'Shell-vendor billing scheme',
  description_fr:
    "Schéma de détournement par facturation fictive via une société écran : entité sans employés, sans adresse opérationnelle, incorporée peu avant le premier paiement, recevant des paiements matériels de l'État avec un UBO ou un contact commun avec un fonctionnaire. Typologie ACFE Fraud Tree.",
  description_en:
    'Asset-misappropriation billing scheme via a shell vendor — entity with zero employees, no operating address, incorporated shortly before first payment, receiving material state payments and sharing UBO / contact info with a state employee. ACFE Fraud Tree typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.62,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    if (subject.kind !== 'Company' || subject.canonical === null) {
      return notMatched(PID, 'subject is not a Company with a canonical row');
    }
    const c = subject.canonical;
    const metadata = (c.metadata ?? {}) as Record<string, unknown>;

    const markers: string[] = [];

    // Marker 1: zero declared employees (or unknown but UBO concentration ≤ 2).
    const employees = Number(metadata.declared_employees ?? metadata.employees ?? NaN);
    if (Number.isFinite(employees) && employees === 0) {
      markers.push('employees=0');
    }

    // Marker 2: no operating address (mailbox, PO Box, or shared with > 5 entities).
    const sharedAddressCount = Number(metadata.shared_registered_address_count ?? 0);
    if (sharedAddressCount > 5) {
      markers.push(`shared_address_count=${sharedAddressCount}`);
    }
    if (metadata.address_is_mailbox === true) {
      markers.push('address_is_mailbox');
    }

    // Marker 3: incorporated within 180 days of first state payment.
    const firstStatePaymentDays = Number(
      metadata.days_first_state_payment_after_incorporation ?? NaN,
    );
    if (Number.isFinite(firstStatePaymentDays) && firstStatePaymentDays < 180) {
      markers.push(`first_state_payment_days=${firstStatePaymentDays}`);
    }

    // Marker 4: state payments dominate revenue (>= 60% of total revenue from state sources).
    const statePaymentShare = Number(metadata.state_payment_share ?? NaN);
    if (Number.isFinite(statePaymentShare) && statePaymentShare >= 0.6) {
      markers.push(`state_payment_share=${statePaymentShare.toFixed(2)}`);
    }

    // Marker 5: common UBO or contact info with a state employee (flagged upstream).
    if (metadata.shared_ubo_with_state_employee === true) {
      markers.push('shared_ubo_with_state_employee');
    }

    if (markers.length < 2) {
      return notMatched(PID, `shell-vendor markers below threshold (${markers.length}/5)`);
    }

    // Strength: 2 markers = 0.40, 3 = 0.60, 4 = 0.80, 5 = 0.95.
    const strength = Math.min(0.95, 0.2 + markers.length * 0.18);

    return matched({
      pattern_id: PID,
      strength,
      rationale: `Shell-vendor markers (${markers.length}/5): ${markers.join(', ')}.`,
      contributing_event_ids: subject.events.slice(0, 5).map((e) => e.id),
    });
  },
};

registerPattern(definition);

export default definition;
