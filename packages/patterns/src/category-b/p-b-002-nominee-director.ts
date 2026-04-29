import { type Schemas } from '@vigil/shared';

import { matched, notMatched, PID } from '../_pattern-helpers.js';
import { registerPattern } from '../registry.js';

import type { PatternDef } from '../types.js';

/**
 * P-B-002 — Nominee director (mass-director signal).
 *
 * A single individual is recorded as director of an unusually high number of
 * unrelated companies (≥ 10), of which at least 2 won public contracts in
 * the past 24 months. Strongly suggestive of nominee / front director
 * arrangements.
 */
const ID = PID('P-B-002');
const NOMINEE_THRESHOLD = 10;

const definition: PatternDef = {
  id: ID,
  category: 'B',
  subjectKinds: ['Person', 'Company'],
  title_fr: 'Dirigeant fictif (nominee)',
  title_en: 'Nominee director',
  description_fr:
    "Personne enregistrée comme dirigeante d'au moins 10 sociétés sans lien apparent, dont plusieurs attributaires.",
  description_en:
    'Person on record as director of ≥ 10 unrelated companies, several of which are public-contract awardees.',
  defaultPrior: 0.22,
  defaultWeight: 0.7,
  status: 'live',

  async detect(subject, _ctx): Promise<Schemas.PatternResult> {
    const person = subject.canonical;
    if (!person || person.kind !== 'person') return notMatched(ID, 'no person subject');
    const companies = subject.related.filter((r) => r.kind === 'company');
    if (companies.length < NOMINEE_THRESHOLD) {
      return notMatched(ID, `directs only ${companies.length} companies`);
    }
    const awardees = companies.filter((c) => {
      const tags = (c.metadata?.['tags'] as ReadonlyArray<string> | undefined) ?? [];
      return tags.includes('public-contract-awardee');
    });
    if (awardees.length < 2) return notMatched(ID, 'fewer than 2 awardee directorships');

    const strength = Math.min(1, 0.5 + 0.04 * (companies.length - NOMINEE_THRESHOLD) + 0.05 * awardees.length);
    return matched({
      pattern_id: ID,
      strength,
      contributing_event_ids: subject.events.map((e) => e.id).slice(0, 5),
      rationale: `directs ${companies.length} companies; ${awardees.length} are public-contract awardees`,
    });
  },
};

registerPattern(definition);
export default definition;
