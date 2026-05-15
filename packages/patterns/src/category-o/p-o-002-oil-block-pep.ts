import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-O-002 — Oil / gas block transferred to politically-connected entity below market.
 *
 * NRGI Resource Governance Index methodology — block transferred to
 * entity whose UBO matches an active PEP, at a transfer price below
 * the IMF/World-Bank fair-value benchmark.
 */
const PID = Ids.asPatternId('P-O-002');
const definition: PatternDef = {
  id: PID,
  category: 'O',
  source_body: 'EITI',
  subjectKinds: ['Tender'],
  title_fr: 'Bloc pétrolier transféré à une entité PEP sous le prix de marché',
  title_en: 'Oil/gas block to PEP-connected entity below market',
  description_fr:
    "Bloc pétrolier ou gazier transféré à une entité dont l'UBO est PEP, à un prix inférieur au benchmark FMI / Banque mondiale. Typologie NRGI.",
  description_en:
    'Oil/gas block transferred to an entity whose UBO matches an active PEP, below IMF/World-Bank fair-value benchmark. NRGI typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.75,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    if (meta.sector !== 'oil_gas') return notMatched(PID, 'not oil/gas');
    const pepLinked = meta.ubo_is_pep === true;
    const belowMarketRatio = Number(meta.transfer_price_to_benchmark ?? 1);
    if (!pepLinked || belowMarketRatio >= 0.7)
      return notMatched(PID, `pep=${pepLinked} ratio=${belowMarketRatio}`);
    const strength = Math.min(0.95, 0.5 + (0.7 - belowMarketRatio) * 1.2);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `PEP-linked acquirer at ${(belowMarketRatio * 100).toFixed(0)}% of benchmark.`,
    });
  },
};
registerPattern(definition);
export default definition;
