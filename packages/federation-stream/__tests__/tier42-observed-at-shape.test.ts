/**
 * Tier-42 audit closure — `observedAtMs` shape validation in
 * `verifyEnvelopeWithPolicy`.
 *
 * Pre-fix, the receiver's replay-window comparisons relied on
 *   env.observedAtMs > now + forward
 *   env.observedAtMs < now - backward
 * Both comparisons return `false` when `observedAtMs` is NaN — so a
 * malformed wire payload whose `observed_at` field deserialised to
 * NaN (or Infinity, or a negative value, or a non-integer) would
 * SKIP both window checks and proceed to signature verification.
 *
 * Two failure modes followed:
 *   (a) The canonical-bytes encoder calls `BigInt(env.observedAtMs)`
 *       which throws RangeError on NaN/Infinity — surfacing an opaque
 *       internal error from sign/verify rather than a structured
 *       rejection.
 *   (b) Even when (a) was avoided, the operator-facing rejection was
 *       SIGNATURE_INVALID — masking a structural-input bug behind a
 *       crypto-failure label, which makes triage harder and (worse)
 *       could hide active tampering by an upstream malformed-payload
 *       attacker behind the noise of legitimate sig-failure logs.
 *
 * Fix: explicit `Number.isFinite + Number.isInteger + >= 0` check
 * BEFORE the window comparisons. Rejection code is REPLAY_WINDOW
 * because shape-of-timestamp is morally a replay-window concern,
 * and the detail string names the exact violation so operators
 * see the real root cause.
 *
 * Refs: `packages/federation-stream/src/verify.ts`
 * verifyEnvelopeWithPolicy.
 */
import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { signEnvelope } from '../src/sign.js';
import { StaticKeyResolver, verifyEnvelopeWithPolicy } from '../src/verify.js';

import type { EventEnvelope, EventEnvelopeUnsigned } from '../src/types.js';

const VALID_REGION = 'CE';
const VALID_KEY_ID = `${VALID_REGION}:1`;
const NOW_MS = 1_730_000_000_000;

function ed25519PemPair(): { privatePem: string; publicPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

function baseFixture(overrides: Partial<EventEnvelopeUnsigned> = {}): EventEnvelopeUnsigned {
  return {
    envelopeId: '01928c66-7e1f-7000-9000-00000000004T',
    region: VALID_REGION,
    sourceId: 'minfi-bis-public-feed',
    dedupKey: 'minfi-bis::contract-2026-04-CE-tier42',
    payload: Buffer.from(JSON.stringify({ contract: 'tier42-fixture' }), 'utf8'),
    observedAtMs: NOW_MS - 5_000,
    ...overrides,
  };
}

/**
 * The TS types say `observedAtMs: number` — that constraint is enforced
 * at the proto-loader edge in production, but the whole point of this
 * defence is that a malformed wire payload may arrive with a value
 * the loader was too permissive about (Number(undefined) is NaN, a
 * missing field deserialised as `0` could be replaced post-hoc by a
 * proxy with NaN, etc.). For tests we deliberately bypass the type
 * system with `as unknown as number` to construct the invalid shape.
 */
function withObservedAt(base: EventEnvelopeUnsigned, observedAtMs: unknown): EventEnvelopeUnsigned {
  return { ...base, observedAtMs: observedAtMs as unknown as number };
}

describe('Tier-42 — verifyEnvelopeWithPolicy rejects malformed observedAtMs before window comparisons', () => {
  const INVALID_SHAPES: ReadonlyArray<{ label: string; value: unknown }> = [
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: '-Infinity', value: Number.NEGATIVE_INFINITY },
    { label: 'negative integer', value: -1 },
    { label: 'fractional', value: NOW_MS - 0.5 },
    { label: 'string masquerading as number', value: '1730000000000' },
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
  ];

  for (const { label, value } of INVALID_SHAPES) {
    it(`rejects ${label} observedAtMs with REPLAY_WINDOW + structural detail`, async () => {
      const { privatePem, publicPem } = ed25519PemPair();
      const resolver = new StaticKeyResolver();
      resolver.register(VALID_KEY_ID, publicPem);
      const env = withObservedAt(baseFixture(), value);
      // Signing is best-effort here; for some shapes (NaN, Infinity)
      // the canonical encoder may throw — wrap so the test asserts
      // the verify-layer rejection rather than the encoder behaviour.
      let signature: Uint8Array;
      try {
        signature = signEnvelope(env, privatePem);
      } catch {
        // Encoder rejected the shape; use an arbitrary 64-byte sig
        // since verify will short-circuit before signature check.
        signature = new Uint8Array(64);
      }
      const signed: EventEnvelope = {
        ...env,
        signature,
        signingKeyId: VALID_KEY_ID,
      };
      const result = await verifyEnvelopeWithPolicy(signed, resolver, {
        nowMs: () => NOW_MS,
      });
      expect(result.ok, `${label} should be rejected`).toBe(false);
      expect(result.code, `${label} rejection code`).toBe('REPLAY_WINDOW');
      expect(result.detail, `${label} detail`).toMatch(
        /observed_at must be a non-negative integer epoch-ms/,
      );
    });
  }

  it('accepts observedAtMs = 0 (epoch) only if also within window — boundary check', async () => {
    // 0 is a valid non-negative integer, so the shape check passes.
    // It will then fail the backward-window check (0 << now - 7d).
    // The test asserts that the shape check is NOT what rejects it;
    // detail must NOT match the structural error string.
    const { privatePem, publicPem } = ed25519PemPair();
    const resolver = new StaticKeyResolver();
    resolver.register(VALID_KEY_ID, publicPem);
    const env = withObservedAt(baseFixture(), 0);
    const signed: EventEnvelope = {
      ...env,
      signature: signEnvelope(env, privatePem),
      signingKeyId: VALID_KEY_ID,
    };
    const result = await verifyEnvelopeWithPolicy(signed, resolver, {
      nowMs: () => NOW_MS,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('REPLAY_WINDOW');
    expect(result.detail).not.toMatch(/non-negative integer/);
  });

  it('accepts a within-window integer observedAtMs (sanity — no regression)', async () => {
    const { privatePem, publicPem } = ed25519PemPair();
    const resolver = new StaticKeyResolver();
    resolver.register(VALID_KEY_ID, publicPem);
    const env = baseFixture({ observedAtMs: NOW_MS });
    const signed: EventEnvelope = {
      ...env,
      signature: signEnvelope(env, privatePem),
      signingKeyId: VALID_KEY_ID,
    };
    const result = await verifyEnvelopeWithPolicy(signed, resolver, {
      nowMs: () => NOW_MS,
    });
    expect(result.ok).toBe(true);
  });
});
