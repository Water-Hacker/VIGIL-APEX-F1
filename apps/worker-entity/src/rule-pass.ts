/**
 * Rule-pass — pure deterministic helpers for worker-entity.
 *
 * Separated from `index.ts` so unit tests can import the regex /
 * language detector without dragging in `@vigil/llm` /
 * `@vigil/db-neo4j` / `@vigil/security`. This module has zero
 * runtime dependencies and is safe to import from anywhere.
 *
 * The companion `EntityRepo` lookup methods live in
 * `@vigil/db-postgres`; the worker handler in `index.ts` composes
 * the regexes here with those repo calls into the full rule-pass.
 */

// Cameroonian RCCM (Registre du Commerce et du Crédit Mobilier).
// Canonical form: `RC/<centre>/<year>/<categ>/<seq>` —
// e.g. `RC/YDE/2024/B/01234`.
//
// We accept the canonical slash form plus a tolerant variant where
// the slashes are dashes or spaces because adapter outputs vary.
// The regex is anchored with word boundaries so it can be applied
// against an arbitrary alias string and capture the substring.
export const RCCM_RE = /\bRC[\s/-](?:[A-Z]{2,4})[\s/-](?:19|20)\d{2}[\s/-][A-Z][\s/-]\d{1,6}\b/i;

// NIU (Numéro d'Identification Unique) — Cameroonian taxpayer id.
// Fixed-format alphanumeric: leading letter (P personal, M
// micro-entreprise, C corporate) + 12 digits + trailing checksum
// letter, e.g. `P011500001234X`.
export const NIU_RE = /\b[PMC]\d{12}[A-Z]\b/;

/**
 * Cheap heuristic language tagger for an alias.
 *
 * Returns `'fr'` if the alias contains French diacritics or any
 * common French function word, otherwise `'en'`. The downstream
 * surfaces use this only for display ordering; a misclassification
 * is cosmetic, not load-bearing.
 */
export function detectLanguage(alias: string): string {
  if (/[éèêëàâäîïôöùûüç]/i.test(alias)) return 'fr';
  if (/\b(le|la|les|du|des|de|et|société|sàrl|sa)\b/i.test(alias)) return 'fr';
  return 'en';
}

/**
 * Normalise an RCCM substring to its canonical slash form. Used
 * before exact-equality lookup against `entity.canonical.rccm_number`
 * so both `RC/YDE/2024/B/01234` and `RC-YDE-2024-B-1234` collapse
 * to the same key.
 */
export function canonicalRccm(s: string): string {
  return s.replace(/[\s-]/g, '/').toUpperCase();
}

/**
 * Normalise a NIU substring to its canonical form. Currently a
 * simple `toUpperCase()` because the NIU regex already pins the
 * digit positions; future format changes (post-2025) may require
 * additional normalisation.
 */
export function canonicalNiu(s: string): string {
  return s.toUpperCase();
}
