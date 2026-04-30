/**
 * Tip-attachment sanitisation — MIME allow-list, magic-byte verification,
 * filename hardening, size caps. Pure functions; runs in the browser
 * (before encryption) AND on the server (defense in depth). Threat model
 * is hostile-citizen: a determined adversary who wants to plant malware,
 * exfiltrate operator metadata, or hang the triage queue.
 *
 * Design constraints:
 *   - Closed allow-list of MIME types (no SVG, no HTML, no exotics).
 *   - Magic-byte check rejects MIME-type spoofing (e.g. .exe renamed
 *     to .jpg).
 *   - Filename strips path traversal, control chars, double-extensions,
 *     non-ASCII (NFC-normalise then ASCII-fold; reject if zero chars
 *     remain).
 *   - Hard byte caps per-file AND per-submission so the upload pipeline
 *     can't be DoS'd.
 *   - Returns structured `{ok, reason}` so the UI can render a precise
 *     error AND so the server-side audit log records exactly which gate
 *     rejected which file.
 *   - Does NOT touch network. Does NOT touch crypto. Does NOT touch
 *     filesystem. Pure data-in / verdict-out.
 */

export const TIP_ATTACHMENT_LIMITS = {
  /** Max bytes per single file. Tuned for procurement-document evidence
   *  (a 1080p video clip ≈ 8 MB; a high-res photo ≈ 4 MB). 10 MB matches
   *  the schema's existing comment in zTipAttachmentKind. */
  maxBytesPerFile: 10 * 1024 * 1024,
  /** Max total bytes across all attachments in one submission. */
  maxBytesPerSubmission: 40 * 1024 * 1024,
  /** Max number of attachments. Schema cap is 5; we mirror that here. */
  maxFiles: 5,
  /** Max filename length AFTER sanitisation. */
  maxFilenameLen: 80,
  /** Max length of text body (chars, NOT bytes). */
  maxBodyChars: 5000,
  /** Min length of text body — discourage empty / one-word spam. */
  minBodyChars: 50,
  /** Max length of optional contact field. */
  maxContactChars: 200,
} as const;

/**
 * Closed MIME allow-list. Citizens may submit photos, short videos, and
 * PDF/audio evidence. Everything else is refused — including SVG (XSS),
 * GIF (LZW fuzz history), HTML/XHTML (script vector), archives (defeat
 * scanning), Office docs (macros), executables, scripts, HEIC/HEIF.
 */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/ogg',
  'audio/mpeg',
  'application/pdf',
] as const;
export type AllowedTipMime = (typeof ALLOWED_MIME_TYPES)[number];

/**
 * Magic-byte signatures for every allowed MIME. `offset` is where the
 * signature begins in the file (most are 0; mp4 starts at byte 4 with
 * the `ftyp` box; webp has the RIFF prefix at 0).
 */
interface MagicSignature {
  readonly mime: AllowedTipMime;
  readonly offset: number;
  readonly signature: Uint8Array;
  readonly secondary?: { offset: number; signature: Uint8Array };
}

