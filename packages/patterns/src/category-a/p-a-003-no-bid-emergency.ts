import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-A-003 — No-bid emergency procurement (without justification).
 *
 * Sole-source / no-bid awards may be legitimate under emergency-decree
 * conditions (cf. EXEC §22.4 — Ebola-2014 example). This pattern fires when
 * the procurement_method is no-bid AND there is NO matching emergency_decree
 * event in the same time window.
 */
const ID = PID('P-A-003');

const definition: PatternDef = {
  id: ID,
  category: 'A',
  subjectKinds: ['Tender'],
  title_fr: "Marché de gré-à-gré sans justification d'urgence",
  title_en: 'No-bid award without emergency justification',
  description_fr:
    "Marché négocié ou gré-à-gré sans décret d'état d'urgence couvrant le secteur ou la période.",
  description_en:
    'Sole-source or no-bid award not covered by an emergency decree applicable to the sector or period.',
  defaultPrior: 0.20,
  defaultWeight: 0.7,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const award = subject.events.find((e) => e.kind === 'award');
    if (!award) return notMatched(ID, 'no award');
    const method =
      typeof award.payload['procurement_method'] === 'string'
        ? (award.payload['procurement_method'] as string).toLowerCase()
        : '';
    const isNoBid =
      method.includes('gré à gré') || method.includes('sole-source') || method.includes('marché négocié');
    if (!isNoBid) return notMatched(ID, 'method is competitive');

    // Look for an emergency-decree event referenced on the subject
    const decree = subject.events.find(
      (e) =>
        e.kind === 'gazette_decree' &&
        typeof e.payload['emergency'] === 'boolean' &&
        e.payload['emergency'] === true,
    );
    if (decree) {
      return notMatched(ID, 'covered by emergency decree');
    }
    return matched({
      pattern_id: ID,
      strength: 0.7,
      contributing_event_ids: [award.id],
      contributing_document_cids: award.document_cids,
      rationale: `no-bid (${method}) without covering emergency decree`,
    });
  },
};

registerPattern(definition);
export default definition;
