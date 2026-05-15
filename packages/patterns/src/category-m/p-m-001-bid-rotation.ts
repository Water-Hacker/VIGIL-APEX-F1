import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-M-001 — Bid rotation (World Bank INT + OECD).
 *
 * Source channel: graph-analysis events (kind `audit_observation`)
 * carry `bid_rotation_score` ∈ [0,1] computed by worker-pattern over a
 * Louvain community of bidders. Falls back to
 * `metadata.bid_rotation_score`.
 */
const PID = Ids.asPatternId('P-M-001');
const definition: PatternDef = {
  id: PID,
  category: 'M',
  source_body: 'WORLD_BANK_INT',
  subjectKinds: ['Tender'],
  title_fr: "Rotation d'attributaires",
  title_en: 'Bid rotation',
  description_fr:
    'Un attributaire pré-déterminé gagne à chaque tour ; même groupe de soumissionnaires en rotation suspecte. Typologie Banque mondiale INT + OECD.',
  description_en:
    'Pre-determined supplier wins each round; same pool rotates through "winner" position. WB INT + OECD typology.',
  defaultPrior: 0.05,
  defaultWeight: 0.7,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const r = readNumericWithFallback(subject, 'bid_rotation_score', 'bid_rotation_score', [
      'audit_observation',
      'company_filing',
    ]);
    if (r.value < 0.6) return notMatched(PID, `rotation_score=${r.value.toFixed(2)} < 0.6`);
    const strength = Math.min(0.95, r.value);
    const ev = evidenceFrom(r.contributors);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `Bid-rotation score ${r.value.toFixed(2)} across observed window.`,
    });
  },
};
registerPattern(definition);
export default definition;
