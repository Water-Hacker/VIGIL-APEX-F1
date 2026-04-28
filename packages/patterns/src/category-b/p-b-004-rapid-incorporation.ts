import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-B-004 — Rapid-incorporation timing (sub-30-day before tender).
 *
 * Distinct from P-B-001 (shell-company) which checks 90-day windows + thin
 * history. P-B-004 is the SHARP version: company incorporated < 30 days before
 * the tender publication AND wins. Strong signal even for companies with
 * otherwise normal directors.
 */
const ID = PID('P-B-004');
const SHARP_WINDOW_DAYS = 30;

const definition: PatternDef = {
  id: ID,
  category: 'B',
  subjectKinds: ['Company', 'Tender'],
  title_fr: 'Constitution éclair avant appel d\'offres',
  title_en: 'Sub-30-day pre-tender incorporation',
  description_fr:
    "Société constituée moins de 30 jours avant la publication du marché qu'elle a remporté.",
  description_en:
    'Company incorporated < 30 days before the tender publication that it then won.',
  defaultPrior: 0.40,
  defaultWeight: 0.85,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const incorp = subject.events.find(
      (e) => e.kind === 'company_filing' && e.payload['filing_kind'] === 'incorporation',
    );
    const tender = subject.events.find((e) => e.kind === 'tender_notice');
    const award = subject.events.find((e) => e.kind === 'award');
    if (!incorp || !tender || !award) return notMatched(ID, 'missing event');
    const incDate = incorp.published_at ? new Date(incorp.published_at).getTime() : null;
    const tenDate = tender.published_at ? new Date(tender.published_at).getTime() : null;
    if (incDate === null || tenDate === null) return notMatched(ID, 'missing dates');
    const days = (tenDate - incDate) / 86_400_000;
    if (days < 0 || days > SHARP_WINDOW_DAYS) return notMatched(ID, `gap=${days.toFixed(1)}d`);

    // Strength scales inversely with days
    const strength = Math.min(1, 0.7 + (1 - days / SHARP_WINDOW_DAYS) * 0.3);
    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: [incorp.id, tender.id, award.id],
      rationale: `incorporated ${days.toFixed(0)}d before tender`,
    });
  },
};

registerPattern(definition);
export default definition;
