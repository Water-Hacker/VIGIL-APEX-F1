import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-O-003 — PSC rate anomalously favourable to operator.
 *
 * Detection: `cost_recovery_cap` and `royalty_rate` on a `company_filing`
 * or `gazette_decree` event. Falls back to metadata fields. Fires when
 * either is anomalous; strength is higher when both are.
 */
const PID = Ids.asPatternId('P-O-003');
const definition: PatternDef = {
  id: PID,
  category: 'O',
  source_body: 'EITI',
  subjectKinds: ['Project'],
  title_fr: "Taux de partage de production favorable à l'opérateur",
  title_en: 'PSC rate anomalously favourable to operator',
  description_fr:
    "Part de l'État sous le benchmark FMI : plafond de récupération de coûts > 80% ou redevance < 5%. Typologie EITI 2.6 / IMF FAD.",
  description_en:
    'State share below IMF FAD benchmark: cost-recovery cap > 80% or royalty < 5%. EITI 2.6 / IMF FAD typology.',
  defaultPrior: 0.05,
  defaultWeight: 0.55,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const cap = readNumericWithFallback(subject, 'cost_recovery_cap', 'cost_recovery_cap', [
      'gazette_decree',
      'company_filing',
    ]);
    const royalty = readNumericWithFallback(subject, 'royalty_rate', 'royalty_rate', [
      'gazette_decree',
      'company_filing',
    ]);
    const flags: string[] = [];
    if (cap.value > 0.8) flags.push(`recovery_cap=${(cap.value * 100).toFixed(0)}%`);
    // Treat royalty=0 as no signal (default), only flag actual < 5% when known.
    if (royalty.from !== 'none' && royalty.value < 0.05 && royalty.value > 0) {
      flags.push(`royalty=${(royalty.value * 100).toFixed(1)}%`);
    }
    if (flags.length === 0) return notMatched(PID, 'PSC terms within norm');
    const strength = flags.length === 2 ? 0.88 : 0.6;
    const ev = evidenceFrom([...cap.contributors, ...royalty.contributors]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Anomalous PSC terms: ${flags.join(', ')}.`,
    });
  },
};
registerPattern(definition);
export default definition;
