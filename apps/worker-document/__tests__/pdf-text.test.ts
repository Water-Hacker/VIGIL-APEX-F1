/**
 * PDF text-layer extractor tests.
 *
 * Verifies the parser handles every text-operator variant the
 * procurement-PDF corpus uses (Tj literal/hex, TJ array, FlateDecode-
 * compressed streams) plus the safety bounds (size cap, empty buffer,
 * non-PDF input).
 */
import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { extractPdfTextLayer } from '../src/pdf-text.js';

function pdfWithStream(streamBody: string, dict = ''): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<<${dict}>>\nstream\n${streamBody}\nendstream\nendobj\n%%EOF\n`,
    'latin1',
  );
}

describe('extractPdfTextLayer — happy paths', () => {
  it('extracts a literal Tj string', () => {
    const buf = pdfWithStream('BT /F1 12 Tf (Hello World) Tj ET');
    const out = extractPdfTextLayer(buf);
    expect(out).toContain('Hello World');
  });

  it('extracts a hex Tj string', () => {
    // hex for "Hi" = 4869
    const buf = pdfWithStream('BT <4869> Tj ET');
    const out = extractPdfTextLayer(buf);
    expect(out).toContain('Hi');
  });

  it('extracts UTF-16 BE hex (FEFF prefix)', () => {
    // FEFF + 00C9 (É) + 0078 (x)
    const buf = pdfWithStream('BT <FEFF00C90078> Tj ET');
    const out = extractPdfTextLayer(buf);
    expect(out).toContain('Éx');
  });

  it('extracts strings from a TJ array', () => {
    const buf = pdfWithStream('BT [(Hello) -250 (World)] TJ ET');
    const out = extractPdfTextLayer(buf);
    expect(out).toContain('HelloWorld');
  });

  it('unescapes literal-string escapes (\\n, \\(, \\\\)', () => {
    const buf = pdfWithStream('BT (Line1\\nLine2 \\(parens\\)) Tj ET');
    const out = extractPdfTextLayer(buf);
    expect(out).toContain('Line1\nLine2 (parens)');
  });

  it('honours the Tj single-quote variant', () => {
    const buf = pdfWithStream("BT (Quoted text) ' ET");
    const out = extractPdfTextLayer(buf);
    expect(out).toContain('Quoted text');
  });

  it('decodes FlateDecode-compressed streams', () => {
    const inner = 'BT (Compressed!) Tj ET';
    const compressed = deflateSync(Buffer.from(inner, 'latin1'));
    const buf = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<</Filter /FlateDecode>>\nstream\n', 'latin1'),
      compressed,
      Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
    ]);
    const out = extractPdfTextLayer(buf);
    expect(out).toContain('Compressed!');
  });
});

describe('extractPdfTextLayer — fallback / safety', () => {
  it('returns null for non-PDF input', () => {
    expect(extractPdfTextLayer(Buffer.from('NOT A PDF', 'latin1'))).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(extractPdfTextLayer(Buffer.alloc(0))).toBeNull();
  });

  it('returns null when the PDF has no text operators (image-only)', () => {
    const buf = pdfWithStream('BT /Im0 Do ET');
    expect(extractPdfTextLayer(buf)).toBeNull();
  });

  it('skips streams using non-Flate filters', () => {
    const buf = pdfWithStream('BT (visible) Tj ET', '/Filter /DCTDecode');
    expect(extractPdfTextLayer(buf)).toBeNull();
  });

  it('rejects oversized inputs without scanning', () => {
    const giant = Buffer.alloc(6 * 1024 * 1024, 0x20); // 6 MB > MAX_PDF_BYTES
    const start = Date.now();
    const out = extractPdfTextLayer(giant);
    const elapsed = Date.now() - start;
    expect(out).toBeNull();
    expect(elapsed).toBeLessThan(100);
  });

  it('returns deterministic output for identical input', () => {
    const buf = pdfWithStream('BT (Same string) Tj ET');
    expect(extractPdfTextLayer(buf)).toEqual(extractPdfTextLayer(buf));
  });

  it('combines text from multiple content streams in object order', () => {
    const buf = Buffer.from(
      '%PDF-1.4\n' +
        '1 0 obj <<>> stream\nBT (First) Tj ET\nendstream endobj\n' +
        '2 0 obj <<>> stream\nBT (Second) Tj ET\nendstream endobj\n' +
        '%%EOF\n',
      'latin1',
    );
    const out = extractPdfTextLayer(buf);
    expect(out).toContain('First');
    expect(out).toContain('Second');
    // First-appearing content should land before the second
    expect(out!.indexOf('First')).toBeLessThan(out!.indexOf('Second'));
  });
});
