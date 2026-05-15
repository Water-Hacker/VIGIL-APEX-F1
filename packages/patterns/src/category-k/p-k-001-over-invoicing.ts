import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-K-001 — Over-invoicing (FATF TBML).
 *
 * Import declared at a price materially above world-market price for
 * the same HS code, allowing currency exfiltration. Detection:
 * `unit_price / world_reference_price > 1.5` for a transaction
 * matched to its HS classification.
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
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const ratio = Number(meta.unit_price_to_world_reference_ratio ?? 0);
    if (ratio < 1.5) return notMatched(PID, `ratio=${ratio} < 1.5`);
    const strength = Math.min(0.95, 0.3 + Math.min(0.6, (ratio - 1.5) * 0.4));
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Unit price ${ratio.toFixed(2)}x world-reference for HS classification.`,
    });
  },
};
registerPattern(definition);
export default definition;
