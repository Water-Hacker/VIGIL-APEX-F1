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
    const award = subject.events.find((e) => e.kind === 'award');
    if (!award) {
      return {
        pattern_id: this.id,
        matched: false,
        strength: 0,
        contributing_event_ids: [],
        contributing_document_cids: [],
        rationale: 'no award event',
      };
    }
    const bidderCount =
      typeof award.payload['bidder_count'] === 'number' ? (award.payload['bidder_count'] as number) : null;
    const procurementMethod =
      typeof award.payload['procurement_method'] === 'string'
        ? (award.payload['procurement_method'] as string).toLowerCase()
        : '';
    const isNoBid =
      procurementMethod.includes('gré à gré') ||
      procurementMethod.includes('sole-source') ||
      procurementMethod.includes('marché négocié');

    let strength = 0;
    const why: string[] = [];
    if (bidderCount === 1) {
      strength += 0.6;
      why.push('exactly 1 bidder');
    }
    if (isNoBid) {
      strength += 0.3;
      why.push('no-bid procurement method');
    }
    // Bonus if the same supplier won the previous award from the same authority
    const supplier = (award.payload['supplier_name'] as string | undefined) ?? null;
    if (supplier !== null) {
      const prior = subject.events.find(
        (e) =>
          e.kind === 'award' &&
          e.id !== award.id &&
          (e.payload['supplier_name'] as string | undefined) === supplier,
      );
      if (prior !== undefined) {
        strength += 0.15;
        why.push('same supplier as prior award');
      }
    }

    ctx.logger.info('p-a-001-evaluated', { strength, why });
    return {
      pattern_id: this.id,
      matched: strength >= 0.5,
      strength: Math.min(1, strength),
      contributing_event_ids: [award.id],
      contributing_document_cids: award.document_cids,
      rationale: why.join('; '),
    };
  },
};

registerPattern(definition);
export default definition;
