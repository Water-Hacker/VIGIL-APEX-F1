import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-K-003 — Multiple invoicing (FATF TBML).
 *
 * Same shipment / bill of lading billed multiple times across
 * different banks. Source: FATF TBML 2020.
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
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const dupInvoices = Number(meta.duplicate_invoice_count ?? 0);
    if (dupInvoices < 2) return notMatched(PID, `duplicates=${dupInvoices}`);
    const strength = Math.min(0.95, 0.5 + dupInvoices * 0.15);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `${dupInvoices} invoices reference the same shipment / bill of lading.`,
    });
  },
};
registerPattern(definition);
export default definition;
