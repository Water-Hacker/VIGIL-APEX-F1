import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, eventsOfKind, meta, num, maxNumericField } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-J-004 — Expense capitalisation / deferral (ACFE).
 *
 * Detection:
 *   1. Find the latest `company_filing` event carrying `capex_xaf` +
 *      `opex_xaf` (or `revenue_xaf` for ratio anchoring).
 *   2. Compute capex_to_benchmark_deviation = (capex/opex - sector_median)
 *      / sector_median. Sector median lives on the same event as
 *      `sector_capex_opex_median`, populated by the extractor from a
 *      sector-benchmark adapter (when available).
 *   3. Fall back to `metadata.capex_to_benchmark_deviation`.
 *
 * Fires when deviation ≥ 30%.
 */
const PID = Ids.asPatternId('P-J-004');
const definition: PatternDef = {
  id: PID,
  category: 'J',
  source_body: 'ACFE',
  subjectKinds: ['Company'],
  title_fr: "Capitalisation abusive de charges d'exploitation",
  title_en: 'Expense capitalisation / deferral',
  description_fr:
    "Frais d'exploitation classés en immobilisation pour différer leur impact comptable. Ratio capex/opex anormal vs. benchmark sectoriel. Typologie ACFE.",
  description_en:
    'Operating expenses classified as capital expenditure to defer P&L impact. Capex/opex ratio diverges from sector benchmark. ACFE typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.45,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const filings = eventsOfKind(subject, ['company_filing']);

    let dev = 0;
    let contributing: ReadonlyArray<(typeof subject.events)[number]> = [];

    if (filings.length > 0) {
      const capex = maxNumericField(filings, 'capex_xaf');
      const opex = maxNumericField(filings, 'opex_xaf');
      const benchmark = maxNumericField(filings, 'sector_capex_opex_median');
      if (
        capex.value !== null &&
        opex.value !== null &&
        opex.value > 0 &&
        benchmark.value !== null &&
        benchmark.value > 0
      ) {
        const ratio = capex.value / opex.value;
        dev = (ratio - benchmark.value) / benchmark.value;
        if (dev > 0) {
          contributing = [...capex.contributors, ...opex.contributors, ...benchmark.contributors];
        } else {
          dev = 0;
        }
      }
    }

    if (dev === 0) {
      dev = num(meta(subject).capex_to_benchmark_deviation) ?? 0;
    }

    if (dev < 0.3) return notMatched(PID, `capex_dev=${dev.toFixed(3)} < 30%`);
    const strength = Math.min(0.95, 0.3 + dev * 1.2);
    const ev = evidenceFrom(contributing);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Capex/opex ratio ${(dev * 100).toFixed(0)}% above sector benchmark.`,
    });
  },
};
registerPattern(definition);
export default definition;
