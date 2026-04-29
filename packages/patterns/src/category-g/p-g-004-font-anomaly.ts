import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-G-004 — Font / typography anomaly.
 *
 * Critical fields (amount, supplier name, signing officer) are typeset in a
 * different font or character-spacing from the rest of the document — a
 * classic "alteration after print" tell-tale on scanned PDFs.
 *
 * Detection input: an out-of-band image-forensics worker stamps
 * `payload.font_anomaly_score ∈ [0,1]` (1 = certain anomaly).
 */
const ID = PID('P-G-004');

const definition: PatternDef = {
  id: ID,
  category: 'G',
  subjectKinds: ['Tender'],
  title_fr: "Incohérence typographique sur un champ critique",
  title_en: 'Typography anomaly on a critical field',
  description_fr:
    "Police ou interlettrage différent sur un champ critique (montant, nom du fournisseur, signataire).",
  description_en:
    'Different font or letter-spacing on a critical field (amount, supplier name, signing officer).',
  defaultPrior: 0.25,
  defaultWeight: 0.6,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    let strongest = 0;
    const ids: string[] = [];
    for (const e of subject.events) {
      const score = e.payload['font_anomaly_score'];
      if (typeof score !== 'number') continue;
      if (score < 0.6) continue;
      if (score > strongest) strongest = score;
      ids.push(e.id);
    }
    return strongest === 0
      ? notMatched(ID, 'no font anomaly above 0.6')
      : matched({
          pattern_id: ID,
          strength: strongest,
          contributing_event_ids: ids,
          rationale: `font anomaly score=${strongest.toFixed(2)}`,
        });
  },
};

registerPattern(definition);
export default definition;
