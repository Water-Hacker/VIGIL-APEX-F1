import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readBoolWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-K-006 — Round-trip trade (FATF TBML).
 *
 * Detection: company_filing or payment_order events with
 * `round_trip_detected:true` (Douanes reconciliation flag) and
 * optionally `round_trip_via_offshore:true` (a haven-jurisdiction
 * intermediary appeared in the trade chain). Falls back to metadata.
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
    const detected = readBoolWithFallback(subject, 'round_trip_detected', 'round_trip_detected', [
      'company_filing',
      'payment_order',
    ]);
    const offshore = readBoolWithFallback(
      subject,
      'round_trip_via_offshore',
      'round_trip_via_offshore',
      ['company_filing', 'payment_order'],
    );
    if (!detected.value) return notMatched(PID, 'no round-trip detected');
    const strength = offshore.value ? 0.9 : 0.6;
    const ev = evidenceFrom([...detected.contributors, ...offshore.contributors]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Round-trip trade detected (offshore intermediary: ${offshore.value}).`,
    });
  },
};
registerPattern(definition);
export default definition;
