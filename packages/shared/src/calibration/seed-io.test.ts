/**
 * Concern 2 of the post-#69 followup — pin the calibration seed CSV
 * parser + serialiser in @vigil/shared/src/calibration/seed-io.ts.
 *
 * Per EXEC §24.2 the seed file is the load-bearing input to
 * W-16's calibration loop. The parser is intentionally STRICT (rejects
 * any column-set drift, any out-of-range posterior, any non-integer
 * case_year, any non-array evidence JSON) because a silently-tolerated
 * malformed row would produce a bogus calibration table downstream.
 *
 * These tests pin the contract end-to-end: header validation,
 * round-trip (parse → serialise → parse equal to input), JSON-evidence
 * decoding, RFC-4180 quote escaping, all six error branches. A future
 * refactor that loosens any check fires here.
 */
import { describe, expect, it } from 'vitest';

import {
  SEED_CSV_HEADER,
  SeedCsvParseError,
  parseSeedCsv,
  serialiseSeedCsv,
  type ParsedSeedRow,
} from './seed-io.js';

const HEADER_LINE = SEED_CSV_HEADER.join(',');

const minimalRow = (overrides: Partial<ParsedSeedRow> = {}): ParsedSeedRow => ({
  id: 'r-001',
  recorded_at: '2026-05-17T12:00:00.000Z',
  pattern_id: 'P-A-001',
  finding_id: 'f-abc',
  case_label: 'CONAC-2024-001',
  case_year: 2024,
  region: 'CE',
  amount_xaf: 12_345_678,
  posterior_at_review: 0.85,
  severity_at_review: 'high',
  ground_truth: 'true_positive',
  ground_truth_recorded_by: 'architect@vigilapex.cm',
  ground_truth_evidence: [{ kind: 'press', citation: 'https://conac.cm/press/2024-001' }],
  closure_reason: 'judicial_review_in_progress',
  notes: 'short note',
  ...overrides,
});

/* -------------------------------------------------------------------------- */
/* Round-trip                                                                  */
/* -------------------------------------------------------------------------- */

