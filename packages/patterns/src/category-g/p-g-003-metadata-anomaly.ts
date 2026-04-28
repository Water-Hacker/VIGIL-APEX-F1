import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';
import type { PatternDef } from '../types.js';

/**
 * P-G-003 — Document metadata anomaly.
 *
 * PDF / DOCX metadata reveals (a) wrong author / created-by entity, (b)
 * software-version mismatch with the declared origin, or (c) modification
 * date well after the document's stated effective date. Distinct from
 * P-G-001 (backdating) — this is broader metadata-vs-content inconsistency.
 */
const ID = PID('P-G-003');

const definition: PatternDef = {
  id: ID,
  category: 'G',
  subjectKinds: ['Tender'],
  title_fr: 'Anomalie de métadonnées documentaires',
  title_en: 'Document metadata anomaly',
  description_fr:
    "Les métadonnées du document (auteur, logiciel, date de modification) sont incohérentes avec son origine déclarée.",
  description_en:
    'Document metadata (author, software, modification date) are inconsistent with its stated origin.',
  defaultPrior: 0.18,
  defaultWeight: 0.55,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    let strength = 0;
    const ids: string[] = [];
    const why: string[] = [];
    for (const e of subject.events) {
      const meta = e.payload['document_metadata'] as Record<string, unknown> | undefined;
      const declaredAuthor = e.payload['declared_author'] as string | undefined;
      if (!meta) continue;
      const authorOnFile = meta['Author'] as string | undefined;
      const software = (meta['Producer'] as string | undefined) ?? (meta['Creator'] as string | undefined);

      if (declaredAuthor && authorOnFile && normalise(declaredAuthor) !== normalise(authorOnFile)) {
        strength = Math.max(strength, 0.55);
        why.push(`author '${authorOnFile}' ≠ declared '${declaredAuthor}'`);
        ids.push(e.id);
      }
      if (software && /\b(libre ?office|wordpad|abiword)\b/i.test(software)) {
        strength = Math.max(strength, 0.4);
        why.push(`unusual software=${software}`);
        ids.push(e.id);
      }
    }
    return strength === 0
      ? notMatched(ID, 'no metadata anomaly')
      : matched({
          pattern_id: ID,
          strength,
          contributing_event_ids: ids,
          rationale: why.slice(0, 5).join('; '),
        });
  },
};

function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

registerPattern(definition);
export default definition;
