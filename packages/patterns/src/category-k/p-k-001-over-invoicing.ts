import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-K-001 — Over-invoicing (FATF TBML).
 *
 * Source channel: customs-declaration events emitted by the Cameroon
 * Douanes adapter (event kind `company_filing`, payload field
 * `unit_price_to_world_reference_ratio`). Falls back to the same field
 * on `subject.canonical.metadata` for the legacy code path. Fires at
 * ratio ≥ 1.5 (declared price ≥ 50% above world reference).
 *
 * Source: FATF Trade-Based ML (2020), Annex A typology #1.
 */
const PID = Ids.asPatternId('P-K-001');
const definition: PatternDef = {
  id: PID,
  category: 'K',
  source_body: 'FATF',
  subjectKinds: ['Payment'],
  title_fr: "Surfacturation à l'importation",
  title_en: 'Over-invoicing of imports',
  description_fr:
    "Importation déclarée à un prix unitaire supérieur de 50%+ au prix de référence mondial pour le même code SH. Permet l'exfiltration de devises. Typologie FATF TBML.",
  description_en:
    'Import declared at unit price ≥ 50% above world reference price for the same HS code. Allows currency exfiltration. FATF TBML typology.',
  defaultPrior: 0.05,
  defaultWeight: 0.65,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const r = readNumericWithFallback(
      subject,
      'unit_price_to_world_reference_ratio',
      'unit_price_to_world_reference_ratio',
      ['company_filing', 'payment_order'],
    );
    if (r.value < 1.5) return notMatched(PID, `ratio=${r.value.toFixed(2)} < 1.5`);
    const strength = Math.min(0.95, 0.5 + Math.min(0.45, (r.value - 1.5) * 0.4));
    const ev = evidenceFrom(r.contributors);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Unit price ${r.value.toFixed(2)}x world-reference for HS classification.`,
    });
  },
};
registerPattern(definition);
export default definition;
