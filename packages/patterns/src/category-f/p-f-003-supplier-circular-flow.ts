import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-F-003 — Supplier-circular flow.
 *
 * A → B → C → A money cycle among suppliers, with each leg a "service" or
 * "consulting" contract. Indicates a closed-loop money-laundering vehicle.
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
  defaultPrior: 0.30,
  defaultWeight: 0.8,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const company = subject.canonical;
    if (!company) return notMatched(ID, 'no canonical');
    const cycleLen = Number(company.metadata['supplierCycleLength'] ?? 0);
    if (cycleLen < 3) return notMatched(ID, `cycle=${cycleLen}`);
    // Strength scales inversely with cycle length (shorter = more suspicious)
    const strength = Math.min(1, 0.9 - (cycleLen - 3) * 0.1);
    return matched({
      pattern_id: ID,
      strength: Math.max(0.5, strength),
      rationale: `participates in ${cycleLen}-node supplier cycle`,
    });
  },
};

registerPattern(definition);
export default definition;
