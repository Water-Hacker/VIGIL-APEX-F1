import { type Schemas } from '@vigil/shared';

import { evidenceFrom, eventsOfKind } from '../_event-helpers.js';
import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-F-003 — Supplier-circular flow.
 *
 * A → B → C → A money cycle among suppliers. The graph traversal lives in
 * worker-pattern's subject loader and sets `metadata.supplierCycleLength`.
 * This pattern reads the cycle length and attaches the payment events on the
 * subject as contributing evidence.
 */
const ID = PID('P-F-003');

const definition: PatternDef = {
  id: ID,
  category: 'F',
  subjectKinds: ['Company'],
  title_fr: 'Flux circulaire entre fournisseurs',
  title_en: 'Supplier-circular flow (A→B→C→A)',
  description_fr:
    "Cycle d'au moins trois fournisseurs où chaque facture est un service générique au suivant.",
  description_en:
    'Cycle of ≥ 3 suppliers, each invoicing a generic service to the next, returning to A.',
  defaultPrior: 0.3,
  defaultWeight: 0.8,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const company = subject.canonical;
    if (!company) return notMatched(ID, 'no canonical');
    const cycleLen = Number(company.metadata['supplierCycleLength'] ?? 0);
    if (cycleLen < 3) return notMatched(ID, `cycle=${cycleLen}`);
    const payments = eventsOfKind(subject, ['payment_order', 'treasury_disbursement']);
    const ev = evidenceFrom(payments);
    const strength = Math.max(0.5, Math.min(1, 0.9 - (cycleLen - 3) * 0.1));
    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `participates in ${cycleLen}-node supplier cycle`,
    });
  },
};

registerPattern(definition);
export default definition;
