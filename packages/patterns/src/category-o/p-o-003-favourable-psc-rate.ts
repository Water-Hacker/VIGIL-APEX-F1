import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-O-003 — Production-sharing rate anomalously favourable to operator (EITI 2.6 + IMF FAD).
 *
 * PSC (Production Sharing Contract) state share is below the
 * IMF Fiscal Affairs Department's regional benchmark for similar
 * basins. Marker: cost-recovery cap > 80% (industry norm 60-70%) OR
 * royalty rate < 5% (basin norm > 10%).
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
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const recoveryCap = Number(meta.cost_recovery_cap ?? 0);
    const royalty = Number(meta.royalty_rate ?? 1);
    const flags: string[] = [];
    if (recoveryCap > 0.8) flags.push(`recovery_cap=${(recoveryCap * 100).toFixed(0)}%`);
    if (royalty < 0.05) flags.push(`royalty=${(royalty * 100).toFixed(1)}%`);
    if (flags.length === 0) return notMatched(PID, 'PSC terms within norm');
    const strength = flags.length === 2 ? 0.85 : 0.55;
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Anomalous PSC terms: ${flags.join(', ')}.`,
    });
  },
};
registerPattern(definition);
export default definition;
