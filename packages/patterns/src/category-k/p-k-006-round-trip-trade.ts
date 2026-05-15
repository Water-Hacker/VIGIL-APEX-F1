import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-K-006 — Round-trip trade (FATF TBML).
 *
 * Same goods exported and re-imported (potentially via an offshore
 * intermediary) to layer currency movement. Source: FATF TBML 2020.
 */
const PID = Ids.asPatternId('P-K-006');
const definition: PatternDef = {
  id: PID,
  category: 'K',
  source_body: 'FATF',
  subjectKinds: ['Company'],
  title_fr: "Trafic d'aller-retour",
  title_en: 'Round-trip trade',
  description_fr:
    'Mêmes marchandises exportées puis ré-importées (via intermédiaire offshore) pour superposer un flux de devises. Typologie FATF TBML.',
  description_en:
    'Same goods exported and re-imported, often via offshore intermediary, layering currency flow. FATF TBML typology.',
  defaultPrior: 0.03,
  defaultWeight: 0.65,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const detected = meta.round_trip_detected === true;
    const offshore = meta.round_trip_via_offshore === true;
    if (!detected) return notMatched(PID, 'no round-trip detected');
    const strength = offshore ? 0.9 : 0.6;
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Round-trip trade detected (offshore intermediary: ${offshore}).`,
    });
  },
};
registerPattern(definition);
export default definition;
