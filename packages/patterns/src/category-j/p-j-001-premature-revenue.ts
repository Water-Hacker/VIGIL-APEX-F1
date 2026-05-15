import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, eventsOfKind, meta, num, sumNumericField } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-J-001 — Premature / fictitious revenue recognition (ACFE).
 *
 * Detection (event-based, with metadata fallback):
 *
 *   1. Gather `company_filing` events whose payload carries revenue
 *      figures (`revenue_xaf` + optionally `verifiable_receipts_xaf`).
 *   2. Compute the gap between declared revenue and verifiable
 *      receipts/receivables; the ratio of gap to total revenue is the
 *      signal.
 *   3. Fall back to `subject.canonical.metadata.revenue_unverifiable_ratio`
 *      when no filing event carries the structured fields (some
 *      extractors emit only the ratio).
 *
 * Fires when the gap ≥ 50,000,000 XAF AND the ratio ≥ 20%.
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
    const filings = eventsOfKind(subject, ['company_filing']);

    let gapXaf = 0;
    let ratio = 0;
    let contributing: ReadonlyArray<(typeof filings)[number]> = [];

    if (filings.length > 0) {
      const rev = sumNumericField(filings, 'revenue_xaf');
      const verifiable = sumNumericField(filings, 'verifiable_receipts_xaf');
      if (rev.value > 0) {
        gapXaf = Math.max(0, rev.value - verifiable.value);
        ratio = gapXaf / rev.value;
        contributing = [...rev.contributors, ...verifiable.contributors];
      }
    }

    if (gapXaf === 0 && ratio === 0) {
      const m = meta(subject);
      const gapMeta = num(m.revenue_minus_verifiable_xaf) ?? 0;
      const ratioMeta = num(m.revenue_unverifiable_ratio) ?? 0;
      gapXaf = gapMeta;
      ratio = ratioMeta;
    }

    if (gapXaf < 50_000_000 || ratio < 0.2) {
      return notMatched(PID, `gap=${gapXaf} ratio=${ratio.toFixed(3)}`);
    }

    const strength = Math.min(0.95, 0.3 + ratio * 1.5);
    const ev = evidenceFrom(contributing);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `${(ratio * 100).toFixed(0)}% of declared revenue (${gapXaf.toLocaleString('fr-CM')} XAF) lacks verifiable counterparty.`,
    });
  },
};
registerPattern(definition);
export default definition;
