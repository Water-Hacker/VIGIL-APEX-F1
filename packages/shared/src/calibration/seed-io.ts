/**
 * Calibration seed CSV I/O — pure parser + serialiser.
 *
 * The seed file lives at `personal/calibration-seed/seed.csv`. EXEC §24.2
 * mandates it stays on the architect's encrypted laptop and is **never**
 * committed. This module provides the parse/serialise helpers that the
 * architect's CLI (`scripts/seed-calibration.ts`) uses to read from /
 * write to that file, plus the `Phase-9 enrolment` loader that
 * `audit-runner` calls to ingest a verified seed into the production
 * `calibration_entry` table.
 *
 * The parser tolerates the single-line header form recorded in the
 * checked-in `seed.csv` template. It deliberately does NOT support
 * arbitrary CSV dialects — the architect's tool emits the exact
 * column-set EXEC §22.2 specifies, in the same order, and the parser
 * mirrors it. Anything else is rejected at parse time.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const SEED_CSV_HEADER = [
  'id',
  'recorded_at',
  'pattern_id',
  'finding_id',
  'case_label',
  'case_year',
  'region',
  'amount_xaf',
  'posterior_at_review',
  'severity_at_review',
  'ground_truth',
  'ground_truth_recorded_by',
  'ground_truth_evidence_json',
  'closure_reason',
  'notes',
] as const;

export interface ParsedSeedRow {
  readonly id: string;
  readonly recorded_at: string;
  readonly pattern_id: string;
  readonly finding_id: string;
  readonly case_label: string;
  readonly case_year: number;
  readonly region: string | null;
  readonly amount_xaf: number | null;
  readonly posterior_at_review: number;
  readonly severity_at_review: string;
  readonly ground_truth: string;
  readonly ground_truth_recorded_by: string;
  readonly ground_truth_evidence: ReadonlyArray<{
    kind: string;
    citation: string;
    excerpt?: string;
  }>;
  readonly closure_reason: string | null;
  readonly notes: string;
}

export class SeedCsvParseError extends Error {
  constructor(
    message: string,
    public readonly lineNumber: number,
    public readonly column?: string,
  ) {
    super(`seed.csv line ${lineNumber}${column ? ` (col ${column})` : ''}: ${message}`);
  }
}

/**
 * Parse the seed.csv text into ParsedSeedRow[]. The header line must
 * match SEED_CSV_HEADER exactly. The `ground_truth_evidence_json` cell
 * is a JSON-encoded array of `{kind, citation, excerpt?}` objects; the
 * parser un-escapes the standard CSV double-quote escaping ("" → ") and
 * then `JSON.parse`s the cell.
 */
