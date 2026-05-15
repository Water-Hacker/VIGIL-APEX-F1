import { Ids, type Schemas } from '@vigil/shared';

import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-J-005 — Undisclosed related-party transaction (ACFE).
 *
 * Material transaction with a counterparty that shares director/UBO
 * with the reporting entity, not disclosed in financial statements
 * per OHADA accounting standards (Art. 32 SYSCOHADA). Source: ACFE.
 */
const PID = Ids.asPatternId('P-J-005');
const definition: PatternDef = {
  id: PID,
  category: 'J',
  source_body: 'ACFE',
  subjectKinds: ['Company'],
  title_fr: 'Transaction avec partie liée non déclarée',
  title_en: 'Undisclosed related-party transaction',
  description_fr:
    'Transaction matérielle avec une partie liée (administrateur, UBO commun) non déclarée selon SYSCOHADA art. 32. Typologie ACFE.',
  description_en:
    'Material related-party transaction (shared director / UBO) not disclosed per OHADA Art. 32. ACFE typology.',
  defaultPrior: 0.06,
  defaultWeight: 0.5,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    const meta = (subject.canonical?.metadata ?? {}) as Record<string, unknown>;
    const undisclosedXaf = Number(meta.related_party_undisclosed_xaf ?? 0);
    if (undisclosedXaf < 50_000_000) return notMatched(PID, `undisclosed=${undisclosedXaf} < 50M`);
    const strength = Math.min(0.95, 0.4 + Math.log10(undisclosedXaf / 50_000_000) * 0.25);
    return matched({
      pattern_id: PID,
      strength,
      rationale: `${undisclosedXaf.toLocaleString('fr-CM')} XAF in related-party transactions absent from disclosures.`,
    });
  },
};
registerPattern(definition);
export default definition;
