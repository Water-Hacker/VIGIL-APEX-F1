/**
 * Tip-sanitiser tests — every gate in the threat model.
 *
 * Every control / zero-width / homoglyph byte is built via
 * `String.fromCharCode` so the source file contains zero literal
 * control bytes (lint-friendly + reviewable as plain ASCII).
 */
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_MIME_TYPES,
  TIP_ATTACHMENT_LIMITS,
  detectMimeFromMagic,
  sanitiseContact,
  sanitiseFilename,
  sanitiseTextBody,
  validateAttachment,
} from './tip-sanitise.js';

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const ESC = String.fromCharCode(27);
const ZWSP = String.fromCharCode(0x200b);
const ZWJ = String.fromCharCode(0x200d);

// --- magic-byte fixtures (synthesised inline so no test fixtures dir needed)
function jpegBytes(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
}
function pngBytes(): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
}
function webpBytes(): Uint8Array {
  return Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x20, 0x30, 0x40, 0x57, 0x45, 0x42, 0x50]);
}
function mp4Bytes(): Uint8Array {
  return Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
}
function webmBytes(): Uint8Array {
  return Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x10]);
}
function pdfBytes(): Uint8Array {
  return Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
}
function svgBytes(): Uint8Array {
  const s = '<?xml version="1.0"?><svg><script>alert(1)</script></svg>';
  return new TextEncoder().encode(s);
}
function exeBytes(): Uint8Array {
  return Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
}
function zipBytes(): Uint8Array {
  return Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
}

describe('detectMimeFromMagic — happy paths', () => {
  const cases: Array<[string, Uint8Array, string]> = [
    ['jpeg', jpegBytes(), 'image/jpeg'],
    ['png', pngBytes(), 'image/png'],
    ['webp', webpBytes(), 'image/webp'],
    ['mp4', mp4Bytes(), 'video/mp4'],
    ['webm', webmBytes(), 'video/webm'],
    ['pdf', pdfBytes(), 'application/pdf'],
  ];
  for (const [name, buf, expected] of cases) {
    it(`detects ${name}`, () => {
      expect(detectMimeFromMagic(buf)).toBe(expected);
    });
  }
});

describe('detectMimeFromMagic — refuses everything outside the allow-list', () => {
  it('returns null for SVG (XSS vector)', () => {
    expect(detectMimeFromMagic(svgBytes())).toBeNull();
  });
  it('returns null for Windows executables', () => {
    expect(detectMimeFromMagic(exeBytes())).toBeNull();
  });
  it('returns null for ZIP archives', () => {
    expect(detectMimeFromMagic(zipBytes())).toBeNull();
  });
  it('returns null for empty buffers', () => {
    expect(detectMimeFromMagic(new Uint8Array(0))).toBeNull();
  });
  it('returns null for short buffers (< 8 bytes)', () => {
    expect(detectMimeFromMagic(Uint8Array.from([0xff, 0xd8]))).toBeNull();
  });
  it('returns null for plausibly-text input', () => {
    expect(detectMimeFromMagic(new TextEncoder().encode('Hello world'))).toBeNull();
  });
});

describe('detectMimeFromMagic — webp secondary check rejects RIFF-not-WEBP', () => {
  it('returns null for "RIFF" + non-WEBP (e.g. WAV)', () => {
    const buf = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0x10, 0x20, 0x30, 0x40, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(detectMimeFromMagic(buf)).toBeNull();
  });
});

