/**
 * Tier-6 adapter audit — first-contact archive hardening.
 *
 * Three closures pinned here:
 *
 *   1. Path-traversal validation: dumpFirstContactHtml refuses any
 *      sourceId that isn't strict kebab-case-with-digits. Pre-fix, a
 *      future refactor that derived sourceId from config could have
 *      shipped `../../etc/passwd`-style escapes outside ARCHIVE_ROOT.
 *
 *   2. Size cap: HTML payloads above 8 MB and reason payloads above
 *      64 KB are clamped before write. Pre-fix, a source returning a
 *      multi-GB body could fill the host disk on a single parse-
 *      failure cycle.
 *
 *   3. Atomic write: the HTML file is written via tmp+rename. Pre-fix,
 *      a crash mid-writeFile could leave a half-truncated archive
 *      that the W-19 selector-repair worker would mis-diagnose.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FIRST_CONTACT_HTML_MAX_BYTES,
  FIRST_CONTACT_REASON_MAX_BYTES,
  dumpFirstContactHtml,
} from '../src/first-contact.js';

let archiveRoot: string;
const ORIGINAL_ENV = process.env.ADAPTER_FIRST_CONTACT_ARCHIVE;

beforeEach(async () => {
  archiveRoot = await mkdtemp(join(tmpdir(), 'first-contact-test-'));
  process.env.ADAPTER_FIRST_CONTACT_ARCHIVE = archiveRoot;
});

afterEach(async () => {
  await rm(archiveRoot, { recursive: true, force: true });
  if (ORIGINAL_ENV === undefined) delete process.env.ADAPTER_FIRST_CONTACT_ARCHIVE;
  else process.env.ADAPTER_FIRST_CONTACT_ARCHIVE = ORIGINAL_ENV;
});

describe('dumpFirstContactHtml — sourceId path-traversal validation', () => {
  it('writes when sourceId is kebab-case-with-digits', async () => {
    const file = await dumpFirstContactHtml('minfi-portal', '<html>...</html>', 'parse failure');
    expect(file).toContain('minfi-portal');
    const html = await readFile(file, 'utf8');
    expect(html).toBe('<html>...</html>');
  });

  it('rejects sourceId with `..` path-traversal', async () => {
    await expect(dumpFirstContactHtml('../etc/passwd', '<html/>', 'parse failure')).rejects.toThrow(
      /sourceId.*outside \[a-z0-9-\]/,
    );
  });

  it('rejects sourceId with absolute-path separators', async () => {
    await expect(dumpFirstContactHtml('/abs/path', '<html/>', 'parse failure')).rejects.toThrow(
      /sourceId.*outside \[a-z0-9-\]/,
    );
  });

  it('rejects uppercase / underscore / dot variants', async () => {
    await expect(dumpFirstContactHtml('MinFi-Portal', '<html/>', 'r')).rejects.toThrow();
    await expect(dumpFirstContactHtml('minfi_portal', '<html/>', 'r')).rejects.toThrow();
    await expect(dumpFirstContactHtml('minfi.portal', '<html/>', 'r')).rejects.toThrow();
  });

  it('rejects empty sourceId', async () => {
    await expect(dumpFirstContactHtml('', '<html/>', 'r')).rejects.toThrow();
  });

  it('rejects sourceId starting with hyphen (must start with [a-z0-9])', async () => {
    await expect(dumpFirstContactHtml('-bad', '<html/>', 'r')).rejects.toThrow();
  });
});

describe('dumpFirstContactHtml — payload size caps', () => {
  it('writes a small HTML body unchanged', async () => {
    const small = '<html>hi</html>';
    const file = await dumpFirstContactHtml('test-source', small, 'r');
    expect(await readFile(file, 'utf8')).toBe(small);
  });

  it('clamps an oversized HTML body at FIRST_CONTACT_HTML_MAX_BYTES', async () => {
    // 16 MB > 8 MB cap → must be truncated with the marker appended.
    const oversized = 'x'.repeat(16 * 1024 * 1024);
    const file = await dumpFirstContactHtml('test-source', oversized, 'r');
    const written = await readFile(file, 'utf8');
    // The cap is in BYTES; ASCII chars are 1 byte each so 8 MB chars
    // pre-marker, plus the marker.
    expect(written.length).toBeLessThanOrEqual(FIRST_CONTACT_HTML_MAX_BYTES + 100);
    expect(written.endsWith('<<<TRUNCATED>>>')).toBe(true);
  });

  it('clamps an oversized reason string', async () => {
    const oversizedReason = 'y'.repeat(200 * 1024);
    const file = await dumpFirstContactHtml('test-source', '<html/>', oversizedReason);
    const reason = await readFile(`${file}.reason.txt`, 'utf8');
    expect(reason.length).toBeLessThanOrEqual(FIRST_CONTACT_REASON_MAX_BYTES + 100);
    expect(reason.endsWith('<<<TRUNCATED>>>')).toBe(true);
  });
});

describe('dumpFirstContactHtml — atomic write', () => {
  it('does not leave any .tmp.* artefacts after a successful write', async () => {
    await dumpFirstContactHtml('test-source', '<html>...</html>', 'r');
    const dir = join(archiveRoot, 'test-source');
    const entries = await readdir(dir);
    expect(entries.filter((e) => e.includes('.tmp.'))).toEqual([]);
  });

  it('emits both the .html and the .reason.txt files', async () => {
    await dumpFirstContactHtml('test-source', '<html>...</html>', 'parse failure');
    const dir = join(archiveRoot, 'test-source');
    const entries = await readdir(dir);
    expect(entries.filter((e) => e.endsWith('.html'))).toHaveLength(1);
    expect(entries.filter((e) => e.endsWith('.reason.txt'))).toHaveLength(1);
  });
});
