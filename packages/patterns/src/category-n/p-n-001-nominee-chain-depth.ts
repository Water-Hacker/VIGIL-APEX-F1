import { Ids, type Schemas } from '@vigil/shared';

import { evidenceFrom, readNumericWithFallback } from '../_event-helpers.js';
import { matched, notMatched } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternContext, PatternDef, SubjectInput } from '../types.js';

/**
 * P-N-001 — Nominee chain depth > 3 jurisdictions (Pandora Papers).
 *
 * UBO graph traversal upstream populates `ubo_chain_jurisdiction_count`
 * on a `company_filing` event (or directly in canonical.metadata for
 * the legacy path). The count is the number of distinct
 * jurisdictions encountered while walking the UBO chain root-down.
 *
 * The walk also counts entries in `subject.related` that carry a
 * `relation_kind:'ubo'` link + a `jurisdiction` field — when present,
 * those contribute the same count without an upstream pre-computation.
 */
const PID = Ids.asPatternId('P-N-001');
const definition: PatternDef = {
  id: PID,
  category: 'N',
  source_body: 'OCCRP',
  subjectKinds: ['Company'],
  title_fr: "Chaîne d'actionnariat traversant plus de 3 juridictions",
  title_en: 'Nominee chain depth > 3 jurisdictions',
  description_fr:
    "Structure d'actionnariat traversant 3+ juridictions distinctes (motif typique des Pandora Papers).",
  description_en:
    'Beneficial-ownership chain passes through 3+ distinct jurisdictions (typical Pandora-Papers shape).',
  defaultPrior: 0.06,
  defaultWeight: 0.6,
  status: 'live',
  async detect(subject: SubjectInput, _ctx: PatternContext): Promise<Schemas.PatternResult> {
    // Path 1 — count distinct jurisdictions across UBO-linked related entities.
    const uboJurisdictions = new Set<string>();
    for (const r of subject.related) {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      const kind = (m.relation_kind ?? m.kind) as string | undefined;
      if (kind === 'ubo' && typeof r.jurisdiction === 'string') {
        uboJurisdictions.add(r.jurisdiction);
      }
    }

    let depth = uboJurisdictions.size;
    let contributors: ReadonlyArray<(typeof subject.events)[number]> = [];

    // Path 2 — read upstream pre-computed score.
    if (depth < 4) {
      const r = readNumericWithFallback(
        subject,
        'ubo_chain_jurisdiction_count',
        'ubo_chain_jurisdiction_count',
        ['company_filing', 'audit_observation'],
      );
      if (r.value > depth) {
        depth = r.value;
        contributors = r.contributors;
      }
    }

    if (depth < 4) return notMatched(PID, `jurisdiction_count=${depth} < 4`);
    const strength = Math.min(0.95, 0.5 + depth * 0.08);
    const ev = evidenceFrom(contributors);
    return matched({
      pattern_id: PID,
      strength,
      contributing_event_ids: ev.contributing_event_ids,
      contributing_document_cids: ev.contributing_document_cids,
      rationale: `UBO chain passes through ${depth} jurisdictions.`,
    });
  },
};
registerPattern(definition);
export default definition;
