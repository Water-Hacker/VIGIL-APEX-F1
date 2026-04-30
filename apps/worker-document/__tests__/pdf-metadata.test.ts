/**
 * PDF info-dict extraction tests — every parse path + adversarial inputs.
 */
import { describe, expect, it } from 'vitest';

import { extractPdfMetadata, parsePdfDate } from '../src/pdf-metadata.js';

const NOW = new Date('2026-04-29T00:00:00Z');

function pdf(infoDict: string): Buffer {
  // Minimal PDF skeleton with the supplied Info dict — enough for the
  // extractor to find the keys; we don't construct a parseable PDF.
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<<\n${infoDict}\n>>\nendobj\nxref\ntrailer\n<<\n/Info 1 0 R\n>>\n`,
    'latin1',
  );
}

describe('parsePdfDate', () => {
  it('parses full PDF date with offset', () => {
    expect(parsePdfDate("D:20240315120000+01'00'")).toBe('2024-03-15T12:00:00+01:00');
  });
  it('parses Z (UTC) suffix', () => {
    expect(parsePdfDate('D:20240315120000Z')).toBe('2024-03-15T12:00:00Z');
  });
  it('treats no zone as UTC', () => {
    expect(parsePdfDate('D:20240315120000')).toBe('2024-03-15T12:00:00Z');
  });
  it('parses date-only', () => {
    expect(parsePdfDate('D:20240315')).toBe('2024-03-15T00:00:00Z');
  });
  it('returns null for impossible months', () => {
    expect(parsePdfDate('D:20241315120000')).toBeNull();
  });
  it('returns null for years out of plausible band', () => {
    expect(parsePdfDate('D:18001215120000')).toBeNull();
  });
  it('handles missing D: prefix (some PDFs omit)', () => {
    expect(parsePdfDate('20240315120000Z')).toBe('2024-03-15T12:00:00Z');
  });
  it('returns null on garbage', () => {
    expect(parsePdfDate('not-a-date')).toBeNull();
  });
});

describe('extractPdfMetadata — happy path', () => {
  it('extracts a fully-populated Info dict', () => {
    const buf = pdf(
      '/Title (Some Title)\n/Author (Jean Dupont)\n/Creator (Microsoft Word)\n/Producer (Microsoft Word 2019)\n/CreationDate (D:20240115100000Z)\n/ModDate (D:20240120100000Z)',
    );
    const m = extractPdfMetadata(buf, { now: NOW });
    expect(m.extracted_ok).toBe(true);
    expect(m.title).toBe('Some Title');
    expect(m.author).toBe('Jean Dupont');
    expect(m.creator).toBe('Microsoft Word');
    expect(m.producer).toBe('Microsoft Word 2019');
    expect(m.creation_date).toBe('2024-01-15T10:00:00Z');
    expect(m.mod_date).toBe('2024-01-20T10:00:00Z');
    expect(m.anomaly_flags).toEqual([]);
  });

  it('decodes UTF-16 BE hex strings', () => {
    // FEFF + UTF-16 BE for "Bé" (B=0042, é=00E9)
    const buf = pdf('/Title <FEFF004200E9>');
    const m = extractPdfMetadata(buf, { now: NOW });
    expect(m.title).toBe('Bé');
  });

  it('unescapes literal-string escape sequences', () => {
    const buf = pdf('/Author (Line1\\nLine2 \\(parens\\))');
    const m = extractPdfMetadata(buf, { now: NOW });
    expect(m.author).toBe('Line1\nLine2 (parens)');
  });
});

describe('extractPdfMetadata — anomaly flags', () => {
  it('flags mod-before-creation as definite tamper', () => {
    const buf = pdf('/CreationDate (D:20240315100000Z)\n/ModDate (D:20240310100000Z)');
    const m = extractPdfMetadata(buf, { now: NOW });
    expect(m.anomaly_flags).toContain('mod-before-creation');
  });

  it('flags producer-mismatched-creator', () => {
    const buf = pdf('/Creator (Microsoft Word)\n/Producer (PDFescape Online Editor)');
    const m = extractPdfMetadata(buf, { now: NOW });
    expect(m.anomaly_flags).toContain('producer-mismatched-creator');
  });

  it('flags suspicious-producer (closed allow-list)', () => {
    const buf = pdf('/Producer (PDFescape v2)');
    const m = extractPdfMetadata(buf, { now: NOW });
    expect(m.anomaly_flags).toContain('suspicious-producer');
  });

  it('flags creation-date-future', () => {
    const buf = pdf('/CreationDate (D:30000101000000Z)');
    const m = extractPdfMetadata(buf, { now: NOW });
    // 3000 is out of plausible band → returns null, no flag
    expect(m.creation_date).toBeNull();

    const buf2 = pdf('/CreationDate (D:20990101000000Z)');
    const m2 = extractPdfMetadata(buf2, { now: NOW });
    expect(m2.anomaly_flags).toContain('creation-date-future');
  });

  it('flags no-info-dict when none found', () => {
    const buf = Buffer.from('%PDF-1.4\nrandom bytes\n', 'latin1');
    const m = extractPdfMetadata(buf, { now: NOW });
    expect(m.extracted_ok).toBe(false);
    expect(m.anomaly_flags).toEqual(['no-info-dict']);
  });

  it('does NOT flag producer/creator that are substring-related', () => {
    const buf = pdf('/Creator (Microsoft Word)\n/Producer (Microsoft Word 2019)');
    const m = extractPdfMetadata(buf, { now: NOW });
    expect(m.anomaly_flags).not.toContain('producer-mismatched-creator');
  });
});

describe('extractPdfMetadata — safety / adversarial', () => {
  it('clamps very large input to MAX_SCAN_BYTES window', () => {
    const giantHead = Buffer.alloc(200_000, 0x20); // 200 KB of spaces
    const tail = Buffer.from('/Title (Real Title)\n>>\n', 'latin1');
    const buf = Buffer.concat([giantHead, tail]);
    const start = Date.now();
    const m = extractPdfMetadata(buf, { now: NOW });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    // Title in the tail is reachable
    expect(m.title).toBe('Real Title');
  });

  it('clamps absurd value lengths', () => {
    const huge = 'X'.repeat(2000);
    const buf = pdf(`/Title (${huge})`);
    const m = extractPdfMetadata(buf, { now: NOW });
    expect(m.title?.length).toBeLessThanOrEqual(500);
  });

  it('returns deterministic output for identical input', () => {
    const buf = pdf('/Author (Same Name)\n/CreationDate (D:20240115100000Z)');
    const a = extractPdfMetadata(buf, { now: NOW });
    const b = extractPdfMetadata(buf, { now: NOW });
    expect(a).toEqual(b);
  });

  it('handles empty buffer', () => {
    const m = extractPdfMetadata(Buffer.alloc(0), { now: NOW });
    expect(m.extracted_ok).toBe(false);
    expect(m.anomaly_flags).toContain('no-info-dict');
  });
});
