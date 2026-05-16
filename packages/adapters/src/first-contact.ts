import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createLogger, type Logger } from '@vigil/observability';
import { Errors } from '@vigil/shared';

/**
 * First-contact protocol (SRD §10.5; BUILD-V2 §43).
 *
 * On first run, an adapter that fails to parse rows MUST save the live HTML
 * to /infra/sites/<id>/<timestamp>.html and notify the architect. It MUST NOT
 * silently update its own selectors. The W-19 selector-repair worker reads
 * these archives and proposes selector updates via PR.
 *
 * Tier-6 adapter audit hardening:
 *   - sourceId is validated to refuse path-traversal segments (.., /).
 *     The `sourceId` is set by each adapter's constructor as a string
 *     literal, but a future refactor that derives it from config would
 *     otherwise be one typo away from writing outside ARCHIVE_ROOT.
 *   - HTML and reason payloads are capped before write so a source
 *     that returns a multi-GB body cannot fill the host's disk via a
 *     single parse-failure cycle.
 *   - The HTML file is written atomically (tmp + rename) so a crash
 *     mid-write doesn't leave a half-truncated archive that the
 *     selector-repair worker would then mis-diagnose.
 */

function archiveRoot(): string {
  // Read at call-time, not module-load, so the archive root can be
  // redirected per-test or rotated at runtime without a re-import.
  return process.env.ADAPTER_FIRST_CONTACT_ARCHIVE ?? '/infra/sites';
}

// Adapter ids are kebab-case-with-digits-only by repo convention; this
// regex is intentionally strict so a malformed id throws rather than
// silently escaping ARCHIVE_ROOT via `../`.
const SAFE_SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Cap each component. 8 MB covers any realistic regulator page; a
// source returning much more is either compromised or returning
// binary garbage — neither is useful for selector repair.
export const FIRST_CONTACT_HTML_MAX_BYTES = 8 * 1024 * 1024;
export const FIRST_CONTACT_REASON_MAX_BYTES = 64 * 1024;

function clamp(s: string, maxBytes: number): string {
  // UTF-8 byte length; truncate at the byte boundary closest to the cap.
  // Avoid TextEncoder/Decoder roundtrip cost on the common-case clean
  // path by short-circuiting when the string is well under the cap.
  if (s.length <= maxBytes / 4) return s; // ASCII-or-similar shortcut
  const buf = Buffer.from(s, 'utf8');
  if (buf.byteLength <= maxBytes) return s;
  // Decoding a truncated buffer at the byte level can split a multi-byte
  // codepoint; Node's Buffer.toString silently replaces with U+FFFD,
  // which is fine for diagnostic archive material.
  return buf.subarray(0, maxBytes).toString('utf8') + '\n<<<TRUNCATED>>>';
}

export async function dumpFirstContactHtml(
  sourceId: string,
  html: string,
  reason: string,
  logger?: Logger,
): Promise<string> {
  if (!SAFE_SOURCE_ID.test(sourceId)) {
    throw new Errors.VigilError({
      code: 'ADAPTER_FIRST_CONTACT_BAD_SOURCE_ID',
      message: `sourceId ${JSON.stringify(sourceId)} contains chars outside [a-z0-9-]`,
      severity: 'error',
    });
  }
  const log = logger ?? createLogger({ service: `first-contact:${sourceId}` });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(archiveRoot(), sourceId);
  await mkdir(dir, { recursive: true });

  const cappedHtml = clamp(html, FIRST_CONTACT_HTML_MAX_BYTES);
  const cappedReason = clamp(reason, FIRST_CONTACT_REASON_MAX_BYTES);

  const file = path.join(dir, `${ts}.html`);
  // Atomic write: a partial archive that the selector-repair worker
  // mis-diagnoses is worse than no archive at all. tmp+rename means a
  // crash mid-write leaves the tmp file but never a half-written
  // canonical archive. Per-PID suffix prevents two concurrent dumps
  // from clobbering each other's tmp file.
  const tmp = `${file}.tmp.${process.pid}`;
  await writeFile(tmp, cappedHtml, 'utf8');
  await rename(tmp, file);
  await writeFile(`${file}.reason.txt`, cappedReason, 'utf8');

  log.warn(
    {
      file,
      sourceId,
      html_bytes: Buffer.byteLength(cappedHtml, 'utf8'),
      html_truncated: cappedHtml.length !== html.length,
      reason_truncated: cappedReason.length !== reason.length,
    },
    'first-contact-archive-written',
  );
  return file;
}
