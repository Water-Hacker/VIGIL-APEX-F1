import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-I-008 — Inventory / non-cash misappropriation (ACFE).
 *
 * Physical asset diversion: declared inventory ≠ physical-count
 * inventory after delivery acceptance. Detection from
 * inventory-vs-delivery reconciliation. Source: ACFE.
 */
const PID = Ids.asPatternId('P-I-008');
const definition: PatternDef = {
  id: PID,
  category: 'I',
  source_body: 'ACFE',
  subjectKinds: ['Project', 'Tender'],
  title_fr: "Détournement d'inventaire / actifs non monétaires",
  title_en: 'Inventory / non-cash misappropriation',
  description_fr:
    "Écart matériel entre l'inventaire déclaré et l'inventaire physique post-livraison. Typologie ACFE.",
  description_en:
    'Material gap between declared inventory and post-delivery physical count. ACFE typology.',
  defaultPrior: 0.05,
  defaultWeight: 0.5,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const shrinkage = Number(meta.inventory_shrinkage_ratio ?? 0);
    if (shrinkage < 0.1) return notMatched(PID, `shrinkage=${shrinkage} < 10%`);
    const strength = Math.min(0.95, 0.3 + shrinkage * 2);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Inventory shrinkage of ${(shrinkage * 100).toFixed(1)}%.`,
    });
  },
};
registerPattern(definition);
export default definition;
