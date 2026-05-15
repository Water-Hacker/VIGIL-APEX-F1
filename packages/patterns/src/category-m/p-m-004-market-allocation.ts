import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-M-004 — Market allocation (WB INT / OECD).
 *
 * Bidders carve up the market by geography (Cameroon has 10 regions
 * + 58 départements) or by procurement category, with each cartel
 * member dominating their assigned slice. Detection: per-bidder
 * geographic / category concentration > 0.85 (Herfindahl-Hirschman
 * within bidder), and the union of bidders covers > 80% of state
 * procurement in the region/category.
 */
const PID = Ids.asPatternId('P-M-004');
const definition: PatternDef = {
  id: PID,
  category: 'M',
  source_body: 'WORLD_BANK_INT',
  subjectKinds: ['Company'],
  title_fr: 'Partage de marché entre soumissionnaires',
  title_en: 'Market allocation among bidders',
  description_fr:
    'Cartel de soumissionnaires se partageant le marché par géographie (10 régions / 58 départements) ou par catégorie. Typologie WB INT / OECD.',
  description_en:
    'Bidder cartel carving the market by geography (10 regions / 58 departments) or category. WB INT / OECD typology.',
  defaultPrior: 0.04,
  defaultWeight: 0.7,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const hhi = Number(meta.bidder_geographic_hhi ?? 0);
    const coverage = Number(meta.cartel_market_coverage ?? 0);
    if (hhi < 0.85 || coverage < 0.8) return notMatched(PID, `HHI=${hhi}, coverage=${coverage}`);
    const strength = Math.min(0.95, 0.3 + hhi * 0.3 + coverage * 0.4);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Bidder HHI ${hhi.toFixed(2)}, cartel coverage ${(coverage * 100).toFixed(0)}%.`,
    });
  },
};
registerPattern(definition);
export default definition;
