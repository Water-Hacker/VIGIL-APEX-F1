import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readBoolWithFallback, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

const PID = Ids.asPatternId('P-L-005');
const definition: PatternDef = {
  id: PID,
  category: 'L',
  source_body: 'OECD',
  subjectKinds: ['Person', 'Tender'],
  title_fr: 'Embauche post-attribution du décideur ou de sa famille',
  title_en: 'Post-award employment of decision-maker / family member',
  description_fr:
    "Porte tournante : décideur (ou parent 1er degré) embauché par l'attributaire dans les 24 mois post-attribution. Typologie OECD / FCPA.",
  description_en:
    'Revolving door: award decision-maker (or 1st-degree family member) hired by awardee within 24 months. OECD / FCPA typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.7,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const sources: ReadonlyArray<Schemas.SourceEventKind> = [
      'gazette_appointment',
      'company_filing',
      'audit_observation',
    ];
    const flag = readBoolWithFallback(
      subject,
      'revolving_door_detected',
      'revolving_door_detected',
      sources,
    );
    const familyDegree = readNumericWithFallback(
      subject,
      'relation_degree',
      'relation_degree',
      sources,
    );
    const months = readNumericWithFallback(
      subject,
      'months_after_award',
      'months_after_award',
      sources,
    );
    if (!flag.value || months.from === 'none' || months.value > 24) {
      return notMatched(PID, `flag=${flag.value} months=${months.value}`);
    }
    const strength = Math.min(
      0.95,
      0.55 + (familyDegree.value === 1 ? 0.25 : 0.12) + (24 - months.value) * 0.008,
    );
    const ev = evidenceFrom([
      ...flag.contributors,
      ...familyDegree.contributors,
      ...months.contributors,
    ]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Decision-maker hired by awardee ${months.value} months post-award (relation degree ${familyDegree.value}).`,
    });
  },
};
registerPattern(definition);
export default definition;
