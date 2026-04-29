import { Ids } from '@vigil/shared';

import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-G-001 — Backdated document.
 *
 * Document metadata creation_date is later than the document's stated
 * effective date. Reference pattern for category G (document integrity).
 */
const PATTERN_ID = Ids.asPatternId('P-G-001');

const definition: PatternDef = {
  id: PATTERN_ID,
  category: 'G',
  subjectKinds: ['Tender'],
  title_fr: 'Document antidaté',
  title_en: 'Backdated document',
  description_fr:
    'La date de création des métadonnées est postérieure à la date effective déclarée par le document.',
  description_en: "Document metadata creation date is after the document's stated effective date.",
  defaultPrior: 0.35,
  defaultWeight: 0.7,
  status: 'live',

  async detect(subject) {
    let strongest = 0;
    const why: string[] = [];
    const ids: string[] = [];
    for (const ev of subject.events) {
      const meta = ev.payload['document_metadata'] as Record<string, unknown> | undefined;
      const stated = ev.payload['effective_date'] as string | undefined;
      const created = (meta?.['created_date'] as string | undefined) ?? null;
      if (!stated || !created) continue;
      const s = new Date(stated).getTime();
      const c = new Date(created).getTime();
      if (Number.isNaN(s) || Number.isNaN(c)) continue;
      if (c > s) {
        const days = (c - s) / 86_400_000;
        const strength = Math.min(1, days / 30); // 30+ days backdated → strength 1
        if (strength > strongest) strongest = strength;
        why.push(`event=${ev.id.slice(0, 8)} backdated ${days.toFixed(0)}d`);
        ids.push(ev.id);
      }
    }
    return {
      pattern_id: PATTERN_ID,
      matched: strongest >= 0.4,
      strength: strongest,
      contributing_event_ids: ids,
      contributing_document_cids: [],
      rationale: why.join('; ') || 'no backdating found',
    };
  },
};

registerPattern(definition);
export default definition;
