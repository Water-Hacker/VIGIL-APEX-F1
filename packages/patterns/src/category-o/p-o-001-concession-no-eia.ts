import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, eventsOfKind, meta, readBoolWithFallback, str } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-O-001 — Mining concession without environmental impact assessment.
 *
 * Detection: pull `sector` and `eia_present` from `tender_notice` or
 * `gazette_decree` events; mining sector with no EIA on file fires.
 * Falls back to `metadata.sector` + `metadata.eia_present`.
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
    const tenders = eventsOfKind(subject, ['tender_notice', 'gazette_decree', 'company_filing']);
    let sector: string | null = null;
    let sectorEvent: (typeof tenders)[number] | null = null;
    for (const t of tenders) {
      const s = str(t.payload['sector']);
      if (s !== null) {
        sector = s;
        sectorEvent = t;
        break;
      }
    }
    if (sector === null) {
      sector = str(meta(subject).sector);
    }
    if (sector !== 'mining') return notMatched(PID, `sector=${sector ?? 'unknown'} not mining`);

    const eia = readBoolWithFallback(subject, 'eia_present', 'eia_present', [
      'tender_notice',
      'gazette_decree',
      'company_filing',
    ]);
    if (eia.value) return notMatched(PID, 'EIA present');
    const ev = evidenceFrom([...(sectorEvent ? [sectorEvent] : []), ...eia.contributors]);
    return matched({
      pattern_id: PID,
      strength: 0.85,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: 'Mining concession granted without EIA on file.',
    });
  },
};
registerPattern(definition);
export default definition;
