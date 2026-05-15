import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-K-004 — Phantom shipment (FATF TBML).
 *
 * Goods invoiced and paid for that were never actually shipped.
 * Detection: invoiced shipment with no matching customs declaration
 * (Cameroon Douanes) or no bill of lading on file with the carrier.
 * Source: FATF.
 */
const PID = Ids.asPatternId('P-K-004');
const definition: PatternDef = {
  id: PID,
  category: 'K',
  source_body: 'FATF',
  subjectKinds: ['Payment'],
  title_fr: 'Expédition fantôme',
  title_en: 'Phantom shipment',
  description_fr:
    'Marchandises facturées et payées sans déclaration douanière ni connaissement correspondant. Typologie FATF TBML.',
  description_en:
    'Goods invoiced and paid with no matching customs declaration nor bill of lading. FATF TBML typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.75,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const noCustoms = meta.no_customs_declaration === true;
    const noBol = meta.no_bill_of_lading === true;
    if (!noCustoms && !noBol) return notMatched(PID, 'shipment evidence present');
    const strength = noCustoms && noBol ? 0.92 : 0.6;
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Phantom-shipment markers: noCustoms=${noCustoms}, noBoL=${noBol}.`,
    });
  },
};
registerPattern(definition);
export default definition;
