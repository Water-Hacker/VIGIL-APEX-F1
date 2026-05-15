import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-K-005 — Goods misclassification by HS code (FATF TBML).
 *
 * Declared HS classification differs from physical-inspection
 * classification — typically to evade tariffs, sanctions, or to
 * manipulate cost basis. Source: FATF + World Customs Organization
 * Harmonized System.
 */
const PID = Ids.asPatternId('P-K-005');
const definition: PatternDef = {
  id: PID,
  category: 'K',
  source_body: 'FATF',
  subjectKinds: ['Payment'],
  title_fr: 'Classification SH erronée des marchandises',
  title_en: 'Goods misclassification (HS code)',
  description_fr:
    "Code SH déclaré différent de l'inspection physique : évasion tarifaire ou contournement de sanctions. Typologie FATF / WCO.",
  description_en:
    'Declared HS code differs from physical-inspection HS code: tariff evasion or sanctions evasion. FATF + WCO typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.55,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const mismatched = meta.hs_code_mismatch === true;
    const sanctionsImplicated = meta.hs_mismatch_implicates_sanction === true;
    if (!mismatched) return notMatched(PID, 'HS codes match');
    const strength = sanctionsImplicated ? 0.92 : 0.55;
    return matched({
      pattern_id: PID,
      strength,
      rationale: `HS-code mismatch (sanctions-implicated: ${sanctionsImplicated}).`,
    });
  },
};
registerPattern(definition);
export default definition;
