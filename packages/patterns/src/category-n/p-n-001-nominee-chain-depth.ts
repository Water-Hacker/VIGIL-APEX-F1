import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-N-001 — Nominee chain depth > 3 jurisdictions (Pandora Papers).
 *
 * Beneficial-ownership chain passes through 3+ separate jurisdictions
 * (typical Pandora-Papers laundering structure: company in country A
 * → holding in BVI → nominee in Mauritius → trust in Cayman → UBO).
 */
const PID = Ids.asPatternId('P-N-001');
const definition: PatternDef = {
  id: PID,
  category: 'N',
  source_body: 'OCCRP',
  subjectKinds: ['Company'],
  title_fr: "Chaîne d'actionnariat traversant plus de 3 juridictions",
  title_en: 'Nominee chain depth > 3 jurisdictions',
  description_fr:
    "Structure d'actionnariat traversant 3+ juridictions distinctes (motif typique des Pandora Papers).",
  description_en:
    'Beneficial-ownership chain passes through 3+ distinct jurisdictions (typical Pandora-Papers shape).',
  defaultPrior: 0.06,
  defaultWeight: 0.6,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const depth = Number(meta.ubo_chain_jurisdiction_count ?? 0);
    if (depth < 4) return notMatched(PID, `jurisdiction_count=${depth} < 4`);
    const strength = Math.min(0.95, 0.4 + depth * 0.1);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `UBO chain passes through ${depth} jurisdictions.`,
    });
  },
};
registerPattern(definition);
export default definition;
