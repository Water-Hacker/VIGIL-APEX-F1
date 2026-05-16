import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLogger, type Logger } from '@vigil/observability';
import { Errors } from '@vigil/shared';

/**
 * GPG signing — invokes `gpg --detach-sign --armor` against the architect's
 * YubiKey-resident OpenPGP key (HSK §4.5).
 *
 * The host's `gpg-agent` mediates YubiKey access; this process never touches
 * the private key. A signing prompt may appear on the architect's desktop
 * notification system (HSK §6.6 dossier-signing workflow).
 */
export interface GpgSignOptions {
  readonly fingerprint: string;
  readonly logger?: Logger;
  readonly gpgBinary?: string;
}

export async function gpgDetachSign(pdfBytes: Buffer, opts: GpgSignOptions): Promise<Buffer> {
  const logger = opts.logger ?? createLogger({ service: 'dossier-sign' });
  const gpg = opts.gpgBinary ?? 'gpg';
  // Tier-35 audit closure: replace the predictable
  // `vigil-dossier-${pid}-${ts}.pdf` filename with a crypto-random
  // suffix. The previous shape was guessable enough that an attacker
  // with write access to /tmp (rare, but possible on shared hosts or
  // misconfigured systemd units) could pre-create a symlink at that
  // path and have the dossier worker overwrite the symlink's target
  // when it called writeFile.
  const tmp = path.join(tmpdir(), `vigil-dossier-${randomBytes(16).toString('hex')}.pdf`);
  await writeFile(tmp, pdfBytes, { mode: 0o600 });
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const args = [
        '--batch',
        '--yes',
        '--armor',
        '--detach-sign',
        '--local-user',
        opts.fingerprint,
        '--output',
        '-',
        tmp,
      ];
      const child = spawn(gpg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on('data', (c) => out.push(c));
      child.stderr.on('data', (c) => err.push(c));
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        if (code !== 0) {
          // Tier-35 audit closure: normalise the failure log to the
          // err_name / err_message convention used elsewhere. Truncate
          // stderr to 500 chars to bound the log line size.
          const stderrStr = Buffer.concat(err).toString('utf8').slice(0, 500);
          logger.error(
            {
              err_name: 'DOSSIER_GPG_SIGN_FAILED',
              err_message: `gpg exited ${code}`,
              stderr: stderrStr,
            },
            'gpg-failed',
          );
          reject(
            new Errors.VigilError({
              code: 'DOSSIER_GPG_SIGN_FAILED',
              message: `gpg exited ${code}: ${stderrStr}`,
              severity: 'fatal',
            }),
          );
          return;
        }
        resolve(Buffer.concat(out));
      });
    });
  } finally {
    // Tier-35 audit closure: actually unlink the tmp file. Pre-fix the
    // `finally` was a no-op with a "best-effort" comment; in long-
    // running workers (worker-dossier processes thousands of dossiers
    // per day) the leak accumulated mode-0600 PDFs in /tmp until the
    // filesystem filled. The unlink is itself best-effort (logged
    // on failure) so a cleanup error doesn't mask the original
    // GPG outcome.
    try {
      await unlink(tmp);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.warn(
        { err_name: err.name, err_message: err.message, tmp },
        'dossier-tmp-unlink-failed',
      );
    }
  }
}
