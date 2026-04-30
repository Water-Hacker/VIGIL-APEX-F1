/**
 * AUDIT-041 — server insecure-mode guard.
 *
 * Two layers:
 *   (a) tlsCertPath/tlsKeyPath unset AND VIGIL_FEDERATION_INSECURE_OK
 *       != 'true' → refuse to start (pre-existing).
 *   (b) tlsCertPath/tlsKeyPath unset AND VIGIL_FEDERATION_INSECURE_OK
 *       == 'true' AND NODE_ENV === 'production' → refuse to start
 *       (AUDIT-041, the gap this finding closed).
 *
 * The opt-in is for in-process tests + the local dev compose stack.
 * Running federation-stream in production over plaintext gRPC is
 * never legitimate.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FederationStreamServer } from './server';

import type { KeyResolver } from './verify';

const STUB_KEY_RESOLVER: KeyResolver = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  resolve(_keyId, _region) {
    return null;
  },
};

function makeServer() {
  return new FederationStreamServer({
    listenAddress: '127.0.0.1:0',
    keyResolver: STUB_KEY_RESOLVER,
    handlers: {
      onAccepted: async () => {},
    },
    policy: { maxFutureSkewMs: 60_000, maxPastAgeMs: 5 * 60_000, requiredRegions: [] },
    // tlsCertPath / tlsKeyPath intentionally omitted → exercises the
    // insecure-mode branch.
  });
}

describe('AUDIT-041 — FederationStreamServer.start refuses insecure binding in production', () => {
  const ORIG_INSECURE_OK = process.env.VIGIL_FEDERATION_INSECURE_OK;
  const ORIG_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.VIGIL_FEDERATION_INSECURE_OK;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    if (ORIG_INSECURE_OK === undefined) delete process.env.VIGIL_FEDERATION_INSECURE_OK;
    else process.env.VIGIL_FEDERATION_INSECURE_OK = ORIG_INSECURE_OK;
    if (ORIG_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIG_NODE_ENV;
  });

  it('throws when neither TLS paths nor the insecure-OK opt-in are provided (pre-existing layer)', async () => {
    await expect(makeServer().start()).rejects.toThrow(/refusing to start without TLS/);
  });

  it('throws in production even when VIGIL_FEDERATION_INSECURE_OK=true is set (AUDIT-041)', async () => {
    process.env.VIGIL_FEDERATION_INSECURE_OK = 'true';
    process.env.NODE_ENV = 'production';
    await expect(makeServer().start()).rejects.toThrow(/forbidden when NODE_ENV=production/);
  });

  it('throws in production when the opt-in is unset (single-error branch trumps prod-branch)', async () => {
    process.env.NODE_ENV = 'production';
    await expect(makeServer().start()).rejects.toThrow(/refusing to start without TLS/);
  });

  it('does NOT throw on dev/test envs when the opt-in is set (the legitimate dev path remains)', async () => {
    process.env.VIGIL_FEDERATION_INSECURE_OK = 'true';
    process.env.NODE_ENV = 'test';
    const srv = makeServer();
    // Bind happens against 127.0.0.1:0 → real port, but we tear it down
    // immediately. We only assert the guard does not throw.
    await srv.start();
    await srv.stop(0);
  });
});
