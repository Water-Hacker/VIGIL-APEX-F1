import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readBoolWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-K-004 — Phantom shipment (FATF TBML).
 *
 * Detection: invoiced shipment with no matching customs declaration
 * (Cameroon Douanes adapter writes `no_customs_declaration:true` on the
 * payment_order event when reconciliation fails) or no bill of lading
 * on file with the carrier (`no_bill_of_lading:true`). Falls back to
 * the same fields on `subject.canonical.metadata`.
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
    const customs = readBoolWithFallback(
      subject,
      'no_customs_declaration',
      'no_customs_declaration',
      ['payment_order', 'company_filing'],
    );
    const bol = readBoolWithFallback(subject, 'no_bill_of_lading', 'no_bill_of_lading', [
      'payment_order',
      'company_filing',
    ]);
    if (!customs.value && !bol.value) return notMatched(PID, 'shipment evidence present');
    const strength = customs.value && bol.value ? 0.92 : 0.65;
    const ev = evidenceFrom([...customs.contributors, ...bol.contributors]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Phantom-shipment markers: noCustoms=${customs.value}, noBoL=${bol.value}.`,
    });
  },
};
registerPattern(definition);
export default definition;
