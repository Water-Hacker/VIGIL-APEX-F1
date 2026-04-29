import { Ids } from '@vigil/shared';

import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-E-001 — Direct sanctioned-entity exposure.
 *
 * The supplier OR a direct shareholder appears on World Bank / AfDB / EU /
 * OFAC / UN / OpenSanctions rolls. Reference pattern for category E.
 */
const PATTERN_ID = Ids.asPatternId('P-E-001');

const definition: PatternDef = {
  id: PATTERN_ID,
  category: 'E',
  subjectKinds: ['Tender', 'Company'],
  title_fr: 'Exposition directe à une entité sanctionnée',
  title_en: 'Direct sanctioned-entity exposure',
  description_fr:
    "Le fournisseur ou un actionnaire direct figure sur une liste de sanctions internationales.",
  description_en: 'Supplier or direct shareholder appears on an international sanctions roster.',
  defaultPrior: 0.55,
  defaultWeight: 0.95,
  status: 'live',

  async detect(subject, ctx) {
    const company = subject.canonical;
    if (!company) return empty('no canonical');
    const direct = company.is_sanctioned;
    const shareholderHit = subject.related.some((r) => r.is_sanctioned);
    if (!direct && !shareholderHit) return empty('no sanctions exposure');
    const lists = company.sanctioned_lists.length;
    const strength = direct ? Math.min(1, 0.8 + 0.1 * lists) : 0.6;
    ctx.logger.info('p-e-001-evaluated', { direct, shareholderHit, strength });
    return {
      pattern_id: PATTERN_ID,
      matched: true,
      strength,
      contributing_event_ids: [],
      contributing_document_cids: [],
      rationale: direct
        ? `direct sanction; lists=${company.sanctioned_lists.join(',')}`
        : 'shareholder is sanctioned',
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