describe('sanitiseFilename — path traversal + control chars', () => {
  it('strips ../ traversal (leading underscores then collapsed)', () => {
    expect(sanitiseFilename('../../../etc/passwd')).toBe('etc_passwd');
  });
  it('strips bare ../', () => {
    expect(sanitiseFilename('../secret.pdf')).toBe('secret.pdf');
  });
  it('strips Windows backslashes', () => {
    expect(sanitiseFilename('C:\\Windows\\system32\\cmd.exe')).toBe('C_Windows_system32_cmd.exe');
  });
  it('strips control characters (NUL, BEL, ESC)', () => {
    expect(sanitiseFilename(`foo${NUL}${BEL}${ESC}bar.pdf`)).toBe('foo_bar.pdf');
  });
  it('preserves the extension when truncating long names', () => {
    const long = 'a'.repeat(500) + '.pdf';
    const out = sanitiseFilename(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(TIP_ATTACHMENT_LIMITS.maxFilenameLen);
    expect(out!.endsWith('.pdf')).toBe(true);
  });
  it('lowercases the extension only', () => {
    expect(sanitiseFilename('Report.PDF')).toBe('Report.pdf');
  });
  it('returns null for filenames that sanitise to empty', () => {
    expect(sanitiseFilename('....')).toBeNull();
    expect(sanitiseFilename('   ')).toBeNull();
    expect(sanitiseFilename('')).toBeNull();
  });
  it('strips non-ASCII (after NFC normalisation)', () => {
    expect(sanitiseFilename('résumé.pdf')).toMatch(/r_sum_\.pdf|r_sum\.pdf/);
  });
  it('rejects double-dot tokens', () => {
    expect(sanitiseFilename('cv..pdf')).toBe('cv.pdf');
  });
  it('rejects null input', () => {
    expect(sanitiseFilename(null as unknown as string)).toBeNull();
  });
});

describe('sanitiseTextBody', () => {
  it('accepts a plain ≥ 50-char body', () => {
    const r = sanitiseTextBody('a'.repeat(60));
    expect(r.ok).toBe(true);
  });
  it('rejects null bytes outright', () => {
    const r = sanitiseTextBody(`hello${NUL}world` + 'x'.repeat(60));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('body-has-nul-byte');
  });
  it('strips ASCII control bytes (preserves \\r and \\n)', () => {
    const r = sanitiseTextBody(`Line1\nLine2\r\n${'x'.repeat(60)}${BEL}${ESC}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toContain('Line1\n');
      expect(r.value).not.toContain(BEL);
      expect(r.value).not.toContain(ESC);
    }
  });
  it('strips zero-width joiners (homoglyph spoofing)', () => {
    const r = sanitiseTextBody(`Visi${ZWJ}ble` + 'x'.repeat(60));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Visible' + 'x'.repeat(60));
  });
  it('strips zero-width-space (ZWSP)', () => {
    const r = sanitiseTextBody(`Hi${ZWSP}lo` + 'x'.repeat(60));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.startsWith('Hilo')).toBe(true);
  });
  it('clamps to maxBodyChars', () => {
    const r = sanitiseTextBody('a'.repeat(TIP_ATTACHMENT_LIMITS.maxBodyChars + 100));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.length).toBe(TIP_ATTACHMENT_LIMITS.maxBodyChars);
  });
  it('rejects bodies shorter than minBodyChars', () => {
    const r = sanitiseTextBody('too short');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('body-too-short');
  });
  it('rejects non-string input', () => {
    const r = sanitiseTextBody(123 as unknown as string);
    expect(r.ok).toBe(false);
  });
});

describe('sanitiseContact', () => {
  it('accepts empty string (anonymous default)', () => {
    const r = sanitiseContact('');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('');
  });
  it('rejects oversized contact', () => {
    const r = sanitiseContact('a'.repeat(TIP_ATTACHMENT_LIMITS.maxContactChars + 1));
    expect(r.ok).toBe(false);
  });
  it('rejects null bytes', () => {
    const r = sanitiseContact(`email${NUL}@example.com`);
    expect(r.ok).toBe(false);
  });
  it('strips control chars from valid contacts', () => {
    const r = sanitiseContact(`  signal:+1234567890${BEL}  `);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('signal:+1234567890');
  });
});

describe('validateAttachment — full gate', () => {
  it('accepts a valid jpeg', () => {
    const r = validateAttachment({
      filename: 'evidence.jpg',
      declaredMime: 'image/jpeg',
      bytes: jpegBytes(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe('image/jpeg');
      expect(r.sanitisedFilename).toBe('evidence.jpg');
    }
  });
  it('rejects mime spoofing (declared jpeg but actually exe)', () => {
    const r = validateAttachment({
      filename: 'cv.jpg',
      declaredMime: 'image/jpeg',
      bytes: exeBytes(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/mime-spoof|magic-bytes/);
  });
  it('rejects declared SVG (not in allow-list)', () => {
    const r = validateAttachment({
      filename: 'fake.svg',
      declaredMime: 'image/svg+xml',
      bytes: svgBytes(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('declared-mime-not-allowed');
  });
  it('rejects empty file', () => {
    const r = validateAttachment({
      filename: 'empty.jpg',
      declaredMime: 'image/jpeg',
      bytes: new Uint8Array(0),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('attachment-empty');
  });
  it('rejects oversize file', () => {
    const big = new Uint8Array(TIP_ATTACHMENT_LIMITS.maxBytesPerFile + 1);
    big.set(jpegBytes(), 0);
    const r = validateAttachment({
      filename: 'big.jpg',
      declaredMime: 'image/jpeg',
      bytes: big,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('attachment-too-large');
  });
  it('rejects when declared MIME does not match magic bytes', () => {
    const r = validateAttachment({
      filename: 'sneaky.png',
      declaredMime: 'image/png',
      bytes: jpegBytes(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('mime-spoof');
  });
  it('sanitises path-traversal filename even on accepted bytes', () => {
    const r = validateAttachment({
      filename: '../../etc/passwd.jpg',
      declaredMime: 'image/jpeg',
      bytes: jpegBytes(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sanitisedFilename).not.toContain('..');
      expect(r.sanitisedFilename).not.toContain('/');
    }
  });
});

describe('ALLOWED_MIME_TYPES — closed-set discipline', () => {
  it('does not allow SVG', () => {
    expect((ALLOWED_MIME_TYPES as readonly string[]).includes('image/svg+xml')).toBe(false);
  });
  it('does not allow GIF', () => {
    expect((ALLOWED_MIME_TYPES as readonly string[]).includes('image/gif')).toBe(false);
  });
  it('does not allow HTML', () => {
    expect((ALLOWED_MIME_TYPES as readonly string[]).includes('text/html')).toBe(false);
  });
  it('does not allow archives', () => {
    expect((ALLOWED_MIME_TYPES as readonly string[]).includes('application/zip')).toBe(false);
    expect((ALLOWED_MIME_TYPES as readonly string[]).includes('application/x-rar-compressed')).toBe(
      false,
    );
  });
});
