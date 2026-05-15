import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-J-001 — Premature / fictitious revenue recognition (ACFE).
 *
 * Revenue booked before earned (or revenue from non-existent
 * counterparty). Detection: declared revenue for period > sum of
 * verifiable receipts + verifiable receivables. Source: ACFE.
 */
const PID = Ids.asPatternId('P-J-001');
const definition: PatternDef = {
  id: PID,
  category: 'J',
  source_body: 'ACFE',
  subjectKinds: ['Company'],
  title_fr: 'Reconnaissance prématurée ou fictive de produits',
  title_en: 'Premature / fictitious revenue recognition',
  description_fr:
    "Produits comptabilisés avant d'être acquis, ou provenant de contreparties non vérifiables. Typologie ACFE.",
  description_en:
    'Revenue booked before earned or from unverifiable counterparties. ACFE typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.55,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const revGap = Number(meta.revenue_minus_verifiable_xaf ?? 0);
    const ratio = Number(meta.revenue_unverifiable_ratio ?? 0);
    if (revGap < 50_000_000 || ratio < 0.2) return notMatched(PID, `gap=${revGap} ratio=${ratio}`);
    const strength = Math.min(0.95, 0.3 + ratio * 1.5);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `${(ratio * 100).toFixed(0)}% of declared revenue (${revGap.toLocaleString('fr-CM')} XAF) lacks verifiable counterparty.`,
    });
  },
};
registerPattern(definition);
export default definition;
