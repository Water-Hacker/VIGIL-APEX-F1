import { Ids } from '@vigil/shared';

import { registerPattern } from '../registry.js';

import type { PatternDef, PatternContext, SubjectInput } from '../types.js';

/**
 * P-A-001 — Single-bidder award.
 *
 * Fires when a tender attracted exactly one bidder AND was awarded above a
 * material threshold OR was a no-bid extension.
 *
 * Reference pattern for category A. The other 8 A-patterns follow the same
 * shape: pure detect() over the subject's events + related entities.
 */

const definition: PatternDef = {
  id: Ids.asPatternId('P-A-001'),
  category: 'A',
  subjectKinds: ['Tender'],
  title_fr: 'Marché à soumissionnaire unique',
  title_en: 'Single-bidder award',
  description_fr:
    "Le marché a été attribué après réception d'une seule offre, ou en l'absence d'appel à concurrence formel.",
  description_en:
    'Tender awarded after receiving exactly one bid, or without a formal competitive solicitation.',
  defaultPrior: 0.18,
  defaultWeight: 0.7,
  status: 'live',

  async detect(subject: SubjectInput, ctx: PatternContext) {
    const awards = subject.events.filter((e) => e.kind === 'award');
    if (awards.length === 0) {
      return {
        pattern_id: this.id,
        matched: false,
        strength: 0,
        contributing_event_ids: [],
        contributing_document_cids: [],
        rationale: 'no award event',
      };
    }

    let strength = 0;
    const why: string[] = [];
    const contributingIds = new Set<string>();
    const contributingCids = new Set<string>();

    // Aggregate signals across every award in the subject. Each signal
    // counts at most once so a subject with multiple suspicious awards
    // doesn't double-add (the test calls this the "multi-signal" case).
    let sawSingleBidder = false;
    let sawNoBid = false;
    let sawSamePriorSupplier = false;

    for (const a of awards) {
      const bc = typeof a.payload['bidder_count'] === 'number' ? (a.payload['bidder_count'] as number) : null;
      const pm =
        typeof a.payload['procurement_method'] === 'string'
          ? (a.payload['procurement_method'] as string).toLowerCase()
          : '';
      const isNoBid =
        pm.includes('gré à gré') ||
        pm.includes('sole-source') ||
        pm.includes('marché négocié');
      const supplier = (a.payload['supplier_name'] as string | undefined) ?? null;

      const matchedAward = bc === 1 || isNoBid;
      if (matchedAward) {
        contributingIds.add(a.id);
        for (const cid of a.document_cids) contributingCids.add(cid);
      }
      if (bc === 1) sawSingleBidder = true;
      if (isNoBid) sawNoBid = true;

      if (supplier !== null) {
        const priorWithSameSupplier = awards.find(
          (other) =>
            other.id !== a.id &&
            (other.payload['supplier_name'] as string | undefined) === supplier,
        );
        if (priorWithSameSupplier !== undefined) {
          sawSamePriorSupplier = true;
          contributingIds.add(a.id);
          contributingIds.add(priorWithSameSupplier.id);
        }
      }
    }

    if (sawSingleBidder) {
      strength += 0.6;
      why.push('exactly 1 bidder');
    }
    if (sawNoBid) {
      strength += 0.3;
      why.push('no-bid procurement method');
    }
    if (sawSamePriorSupplier) {
      strength += 0.15;
      why.push('same supplier as prior award');
    }

    ctx.logger.info('p-a-001-evaluated', { strength, why });
    return {
      pattern_id: this.id,
      matched: strength >= 0.5,
      strength: Math.min(1, strength),
      contributing_event_ids: [...contributingIds],
      contributing_document_cids: [...contributingCids],
      rationale: why.join('; '),
    };
  },
};

registerPattern(definition);
export default definition;
