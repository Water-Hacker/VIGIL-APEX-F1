/**
 * T8.4 of TODO.md sweep — extract the MINFI MTLS-material loader to a
 * focused module so tests can pin its contract without importing
 * src/index.ts (which calls process.exit(1) at the bottom on failed
 * boot, polluting vitest with an unhandled rejection).
 *
 * Reproduces the original loader behaviour verbatim:
 *   - reads cert/key/ca paths from MINFI_API_TLS_{CERT,KEY,CA} env
 *     with /run/secrets/minfi_tls_{cert,key,ca} fallbacks
 *   - throws a descriptive error naming the offending env-var if any
 *     of the three files is missing (per the MINFI_API_MTLS=1 boot
 *     contract)
 *   - returns the cert/key/ca buffers + the strict mutual-TLS flags
 *
 * The fs primitives are injectable so the test exercises every
 * branch without writing a real cert to disk.
 */
import { existsSync as defaultExistsSync, readFileSync as defaultReadFileSync } from 'node:fs';

export interface MinfiMtlsMaterial {
  readonly cert: Buffer;
  readonly key: Buffer;
  readonly ca: Buffer;
  readonly requestCert: true;
  readonly rejectUnauthorized: true;
}

export interface MinfiMtlsLoaderDeps {
  /** Defaults to process.env */
  readonly env?: NodeJS.ProcessEnv;
  /** Defaults to node:fs existsSync — overridable for tests */
  readonly existsSync?: (p: string) => boolean;
  /** Defaults to node:fs readFileSync — overridable for tests */
  readonly readFileSync?: (p: string) => Buffer;
}

export function loadMinfiMtls(deps: MinfiMtlsLoaderDeps = {}): MinfiMtlsMaterial {
  const env = deps.env ?? process.env;
  const exists = deps.existsSync ?? defaultExistsSync;
  const read = deps.readFileSync ?? ((p: string): Buffer => defaultReadFileSync(p));

  const certPath = env.MINFI_API_TLS_CERT ?? '/run/secrets/minfi_tls_cert';
  const keyPath = env.MINFI_API_TLS_KEY ?? '/run/secrets/minfi_tls_key';
  const caPath = env.MINFI_API_TLS_CA ?? '/run/secrets/minfi_tls_ca';
  const triplet: ReadonlyArray<readonly [string, string]> = [
    ['MINFI_API_TLS_CERT', certPath],
    ['MINFI_API_TLS_KEY', keyPath],
    ['MINFI_API_TLS_CA', caPath],
  ];
  for (const [name, p] of triplet) {
    if (!exists(p)) {
      throw new Error(
        `MINFI_API_MTLS=1 but ${name} (${p}) does not exist or is unreadable; refusing to start worker-minfi-api`,
      );
    }
  }
  return {
    cert: read(certPath),
    key: read(keyPath),
    ca: read(caPath),
    requestCert: true,
    rejectUnauthorized: true,
  };
}
