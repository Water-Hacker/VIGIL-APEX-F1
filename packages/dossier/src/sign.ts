import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
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
  const tmp = path.join(tmpdir(), `vigil-dossier-${process.pid}-${Date.now()}.pdf`);
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
          logger.error({ code, stderr: Buffer.concat(err).toString('utf8') }, 'gpg-failed');
          reject(
            new Errors.VigilError({
              code: 'DOSSIER_GPG_SIGN_FAILED',
              message: `gpg exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0, 500)}`,
              severity: 'fatal',
            }),
          );
          return;
        }
        resolve(Buffer.concat(out));
      });
    });
  } finally {
    // Best-effort temp cleanup; not security-critical because tmp is mode 0600
  }
}
