import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

import {
  canonicalSigningBytes,
  signEnvelope,
  verifyEnvelope,
} from './sign.js';
import {
  StaticKeyResolver,
  verifyEnvelopeWithPolicy,
} from './verify.js';
import type { EventEnvelope, EventEnvelopeUnsigned } from './types.js';

function ed25519PemPair(): { privatePem: string; publicPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

function envelopeFixture(): EventEnvelopeUnsigned {
  return {
    envelopeId: '01928c66-7e1f-7000-9000-000000000001',
    region: 'CE',
    sourceId: 'minfi-bis-public-feed',
    dedupKey: 'minfi-bis::contract-2026-04-CE-0042',
    payload: Buffer.from('{"contract":"2026-04-CE-0042","amount_xaf":120000000}', 'utf8'),
    observedAtMs: Date.now() - 5_000,
  };
}

describe('canonicalSigningBytes', () => {
  it('is deterministic for identical input', () => {
    const env = envelopeFixture();
    const a = canonicalSigningBytes(env);
    const b = canonicalSigningBytes(env);
    expect(a.equals(b)).toBe(true);
  });

  it('changes when payload changes', () => {
    const env = envelopeFixture();
    const a = canonicalSigningBytes(env);
    const b = canonicalSigningBytes({ ...env, payload: Buffer.from('different', 'utf8') });
    expect(a.equals(b)).toBe(false);
  });

  it('changes when region changes', () => {
    const env = envelopeFixture();
    const a = canonicalSigningBytes(env);
    const b = canonicalSigningBytes({ ...env, region: 'LT' });
    expect(a.equals(b)).toBe(false);
  });
});

describe('signEnvelope / verifyEnvelope', () => {
  it('round-trips with a fresh key', () => {
    const { privatePem, publicPem } = ed25519PemPair();
    const env = envelopeFixture();
    const sig = signEnvelope(env, privatePem);
    expect(verifyEnvelope(env, sig, publicPem)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const { privatePem, publicPem } = ed25519PemPair();
    const env = envelopeFixture();
    const sig = signEnvelope(env, privatePem);
    const tampered: EventEnvelopeUnsigned = {
      ...env,
      payload: Buffer.from('tampered', 'utf8'),
    };
    expect(verifyEnvelope(tampered, sig, publicPem)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const a = ed25519PemPair();
    const b = ed25519PemPair();
    const env = envelopeFixture();
    const sig = signEnvelope(env, a.privatePem);
    expect(verifyEnvelope(env, sig, b.publicPem)).toBe(false);
  });
});

describe('verifyEnvelopeWithPolicy', () => {
  it('accepts a properly signed in-window envelope', async () => {
    const { privatePem, publicPem } = ed25519PemPair();
    const resolver = new StaticKeyResolver();
    resolver.register('CE:1', publicPem);
    const env = envelopeFixture();
    const signed: EventEnvelope = {
      ...env,
      signature: signEnvelope(env, privatePem),
      signingKeyId: 'CE:1',
    };
    const result = await verifyEnvelopeWithPolicy(signed, resolver);
    expect(result.ok).toBe(true);
  });

  it('rejects envelopes whose region does not match the key id prefix', async () => {
    const { privatePem, publicPem } = ed25519PemPair();
    const resolver = new StaticKeyResolver();
    resolver.register('CE:1', publicPem);
    const env: EventEnvelopeUnsigned = { ...envelopeFixture(), region: 'LT' };
    const signed: EventEnvelope = {
      ...env,
      signature: signEnvelope(env, privatePem),
      signingKeyId: 'CE:1', // wrong-region key id
    };
    const result = await verifyEnvelopeWithPolicy(signed, resolver);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('REGION_MISMATCH');
  });

  it('rejects envelopes with an unknown key id', async () => {
    const { privatePem } = ed25519PemPair();
    const resolver = new StaticKeyResolver();
    const env = envelopeFixture();
    const signed: EventEnvelope = {
      ...env,
      signature: signEnvelope(env, privatePem),
      signingKeyId: 'CE:99', // not registered
    };
    const result = await verifyEnvelopeWithPolicy(signed, resolver);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('KEY_UNKNOWN');
  });

  it('rejects envelopes outside the replay window', async () => {
    const { privatePem, publicPem } = ed25519PemPair();
    const resolver = new StaticKeyResolver();
    resolver.register('CE:1', publicPem);
    // 30 days ago — outside the 7d backward window.
    const env: EventEnvelopeUnsigned = {
      ...envelopeFixture(),
      observedAtMs: Date.now() - 30 * 24 * 60 * 60 * 1000,
    };
    const signed: EventEnvelope = {
      ...env,
      signature: signEnvelope(env, privatePem),
      signingKeyId: 'CE:1',
    };
    const result = await verifyEnvelopeWithPolicy(signed, resolver);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('REPLAY_WINDOW');
  });

  it('rejects oversized payloads', async () => {
    const { privatePem, publicPem } = ed25519PemPair();
    const resolver = new StaticKeyResolver();
    resolver.register('CE:1', publicPem);
    const env: EventEnvelopeUnsigned = {
      ...envelopeFixture(),
      payload: Buffer.alloc(300 * 1024), // > 256 KiB cap
    };
    const signed: EventEnvelope = {
      ...env,
      signature: signEnvelope(env, privatePem),
      signingKeyId: 'CE:1',
    };
    const result = await verifyEnvelopeWithPolicy(signed, resolver);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
