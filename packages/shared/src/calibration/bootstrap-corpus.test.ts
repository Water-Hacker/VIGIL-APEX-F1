import { describe, it, expect } from 'vitest';

import {
  generateSyntheticCorpus,
  checkEvidenceAdmissibility,
  summarisePhase9Gate,
  SKELETON_WORKLIST,
  PHASE9_FLOOR,
  PHASE9_DENSITY_TARGET,
  PHASE9_HORIZON_TARGET,
} from './bootstrap-corpus.js';
import { parseSeedCsv, serialiseSeedCsv, SEED_CSV_HEADER, SeedCsvParseError } from './seed-io.js';

import type { CalibrationEvidenceKind } from './bootstrap-corpus.js';

describe('generateSyntheticCorpus', () => {
  it('produces 3 cases per category by default', () => {
    const cases = generateSyntheticCorpus();
    expect(cases).toHaveLength(16 * 3); // 16 categories × 3 each
  });

  it('honours perCategory option', () => {
    const cases = generateSyntheticCorpus({ perCategory: 1 });
    expect(cases).toHaveLength(16);
  });

  it('spread strategy hits low / mid / high deciles', () => {
    const cases = generateSyntheticCorpus({ perCategory: 3, posteriorStrategy: 'spread' });
    const posteriors = cases.map((c) => c.posterior_target);
    expect(posteriors).toContain(0.15);
    expect(posteriors).toContain(0.55);
    expect(posteriors).toContain(0.95);
  });

  it('matched strategy aligns posterior to ground-truth label', () => {
    const cases = generateSyntheticCorpus({ perCategory: 3, posteriorStrategy: 'matched' });
    for (const c of cases) {
      if (c.ground_truth_by_construction === 'true_positive') {
        expect(c.posterior_target).toBeGreaterThan(0.8);
      } else if (c.ground_truth_by_construction === 'false_positive') {
        expect(c.posterior_target).toBeLessThan(0.3);
      }
    }
  });

  it('case ids are deterministic across runs with same options', () => {
    const a = generateSyntheticCorpus({ idPrefix: 'TEST-X' });
    const b = generateSyntheticCorpus({ idPrefix: 'TEST-X' });
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it('case ids vary across categories', () => {
    const cases = generateSyntheticCorpus({ perCategory: 1, idPrefix: 'BOOT-X' });
    const ids = new Set(cases.map((c) => c.id));
    expect(ids.size).toBe(16);
  });

  it('every case carries a pattern_id matching the canonical regex', () => {
    const re = /^P-[A-P]-\d{3}$/;
    for (const c of generateSyntheticCorpus()) {
      expect(c.pattern_id).toMatch(re);
    }
  });

  it('synthetic notes explicitly flag the case as non-real', () => {
    for (const c of generateSyntheticCorpus({ perCategory: 1 })) {
      expect(c.notes).toMatch(/synthetic/i);
      expect(c.notes).toMatch(/NOT a real grade/i);
    }
  });
});

describe('SKELETON_WORKLIST', () => {
  it('is non-empty', () => {
    expect(SKELETON_WORKLIST.length).toBeGreaterThan(0);
  });

  it('is short — bootstrap, not exhaustive', () => {
    expect(SKELETON_WORKLIST.length).toBeLessThanOrEqual(20);
  });

  it('every entry has ≥ 2 citation lines (EXEC §23 two-source rule)', () => {
    for (const row of SKELETON_WORKLIST) {
      expect(row.citation_lines.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('every entry has a valid pattern category', () => {
    const valid = new Set([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
      'J',
      'K',
      'L',
      'M',
      'N',
      'O',
      'P',
    ]);
    for (const row of SKELETON_WORKLIST) {
      expect(valid.has(row.suggested_category)).toBe(true);
    }
  });

  it('publicly_contested rows exist (false-positive channel coverage)', () => {
    const contested = SKELETON_WORKLIST.filter((r) => r.publicly_contested);
    expect(contested.length).toBeGreaterThan(0);
  });

  it('case_year is a reasonable historical year', () => {
    for (const row of SKELETON_WORKLIST) {
      expect(row.case_year).toBeGreaterThan(2000);
      expect(row.case_year).toBeLessThan(2030);
    }
  });
});

describe('checkEvidenceAdmissibility', () => {
  it('rejects empty evidence', () => {
    const r = checkEvidenceAdmissibility([]);
    expect(r.admissible).toBe(false);
    expect(r.distinct_kinds).toBe(0);
  });

  it('rejects single source', () => {
    const r = checkEvidenceAdmissibility(['court_judgement']);
    expect(r.admissible).toBe(false);
    expect(r.reason).toMatch(/2 distinct/);
  });

  it('rejects two press-only sources', () => {
    const kinds: ReadonlyArray<CalibrationEvidenceKind> = [
      'press_corroboration',
      'civil_society_report',
    ];
    const r = checkEvidenceAdmissibility(kinds);
    expect(r.admissible).toBe(false);
    expect(r.reason).toMatch(/primary/);
  });

  it('accepts judicial + press', () => {
    const kinds: ReadonlyArray<CalibrationEvidenceKind> = [
      'court_judgement',
      'press_corroboration',
    ];
    const r = checkEvidenceAdmissibility(kinds);
    expect(r.admissible).toBe(true);
  });

  it('accepts cour-comptes + conac', () => {
    const r = checkEvidenceAdmissibility(['cour_comptes_observation', 'conac_finding']);
    expect(r.admissible).toBe(true);
    expect(r.has_primary_kind).toBe(true);
  });

  it('counts distinct kinds, not duplicates', () => {
    const r = checkEvidenceAdmissibility(['court_judgement', 'court_judgement']);
    expect(r.distinct_kinds).toBe(1);
    expect(r.admissible).toBe(false);
  });
});

describe('summarisePhase9Gate', () => {
  it('reports zero-state correctly', () => {
    const s = summarisePhase9Gate(0);
    expect(s.current_count).toBe(0);
    expect(s.floor).toBe(PHASE9_FLOOR);
    expect(s.cases_remaining_to_floor).toBe(PHASE9_FLOOR);
    expect(s.floor_reached).toBe(false);
  });

  it('flips floor_reached at the floor', () => {
    const s = summarisePhase9Gate(PHASE9_FLOOR);
    expect(s.floor_reached).toBe(true);
    expect(s.cases_remaining_to_floor).toBe(0);
  });

  it('flips density_target at the density threshold', () => {
    const s = summarisePhase9Gate(PHASE9_DENSITY_TARGET);
    expect(s.density_target_reached).toBe(true);
  });

  it('flips horizon target at the horizon', () => {
    const s = summarisePhase9Gate(PHASE9_HORIZON_TARGET);
    expect(s.horizon_target_reached).toBe(true);
  });

  it('clamps negative counts to zero', () => {
    const s = summarisePhase9Gate(-5);
    expect(s.current_count).toBe(0);
  });
});

describe('parseSeedCsv', () => {
  it('parses the header-only template file', () => {
    const text = SEED_CSV_HEADER.join(',') + '\n';
    const rows = parseSeedCsv(text);
    expect(rows).toEqual([]);
  });

  it('throws on empty file', () => {
    expect(() => parseSeedCsv('')).toThrow(SeedCsvParseError);
  });

  it('throws on a header with a missing column', () => {
    const text = SEED_CSV_HEADER.slice(0, -1).join(',') + '\n';
    expect(() => parseSeedCsv(text)).toThrow(/header/);
  });

  it('parses a single row with evidence JSON', () => {
    const evidenceJson = JSON.stringify([
      { kind: 'court_judgement', citation: 'TCS 2014-007', excerpt: 'guilty as charged' },
      { kind: 'press_corroboration', citation: 'Cameroon Tribune 2014-07-12' },
    ]);
    const text =
      SEED_CSV_HEADER.join(',') +
      '\n' +
      [
        '00000000-0000-0000-0000-000000000001',
        '2026-05-15T00:00:00.000Z',
        'P-A-001',
        '00000000-0000-0000-0000-000000000010',
        'Test case',
        '2014',
        'CE',
        '250000000',
        '0.91',
        'high',
        'true_positive',
        'architect',
        `"${evidenceJson.replace(/"/g, '""')}"`,
        '',
        'note',
      ].join(',') +
      '\n';
    const rows = parseSeedCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pattern_id).toBe('P-A-001');
    expect(rows[0]!.amount_xaf).toBe(250_000_000);
    expect(rows[0]!.posterior_at_review).toBeCloseTo(0.91);
    expect(rows[0]!.ground_truth_evidence).toHaveLength(2);
    expect(rows[0]!.ground_truth_evidence[0]!.kind).toBe('court_judgement');
    expect(rows[0]!.ground_truth_evidence[0]!.excerpt).toBe('guilty as charged');
  });

  it('rejects posterior outside [0,1]', () => {
    const text =
      SEED_CSV_HEADER.join(',') +
      '\n' +
      [
        '00000000-0000-0000-0000-000000000001',
        '2026-05-15T00:00:00.000Z',
        'P-A-001',
        '00000000-0000-0000-0000-000000000010',
        'Test',
        '2014',
        'CE',
        '0',
        '1.5',
        'high',
        'true_positive',
        'a',
        '[]',
        '',
        'note',
      ].join(',') +
      '\n';
    expect(() => parseSeedCsv(text)).toThrow(/posterior_at_review out of range/);
  });

  it('round-trips through serialiseSeedCsv (idempotent)', () => {
    const original =
      SEED_CSV_HEADER.join(',') +
      '\n' +
      [
        '00000000-0000-0000-0000-000000000002',
        '2026-05-15T01:00:00.000Z',
        'P-B-002',
        '00000000-0000-0000-0000-000000000020',
        'Round-trip case',
        '2019',
        '',
        '',
        '0.55',
        'medium',
        'partial_match',
        'architect',
        '[]',
        '',
        'no notes',
      ].join(',') +
      '\n';
    const rows1 = parseSeedCsv(original);
    const serialised = serialiseSeedCsv(rows1);
    const rows2 = parseSeedCsv(serialised);
    expect(rows2).toEqual(rows1);
  });
});
