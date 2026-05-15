import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-O-001 — Mining concession without environmental impact assessment (EITI 2.5).
 *
 * Cameroon's Mining Code (Loi 2016/017 art. 24) requires an EIA
 * before any concession is granted. Absent EIA = procedural defect
 * + potential corruption signal.
 */
const PID = Ids.asPatternId('P-O-001');
const definition: PatternDef = {
  id: PID,
  category: 'O',
  source_body: 'EITI',
  subjectKinds: ['Tender', 'Project'],
  title_fr: "Concession minière sans étude d'impact environnemental",
  title_en: 'Mining concession without EIA',
  description_fr:
    "Concession minière accordée sans étude d'impact environnemental (Loi 2016/017 art. 24 + EITI 2.5).",
  description_en:
    'Mining concession granted without environmental impact assessment (Loi 2016/017 art. 24 + EITI 2.5).',
  defaultPrior: 0.06,
  defaultWeight: 0.6,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    if (meta.sector !== 'mining') return notMatched(PID, 'not mining sector');
    const eiaPresent = meta.eia_present === true;
    if (eiaPresent) return notMatched(PID, 'EIA present');
    return matched({
      pattern_id: PID,
      strength: 0.85,
      rationale: 'Mining concession granted without EIA on file.',
    });
  },
};
registerPattern(definition);
export default definition;