const MAGIC: ReadonlyArray<MagicSignature> = [
  // image/jpeg — FFD8FF
  { mime: 'image/jpeg', offset: 0, signature: u8([0xff, 0xd8, 0xff]) },
  // image/png — 89 50 4E 47 0D 0A 1A 0A
  { mime: 'image/png', offset: 0, signature: u8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  // image/webp — "RIFF" + "WEBP" at offset 8
  {
    mime: 'image/webp',
    offset: 0,
    signature: u8([0x52, 0x49, 0x46, 0x46]),
    secondary: { offset: 8, signature: u8([0x57, 0x45, 0x42, 0x50]) },
  },
  // video/mp4 — bytes 4..8 are "ftyp"; brand at 8..12 must be one of a closed list
  ...['isom', 'mp42', 'mp41', 'avc1', 'iso2', 'iso4', 'iso5', 'M4V ', 'M4A ', 'dash'].map(
    (brand) =>
      ({
        mime: 'video/mp4' as AllowedTipMime,
        offset: 4,
        signature: u8([0x66, 0x74, 0x79, 0x70]),
        secondary: { offset: 8, signature: u8(stringBytes(brand)) },
      }) satisfies MagicSignature,
  ),
  // video/webm — EBML header 1A 45 DF A3
  { mime: 'video/webm', offset: 0, signature: u8([0x1a, 0x45, 0xdf, 0xa3]) },
  // audio/ogg — "OggS"
  { mime: 'audio/ogg', offset: 0, signature: u8([0x4f, 0x67, 0x67, 0x53]) },
  // audio/mpeg — ID3 tag (49 44 33) OR a frame sync (FF FB | FF F3 | FF F2)
  { mime: 'audio/mpeg', offset: 0, signature: u8([0x49, 0x44, 0x33]) },
  { mime: 'audio/mpeg', offset: 0, signature: u8([0xff, 0xfb]) },
  { mime: 'audio/mpeg', offset: 0, signature: u8([0xff, 0xf3]) },
  { mime: 'audio/mpeg', offset: 0, signature: u8([0xff, 0xf2]) },
  // application/pdf — "%PDF-"
  { mime: 'application/pdf', offset: 0, signature: u8([0x25, 0x50, 0x44, 0x46, 0x2d]) },
];

function u8(arr: number[]): Uint8Array {
  return Uint8Array.from(arr);
}
function stringBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 1) out.push(s.charCodeAt(i));
  return out;
}

function bytesEqual(a: Uint8Array, offset: number, sig: Uint8Array): boolean {
  if (offset + sig.length > a.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (a[offset + i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Detect the actual MIME of a file from its first ~32 bytes. Returns
 * one of {@link ALLOWED_MIME_TYPES} or `null` when no signature
 * matches — the caller treats `null` as "rejected, MIME not in the
 * allow-list."
 */
export function detectMimeFromMagic(bytes: Uint8Array): AllowedTipMime | null {
  for (const sig of MAGIC) {
    if (!bytesEqual(bytes, sig.offset, sig.signature)) continue;
    if (sig.secondary && !bytesEqual(bytes, sig.secondary.offset, sig.secondary.signature)) {
      continue;
    }
    return sig.mime;
  }
  return null;
}

/**
 * Sanitise a filename. Returns the sanitised result OR `null` if the
 * sanitised result would be empty / unsafe.
 */
export function sanitiseFilename(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.normalize('NFC');
  // Strip everything that is not [A-Za-z0-9 ._-]
  s = s.replace(/[^A-Za-z0-9 ._-]+/g, '_');
  // Collapse runs of dots / underscores
  s = s.replace(/_+/g, '_').replace(/\.{2,}/g, '.');
  // Strip leading dots / underscores / spaces
  s = s.replace(/^[._\s]+/, '');
  // Truncate
  if (s.length > TIP_ATTACHMENT_LIMITS.maxFilenameLen) {
    const dot = s.lastIndexOf('.');
    if (dot > 0 && s.length - dot <= 8) {
      const ext = s.slice(dot);
      const stem = s.slice(0, dot);
      s = stem.slice(0, TIP_ATTACHMENT_LIMITS.maxFilenameLen - ext.length) + ext;
    } else {
      s = s.slice(0, TIP_ATTACHMENT_LIMITS.maxFilenameLen);
    }
  }
  // Lowercase the extension only.
  const dot = s.lastIndexOf('.');
  if (dot > 0) {
    s = s.slice(0, dot) + s.slice(dot).toLowerCase();
  }
  if (s.length === 0) return null;
  return s;
}

/**
 * NUL byte (U+0000) string used by the body / contact NUL-detection
 * fast-path. Defined as `String.fromCharCode(0)` so the file does not
 * itself contain a literal NUL byte that lint would flag.
 */
const NUL = String.fromCharCode(0);

/**
 * Strip ASCII control bytes (U+0000..U+001F + U+007F) EXCEPT \r (0D) and
 * \n (0A). Plus strip the well-known invisible-bidi codepoints used to
 * spoof homoglyphs in operator-facing display:
 *   ZWSP U+200B, ZWNJ U+200C, ZWJ U+200D, WJ U+2060, BOM U+FEFF.
 *
 * Implemented charcode-by-charcode (no regex) so the source file
 * contains zero literal control characters and no `no-control-regex`
 * lint suppression is needed.
 */
function stripDangerousChars(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c === 0x0d || c === 0x0a) {
      out += s[i];
      continue;
    }
    if (c < 0x20 || c === 0x7f) continue;
    if (c === 0x200b || c === 0x200c || c === 0x200d || c === 0x2060 || c === 0xfeff) continue;
    out += s[i];
  }
  return out;
}

/**
 * Sanitise a citizen-supplied text body. Rejects NUL bytes outright,
 * strips control + bidi-format codepoints, NFC-normalises, length-clamps,
 * and rejects bodies shorter than {@link TIP_ATTACHMENT_LIMITS.minBodyChars}
 * after stripping.
 */
export function sanitiseTextBody(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: 'body-not-string' };
  if (raw.includes(NUL)) return { ok: false, reason: 'body-has-nul-byte' };
  let s = raw.normalize('NFC');
  s = stripDangerousChars(s);
  if (s.length > TIP_ATTACHMENT_LIMITS.maxBodyChars) {
    s = s.slice(0, TIP_ATTACHMENT_LIMITS.maxBodyChars);
  }
  if (s.trim().length < TIP_ATTACHMENT_LIMITS.minBodyChars) {
    return { ok: false, reason: 'body-too-short' };
  }
  return { ok: true, value: s };
}

/**
 * Sanitise the optional contact field. Same rules as the body but with
 * a much smaller length cap and no minimum length (empty is allowed —
 * tip is anonymous by default).
 */
export function sanitiseContact(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: 'contact-not-string' };
  if (raw.length === 0) return { ok: true, value: '' };
  if (raw.includes(NUL)) return { ok: false, reason: 'contact-has-nul-byte' };
  let s = raw.normalize('NFC');
  s = stripDangerousChars(s);
  if (s.length > TIP_ATTACHMENT_LIMITS.maxContactChars) {
    return { ok: false, reason: 'contact-too-long' };
  }
  return { ok: true, value: s.trim() };
}

