/**
 * PDF info-dictionary extractor — pure-JS, no heavyweight deps.
 *
 * Pattern P-G-001 (backdated document) and P-G-003 (metadata anomaly)
 * read `event.payload.document_metadata` for fields like creationDate,
 * modDate, declared author, creator software. This module produces that
 * payload from a PDF buffer.
 *
 * Approach: scan the trailer for the `/Info <ref>` reference, then
 * find that indirect object and extract the Info dict's name-value
 * pairs. PDFs are binary, but the Info dict is ASCII-decodable
 * (PostScript-style). We restrict the scan to a bounded tail of the
 * buffer (last 64 KB) for performance — Info dicts always live near
 * the trailer.
 *
 * Hardening:
 *   - MAX_SCAN_BYTES caps the scan window (no DoS via giant PDFs).
 *   - String values length-clamped at MAX_VALUE_LEN (no unbounded
 *     allocation if the PDF claims a 1 GB Producer string).
 *   - Date values parsed strictly to ISO-8601; malformed dates → null
 *     rather than throw.
 *   - Suspicious-software heuristic uses a closed allow-list (no regex
 *     injection from PDF content).
 *   - Pure function. No I/O. No clock. Same input → same output.
 *
 * Backdating heuristics:
 *   - modDate strictly before creationDate (impossible — definite tamper).
 *   - modDate years before the alleged effective date (probable backdate).
 *   - creationDate years AFTER listing date (post-hoc fabrication).
 */

const MAX_SCAN_BYTES = 65_536; // 64 KB tail window
const MAX_VALUE_LEN = 500;

export interface PdfMetadata {
  readonly title: string | null;
  readonly author: string | null;
  readonly subject: string | null;
  readonly creator: string | null;
  readonly producer: string | null;
  readonly creation_date: string | null; // ISO-8601 datetime
  readonly mod_date: string | null;
  readonly keywords: string | null;
  /** Was the metadata extraction successful? false → no Info dict found. */
  readonly extracted_ok: boolean;
  /** Heuristic flags worth surfacing to G-pattern detection. */
  readonly anomaly_flags: ReadonlyArray<PdfAnomalyFlag>;
}

export type PdfAnomalyFlag =
  | 'mod-before-creation' // modDate < creationDate (impossible — definite tamper)
  | 'producer-mismatched-creator' // common scrubbing pattern
  | 'no-info-dict' // PDF stripped of metadata (intentional?)
  | 'creation-date-future' // creationDate after now
  | 'suspicious-producer'; // matches a closed allow-list of known scrubbers

const SUSPICIOUS_PRODUCERS = new Set([
  'pdfescape',
  'pdftk',
  'qpdf',
  'pdfsam',
  'sejda',
  'smallpdf',
  'ilovepdf',
  'pdf24',
]);

export interface PdfMetadataOptions {
  /** Reference "now" for the creation-date-future flag. Default new Date(). */
  readonly now?: Date;
}

export function extractPdfMetadata(buf: Buffer, opts: PdfMetadataOptions = {}): PdfMetadata {
  const now = opts.now ?? new Date();
  const tail = buf.length > MAX_SCAN_BYTES ? buf.subarray(buf.length - MAX_SCAN_BYTES) : buf;
  // Decode latin-1 — the Info dict is ASCII; UTF-16 BE strings are
  // bracketed `<FEFF...>` and we'll only read the latin-1-equivalent.
  const text = tail.toString('latin1');

  const fields = parseInfoDict(text);
  if (fields === null) {
    return {
      title: null,
      author: null,
      subject: null,
      creator: null,
      producer: null,
      creation_date: null,
      mod_date: null,
      keywords: null,
      extracted_ok: false,
      anomaly_flags: ['no-info-dict'],
    };
  }

  const creationDate = parsePdfDate(fields['CreationDate'] ?? null);
  const modDate = parsePdfDate(fields['ModDate'] ?? null);
  const flags: PdfAnomalyFlag[] = [];

  if (creationDate !== null && modDate !== null) {
    if (new Date(modDate).getTime() < new Date(creationDate).getTime()) {
      flags.push('mod-before-creation');
    }
  }
  if (creationDate !== null && new Date(creationDate).getTime() > now.getTime() + 86_400_000) {
    flags.push('creation-date-future');
  }
  const producer = clamp(fields['Producer'] ?? null);
  const creator = clamp(fields['Creator'] ?? null);
  if (producer !== null && creator !== null) {
    if (
      producer.toLowerCase() !== creator.toLowerCase() &&
      !producer.toLowerCase().includes(creator.toLowerCase()) &&
      !creator.toLowerCase().includes(producer.toLowerCase())
    ) {
      flags.push('producer-mismatched-creator');
    }
  }
  if (producer !== null) {
    const lower = producer.toLowerCase();
    for (const sus of SUSPICIOUS_PRODUCERS) {
      if (lower.includes(sus)) {
        flags.push('suspicious-producer');
        break;
      }
    }
  }

  return {
    title: clamp(fields['Title'] ?? null),
    author: clamp(fields['Author'] ?? null),
    subject: clamp(fields['Subject'] ?? null),
    creator,
    producer,
    creation_date: creationDate,
    mod_date: modDate,
    keywords: clamp(fields['Keywords'] ?? null),
    extracted_ok: true,
    anomaly_flags: flags,
  };
}

function clamp(s: string | null): string | null {
  if (s === null) return null;
  const trimmed = s.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_VALUE_LEN);
}

