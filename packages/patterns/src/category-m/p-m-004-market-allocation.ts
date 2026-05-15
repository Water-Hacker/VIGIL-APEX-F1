import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-M-004 — Market allocation (WB INT / OECD).
 *
 * Detection: `bidder_geographic_hhi` and `cartel_market_coverage` from
 * `audit_observation` events. Falls back to metadata fields.
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
    const hhi = readNumericWithFallback(subject, 'bidder_geographic_hhi', 'bidder_geographic_hhi', [
      'audit_observation',
      'company_filing',
    ]);
    const coverage = readNumericWithFallback(
      subject,
      'cartel_market_coverage',
      'cartel_market_coverage',
      ['audit_observation', 'company_filing'],
    );
    if (hhi.value < 0.85 || coverage.value < 0.8) {
      return notMatched(PID, `HHI=${hhi.value.toFixed(2)}, coverage=${coverage.value.toFixed(2)}`);
    }
    const strength = Math.min(0.95, 0.4 + hhi.value * 0.3 + coverage.value * 0.3);
    const ev = evidenceFrom([...hhi.contributors, ...coverage.contributors]);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Bidder HHI ${hhi.value.toFixed(2)}, cartel coverage ${(coverage.value * 100).toFixed(0)}%.`,
    });
  },
};
registerPattern(definition);
export default definition;
