/**
 * EntityRepo helper unit tests — `normalizeName` only.
 *
 * The repo's read/write methods (`upsertCanonical`, `addAlias`,
 * `upsertCluster`, `findCanonicalByNormalizedName`) require a real
 * Postgres connection; those are gated on `INTEGRATION_DB_URL` and
 * live in `entity-repo-integration.test.ts` (env-skipped by
 * default, mirroring the AUDIT-085 CAS test pattern).
 *
 * `normalizeName` is pure — it case-folds, strips diacritics, drops
 * punctuation, collapses whitespace. The rule-pass uses it client-
 * side to bail early on empty inputs; the SQL `findCanonicalByNormalizedName`
 * recomputes the same normalisation server-side via translate() +
 * regexp_replace(). The two implementations MUST agree byte-for-byte
 * on the test corpus below or the rule-pass becomes stochastic.
 */
import { describe, expect, it } from 'vitest';

import { normalizeName } from '../src/repos/entity.js';

describe('normalizeName', () => {
  it('lower-cases', () => {
    expect(normalizeName('ACME LIMITED')).toBe('acme limited');
  });

  it('strips diacritics', () => {
    expect(normalizeName('Société Générale')).toBe('societe generale');
    expect(normalizeName('Cour des Comptes du Cameroun')).toBe('cour des comptes du cameroun');
  });

  it('strips punctuation', () => {
    expect(normalizeName('Acme, Inc.')).toBe('acme inc');
    // Single-letter runs collapse — "S.A.R.L. Foo & Co." reads
    // as "sarl foo co" after normalisation. See the "collapses
    // single-letter runs" test below for the explicit contract.
    expect(normalizeName('S.A.R.L. Foo & Co.')).toBe('sarl foo co');
  });

  it('collapses whitespace runs', () => {
    expect(normalizeName('Acme    Limited\t\nCo')).toBe('acme limited co');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeName('   ')).toBe('');
    expect(normalizeName('')).toBe('');
  });

  it('treats canonical and lossy variants as equivalent', () => {
    // Pinning the contract: these MUST collapse to the same key.
    const canonical = normalizeName('Société Générale du Cameroun S.A.');
    const lossy = normalizeName('SOCIETE GENERALE DU CAMEROUN SA');
    expect(canonical).toBe(lossy);
  });

  it('keeps numeric tokens in the normalised form', () => {
    expect(normalizeName('Acme 2024 Ltd')).toBe('acme 2024 ltd');
  });

  it('folds ligatures œ → oe / æ → ae / ß → ss', () => {
    // Unicode NFKD does NOT decompose these (they are letters, not
    // glyph shortcuts). We add the fold explicitly so JS-side and
    // SQL-side normalisations agree.
    expect(normalizeName('Cœur de Yaoundé')).toBe('coeur de yaounde');
    expect(normalizeName('Encyclopædia Britannica')).toBe('encyclopaedia britannica');
    expect(normalizeName('Straße')).toBe('strasse');
  });

  it('collapses single-letter runs from punctuation-stripped abbreviations', () => {
    // "S.A.R.L." should be readable as "sarl" after normalisation
    // because Cameroonian registry forms type it both ways. Real-
    // world adapter outputs on the same canonical entity vary.
    expect(normalizeName('S.A.R.L.')).toBe('sarl');
    expect(normalizeName('Foo S A R L Co')).toBe('foo sarl co');
    expect(normalizeName('S.A.')).toBe('sa');
  });
});

describe('normalizeName cross-language (Block-A reconciliation §5.f)', () => {
  it('FR Coopérative and EN Cooperative collapse to the same key', () => {
    // Positive — two Latin-alphabet languages spelling the same
    // word (FR with é, EN without) MUST normalise identically so
    // bilingual adapter outputs do not split a single canonical.
    expect(normalizeName('Coopérative')).toBe('cooperative');
    expect(normalizeName('Cooperative')).toBe('cooperative');
    expect(normalizeName('Coopérative')).toBe(normalizeName('Cooperative'));
  });

  it('FR Société and ES Sociedade do NOT collapse to the same key', () => {
    // Negative — we do NOT do over-aggressive cross-Romance folding.
    // "société" (FR) and "sociedade" (ES) are different words; they
    // must NOT normalise to the same key. Pin that the rule-pass
    // does not become a translation engine.
    expect(normalizeName('Société')).toBe('societe');
    expect(normalizeName('Sociedade')).toBe('sociedade');
    expect(normalizeName('Société')).not.toBe(normalizeName('Sociedade'));
  });
});
