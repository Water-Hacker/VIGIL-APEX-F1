import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-K-002 — Under-invoicing (FATF TBML).
 *
 * Export declared below world-market price for the same HS code,
 * leaving value abroad. Source: FATF.
 */
const PID = Ids.asPatternId('P-K-002');
const definition: PatternDef = {
  id: PID,
  category: 'K',
  source_body: 'FATF',
  subjectKinds: ['Payment'],
  title_fr: "Sous-facturation à l'exportation",
  title_en: 'Under-invoicing of exports',
  description_fr:
    'Exportation déclarée à un prix unitaire inférieur de 33%+ au prix de référence mondial. Typologie FATF TBML.',
  description_en: 'Export declared at unit price ≤ 67% of world reference. FATF TBML typology.',
  defaultPrior: 0.05,
  defaultWeight: 0.6,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const r = readNumericWithFallback(
      subject,
      'unit_price_to_world_reference_ratio',
      'unit_price_to_world_reference_ratio',
      ['company_filing', 'payment_order'],
    );
    if (r.from === 'none') return notMatched(PID, 'no unit-price evidence');
    if (r.value > 0.67) return notMatched(PID, `ratio=${r.value.toFixed(2)} > 0.67`);
    const strength = Math.min(0.95, 0.5 + (0.67 - r.value) * 1.2);
    const ev = evidenceFrom(r.contributors);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Export at ${(r.value * 100).toFixed(0)}% of world-reference price.`,
    });
  },
};
registerPattern(definition);
export default definition;
