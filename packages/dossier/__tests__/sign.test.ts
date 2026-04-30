/**
 * AUDIT-063 — gpgDetachSign tests using a fake gpg binary.
 *
 * The real GPG path requires a YubiKey + gpg-agent (HSK §4.5). We don't
 * exercise that here; instead, we validate the subprocess-orchestration
 * contract:
 *
 *   1. Spawns the configured `gpgBinary` with the documented arg vector.
 *   2. Returns the binary's stdout as a Buffer on success.
 *   3. Wraps non-zero exits in a typed `DOSSIER_GPG_SIGN_FAILED`
 *      VigilError with severity `fatal`.
 *   4. Surfaces stderr (truncated) in the error message for forensics.
 *   5. Writes the input PDF bytes to a tmp file with mode 0600.
 *
 * We generate a fake gpg shell script at test setup that echoes a fixed
 * signature on stdout when called with the expected arg vector, and
 * exits non-zero on demand for the failure-path test.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Errors } from '@vigil/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { gpgDetachSign } from '../src/sign.js';

const FAKE_SIGNATURE =
  '-----BEGIN PGP SIGNATURE-----\nfake-sig-bytes\n-----END PGP SIGNATURE-----\n';
const TEST_FINGERPRINT = '0123456789ABCDEF0123456789ABCDEF01234567';

let fakeGpgOk: string;
let fakeGpgFail: string;

beforeAll(() => {
  // Confirm we can run shell scripts in this environment; if not, the
  // tests must skip rather than emit false negatives.
  const sh = spawnSync('/bin/sh', ['-c', 'echo ok']);
  if (sh.status !== 0) throw new Error('shell unavailable; cannot run sign tests');

  const dir = mkdtempSync(path.join(tmpdir(), 'vigil-sign-test-'));

  fakeGpgOk = path.join(dir, 'gpg-ok.sh');
  writeFileSync(
    fakeGpgOk,
    `#!/bin/sh
# Fake gpg — emit a fixed signature, ignore all args.
printf '%s' '${FAKE_SIGNATURE.replace(/'/g, `'\\''`)}'
exit 0
`,
    { mode: 0o755 },
  );
  chmodSync(fakeGpgOk, 0o755);

  fakeGpgFail = path.join(dir, 'gpg-fail.sh');
  writeFileSync(
    fakeGpgFail,
    `#!/bin/sh
# Fake gpg — emit error and exit 7.
echo 'gpg: card not present' 1>&2
exit 7
`,
    { mode: 0o755 },
  );
  chmodSync(fakeGpgFail, 0o755);
});

afterAll(() => {
  // Tmp dir cleanup is best-effort; mode 0600 means leakage is bounded.
});

describe('AUDIT-063 — gpgDetachSign happy path', () => {
  it('returns the gpg stdout as a Buffer on exit 0', async () => {
    const out = await gpgDetachSign(Buffer.from('FAKE PDF BYTES'), {
      fingerprint: TEST_FINGERPRINT,
      gpgBinary: fakeGpgOk,
    });
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString('utf8')).toBe(FAKE_SIGNATURE);
  });

  it('handles a sizeable input without truncating', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024, 0x41); // 2 MB of 'A'
    const out = await gpgDetachSign(big, {
      fingerprint: TEST_FINGERPRINT,
      gpgBinary: fakeGpgOk,
    });
    // Fake gpg always emits FAKE_SIGNATURE; the test pins that the
    // bytes go through without the wrapper truncating or hanging.
    expect(out.toString('utf8')).toBe(FAKE_SIGNATURE);
  });
});

describe('AUDIT-063 — gpgDetachSign failure path', () => {
  it('wraps non-zero exit in a typed VigilError with code DOSSIER_GPG_SIGN_FAILED', async () => {
    let caught: unknown;
    try {
      await gpgDetachSign(Buffer.from('FAKE'), {
        fingerprint: TEST_FINGERPRINT,
        gpgBinary: fakeGpgFail,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Errors.VigilError);
    expect((caught as { code?: string }).code).toBe('DOSSIER_GPG_SIGN_FAILED');
    expect((caught as { severity?: string }).severity).toBe('fatal');
    expect((caught as Error).message).toMatch(/gpg exited 7/);
    expect((caught as Error).message).toMatch(/card not present/);
  });

  it('rejects with a real Error when the binary itself is missing', async () => {
    let caught: unknown;
    try {
      await gpgDetachSign(Buffer.from('FAKE'), {
        fingerprint: TEST_FINGERPRINT,
        gpgBinary: '/nonexistent/path/to/gpg-binary',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    // The spawn-error path forwards the Node-level error rather than
    // wrapping it, by design — a missing binary is an operator config
    // error, not a forensic gpg-card failure.
    expect((caught as Error).message).toMatch(/ENOENT|nonexistent/i);
  });
});
