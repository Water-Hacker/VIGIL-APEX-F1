import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, eventsOfKind, meta, num } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-N-002 — UBO changed within 90 days before award (EITI 2.5).
 *
 * Detection: look for a `company_filing` event whose payload kind is
 * 'ubo_change' AND an `award` event whose observed_at is at most 90 days
 * after. If both exist, compute the gap days. Falls back to
 * `metadata.days_ubo_change_to_award` for legacy.
 */
const PID = Ids.asPatternId('P-N-002');
const definition: PatternDef = {
  id: PID,
  category: 'N',
  source_body: 'EITI',
  subjectKinds: ['Company', 'Tender'],
  title_fr: 'Changement de bénéficiaire effectif dans les 90 jours pré-attribution',
  title_en: 'UBO changed within 90 days before award',
  description_fr:
    "Changement récent de bénéficiaire effectif juste avant l'attribution. Signal AML Loi 2010/012 + EITI 2.5.",
  description_en:
    'Recent UBO change immediately preceding award. AML Loi 2010/012 + EITI 2.5 marker.',
  defaultPrior: 0.05,
  defaultWeight: 0.55,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const filings = eventsOfKind(subject, ['company_filing']);
    const awards = eventsOfKind(subject, ['award']);

    let days = Infinity;
    let contributors: ReadonlyArray<(typeof subject.events)[number]> = [];

    for (const filing of filings) {
      const isUboChange =
        filing.payload['change_kind'] === 'ubo_change' || filing.payload['ubo_changed'] === true;
      if (!isUboChange) continue;
      const filingT = Date.parse(filing.observed_at);
      if (!Number.isFinite(filingT)) continue;
      for (const a of awards) {
        const awardT = Date.parse(a.observed_at);
        if (!Number.isFinite(awardT)) continue;
        const gap = (awardT - filingT) / 86_400_000;
        if (gap >= 0 && gap < days) {
          days = gap;
          contributors = [filing, a];
        }
      }
    }

    if (days === Infinity) {
      const m = num(meta(subject).days_ubo_change_to_award);
      if (m !== null) days = m;
    }

    if (days > 90) return notMatched(PID, `days_ubo_change_to_award=${days} > 90`);
    const strength = Math.min(0.95, 0.55 + (90 - Math.max(0, days)) * 0.004);
    const ev = evidenceFrom(contributors);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `UBO changed ${days} days before award.`,
    });
  },
};
registerPattern(definition);
export default definition;
