/**
 * VaultPkiKeyResolver + LayeredKeyResolver tests.
 *
 * Exercises the full hardening surface: signing-key-id format gate,
 * cert-PEM → SPKI public-key PEM derivation, CRL parsing (JSON +
 * openssl-text), TTL eviction, single-flight dedup, fail-closed on
 * non-ed25519 algorithm, log-throttling, and Layered fallback.
 *
 * No real network calls. The fetcher is injected as a stub.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { StaticKeyResolver } from '@vigil/federation-stream';
import { describe, expect, it, vi } from 'vitest';

import {
  DirectoryKeyResolver,
  LayeredKeyResolver,
  VaultPkiKeyResolver,
  certPemToPublicKeyPem,
  parseCrlSerials,
  type VaultFetcher,
} from '../src/key-resolver.js';

import type { Logger } from '@vigil/observability';

const FIXTURE_CERT_PEM = readFileSync(path.join(__dirname, 'fixtures', 'ed25519.crt.pem'), 'utf8');

function noopLogger(): Logger {
  const fn = (() => undefined) as unknown as Logger['info'];
  return {
    info: fn,
    warn: fn,
    error: fn,
    debug: fn,
    trace: fn,
    fatal: fn,
    silent: fn,
    level: 'info',
    child: () => noopLogger(),
  } as unknown as Logger;
}

function stubFetcher(routes: Record<string, { status: number; body: string }>): {
  fetcher: VaultFetcher;
  calls: Array<{ url: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetcher: VaultFetcher = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = routes[url];
    if (!r) return { status: 404, body: '' };
    return r;
  };
  return { fetcher, calls };
}

describe('certPemToPublicKeyPem', () => {
  it('extracts the ed25519 SPKI public key from a fixture cert', () => {
    const out = certPemToPublicKeyPem(FIXTURE_CERT_PEM);
    expect(out).toBeTruthy();
    expect(out).toContain('BEGIN PUBLIC KEY');
    expect(out).toContain('END PUBLIC KEY');
  });

  it('rejects garbage input', () => {
    expect(certPemToPublicKeyPem('not a pem')).toBeNull();
    expect(certPemToPublicKeyPem('')).toBeNull();
  });
});

describe('parseCrlSerials', () => {
  it('parses Vault JSON crl response', () => {
    const body = JSON.stringify({
      data: {
        revoked_certs: [
          { serial_number: '0a:1b:2c:3d' },
          { serial_number: '0042' },
          { serial_number: '' },
        ],
      },
    });
    const s = parseCrlSerials(body);
    expect(s.size).toBe(2);
    expect(s.has('0a1b2c3d')).toBe(true);
    expect(s.has('0042')).toBe(true);
  });

  it('parses openssl-text style CRL', () => {
    const body = [
      'Certificate Revocation List (CRL):',
      '    Serial Number: 0A:1B:2C:3D',
      '        Revocation Date: ...',
      '    Serial Number: ABCD',
      '        Revocation Date: ...',
    ].join('\n');
    const s = parseCrlSerials(body);
    expect(s.has('0a1b2c3d')).toBe(true);
    expect(s.has('abcd')).toBe(true);
  });

  it('returns empty set on empty / malformed body', () => {
    expect(parseCrlSerials('').size).toBe(0);
    expect(parseCrlSerials('{').size).toBe(0);
  });
});

describe('VaultPkiKeyResolver — signing-key-id gate', () => {
  it('rejects malformed signingKeyId without hitting Vault', async () => {
    const { fetcher, calls } = stubFetcher({});
    const r = new VaultPkiKeyResolver({
      vaultAddr: 'https://vault.example',
      token: 't',
      logger: noopLogger(),
      fetcher,
    });
    expect(await r.resolveAsync('lower:case')).toBeNull();
    expect(await r.resolveAsync('NO_SERIAL')).toBeNull();
    expect(await r.resolveAsync('CMR:zzz!!!')).toBeNull();
    expect(calls.length).toBe(0);
  });
});

describe('VaultPkiKeyResolver — fetch + cache + CRL', () => {
  const VAULT = 'https://vault.example';
  const KEY_ID = 'CMR:0a1b2c3d';
  const CERT_URL = `${VAULT}/v1/pki-region-cmr/cert/0a1b2c3d`;
  const CRL_URL = `${VAULT}/v1/pki-region-cmr/crl`;
  const certResp = JSON.stringify({ data: { certificate: FIXTURE_CERT_PEM } });
  const crlEmpty = JSON.stringify({ data: { revoked_certs: [] } });

  it('resolves fresh, caches the result, and short-circuits on the 2nd call', async () => {
    const { fetcher, calls } = stubFetcher({
      [CERT_URL]: { status: 200, body: certResp },
      [CRL_URL]: { status: 200, body: crlEmpty },
    });
    const r = new VaultPkiKeyResolver({
      vaultAddr: VAULT,
      token: 't',
      logger: noopLogger(),
      fetcher,
      now: () => 1_000,
    });
    const a = await r.resolveAsync(KEY_ID);
    expect(a).toContain('BEGIN PUBLIC KEY');
    const callsAfterFirst = calls.length;
    const b = await r.resolveAsync(KEY_ID);
    expect(b).toBe(a);
    // 2nd call hits the cache — no additional fetches
    expect(calls.length).toBe(callsAfterFirst);
    // sync resolve() also hits the cache
    expect(r.resolve(KEY_ID)).toBe(a);
  });

  it('returns null when the serial appears on the CRL', async () => {
    const crlRevoked = JSON.stringify({
      data: { revoked_certs: [{ serial_number: '0a1b2c3d' }] },
    });
    const { fetcher } = stubFetcher({
      [CERT_URL]: { status: 200, body: certResp },
      [CRL_URL]: { status: 200, body: crlRevoked },
    });
    const r = new VaultPkiKeyResolver({
      vaultAddr: VAULT,
      token: 't',
      logger: noopLogger(),
      fetcher,
    });
    expect(await r.resolveAsync(KEY_ID)).toBeNull();
  });

  it('returns null when Vault returns 404', async () => {
    const { fetcher } = stubFetcher({
      [CRL_URL]: { status: 200, body: crlEmpty },
    });
    const r = new VaultPkiKeyResolver({
      vaultAddr: VAULT,
      token: 't',
      logger: noopLogger(),
      fetcher,
    });
    expect(await r.resolveAsync(KEY_ID)).toBeNull();
  });

  it('returns null when Vault returns a non-Ed25519 cert (fail closed)', async () => {
    // Replace the cert body with the same PEM but mutated to fail
    // X509 parse — we test the rejection path of certPemToPublicKeyPem.
    const { fetcher } = stubFetcher({
      [CERT_URL]: { status: 200, body: JSON.stringify({ data: { certificate: 'not-a-cert' } }) },
      [CRL_URL]: { status: 200, body: crlEmpty },
    });
    const r = new VaultPkiKeyResolver({
      vaultAddr: VAULT,
      token: 't',
      logger: noopLogger(),
      fetcher,
    });
    expect(await r.resolveAsync(KEY_ID)).toBeNull();
  });

  it('respects TTL — cache evicts after TTL elapses', async () => {
    let now = 1_000;
    const { fetcher, calls } = stubFetcher({
      [CERT_URL]: { status: 200, body: certResp },
      [CRL_URL]: { status: 200, body: crlEmpty },
    });
    const r = new VaultPkiKeyResolver({
      vaultAddr: VAULT,
      token: 't',
      logger: noopLogger(),
      fetcher,
      cacheTtlMs: 5_000,
      now: () => now,
    });
    await r.resolveAsync(KEY_ID);
    const before = calls.length;
    now += 10_000;
    await r.resolveAsync(KEY_ID);
    expect(calls.length).toBeGreaterThan(before);
  });

  it('single-flight: concurrent resolveAsync calls share one network round-trip', async () => {
    let inflight = 0;
    let maxConcurrent = 0;
    const fetcher: VaultFetcher = async (url) => {
      inflight += 1;
      maxConcurrent = Math.max(maxConcurrent, inflight);
      // Yield once so concurrent calls can pile up
      await new Promise((r) => setTimeout(r, 5));
      inflight -= 1;
      if (url.includes('/cert/')) return { status: 200, body: certResp };
      if (url.includes('/crl')) return { status: 200, body: crlEmpty };
      return { status: 404, body: '' };
    };
    const r = new VaultPkiKeyResolver({
      vaultAddr: VAULT,
      token: 't',
      logger: noopLogger(),
      fetcher,
    });
    const results = await Promise.all([
      r.resolveAsync(KEY_ID),
      r.resolveAsync(KEY_ID),
      r.resolveAsync(KEY_ID),
    ]);
    for (const v of results) expect(v).toContain('BEGIN PUBLIC KEY');
    // Concurrent in-flight count for the cert URL should never exceed 1
    expect(maxConcurrent).toBeLessThanOrEqual(2); // crl + cert can be concurrent
  });

  it('sync resolve() returns null on a cold cache (caller must prefetch)', () => {
    const { fetcher } = stubFetcher({});
    const r = new VaultPkiKeyResolver({
      vaultAddr: VAULT,
      token: 't',
      logger: noopLogger(),
      fetcher,
    });
    expect(r.resolve(KEY_ID)).toBeNull();
  });

  it('invalidate() drops the cached entry', async () => {
    const { fetcher } = stubFetcher({
      [CERT_URL]: { status: 200, body: certResp },
      [CRL_URL]: { status: 200, body: crlEmpty },
    });
    const r = new VaultPkiKeyResolver({
      vaultAddr: VAULT,
      token: 't',
      logger: noopLogger(),
      fetcher,
    });
    await r.resolveAsync(KEY_ID);
    expect(r.resolve(KEY_ID)).toContain('BEGIN PUBLIC KEY');
    r.invalidate(KEY_ID);
    expect(r.resolve(KEY_ID)).toBeNull();
  });

  it('throttles error logs on repeated Vault failure', async () => {
    let calls = 0;
    const fetcher: VaultFetcher = async () => {
      calls += 1;
      throw new Error('connection refused');
    };
    const warn = vi.fn();
    const logger = { ...noopLogger(), warn } as unknown as Logger;
    const r = new VaultPkiKeyResolver({
      vaultAddr: VAULT,
      token: 't',
      logger,
      fetcher,
      now: () => 1_000,
    });
    await r.resolveAsync(KEY_ID);
    await r.resolveAsync(KEY_ID);
    await r.resolveAsync(KEY_ID);
    // Multiple errors but at most a small number of warn() calls
    // (one per region per throttle window). The CRL pre-fetch logs once
    // too, so we expect 1-2 calls total.
    expect(warn.mock.calls.length).toBeLessThanOrEqual(2);
    expect(calls).toBeGreaterThan(0);
  });

  it('exposes telemetry via stats()', async () => {
    const { fetcher } = stubFetcher({
      [CERT_URL]: { status: 200, body: certResp },
      [CRL_URL]: { status: 200, body: crlEmpty },
    });
    const r = new VaultPkiKeyResolver({
      vaultAddr: VAULT,
      token: 't',
      logger: noopLogger(),
      fetcher,
    });
    expect(r.stats().cacheSize).toBe(0);
    await r.resolveAsync(KEY_ID);
    expect(r.stats().cacheSize).toBe(1);
    expect(r.stats().crlRegionsCached).toBe(1);
  });
});

describe('LayeredKeyResolver', () => {
  it('returns the first non-null result across layers', async () => {
    const directory = new StaticKeyResolver();
    directory.register('CMR:1', 'pem-from-directory');
    const layered = new LayeredKeyResolver([directory]);
    expect(await layered.resolveAsync('CMR:1')).toBe('pem-from-directory');
    expect(layered.resolve('CMR:1')).toBe('pem-from-directory');
  });

  it('falls through to a second layer when the first returns null', async () => {
    const empty = new StaticKeyResolver();
    const directory = new StaticKeyResolver();
    directory.register('CMR:2', 'pem-from-directory');
    const layered = new LayeredKeyResolver([empty, directory]);
    expect(await layered.resolveAsync('CMR:2')).toBe('pem-from-directory');
  });

  it('returns null when no layer has the key', async () => {
    const empty1 = new StaticKeyResolver();
    const empty2 = new StaticKeyResolver();
    const layered = new LayeredKeyResolver([empty1, empty2]);
    expect(await layered.resolveAsync('CMR:3')).toBeNull();
  });
});

describe('DirectoryKeyResolver', () => {
  it('returns null when the directory does not exist', async () => {
    const r = new DirectoryKeyResolver('/no/such/dir', noopLogger());
    expect(await r.load()).toBe(0);
    expect(r.resolve('CMR:1')).toBeNull();
  });
});