describe('seed-io — parse / serialise round-trip', () => {
  it('serialise → parse is the identity for one row', () => {
    const row = minimalRow();
    const csv = serialiseSeedCsv([row]);
    const back = parseSeedCsv(csv);
    expect(back).toEqual([row]);
  });

  it('serialise → parse round-trips a row carrying multi-element evidence', () => {
    const row = minimalRow({
      ground_truth_evidence: [
        { kind: 'press', citation: 'a' },
        { kind: 'court_roll', citation: 'b', excerpt: 'snippet' },
      ],
    });
    const back = parseSeedCsv(serialiseSeedCsv([row]));
    expect(back[0]?.ground_truth_evidence).toEqual(row.ground_truth_evidence);
  });

  it('serialise → parse round-trips null region and null amount_xaf', () => {
    const row = minimalRow({ region: null, amount_xaf: null, closure_reason: null });
    const csv = serialiseSeedCsv([row]);
    const back = parseSeedCsv(csv);
    expect(back[0]?.region).toBeNull();
    expect(back[0]?.amount_xaf).toBeNull();
    expect(back[0]?.closure_reason).toBeNull();
  });

  it('serialise → parse handles commas, double-quotes, and newlines in cells (RFC-4180)', () => {
    const row = minimalRow({
      notes: 'has, commas, and "double quotes" and a\nnewline',
    });
    const back = parseSeedCsv(serialiseSeedCsv([row]));
    expect(back[0]?.notes).toBe(row.notes);
  });

  it('serialise output ends with a trailing newline (POSIX text-file convention)', () => {
    const csv = serialiseSeedCsv([minimalRow()]);
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('serialise of an empty input emits only the header + trailing newline', () => {
    const csv = serialiseSeedCsv([]);
    expect(csv).toBe(`${HEADER_LINE}\n`);
  });
});

/* -------------------------------------------------------------------------- */
/* Parse — header validation                                                   */
/* -------------------------------------------------------------------------- */

describe('parseSeedCsv — header validation', () => {
  it('rejects an empty file', () => {
    expect(() => parseSeedCsv('')).toThrow(SeedCsvParseError);
    expect(() => parseSeedCsv('')).toThrow(/empty file/);
  });

  it('rejects a header with too few columns', () => {
    expect(() => parseSeedCsv('id,recorded_at\n')).toThrow(/header has \d+ columns; expected 15/);
  });

  it('rejects a header with the wrong column name in position 0', () => {
    const bad = ['wrong_id', ...SEED_CSV_HEADER.slice(1)].join(',');
    expect(() => parseSeedCsv(`${bad}\n`)).toThrow(/header column 0 is "wrong_id"/);
  });

  it('accepts the exact canonical header with zero data rows', () => {
    expect(parseSeedCsv(`${HEADER_LINE}\n`)).toEqual([]);
  });

  it('skips blank data lines (trim → empty)', () => {
    const csv = `${HEADER_LINE}\n\n   \n${serialiseSeedCsv([minimalRow()]).split('\n')[1]}\n`;
    const parsed = parseSeedCsv(csv);
    expect(parsed.length).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Parse — per-row validation                                                  */
/* -------------------------------------------------------------------------- */

describe('parseSeedCsv — per-row strict validation', () => {
  it('rejects a row with the wrong cell count', () => {
    const row = serialiseSeedCsv([minimalRow()]).split('\n')[1]!;
    // Drop the last cell so the line has 14 cells instead of 15.
    const truncated = row.split(',').slice(0, -1).join(',');
    expect(() => parseSeedCsv(`${HEADER_LINE}\n${truncated}\n`)).toThrow(
      /row has 14 cells; expected 15/,
    );
  });

  it('rejects a non-integer case_year', () => {
    const row = minimalRow();
    const csv = serialiseSeedCsv([row]).replace(',2024,', ',not-a-year,');
    expect(() => parseSeedCsv(csv)).toThrow(/case_year/);
  });

  it('rejects posterior_at_review > 1', () => {
    const row = minimalRow({ posterior_at_review: 1.5 });
    const csv = serialiseSeedCsv([row]);
    expect(() => parseSeedCsv(csv)).toThrow(/posterior_at_review out of range: 1.5/);
  });

  it('rejects posterior_at_review < 0', () => {
    const row = minimalRow({ posterior_at_review: -0.1 });
    const csv = serialiseSeedCsv([row]);
    expect(() => parseSeedCsv(csv)).toThrow(/posterior_at_review out of range: -0.1/);
  });

  it('rejects a non-numeric posterior_at_review', () => {
    const csv = serialiseSeedCsv([minimalRow()]).replace(',0.85,', ',not-a-number,');
    expect(() => parseSeedCsv(csv)).toThrow(/not a number/);
  });
});

/* -------------------------------------------------------------------------- */
/* Parse — evidence JSON validation                                            */
/* -------------------------------------------------------------------------- */

describe('parseSeedCsv — ground_truth_evidence_json', () => {
  it('treats an empty evidence cell as an empty array', () => {
    const csv = serialiseSeedCsv([minimalRow({ ground_truth_evidence: [] })]);
    const parsed = parseSeedCsv(csv);
    expect(parsed[0]?.ground_truth_evidence).toEqual([]);
  });

  it('parses an evidence array with optional excerpt field', () => {
    const row = minimalRow({
      ground_truth_evidence: [{ kind: 'press', citation: 'https://x', excerpt: 'tail' }],
    });
    const back = parseSeedCsv(serialiseSeedCsv([row]));
    expect(back[0]?.ground_truth_evidence[0]?.excerpt).toBe('tail');
  });

  it('rejects evidence-json that is not a JSON array (top-level object)', () => {
    const csv =
      `${HEADER_LINE}\n` +
      `r-001,2026,P-A,f,c,2024,CE,1,0.5,high,t,a@b.c,"{""kind"":""x""}",cr,n\n`;
    expect(() => parseSeedCsv(csv)).toThrow(/must be a JSON array/);
  });

  it('rejects evidence-json that is malformed JSON', () => {
    const csv =
      `${HEADER_LINE}\n` + `r-001,2026,P-A,f,c,2024,CE,1,0.5,high,t,a@b.c,"{not-json}",cr,n\n`;
    expect(() => parseSeedCsv(csv)).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* SeedCsvParseError                                                           */
/* -------------------------------------------------------------------------- */

describe('SeedCsvParseError', () => {
  it('includes the line number in the message', () => {
    try {
      parseSeedCsv('id\n');
    } catch (e) {
      expect(e).toBeInstanceOf(SeedCsvParseError);
      expect((e as SeedCsvParseError).lineNumber).toBe(1);
      expect((e as Error).message).toContain('line 1');
    }
  });

  it('includes the column name when known', () => {
    const csv = serialiseSeedCsv([minimalRow()]).replace(',2024,', ',bad-year,');
    try {
      parseSeedCsv(csv);
    } catch (e) {
      expect(e).toBeInstanceOf(SeedCsvParseError);
      expect((e as SeedCsvParseError).column).toBe('case_year');
      expect((e as Error).message).toContain('case_year');
    }
  });
});
