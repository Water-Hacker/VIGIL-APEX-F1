/**
 * T8.4 of TODO.md sweep — pin the MINFI MTLS loader contract.
 *
 * Before T8.4, the loader was an internal helper inside src/index.ts;
 * the worker would refuse to boot if the three cert files were missing
 * but the contract had no test, so a refactor (e.g. swapping the
 * `/run/secrets/` fallback paths or dropping the per-var error) would
 * silently regress.
 *
 * The loader's defensive shape:
 *   - reads MINFI_API_TLS_{CERT,KEY,CA} env with /run/secrets fallbacks
 *   - throws with the offending env-var NAME in the message (operator
 *     can pinpoint which file is missing)
 *   - succeeds only when all three files exist
 *   - returns strict requestCert + rejectUnauthorized for mTLS
 *
 * Tests inject fake `existsSync` + `readFileSync` so nothing touches
 * the filesystem.
 */
import { describe, expect, it } from 'vitest';

import { loadMinfiMtls } from '../src/mtls-loader.js';

const ALL_EXIST = (): boolean => true;
const NONE_EXIST = (): boolean => false;
const FAKE_READ = (p: string): Buffer => Buffer.from(`bytes-of:${p}`);

describe('loadMinfiMtls — happy path', () => {
  it('returns the three buffers + strict mTLS flags when all files exist', () => {
    const result = loadMinfiMtls({
      env: {
        MINFI_API_TLS_CERT: '/etc/vigil/minfi/cert.pem',
        MINFI_API_TLS_KEY: '/etc/vigil/minfi/key.pem',
        MINFI_API_TLS_CA: '/etc/vigil/minfi/ca.pem',
      },
      existsSync: ALL_EXIST,
      readFileSync: FAKE_READ,
    });
    expect(result.cert.toString()).toBe('bytes-of:/etc/vigil/minfi/cert.pem');
    expect(result.key.toString()).toBe('bytes-of:/etc/vigil/minfi/key.pem');
    expect(result.ca.toString()).toBe('bytes-of:/etc/vigil/minfi/ca.pem');
    expect(result.requestCert).toBe(true);
    expect(result.rejectUnauthorized).toBe(true);
  });

  it('uses the /run/secrets/* default paths when env vars are unset', () => {
    const seenPaths: string[] = [];
    const result = loadMinfiMtls({
      env: {},
      existsSync: (p) => {
        seenPaths.push(p);
        return true;
      },
      readFileSync: FAKE_READ,
    });
    expect(seenPaths).toEqual([
      '/run/secrets/minfi_tls_cert',
      '/run/secrets/minfi_tls_key',
      '/run/secrets/minfi_tls_ca',
    ]);
    expect(result.cert.toString()).toBe('bytes-of:/run/secrets/minfi_tls_cert');
  });
});

describe('loadMinfiMtls — missing-file refusal', () => {
  it('throws naming the cert env-var when the cert path is missing', () => {
    expect(() =>
      loadMinfiMtls({
        env: {
          MINFI_API_TLS_CERT: '/dev/null/missing-cert',
          MINFI_API_TLS_KEY: '/etc/k',
          MINFI_API_TLS_CA: '/etc/ca',
        },
        existsSync: (p) => p !== '/dev/null/missing-cert',
        readFileSync: FAKE_READ,
      }),
    ).toThrow(/MINFI_API_TLS_CERT \(\/dev\/null\/missing-cert\) does not exist/);
  });

  it('throws naming the key env-var when only the key is missing', () => {
    expect(() =>
      loadMinfiMtls({
        env: {
          MINFI_API_TLS_CERT: '/etc/c',
          MINFI_API_TLS_KEY: '/dev/null/missing-key',
          MINFI_API_TLS_CA: '/etc/ca',
        },
        existsSync: (p) => p !== '/dev/null/missing-key',
        readFileSync: FAKE_READ,
      }),
    ).toThrow(/MINFI_API_TLS_KEY \(\/dev\/null\/missing-key\) does not exist/);
  });

  it('throws naming the ca env-var when only the ca is missing', () => {
    expect(() =>
      loadMinfiMtls({
        env: {
          MINFI_API_TLS_CERT: '/etc/c',
          MINFI_API_TLS_KEY: '/etc/k',
          MINFI_API_TLS_CA: '/dev/null/missing-ca',
        },
        existsSync: (p) => p !== '/dev/null/missing-ca',
        readFileSync: FAKE_READ,
      }),
    ).toThrow(/MINFI_API_TLS_CA \(\/dev\/null\/missing-ca\) does not exist/);
  });

  it('throws when ALL three files are missing — names the FIRST offender (cert)', () => {
    // Determinism: the implementation walks (CERT, KEY, CA) in order and
    // throws on the first miss. Operators see one clear cause, not three.
    expect(() =>
      loadMinfiMtls({
        env: {},
        existsSync: NONE_EXIST,
        readFileSync: FAKE_READ,
      }),
    ).toThrow(/MINFI_API_TLS_CERT/);
  });

  it('error message mentions the boot contract MINFI_API_MTLS=1', () => {
    try {
      loadMinfiMtls({
        env: {},
        existsSync: NONE_EXIST,
        readFileSync: FAKE_READ,
      });
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toContain('MINFI_API_MTLS=1');
      expect(msg).toContain('refusing to start worker-minfi-api');
    }
  });
});

describe('loadMinfiMtls — defensive read path', () => {
  it('does not read any file until all three existence checks pass (fail-fast)', () => {
    let readCount = 0;
    expect(() =>
      loadMinfiMtls({
        env: {
          MINFI_API_TLS_CERT: '/etc/c',
          MINFI_API_TLS_KEY: '/etc/k',
          MINFI_API_TLS_CA: '/dev/null/missing-ca',
        },
        existsSync: (p) => p !== '/dev/null/missing-ca',
        readFileSync: (p) => {
          readCount++;
          return Buffer.from(`bytes-of:${p}`);
        },
      }),
    ).toThrow(/MINFI_API_TLS_CA/);
    expect(readCount).toBe(0);
  });
});
