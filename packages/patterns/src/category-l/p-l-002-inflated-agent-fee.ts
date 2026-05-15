import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-L-002 — Agent fee abnormally high vs. industry benchmark (OECD).
 *
 * OECD: agent commissions > 10% of contract value are flagged as
 * high-risk by FATF + OECD + UK Bribery Act enforcement guidance.
 */
const PID = Ids.asPatternId('P-L-002');
const definition: PatternDef = {
  id: PID,
  category: 'L',
  source_body: 'OECD',
  subjectKinds: ['Tender', 'Payment'],
  title_fr: "Commission d'agent anormalement élevée",
  title_en: 'Agent fee abnormally high vs. benchmark',
  description_fr:
    "Commission d'agent > 10% de la valeur du marché ; signal OECD / FATF / UK Bribery Act.",
  description_en:
    'Agent commission > 10% of contract value; OECD / FATF / UK Bribery Act risk marker.',
  defaultPrior: 0.05,
  defaultWeight: 0.55,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const share = Number(meta.agent_fee_share ?? 0);
    if (share < 0.1) return notMatched(PID, `agent_fee=${share} < 10%`);
    const strength = Math.min(0.95, 0.3 + share * 4);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Agent commission = ${(share * 100).toFixed(1)}% of contract value.`,
    });
  },
};
registerPattern(definition);
export default definition;
