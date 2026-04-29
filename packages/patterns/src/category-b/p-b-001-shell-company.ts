import { Ids } from '@vigil/shared';

import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-B-001 — Shell-company indicator.
 *
 * Fires when a Company entity was incorporated within N days of an award
 * AND has minimal director / financial history. Reference pattern for
 * category B (beneficial-ownership concealment).
 */
const PATTERN_ID = Ids.asPatternId('P-B-001');
const RAPID_INCORP_WINDOW_DAYS = 90;

const definition: PatternDef = {
  id: PATTERN_ID,
  category: 'B',
  subjectKinds: ['Company'],
  title_fr: 'Indicateur de société écran',
  title_en: 'Shell-company indicator',
  description_fr:
    'Société constituée peu avant l’attribution du marché, sans antécédents administratifs ou financiers significatifs.',
  description_en:
    'Company incorporated shortly before the contract award with thin administrative or financial history.',
  defaultPrior: 0.22,
  defaultWeight: 0.85,
  status: 'live',

  async detect(subject, ctx) {
    const company = subject.canonical;
    if (!company || company.kind !== 'company') {
      return emptyResult('no company subject');
    }
    const incorpEvent = subject.events.find((e) => e.kind === 'company_filing');
    if (!incorpEvent) return emptyResult('no incorporation event');

    const incorpDate = incorpEvent.published_at ? new Date(incorpEvent.published_at) : null;
    if (!incorpDate) return emptyResult('incorporation date missing');

    const award = subject.events.find((e) => e.kind === 'award');
    if (!award || !award.published_at) return emptyResult('no award event');
    const awardDate = new Date(award.published_at);

    const days = Math.abs((awardDate.getTime() - incorpDate.getTime()) / 86_400_000);
    let strength = 0;
    const why: string[] = [];

    if (days <= RAPID_INCORP_WINDOW_DAYS && awardDate >= incorpDate) {
      strength += 0.55;
      why.push(`incorporated ${days.toFixed(0)}d before award`);
    }
    // Director thinness — single director, no PEP marker, no prior filings
    const directors = subject.related.filter((r) => r.kind === 'person');
    if (directors.length <= 1) {
      strength += 0.2;
      why.push('single director');
    }
    if (directors.some((d) => d.is_pep)) {
      strength += 0.25;
      why.push('director is PEP');
    }
    // Address shared with other rapid-incorps (community-detection signal)
    if (subject.metrics?.communityId !== undefined) {
      const sameCommunity = subject.related.filter(
        (r) => r.kind === 'company' && r.metadata?.['communityId'] === subject.metrics?.communityId,
      ).length;
      if (sameCommunity >= 3) {
        strength += 0.15;
        why.push(`co-incorporated cluster of ${sameCommunity}`);
      }
    }

    ctx.logger.info('p-b-001-evaluated', { strength, why });
    return {
      pattern_id: PATTERN_ID,
      matched: strength >= 0.5,
      strength: Math.min(1, strength),
      contributing_event_ids: [incorpEvent.id, award.id],
      contributing_document_cids: [...incorpEvent.document_cids, ...award.document_cids],
      rationale: why.join('; '),
    };
  },
};

function emptyResult(reason: string) {
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
