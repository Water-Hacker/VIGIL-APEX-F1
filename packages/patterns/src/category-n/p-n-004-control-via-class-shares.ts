import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-N-004 — Declared ownership < 25% but de-facto control (Wolfsberg / FATF R.24).
 *
 * Entity claims no person holds ≥ 25% (so no UBO declared), yet a
 * single individual controls the board through dual-class shares,
 * voting trust, or a majority of independent directors are co-aligned.
 */
const PID = Ids.asPatternId('P-N-004');
const definition: PatternDef = {
  id: PID,
  category: 'N',
  source_body: 'WOLFSBERG',
  subjectKinds: ['Company'],
  title_fr: 'Contrôle de fait sans participation > 25%',
  title_en: 'De-facto control without > 25% declared stake',
  description_fr:
    'Aucun actionnaire ≥ 25% déclaré, mais contrôle de fait par actions à droits multiples, fiducie de vote ou administrateurs alignés. Test FATF R.24 / Wolfsberg.',
  description_en:
    'No declared ≥ 25% shareholder, but de-facto control via dual-class shares, voting trust, or aligned directors. FATF R.24 / Wolfsberg test.',
  defaultPrior: 0.07,
  defaultWeight: 0.55,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const noUboDeclared = meta.no_ubo_declared === true;
    const dualClass = meta.dual_class_shares === true;
    const votingTrust = meta.voting_trust_present === true;
    const directorAlignment = Number(meta.director_alignment_ratio ?? 0);
    const flags = [noUboDeclared, dualClass, votingTrust, directorAlignment > 0.66].filter(
      Boolean,
    ).length;
    if (flags < 2) return notMatched(PID, `de-facto-control flags ${flags}/4`);
    const strength = Math.min(0.95, 0.3 + flags * 0.2);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `De-facto control markers: ${flags}/4 (noUbo=${noUboDeclared}, dualClass=${dualClass}, trust=${votingTrust}, dirAlign=${directorAlignment.toFixed(2)}).`,
    });
  },
};
registerPattern(definition);
export default definition;
