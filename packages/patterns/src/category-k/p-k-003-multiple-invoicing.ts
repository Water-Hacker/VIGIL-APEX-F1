import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, eventsOfKind, meta, num, str } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-K-003 — Multiple invoicing (FATF TBML).
 *
 * Detection: count `payment_order` events whose `bill_of_lading` payload
 * field is shared across at least 2 distinct invoices. Falls back to
 * `metadata.duplicate_invoice_count` for the legacy path.
 */
const PID = Ids.asPatternId('P-K-003');
const definition: PatternDef = {
  id: PID,
  category: 'K',
  source_body: 'FATF',
  subjectKinds: ['Payment'],
  title_fr: 'Facturation multiple de la même expédition',
  title_en: 'Multiple invoicing of the same shipment',
  description_fr:
    'Même connaissement / shipment facturé via plusieurs banques. Typologie FATF TBML.',
  description_en:
    'Same bill of lading / shipment billed across multiple banks. FATF TBML typology.',
  defaultPrior: 0.03,
  defaultWeight: 0.7,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const payments = eventsOfKind(subject, ['payment_order']);
    const byBol = new Map<string, (typeof payments)[number][]>();
    for (const p of payments) {
      const bol = str(p.payload['bill_of_lading']);
      if (bol === null) continue;
      const arr = byBol.get(bol) ?? [];
      arr.push(p);
      byBol.set(bol, arr);
    }
    let maxGroup = 0;
    let contributors: (typeof payments)[number][] = [];
    for (const arr of byBol.values()) {
      if (arr.length > maxGroup) {
        maxGroup = arr.length;
        contributors = arr;
      }
    }

    let dupInvoices = maxGroup;
    if (dupInvoices === 0) {
      dupInvoices = num(meta(subject).duplicate_invoice_count) ?? 0;
    }

    if (dupInvoices < 2) return notMatched(PID, `duplicates=${dupInvoices}`);
    const strength = Math.min(0.95, 0.55 + dupInvoices * 0.12);
    const ev = evidenceFrom(contributors);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `${dupInvoices} invoices reference the same shipment / bill of lading.`,
    });
  },
};
registerPattern(definition);
export default definition;
