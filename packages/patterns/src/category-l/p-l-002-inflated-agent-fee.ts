import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

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
    const share = readNumericWithFallback(subject, 'agent_fee_share', 'agent_fee_share', [
      'payment_order',
      'audit_observation',
      'company_filing',
    ]);
    if (share.value < 0.1) return notMatched(PID, `agent_fee=${share.value} < 10%`);
    const strength = Math.min(0.95, 0.5 + share.value * 3);
    const ev = evidenceFrom(share.contributors);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Agent commission = ${(share.value * 100).toFixed(1)}% of contract value.`,
    });
  },
};
registerPattern(definition);
export default definition;
