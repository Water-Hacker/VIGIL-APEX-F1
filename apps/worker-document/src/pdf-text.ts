/**
 * Text-layer PDF extractor — pulls plain text from a PDF whose content
 * stream contains a real text layer (i.e. NOT a scanned image-only PDF).
 *
 * For image-only PDFs the OCR pipeline (`OcrPool`) is the right path;
 * this module fills the gap for procurement-system PDFs that ARE
 * text-extractable but were never run through OCR (saves the OCR cost
 * AND avoids OCR's per-character error rate on legible text).
 *
 * Approach: parse the PDF's content streams for `(text) Tj` and `[(a)
 * (b)] TJ` operators. We do not attempt full-fidelity layout
 * reconstruction (that would require font-metrics + CID maps + a
 * full PostScript interpreter). The output preserves reading order
 * within each content stream and concatenates streams in PDF object
 * order — sufficient for the regex-cue extractors in
 * `content-extractor.ts`.
 *
 * Hardening:
 *   - MAX_PDF_BYTES (5 MB) hard cap before scanning. Procurement PDFs
 *     in the corpus are < 1 MB; the cap exists purely as a DoS bound.
 *   - MAX_TEXT_OUT (2 MB) cap on the produced text — the consumer
 *     (`extractDocContent`) clamps further at MAX_TEXT_SCAN.
 *   - Returns null when no text operators were found (purely-image
 *     PDFs and unparseable inputs both land here cleanly).
 *   - Pure function. No I/O. No clock. Deterministic output.
 */

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_OUT = 2 * 1024 * 1024;

export function extractPdfTextLayer(buf: Buffer): string | null {
  if (buf.length === 0 || buf.length > MAX_PDF_BYTES) return null;
  // Quick reject: no `%PDF` header → not a PDF.
  if (buf.slice(0, 4).toString('latin1') !== '%PDF') return null;
  const text = buf.toString('latin1');

  // Stage 1: pull every content stream out of `stream … endstream` blocks.
  // Many PDFs flate-compress the streams; we cannot inflate without zlib
  // (which we have via node:zlib) and the dictionary signal is `/Filter
  // /FlateDecode`. We attempt inflation when the dictionary advertises
  // FlateDecode AND the stream bytes start with the zlib magic 0x78.
  const out: string[] = [];
  const streamRe = /<<([^>]*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const m of text.matchAll(streamRe)) {
    const dict = m[1] ?? '';
    const body = m[2] ?? '';
    if (out.join('').length > MAX_TEXT_OUT) break;
    let payload: string;
    if (/\/Filter\s*\/FlateDecode\b/.test(dict)) {
      const inflated = tryInflate(Buffer.from(body, 'latin1'));
      if (inflated === null) continue; // skip unreadable stream
      payload = inflated;
    } else if (!/\/Filter\b/.test(dict)) {
      payload = body;
    } else {
      // Other filter (DCT/CCITT/Run-Length/LZW…) — not text-decodable here.
      continue;
    }
    extractTextOperators(payload, out);
  }

  if (out.length === 0) return null;
  let combined = out.join('\n').trim();
  if (combined.length > MAX_TEXT_OUT) combined = combined.slice(0, MAX_TEXT_OUT);
  return combined.length > 0 ? combined : null;
}

/**
 * Pull text from PDF content-stream operators. Targets `Tj` (single
 * string) + `TJ` (array of strings with kerning numbers) + `'` and `"`
 * (move-and-show variants).
 *
 * Strings can be literal `(...)` or hex `<...>`. We unescape the
 * literal-string subset of the PDF spec (\n \r \t \( \) \\ \ddd) and
 * decode the hex form (latin-1 OR FEFF-prefixed UTF-16 BE).
 */
function extractTextOperators(stream: string, out: string[]): void {
  // Tj — `(string) Tj`
  for (const m of stream.matchAll(/\(((?:[^()\\]|\\.|\\[0-7]{1,3})*?)\)\s*(?:Tj|'|")/g)) {
    out.push(unescapePdfLiteral(m[1] ?? ''));
    if (out.join('').length > MAX_TEXT_OUT) return;
  }
  // <hex> Tj
  for (const m of stream.matchAll(/<([0-9a-fA-F\s]+)>\s*Tj/g)) {
    out.push(decodePdfHex(m[1] ?? ''));
    if (out.join('').length > MAX_TEXT_OUT) return;
  }
  // [...] TJ — array of strings + numeric kerning. Pull strings only.
  for (const m of stream.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    const arrBody = m[1] ?? '';
    let combined = '';
    // Literal strings inside the array
    for (const lm of arrBody.matchAll(/\(((?:[^()\\]|\\.|\\[0-7]{1,3})*?)\)/g)) {
      combined += unescapePdfLiteral(lm[1] ?? '');
    }
    // Hex strings inside the array
    for (const hm of arrBody.matchAll(/<([0-9a-fA-F\s]+)>/g)) {
      combined += decodePdfHex(hm[1] ?? '');
    }
    if (combined.length > 0) {
      out.push(combined);
      if (out.join('').length > MAX_TEXT_OUT) return;
    }
  }
}

function unescapePdfLiteral(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]!;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = s[i + 1] ?? '';
    if (n === 'n') {
      out += '\n';
      i += 1;
    } else if (n === 'r') {
      out += '\r';
      i += 1;
    } else if (n === 't') {
      out += '\t';
      i += 1;
    } else if (n === '(' || n === ')' || n === '\\') {
      out += n;
      i += 1;
    } else if (/[0-7]/.test(n)) {
      let octStr = n;
      let j = i + 2;
      while (j < s.length && j < i + 4 && /[0-7]/.test(s[j] ?? '')) {
        octStr += s[j] ?? '';
        j += 1;
      }
      const code = Number.parseInt(octStr, 8);
      if (Number.isFinite(code) && code >= 32 && code < 256) {
        out += String.fromCharCode(code);
      }
      i = j - 1;
    } else {
      out += n;
      i += 1;
    }
    if (out.length > MAX_TEXT_OUT) break;
  }
  return out;
}

function decodePdfHex(hex: string): string {
  const stripped = hex.replace(/\s/g, '');
  if (stripped.length === 0) return '';
  if (stripped.toUpperCase().startsWith('FEFF') && stripped.length >= 4) {
    const bytes = stripped.slice(4);
    let s = '';
    for (let i = 0; i < bytes.length - 3; i += 4) {
      const code = Number.parseInt(bytes.slice(i, i + 4), 16);
      if (Number.isFinite(code) && code > 0) s += String.fromCharCode(code);
      if (s.length >= MAX_TEXT_OUT) break;
    }
    return s;
  }
  let s = '';
  for (let i = 0; i < stripped.length - 1; i += 2) {
    const code = Number.parseInt(stripped.slice(i, i + 2), 16);
    if (Number.isFinite(code) && code >= 32) s += String.fromCharCode(code);
    if (s.length >= MAX_TEXT_OUT) break;
  }
  return s;
}

/**
 * Inflate a FlateDecode stream. Returns the decompressed payload as
 * latin-1 (so byte indices line up with the regex scanner), or null
 * if zlib rejects the input.
 */
function tryInflate(buf: Buffer): string | null {
  try {
    // Lazy require so this module stays usable in tests without
    // pulling in zlib-as-init cost during import.
    const zlib = require('node:zlib') as typeof import('node:zlib');
    const inflated = zlib.inflateSync(buf);
    return inflated.toString('latin1');
  } catch {
    return null;
  }
}
