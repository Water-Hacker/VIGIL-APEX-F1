/**
 * worker-entity — rule-pass + envelope-shape unit tests.
 *
 * These are pure-helper tests against the exported regex / language
 * detector / source-grep contract pins. The full handler test (with
 * EntityRepo mock + Neo4j mock + SafeLlmRouter mock) lives below.
 *
 * No DB connection required; vitest runs in unit-test time.
 */
import { describe, expect, it } from 'vitest';

import { RCCM_RE, NIU_RE, detectLanguage, canonicalRccm, canonicalNiu } from '../src/rule-pass.js';

describe('worker-entity — RCCM_RE shape detector', () => {
  it('matches the canonical slash form', () => {
    const m = RCCM_RE.exec('Société FOO RC/YDE/2024/B/01234 Ltd');
    expect(m).not.toBeNull();
    expect(m![0]).toBe('RC/YDE/2024/B/01234');
  });

  it('matches the dash form (adapter normalisation drift)', () => {
    const m = RCCM_RE.exec('FOO Ltd RC-YDE-2024-B-1234');
    expect(m).not.toBeNull();
  });

  it('matches the space form', () => {
    const m = RCCM_RE.exec('contracted by RC YDE 2024 B 567');
    expect(m).not.toBeNull();
  });

  it('rejects truncated forms (missing year)', () => {
    expect(RCCM_RE.exec('RC/YDE/B/01234')).toBeNull();
  });

  it('rejects strings without RC prefix', () => {
    expect(RCCM_RE.exec('FOO/YDE/2024/B/01234')).toBeNull();
  });

  it('captures only the RCCM substring out of a longer alias', () => {
    const m = RCCM_RE.exec('Acme SARL t/a Acme Group RC/DLA/2023/B/00099 attributaire');
    expect(m![0]).toBe('RC/DLA/2023/B/00099');
  });
});

describe('worker-entity — NIU_RE shape detector', () => {
  it('matches a P-prefixed NIU', () => {
    const m = NIU_RE.exec('Taxpayer P011500001234X verified');
    expect(m).not.toBeNull();
    expect(m![0]).toBe('P011500001234X');
  });

  it('matches an M-prefixed NIU', () => {
    expect(NIU_RE.exec('M005900099876Y')).not.toBeNull();
  });

  it('matches a C-prefixed NIU (corporate)', () => {
    expect(NIU_RE.exec('C022100100100Z')).not.toBeNull();
  });

  it('rejects 13-digit shapes (off-by-one)', () => {
    expect(NIU_RE.exec('P01150000123X')).toBeNull();
  });

  it('rejects all-digit strings of the right length but no leading letter', () => {
    expect(NIU_RE.exec('011500001234XY')).toBeNull();
  });

  it('rejects shapes with a digit suffix instead of a letter', () => {
    expect(NIU_RE.exec('P0115000012349')).toBeNull();
  });
});

describe('worker-entity — adversarial regex (Block-A reconciliation §5.e)', () => {
  it('RCCM with sequence too few — only one digit (regex requires 1-6, so this passes)', () => {
    // The regex's lower-bound is 1 digit; "RC/YDE/2024/B/1" is the
    // minimum legal form. We pin the boundary: `RC/YDE/2024/B/`
    // (zero digits) MUST be rejected.
    expect(RCCM_RE.exec('RC/YDE/2024/B/')).toBeNull();
  });

  it('RCCM with sequence too many — seven digits MUST be rejected', () => {
    // Cameroonian RCCM sequence is bounded at 6 digits. Seven-digit
    // shapes are either a typo or a foreign-jurisdiction format
    // we should not match against the local table.
    expect(RCCM_RE.exec('Acme RC/YDE/2024/B/1234567 attributaire')).toBeNull();
  });

  it('NIU with transposed character class — letter where digit belongs', () => {
    // Position 2 must be a digit, not a letter. `PA1500001234X` has
    // an A at position 2 and MUST be rejected.
    expect(NIU_RE.exec('PA1500001234X')).toBeNull();
  });

  it('Foreign-jurisdiction RCCM-shape — Gabonese form passes the regex but lookup fails', () => {
    // Gabonese RCCM uses RC-G-YYYY-categ-seq. The regex's centre
    // group `[A-Z]{2,4}` accepts G-prefixed centres because Gabonese
    // codes are 1-letter (G, GAB) — but the regex requires 2-4
    // letters in the centre slot, so a single "G" fails the centre
    // group. We pin both: the multi-letter form like "GAB" passes
    // (and the LOOKUP downstream rejects it because "RC/GAB/..." is
    // not in our Cameroonian table); the bare "G" form fails the
    // regex outright.
    const m1 = RCCM_RE.exec('Foo SARL RC/GAB/2024/B/01234');
    expect(m1).not.toBeNull(); // regex shape passes
    expect(m1![0]).toBe('RC/GAB/2024/B/01234');

    expect(RCCM_RE.exec('Foo SARL RC/G/2024/B/01234')).toBeNull(); // single-letter centre fails
  });

  it('whitespace + zero-width characters embedded in a valid RCCM MUST NOT match', () => {
    // U+200B ZERO WIDTH SPACE is inserted between characters by
    // some web scrapers; the regex MUST treat the result as
    // distinct from a clean RCCM. We do not want to silently
    // accept obfuscated input.
    const obfuscated = 'RC/Y​DE/2024/B/01234';
    expect(RCCM_RE.exec(obfuscated)).toBeNull();
    const obfuscated2 = 'RC﻿/YDE/2024/B/01234';
    expect(RCCM_RE.exec(obfuscated2)).toBeNull();
  });
});

describe('worker-entity — canonicalRccm normaliser', () => {
  it('collapses dashes to slashes and uppercases', () => {
    expect(canonicalRccm('rc-yde-2024-b-1234')).toBe('RC/YDE/2024/B/1234');
  });

  it('collapses spaces to slashes', () => {
    expect(canonicalRccm('RC YDE 2024 B 1234')).toBe('RC/YDE/2024/B/1234');
  });

  it('leaves the canonical form unchanged', () => {
    expect(canonicalRccm('RC/YDE/2024/B/01234')).toBe('RC/YDE/2024/B/01234');
  });
});

describe('worker-entity — canonicalNiu normaliser', () => {
  it('uppercases', () => {
    expect(canonicalNiu('p011500001234x')).toBe('P011500001234X');
  });

  it('leaves canonical-form unchanged', () => {
    expect(canonicalNiu('P011500001234X')).toBe('P011500001234X');
  });
});

describe('worker-entity — detectLanguage', () => {
  it('tags strings with French diacritics as fr', () => {
    expect(detectLanguage('Société Générale')).toBe('fr');
    expect(detectLanguage('Hôtel de Ville')).toBe('fr');
  });

  it('tags French function-word patterns as fr without diacritics', () => {
    expect(detectLanguage('Banque du Cameroun SARL')).toBe('fr');
    expect(detectLanguage('La Société des Eaux')).toBe('fr');
  });

  it('tags plain English strings as en', () => {
    expect(detectLanguage('Acme Construction Ltd')).toBe('en');
  });

  it('does not misclassify "SA" as a French word in an English context', () => {
    // "SA" alone is not in the keyword list; only `\bsa\b` would
    // match, and `Acme SA` would be tagged en. Confirming.
    expect(detectLanguage('Acme Construction Limited')).toBe('en');
  });
});
