import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, eventsOfKind, meta, num, maxNumericField } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-J-002 — Overstated asset valuation (ACFE).
 *
 * Detection:
 *   1. Scan `company_filing` events for `book_value_xaf` and any
 *      independent valuation (`independent_valuation_xaf` from an
 *      `audit_observation` event).
 *   2. Compute overvaluation ratio = (book - independent) / book.
 *   3. Fall back to `metadata.asset_overvaluation_ratio` when neither
 *      event channel populates the structured fields.
 *
 * Fires at ≥ 20% overvaluation.
 */
const PID = Ids.asPatternId('P-J-002');
const definition: PatternDef = {
  id: PID,
  category: 'J',
  source_body: 'ACFE',
  subjectKinds: ['Company'],
  title_fr: "Surévaluation d'actifs",
  title_en: 'Overstated asset valuation',
  description_fr:
    "Valeur déclarée des immobilisations ou stocks supérieure à l'évaluation indépendante. Typologie ACFE.",
  description_en:
    'Declared fixed-asset or inventory value materially above independent appraisal. ACFE typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.5,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const filings = eventsOfKind(subject, ['company_filing']);
    const audits = eventsOfKind(subject, ['audit_observation']);

    let ratio = 0;
    let contributing: ReadonlyArray<(typeof subject.events)[number]> = [];

    if (filings.length > 0 && audits.length > 0) {
      const bookField = maxNumericField(filings, 'book_value_xaf');
      const indepField = maxNumericField(audits, 'independent_valuation_xaf');
      if (bookField.value !== null && indepField.value !== null && bookField.value > 0) {
        const diff = bookField.value - indepField.value;
        if (diff > 0) {
          ratio = diff / bookField.value;
          contributing = [...bookField.contributors, ...indepField.contributors];
        }
      }
    }

    if (ratio === 0) {
      ratio = num(meta(subject).asset_overvaluation_ratio) ?? 0;
    }

    if (ratio < 0.2) return notMatched(PID, `overvaluation_ratio=${ratio.toFixed(3)} < 20%`);
    const strength = Math.min(0.95, 0.3 + ratio * 1.5);
    const ev = evidenceFrom(contributing);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Asset valuation ${(ratio * 100).toFixed(0)}% above independent appraisal.`,
    });
  },
};
registerPattern(definition);
export default definition;