export function parseSeedCsv(text: string): ReadonlyArray<ParsedSeedRow> {
  const lines = splitCsvLines(text);
  if (lines.length === 0) throw new SeedCsvParseError('empty file', 0);
  const header = parseCsvLine(lines[0]!);
  if (header.length !== SEED_CSV_HEADER.length) {
    throw new SeedCsvParseError(
      `header has ${header.length} columns; expected ${SEED_CSV_HEADER.length}`,
      1,
    );
  }
  for (let i = 0; i < SEED_CSV_HEADER.length; i += 1) {
    if (header[i] !== SEED_CSV_HEADER[i]) {
      throw new SeedCsvParseError(
        `header column ${i} is "${header[i]}"; expected "${SEED_CSV_HEADER[i]}"`,
        1,
      );
    }
  }

  const out: ParsedSeedRow[] = [];
  for (let li = 1; li < lines.length; li += 1) {
    const raw = lines[li]!;
    if (raw.trim() === '') continue;
    const cells = parseCsvLine(raw);
    if (cells.length !== SEED_CSV_HEADER.length) {
      throw new SeedCsvParseError(
        `row has ${cells.length} cells; expected ${SEED_CSV_HEADER.length}`,
        li + 1,
      );
    }
    const [
      id,
      recorded_at,
      pattern_id,
      finding_id,
      case_label,
      case_year,
      region,
      amount_xaf,
      posterior_at_review,
      severity_at_review,
      ground_truth,
      ground_truth_recorded_by,
      ground_truth_evidence_json,
      closure_reason,
      notes,
    ] = cells as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    let evidence: ReadonlyArray<{ kind: string; citation: string; excerpt?: string }> = [];
    if (ground_truth_evidence_json.trim() !== '') {
      try {
        const parsed = JSON.parse(ground_truth_evidence_json) as unknown;
        if (!Array.isArray(parsed)) {
          throw new SeedCsvParseError(
            'ground_truth_evidence_json must be a JSON array',
            li + 1,
            'ground_truth_evidence_json',
          );
        }
        evidence = parsed.map((e: any) => ({
          kind: String(e.kind ?? ''),
          citation: String(e.citation ?? ''),
          ...(e.excerpt !== undefined ? { excerpt: String(e.excerpt) } : {}),
        }));
      } catch (err) {
        if (err instanceof SeedCsvParseError) throw err;
        throw new SeedCsvParseError(
          `ground_truth_evidence_json: ${(err as Error).message}`,
          li + 1,
          'ground_truth_evidence_json',
        );
      }
    }

    const yearNum = parseStrictInt(case_year, li + 1, 'case_year');
    const amountNum =
      amount_xaf.trim() === '' ? null : parseStrictInt(amount_xaf, li + 1, 'amount_xaf');
    const posteriorNum = parseStrictFloat(posterior_at_review, li + 1, 'posterior_at_review');
    if (posteriorNum < 0 || posteriorNum > 1) {
      throw new SeedCsvParseError(
        `posterior_at_review out of range: ${posteriorNum}`,
        li + 1,
        'posterior_at_review',
      );
    }

    out.push({
      id,
      recorded_at,
      pattern_id,
      finding_id,
      case_label,
      case_year: yearNum,
      region: region.trim() === '' ? null : region,
      amount_xaf: amountNum,
      posterior_at_review: posteriorNum,
      severity_at_review,
      ground_truth,
      ground_truth_recorded_by,
      ground_truth_evidence: evidence,
      closure_reason: closure_reason.trim() === '' ? null : closure_reason,
      notes,
    });
  }
  return out;
}

/**
 * Serialise the rows back to CSV. The output is deterministic — same
 * input always produces same output — to keep diffs clean across runs.
 */
export function serialiseSeedCsv(rows: ReadonlyArray<ParsedSeedRow>): string {
  const lines: string[] = [];
  lines.push(SEED_CSV_HEADER.join(','));
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.id),
        csvCell(r.recorded_at),
        csvCell(r.pattern_id),
        csvCell(r.finding_id),
        csvCell(r.case_label),
        String(r.case_year),
        csvCell(r.region ?? ''),
        r.amount_xaf === null ? '' : String(r.amount_xaf),
        String(r.posterior_at_review),
        csvCell(r.severity_at_review),
        csvCell(r.ground_truth),
        csvCell(r.ground_truth_recorded_by),
        csvCell(JSON.stringify(r.ground_truth_evidence)),
        csvCell(r.closure_reason ?? ''),
        csvCell(r.notes),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

/* =============================================================================
 * Internals — minimal RFC-4180-compatible CSV
 * ===========================================================================*/

function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      cur += ch;
      inQuotes = !inQuotes;
      // RFC-4180 doubled quotes inside a field
      if (!inQuotes && text[i + 1] === '"') {
        cur += '"';
        inQuotes = true;
        i += 1;
      }
      continue;
    }
    if (ch === '\n' && !inQuotes) {
      lines.push(cur);
      cur = '';
      continue;
    }
    if (ch === '\r' && !inQuotes) continue;
    cur += ch;
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

function csvCell(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseStrictInt(v: string, line: number, col: string): number {
  if (!/^-?\d+$/.test(v.trim())) {
    throw new SeedCsvParseError(`not an integer: "${v}"`, line, col);
  }
  return parseInt(v.trim(), 10);
}

function parseStrictFloat(v: string, line: number, col: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new SeedCsvParseError(`not a number: "${v}"`, line, col);
  }
  return n;
}