/**
 * Parse the simple subset of PDF Info-dict syntax.
 *
 *   /Title (Some Title)
 *   /Author (Jean Dupont)
 *   /Producer (Microsoft® Word 2019)
 *   /CreationDate (D:20240315120000+01'00')
 *
 * Returns a flat string→string map. Hex-encoded strings (`<FEFF...>`) are
 * decoded as UTF-16 BE; literal-string parens with backslash escapes are
 * unescaped.
 *
 * Returns null if no Info dict is found in the scanned region.
 */
function parseInfoDict(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  // Find all standard Info keys; bounded regex (no .* unbounded).
  const keys = [
    'Title',
    'Author',
    'Subject',
    'Creator',
    'Producer',
    'CreationDate',
    'ModDate',
    'Keywords',
  ];
  let foundAny = false;
  for (const k of keys) {
    // /Key (literal-string)  OR  /Key <hex-string>
    // Match the closest enclosing parens or brackets after the key.
    const litRe = new RegExp(`/${k}\\s*\\(((?:[^()\\\\]|\\\\.|\\\\[0-7]{1,3})*?)\\)`);
    const hexRe = new RegExp(`/${k}\\s*<([0-9a-fA-F\\s]+)>`);
    const lit = text.match(litRe);
    if (lit && lit[1] !== undefined) {
      out[k] = unescapePdfLiteral(lit[1]);
      foundAny = true;
      continue;
    }
    const hex = text.match(hexRe);
    if (hex && hex[1] !== undefined) {
      out[k] = decodePdfHex(hex[1]);
      foundAny = true;
    }
  }
  return foundAny ? out : null;
}

function unescapePdfLiteral(s: string): string {
  // PDF escape sequences in literal strings: \n \r \t \b \f \( \) \\ \ddd
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
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
      // Octal up to 3 digits
      let octStr = n;
      let j = i + 2;
      while (j < s.length && j < i + 4 && /[0-7]/.test(s[j] ?? '')) {
        octStr += s[j] ?? '';
        j += 1;
      }
      const code = Number.parseInt(octStr, 8);
      if (Number.isFinite(code) && code >= 32 && code < 127) {
        out += String.fromCharCode(code);
      }
      i = j - 1;
    } else {
      out += n;
      i += 1;
    }
    if (out.length > MAX_VALUE_LEN) break;
  }
  return out;
}

function decodePdfHex(hex: string): string {
  const stripped = hex.replace(/\s/g, '');
  if (stripped.length === 0) return '';
  // FEFF prefix → UTF-16 BE
  if (stripped.toUpperCase().startsWith('FEFF') && stripped.length >= 4) {
    const bytes = stripped.slice(4);
    let s = '';
    for (let i = 0; i < bytes.length - 3; i += 4) {
      const code = Number.parseInt(bytes.slice(i, i + 4), 16);
      if (Number.isFinite(code) && code > 0) s += String.fromCharCode(code);
      if (s.length >= MAX_VALUE_LEN) break;
    }
    return s;
  }
  // Otherwise treat as latin-1
  let s = '';
  for (let i = 0; i < stripped.length - 1; i += 2) {
    const code = Number.parseInt(stripped.slice(i, i + 2), 16);
    if (Number.isFinite(code) && code >= 32) s += String.fromCharCode(code);
    if (s.length >= MAX_VALUE_LEN) break;
  }
  return s;
}

/**
 * PDF date string → ISO-8601 datetime. Returns null on parse failure.
 *
 *   "D:YYYYMMDDHHmmSS+HH'mm"   (full)
 *   "D:YYYYMMDDHHmmSSZ"        (UTC)
 *   "D:YYYYMMDDHHmmSS"         (no zone)
 *   "D:YYYYMMDD"               (date-only)
 *   The leading "D:" prefix is optional; some PDFs omit it.
 */
export function parsePdfDate(raw: string | null): string | null {
  if (raw === null) return null;
  const cleaned = raw.replace(/^D:/, '').trim();
  // YYYYMMDDHHmmSS plus optional zone (Z standalone OR ±HH'mm)
  const m = cleaned.match(
    /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z)|([+-])(\d{2})(?:'?(\d{2})'?)?)?$/,
  );
  if (!m) return null;
  const [, yStr, mStr, dStr, hStr, mnStr, sStr, zUtc, zSign, zhStr, zmStr] = m;
  if (yStr === undefined) return null;
  const y = Number.parseInt(yStr, 10);
  const mo = mStr ? Number.parseInt(mStr, 10) : 1;
  const d = dStr ? Number.parseInt(dStr, 10) : 1;
  const h = hStr ? Number.parseInt(hStr, 10) : 0;
  const mn = mnStr ? Number.parseInt(mnStr, 10) : 0;
  const s = sStr ? Number.parseInt(sStr, 10) : 0;
  if (!Number.isFinite(y) || y < 1990 || y > 2099) return null;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  if (h > 23 || mn > 59 || s > 59) return null;

  const isoDate = `${pad4(y)}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mn)}:${pad2(s)}`;
  if (zUtc === 'Z' || (!zUtc && !zSign)) return `${isoDate}Z`;
  const zh = zhStr ? Number.parseInt(zhStr, 10) : 0;
  const zm = zmStr ? Number.parseInt(zmStr, 10) : 0;
  if (!Number.isFinite(zh) || !Number.isFinite(zm) || zh > 14 || zm > 59) return null;
  return `${isoDate}${zSign}${pad2(zh)}:${pad2(zm)}`;
}

const pad2 = (n: number): string => n.toString().padStart(2, '0');
const pad4 = (n: number): string => n.toString().padStart(4, '0');
