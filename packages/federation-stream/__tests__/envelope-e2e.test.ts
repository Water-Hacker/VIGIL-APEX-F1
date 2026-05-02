/**
 * Block-E E.3 / D4 — Federation envelope E2E (sign → policy-verify chain).
 *
 * Complements the existing per-function unit tests in
 * `packages/federation-stream/src/sign.test.ts` (which already covers
 * REGION_MISMATCH, KEY_UNKNOWN, REPLAY_WINDOW backward, PAYLOAD_TOO_LARGE,
 * SIGNATURE_INVALID, and the happy path).
 *
 * What this E2E adds:
 *   1. A parameterised rejection-code table — all 5 documented codes
 *      driven through `verifyEnvelopeWithPolicy` in one place so a
 *      reader can see the full rejection surface at a glance.
 *   2. The forward-window replay test (the existing test covers the
 *      backward window; this fills the symmetry).
 *   3. A multi-envelope flow proving signature uniqueness across
 *      envelopes that share `dedupKey` but differ in payload (the
 *      receiver tracks dedup statefully, but the canonical signing
 *      bytes must still differ when payload differs — so a replayed
 *      envelope cannot mask a tampered one).
 *
 * Refs: BLOCK-E-PLAN.md §2.3 (D4 piece); SRD §15.4 (federation
 * envelope contract); existing `src/sign.test.ts` (per-function
 * unit coverage).
 */
import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { signEnvelope } from '../src/sign.js';
import {
  ALL_REGION_CODES,
  DEFAULT_BACKWARD_WINDOW_MS,
  DEFAULT_FORWARD_WINDOW_MS,
  MAX_PAYLOAD_BYTES,
  type EventEnvelope,
  type EventEnvelopeUnsigned,
  type RejectionCode,
} from '../src/types.js';
import { StaticKeyResolver, verifyEnvelopeWithPolicy } from '../src/verify.js';

