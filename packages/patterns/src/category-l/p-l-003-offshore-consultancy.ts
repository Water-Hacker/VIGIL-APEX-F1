import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, eventsOfKind, meta, num, str } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

const PID = Ids.asPatternId('P-L-003');
const definition: PatternDef = {
  id: PID,
  category: 'L',
  source_body: 'OECD',
  subjectKinds: ['Payment'],
  title_fr: "Paiement à un cabinet offshore concomitant à l'attribution",
  title_en: 'Offshore consultancy payment concurrent with award',
  description_fr:
    "Versement matériel à un cabinet en juridiction à faible-impôt (BVI, Maurice, Seychelles, Cayman, Panama) dans les 90 jours suivant l'attribution. Typologie OECD / Panama Papers.",
  description_en:
    'Material payment to a tax-haven consultancy (BVI, Mauritius, Seychelles, Cayman, Panama) within 90 days of contract award. OECD / Panama Papers typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.65,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    // FATF + OECD high-risk / haven jurisdictions (ISO-3166-1 alpha-2).
    const havens = new Set([
      'VG',
      'MU',
      'SC',
      'KY',
      'PA',
      'BS',
      'BZ',
      'AE',
      'AI',
      'BM',
      'GG',
      'IM',
      'JE',
      'VG',
      'VI',
    ]);

    // Path 1: scan payment_order events for offshore beneficiary + post-award window.
    const payments = eventsOfKind(subject, ['payment_order', 'treasury_disbursement']);
    let beneficiaryCountry: string | null = null;
    let daysAfterAward = Infinity;
    let amountXaf = 0;
    let contributors: ReadonlyArray<(typeof subject.events)[number]> = [];

    for (const p of payments) {
      const country = str(p.payload['beneficiary_country']);
      const days = num(p.payload['days_after_award']);
      const amt = num(p.payload['amount_xaf']);
      if (country !== null && days !== null && amt !== null) {
        const cu = country.toUpperCase();
        if (havens.has(cu) && days <= 90 && amt >= 50_000_000) {
          if (amt > amountXaf) {
            beneficiaryCountry = cu;
            daysAfterAward = days;
            amountXaf = amt;
            contributors = [p];
          }
        }
      }
    }

    // Path 2: metadata fallback.
    if (beneficiaryCountry === null) {
      const m = meta(subject);
      const country = String(m.beneficiary_country ?? '').toUpperCase();
      const days = Number(m.days_after_award ?? Infinity);
      const amt = Number(m.amount_xaf ?? 0);
      if (havens.has(country) && days <= 90 && amt >= 50_000_000) {
        beneficiaryCountry = country;
        daysAfterAward = days;
        amountXaf = amt;
      }
    }

    if (beneficiaryCountry === null) {
      return notMatched(PID, 'no qualifying offshore-payment signal');
    }
    const strength = Math.min(0.95, 0.55 + Math.log10(amountXaf / 50_000_000) * 0.15);
    const ev = evidenceFrom(contributors);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Payment of ${amountXaf.toLocaleString('fr-CM')} XAF to ${beneficiaryCountry} consultancy within ${daysAfterAward} days of award.`,
    });
  },
};
registerPattern(definition);
export default definition;
