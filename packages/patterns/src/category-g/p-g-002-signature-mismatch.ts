import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-G-002 — Signature mismatch on contract documents.
 *
 * The signature image on a contract amendment or completion certificate
 * differs from the reference signature on file for the named officer.
 * Signature similarity is precomputed by an out-of-band image-comparison
 * pass and stored on `payload.signature_similarity_score`.
 */
const ID = PID('P-G-002');

const definition: PatternDef = {
  id: ID,
  category: 'G',
  subjectKinds: ['Tender'],
  title_fr: "Signature non conforme à la référence",
  title_en: 'Signature image diverges from reference',
  description_fr:
    "L'image de la signature sur un acte diffère matériellement de la signature de référence du signataire déclaré.",
  description_en:
    'Signature image on a document materially diverges from the named officer\'s reference signature.',
  defaultPrior: 0.30,
  defaultWeight: 0.7,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    let strongest = 0;
    const ids: string[] = [];
    const why: string[] = [];
    for (const e of subject.events) {
      const sim = e.payload['signature_similarity_score'];
      if (typeof sim !== 'number') continue;
      const score = sim; // [0..1] — 1 = identical
      if (score >= 0.85) continue;
      const s = 1 - score;
      if (s > strongest) strongest = s;
      ids.push(e.id);
      why.push(`event=${e.id.slice(0, 8)} sim=${score.toFixed(2)}`);
    }
    return strongest === 0
      ? notMatched(ID, 'no low-similarity signature')
      : matched({
          pattern_id: ID,
          strength: strongest,
          contributing_event_ids: ids,
          rationale: why.slice(0, 5).join('; '),
          matchAt: 0.1,
        });
  },
};

registerPattern(definition);
export default definition;