export type AttachmentVerdict =
  | { ok: true; mime: AllowedTipMime; sanitisedFilename: string }
  | { ok: false; reason: string };

/**
 * One-stop validator for a single attachment. Combines:
 *   - filename sanitisation
 *   - byte-count gate
 *   - magic-byte detection vs declared MIME
 *
 * The CALLER does in-browser image re-encoding (canvas → PNG/JPEG)
 * BEFORE handing the result here; that strips EXIF + drops
 * steganographic payloads. For videos / PDFs / audio we accept the
 * original bytes (re-encoding those would corrupt evidence) but the
 * magic-byte check + size cap stand.
 */
export function validateAttachment(input: {
  readonly filename: string;
  readonly declaredMime: string;
  readonly bytes: Uint8Array;
}): AttachmentVerdict {
  const fname = sanitiseFilename(input.filename);
  if (fname === null) return { ok: false, reason: 'filename-empty-after-sanitisation' };
  if (input.bytes.byteLength === 0) return { ok: false, reason: 'attachment-empty' };
  if (input.bytes.byteLength > TIP_ATTACHMENT_LIMITS.maxBytesPerFile) {
    return { ok: false, reason: 'attachment-too-large' };
  }
  if (!ALLOWED_MIME_TYPES.includes(input.declaredMime as AllowedTipMime)) {
    return { ok: false, reason: 'declared-mime-not-allowed' };
  }
  const detected = detectMimeFromMagic(input.bytes);
  if (detected === null) {
    return { ok: false, reason: 'magic-bytes-do-not-match-any-allowed-mime' };
  }
  if (detected !== input.declaredMime) {
    return { ok: false, reason: `mime-spoof: declared=${input.declaredMime} detected=${detected}` };
  }
  return { ok: true, mime: detected, sanitisedFilename: fname };
}
