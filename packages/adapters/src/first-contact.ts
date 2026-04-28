import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createLogger, type Logger } from '@vigil/observability';

/**
 * First-contact protocol (SRD §10.5; BUILD-V2 §43).
 *
 * On first run, an adapter that fails to parse rows MUST save the live HTML
 * to /infra/sites/<id>/<timestamp>.html and notify the architect. It MUST NOT
 * silently update its own selectors. The W-19 selector-repair worker reads
 * these archives and proposes selector updates via PR.
 */

const ARCHIVE_ROOT = process.env.ADAPTER_FIRST_CONTACT_ARCHIVE ?? '/infra/sites';

export async function dumpFirstContactHtml(
  sourceId: string,
  html: string,
  reason: string,
  logger?: Logger,
): Promise<string> {
  const log = logger ?? createLogger({ service: `first-contact:${sourceId}` });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(ARCHIVE_ROOT, sourceId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${ts}.html`);
  await writeFile(file, html, 'utf8');
  await writeFile(`${file}.reason.txt`, reason, 'utf8');
  log.warn({ file, sourceId }, 'first-contact-archive-written');
  return file;
}
