/**
 * AUDIT-028 — Postgres TLS verify-full enforcement.
 *
 * The pool sets `ssl = { rejectUnauthorized: false }` when `sslMode === 'require'`.
 * That's encrypted-but-unauthenticated TLS — a passive on-path attacker can
 * MitM the connection. Production should always be `verify-full`. We refuse
 * `require` mode at startup unless an explicit sentinel env
 * `POSTGRES_REQUIRE_INSECURE_OK=1` is set, and log a banner.
 *
 * The Pool constructor in `pg` is lazy: it doesn't dial until a query runs.
 * So these tests construct the pool, assert behaviour, and immediately end()
 * without a live database.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPool } from '../src/client.js';

let savedSslMode: string | undefined;
let savedSslRootCert: string | undefined;
let savedRequireInsecureOk: string | undefined;
let savedPostgresUrl: string | undefined;

beforeEach(() => {
  savedSslMode = process.env.POSTGRES_SSLMODE;
  savedSslRootCert = process.env.POSTGRES_SSLROOTCERT;
  savedRequireInsecureOk = process.env.POSTGRES_REQUIRE_INSECURE_OK;
  savedPostgresUrl = process.env.POSTGRES_URL;
  // Avoid the singleton path in this test file
  delete process.env.POSTGRES_SSLMODE;
  delete process.env.POSTGRES_SSLROOTCERT;
  delete process.env.POSTGRES_REQUIRE_INSECURE_OK;
});

afterEach(() => {
  if (savedSslMode === undefined) delete process.env.POSTGRES_SSLMODE;
  else process.env.POSTGRES_SSLMODE = savedSslMode;
  if (savedSslRootCert === undefined) delete process.env.POSTGRES_SSLROOTCERT;
  else process.env.POSTGRES_SSLROOTCERT = savedSslRootCert;
  if (savedRequireInsecureOk === undefined) delete process.env.POSTGRES_REQUIRE_INSECURE_OK;
  else process.env.POSTGRES_REQUIRE_INSECURE_OK = savedRequireInsecureOk;
  if (savedPostgresUrl === undefined) delete process.env.POSTGRES_URL;
  else process.env.POSTGRES_URL = savedPostgresUrl;
});

describe('AUDIT-028 — sslMode = require requires explicit sentinel', () => {
  it('refuses sslMode=require without POSTGRES_REQUIRE_INSECURE_OK', async () => {
    await expect(
      createPool({ sslMode: 'require', host: '127.0.0.1', port: 1, database: 't', user: 't' }),
    ).rejects.toThrow(/POSTGRES_REQUIRE_INSECURE_OK/);
  });

  it('refuses POSTGRES_SSLMODE=require env without the sentinel too', async () => {
    process.env.POSTGRES_SSLMODE = 'require';
    await expect(
      createPool({ host: '127.0.0.1', port: 1, database: 't', user: 't' }),
    ).rejects.toThrow(/POSTGRES_REQUIRE_INSECURE_OK/);
  });

  it('accepts sslMode=require WITH POSTGRES_REQUIRE_INSECURE_OK=1', async () => {
    process.env.POSTGRES_REQUIRE_INSECURE_OK = '1';
    const pool = await createPool({
      sslMode: 'require',
      host: '127.0.0.1',
      port: 1,
      database: 't',
      user: 't',
    });
    try {
      // The pg Pool stores the original config under `options`; on some
      // versions of pg the field is private. We just check construction
      // succeeded.
      expect(pool).toBeDefined();
    } finally {
      await pool.end();
    }
  });

  it('rejects sentinel values that are not exactly "1" / "true" (typo guard)', async () => {
    process.env.POSTGRES_REQUIRE_INSECURE_OK = 'yes-please'; // unrecognised
    await expect(
      createPool({ sslMode: 'require', host: '127.0.0.1', port: 1, database: 't', user: 't' }),
    ).rejects.toThrow(/POSTGRES_REQUIRE_INSECURE_OK/);
  });

  it('accepts the documented sentinel "true"', async () => {
    process.env.POSTGRES_REQUIRE_INSECURE_OK = 'true';
    const pool = await createPool({
      sslMode: 'require',
      host: '127.0.0.1',
      port: 1,
      database: 't',
      user: 't',
    });
    await pool.end();
    expect(true).toBe(true);
  });
});

describe('AUDIT-028 — verify-full and disable modes are unaffected', () => {
  it('verify-full still requires the root cert path (existing behaviour)', async () => {
    await expect(
      createPool({
        sslMode: 'verify-full',
        host: '127.0.0.1',
        port: 1,
        database: 't',
        user: 't',
      }),
    ).rejects.toThrow(/POSTGRES_SSLROOTCERT/);
  });

  it('verify-full with a valid CA file path succeeds at construction', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vigil-tls-test-'));
    const ca = path.join(dir, 'ca.pem');
    writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n');
    try {
      const pool = await createPool({
        sslMode: 'verify-full',
        sslRootCertPath: ca,
        host: '127.0.0.1',
        port: 1,
        database: 't',
        user: 't',
      });
      await pool.end();
      expect(true).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('disable mode requires no sentinel and constructs cleanly', async () => {
    const pool = await createPool({
      sslMode: 'disable',
      host: '127.0.0.1',
      port: 1,
      database: 't',
      user: 't',
    });
    await pool.end();
    expect(true).toBe(true);
  });

  it('no sslMode (default) requires no sentinel and constructs cleanly', async () => {
    const pool = await createPool({
      host: '127.0.0.1',
      port: 1,
      database: 't',
      user: 't',
    });
    await pool.end();
    expect(true).toBe(true);
  });
});
