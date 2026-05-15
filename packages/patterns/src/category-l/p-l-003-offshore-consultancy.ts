import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-L-003 — Offshore consultancy payment concurrent with award (OECD).
 *
 * Award winner transfers material sum to a consultancy in a tax-haven
 * jurisdiction (BVI, Mauritius, Seychelles, Cayman, Panama) within
 * 90 days of contract award. Source: OECD + Panama Papers analyses.
 */
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
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const havens = new Set(['VG', 'MU', 'SC', 'KY', 'PA', 'BS', 'BZ', 'AE']);
    const beneficiaryCountry = String(meta.beneficiary_country ?? '').toUpperCase();
    const daysAfterAward = Number(meta.days_after_award ?? Infinity);
    const amountXaf = Number(meta.amount_xaf ?? 0);
    if (!havens.has(beneficiaryCountry))
      return notMatched(PID, `country=${beneficiaryCountry} not haven`);
    if (daysAfterAward > 90) return notMatched(PID, `days_after_award=${daysAfterAward} > 90`);
    if (amountXaf < 50_000_000) return notMatched(PID, `amount=${amountXaf} < 50M`);
    const strength = Math.min(0.95, 0.5 + Math.log10(amountXaf / 50_000_000) * 0.15);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Payment of ${amountXaf.toLocaleString('fr-CM')} XAF to ${beneficiaryCountry} consultancy within ${daysAfterAward} days of award.`,
    });
  },
};
registerPattern(definition);
export default definition;
