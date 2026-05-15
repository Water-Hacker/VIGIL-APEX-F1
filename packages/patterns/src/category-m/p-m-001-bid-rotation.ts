import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-M-001 — Bid rotation (World Bank INT + OECD).
 *
 * A pre-determined supplier wins each round; same set of bidders cycles
 * through "winner" position. Detection: for the same procurement
 * category in a defined region/period, the winner-set rotates with
 * suspiciously even share-of-wins across a small pool. Source: WB INT
 * debarment guide + OECD bid-rigging guidelines.
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
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const rotationScore = Number(meta.bid_rotation_score ?? 0); // 0..1, computed upstream by graph analysis
    if (rotationScore < 0.6) return notMatched(PID, `rotation_score=${rotationScore} < 0.6`);
    const strength = Math.min(0.95, rotationScore);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `Bid-rotation score ${rotationScore.toFixed(2)} across observed window.`,
    });
  },
};
registerPattern(definition);
export default definition;
