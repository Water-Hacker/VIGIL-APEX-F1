import { Ids } from '@vigil/shared';

import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-H-001 — Award before tender-close.
 *
 * The award publication is dated BEFORE the tender's official close date.
 * Reference pattern for category H (temporal anomalies). Often a clerical
 * data-entry error in benign cases — but combined with single-bidder
 * (P-A-001) it is a strong rigging signal.
 */
const PATTERN_ID = Ids.asPatternId('P-H-001');

const definition: PatternDef = {
  id: PATTERN_ID,
  category: 'H',
  subjectKinds: ['Tender'],
  title_fr: "Attribution antérieure à la clôture de l'appel d'offres",
  title_en: 'Award dated before tender close',
  description_fr:
    "La date de publication de l’attribution précède la date officielle de clôture du marché.",
  description_en:
    "Award publication is dated before the tender's official close date.",
  defaultPrior: 0.20,
  defaultWeight: 0.6,
  status: 'live',

  async detect(subject) {
    const award = subject.events.find((e) => e.kind === 'award');
    const tender = subject.events.find((e) => e.kind === 'tender_notice');
    if (!award || !tender) return empty('missing award or tender');
    const closeAt = (tender.payload['close_at'] as string | undefined) ?? null;
    const awardAt = award.published_at;
    if (!closeAt || !awardAt) return empty('missing dates');
    const c = new Date(closeAt).getTime();
    const a = new Date(awardAt).getTime();
    if (Number.isNaN(c) || Number.isNaN(a)) return empty('unparseable dates');
    if (a >= c) {
      return {
        pattern_id: PATTERN_ID,
        matched: false,
        strength: 0,
        contributing_event_ids: [],
        contributing_document_cids: [],
        rationale: 'award after tender-close (normal)',
      };
    }
    const days = (c - a) / 86_400_000;
    const strength = Math.min(1, days / 14); // 14d before-close → strength 1
    return {
      pattern_id: PATTERN_ID,
      matched: strength >= 0.3,
      strength,
      contributing_event_ids: [tender.id, award.id],
      contributing_document_cids: [...tender.document_cids, ...award.document_cids],
      rationale: `award ${days.toFixed(1)}d before tender-close`,
    };
  },
};

function empty(reason: string) {
  return {
    pattern_id: PATTERN_ID,
    matched: false,
    strength: 0,
    contributing_event_ids: [],
    contributing_document_cids: [],
    rationale: reason,
  };
}

registerPattern(definition);
export default definition;