function ed25519PemPair(): { privatePem: string; publicPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

const VALID_REGION = 'CE';
const VALID_KEY_ID = `${VALID_REGION}:1`;
const NOW_MS = 1_730_000_000_000; // 2024-10-26-ish — frozen for deterministic policy tests

function unsignedFixture(overrides: Partial<EventEnvelopeUnsigned> = {}): EventEnvelopeUnsigned {
  return {
    envelopeId: '01928c66-7e1f-7000-9000-000000000042',
    region: VALID_REGION,
    sourceId: 'minfi-bis-public-feed',
    dedupKey: 'minfi-bis::contract-2026-04-CE-0042',
    payload: Buffer.from(
      JSON.stringify({ contract: '2026-04-CE-0042', amount_xaf: 120000000 }),
      'utf8',
    ),
    observedAtMs: NOW_MS - 5_000,
    ...overrides,
  };
}

interface RejectionTableRow {
  readonly name: string;
  readonly code: RejectionCode;
  readonly buildSigned: (privatePem: string) => EventEnvelope;
  readonly buildResolver: (publicPem: string) => StaticKeyResolver;
  /** Optional policy override — defaults to {} (production defaults). */
  readonly policy?: { nowMs?: () => number };
}

describe('Block-E E.3 / D4 — federation envelope E2E (sign → policy-verify)', () => {
  describe('happy path', () => {
    it('round-trips a properly signed in-window envelope across all 10 regions', async () => {
      const { privatePem, publicPem } = ed25519PemPair();
      for (const region of ALL_REGION_CODES) {
        const keyId = `${region}:1`;
        const resolver = new StaticKeyResolver();
        resolver.register(keyId, publicPem);
        const env = unsignedFixture({ region });
        const signed: EventEnvelope = {
          ...env,
          signature: signEnvelope(env, privatePem),
          signingKeyId: keyId,
        };
        const result = await verifyEnvelopeWithPolicy(signed, resolver, {
          nowMs: () => NOW_MS,
        });
        expect(result.ok, `region ${region}`).toBe(true);
        expect(result.code).toBeUndefined();
      }
    });
  });

  describe('rejection-code table (all 5 documented codes)', () => {
    const ROWS: ReadonlyArray<RejectionTableRow> = [
      {
        name: 'REGION_MISMATCH — signing_key_id prefix does not match envelope.region',
        code: 'REGION_MISMATCH',
        buildResolver: (publicPem) => {
          const r = new StaticKeyResolver();
          // The resolver knows about an LT key; envelope claims CE.
          r.register('LT:1', publicPem);
          return r;
        },
        buildSigned: (privatePem) => {
          const env = unsignedFixture({ region: 'CE' });
          return {
            ...env,
            signature: signEnvelope(env, privatePem),
            signingKeyId: 'LT:1', // mismatch
          };
        },
      },
      {
        name: 'PAYLOAD_TOO_LARGE — payload byteLength > MAX_PAYLOAD_BYTES (256 KiB)',
        code: 'PAYLOAD_TOO_LARGE',
        buildResolver: (publicPem) => {
          const r = new StaticKeyResolver();
          r.register(VALID_KEY_ID, publicPem);
          return r;
        },
        buildSigned: (privatePem) => {
          const env = unsignedFixture({ payload: Buffer.alloc(MAX_PAYLOAD_BYTES + 1) });
          return {
            ...env,
            signature: signEnvelope(env, privatePem),
            signingKeyId: VALID_KEY_ID,
          };
        },
      },
      {
        name: 'REPLAY_WINDOW — observedAtMs before backward window',
        code: 'REPLAY_WINDOW',
        buildResolver: (publicPem) => {
          const r = new StaticKeyResolver();
          r.register(VALID_KEY_ID, publicPem);
          return r;
        },
        buildSigned: (privatePem) => {
          const env = unsignedFixture({
            observedAtMs: NOW_MS - DEFAULT_BACKWARD_WINDOW_MS - 1,
          });
          return {
            ...env,
            signature: signEnvelope(env, privatePem),
            signingKeyId: VALID_KEY_ID,
          };
        },
        policy: { nowMs: () => NOW_MS },
      },
      {
        name: 'REPLAY_WINDOW — observedAtMs after forward window (clock-skew attack)',
        code: 'REPLAY_WINDOW',
        buildResolver: (publicPem) => {
          const r = new StaticKeyResolver();
          r.register(VALID_KEY_ID, publicPem);
          return r;
        },
        buildSigned: (privatePem) => {
          const env = unsignedFixture({
            observedAtMs: NOW_MS + DEFAULT_FORWARD_WINDOW_MS + 1,
          });
          return {
            ...env,
            signature: signEnvelope(env, privatePem),
            signingKeyId: VALID_KEY_ID,
          };
        },
        policy: { nowMs: () => NOW_MS },
      },
      {
        name: 'KEY_UNKNOWN — resolver does not have signing_key_id',
        code: 'KEY_UNKNOWN',
        buildResolver: () => {
          const r = new StaticKeyResolver();
          // Empty resolver — no keys registered.
          return r;
        },
        buildSigned: (privatePem) => {
          const env = unsignedFixture();
          return {
            ...env,
            signature: signEnvelope(env, privatePem),
            signingKeyId: VALID_KEY_ID,
          };
        },
      },
      {
        name: 'SIGNATURE_INVALID — payload tampered after signing',
        code: 'SIGNATURE_INVALID',
        buildResolver: (publicPem) => {
          const r = new StaticKeyResolver();
          r.register(VALID_KEY_ID, publicPem);
          return r;
        },
        buildSigned: (privatePem) => {
          const env = unsignedFixture();
          const sig = signEnvelope(env, privatePem);
          // Tamper the payload AFTER signing.
          return {
            ...env,
            payload: Buffer.from('TAMPERED-PAYLOAD-ROW', 'utf8'),
            signature: sig,
            signingKeyId: VALID_KEY_ID,
          };
        },
      },
    ];

    for (const row of ROWS) {
      it(`rejects with ${row.code} — ${row.name}`, async () => {
        const { privatePem, publicPem } = ed25519PemPair();
        const resolver = row.buildResolver(publicPem);
        const signed = row.buildSigned(privatePem);
        const result = await verifyEnvelopeWithPolicy(
          signed,
          resolver,
          row.policy ?? { nowMs: () => NOW_MS },
        );
        expect(result.ok).toBe(false);
        expect(result.code).toBe(row.code);
        // Detail string is set on most rejections (helps the receiver
        // attribute the rejection in its PushAck reply); SIGNATURE_INVALID
        // intentionally omits detail to avoid leaking the failure mode
        // to a probing attacker.
      });
    }
  });

  describe('signature uniqueness across envelopes with shared dedupKey', () => {
    /**
     * The receiver tracks dedup keys statefully (Redis-backed); here we
     * verify the canonical-signing layer alone: two envelopes that
     * share a dedupKey but differ in payload produce DIFFERENT
     * signatures. A replayed-with-different-payload attack therefore
     * cannot reuse a previous signature to slip a tampered envelope
     * past the verify layer.
     */
    it('different payloads under same dedupKey produce distinct signatures', () => {
      const { privatePem } = ed25519PemPair();
      const a = unsignedFixture({ payload: Buffer.from('payload-A', 'utf8') });
      const b = unsignedFixture({ payload: Buffer.from('payload-B', 'utf8') });
      // Both envelopes share dedupKey by virtue of the fixture default.
      expect(a.dedupKey).toBe(b.dedupKey);
      const sigA = signEnvelope(a, privatePem);
      const sigB = signEnvelope(b, privatePem);
      expect(Buffer.from(sigA).equals(Buffer.from(sigB))).toBe(false);
    });

    it('different observedAtMs under same payload produce distinct signatures', () => {
      const { privatePem } = ed25519PemPair();
      const a = unsignedFixture({ observedAtMs: NOW_MS - 5_000 });
      const b = unsignedFixture({ observedAtMs: NOW_MS - 4_000 });
      const sigA = signEnvelope(a, privatePem);
      const sigB = signEnvelope(b, privatePem);
      expect(Buffer.from(sigA).equals(Buffer.from(sigB))).toBe(false);
    });
  });

  describe('policy override knobs', () => {
    it('honours custom forward window override', async () => {
      const { privatePem, publicPem } = ed25519PemPair();
      const resolver = new StaticKeyResolver();
      resolver.register(VALID_KEY_ID, publicPem);
      // Tighter forward window: 1 second only.
      const tightPolicy = { nowMs: () => NOW_MS, forwardWindowMs: 1_000 };
      const env = unsignedFixture({ observedAtMs: NOW_MS + 5_000 }); // 5s ahead — outside 1s window
      const signed: EventEnvelope = {
        ...env,
        signature: signEnvelope(env, privatePem),
        signingKeyId: VALID_KEY_ID,
      };
      const result = await verifyEnvelopeWithPolicy(signed, resolver, tightPolicy);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('REPLAY_WINDOW');
    });

    it('honours custom maxPayloadBytes override', async () => {
      const { privatePem, publicPem } = ed25519PemPair();
      const resolver = new StaticKeyResolver();
      resolver.register(VALID_KEY_ID, publicPem);
      // Tighter cap: 100 bytes only.
      const tightPolicy = { nowMs: () => NOW_MS, maxPayloadBytes: 100 };
      const env = unsignedFixture({ payload: Buffer.alloc(101) }); // 101B — over the tight cap
      const signed: EventEnvelope = {
        ...env,
        signature: signEnvelope(env, privatePem),
        signingKeyId: VALID_KEY_ID,
      };
      const result = await verifyEnvelopeWithPolicy(signed, resolver, tightPolicy);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });
});
