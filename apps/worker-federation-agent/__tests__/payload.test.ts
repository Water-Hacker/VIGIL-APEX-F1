/**
 * worker-federation-agent — payload-validation contract.
 *
 * Phase-3 regional agents push events to the Yaoundé core. The wire
 * envelope shape is fixed (envelopeId, region, sourceId, dedupKey,
 * payloadB64, observedAtMs). Drift breaks signature verification at
 * the receiver, so the schema is the load-bearing contract.
 */
import { describe, expect, it } from 'vitest';

import { federationPushSchema } from '../src/worker.js';

describe('worker-federation-agent push payload schema', () => {
  const happy = {
    envelopeId: 'env-abc',
    region: 'CE',
    sourceId: 'armp-main',
    dedupKey: 'src:armp:row-42',
    payloadB64: Buffer.from('hello').toString('base64'),
    observedAtMs: 1714400000000,
  } as const;

  it('accepts a well-formed payload from the CE region', () => {
    const r = federationPushSchema.parse(happy);
    expect(r.region).toBe('CE');
  });

  it('accepts every documented region code', () => {
    // ALL_REGION_CODES from @vigil/federation-stream — the 10 Cameroonian
    // administrative regions per Phase-3 federation rollout.
    for (const region of ['CE', 'LT', 'NW', 'SW', 'OU', 'SU', 'ES', 'EN', 'NO', 'AD']) {
      const r = federationPushSchema.safeParse({ ...happy, region });
      expect(r.success, `region=${region}`).toBe(true);
    }
  });

  it('rejects an unknown region code', () => {
    const r = federationPushSchema.safeParse({ ...happy, region: 'XX' });
    expect(r.success).toBe(false);
  });

  it('requires non-empty envelopeId / sourceId / dedupKey / payloadB64', () => {
    for (const field of ['envelopeId', 'sourceId', 'dedupKey', 'payloadB64'] as const) {
      const r = federationPushSchema.safeParse({ ...happy, [field]: '' });
      expect(r.success, `empty ${field}`).toBe(false);
    }
  });

  it('rejects negative observedAtMs (clock-skew defence)', () => {
    const r = federationPushSchema.safeParse({ ...happy, observedAtMs: -1 });
    expect(r.success).toBe(false);
  });

  it('rejects fractional observedAtMs (must be an integer ms timestamp)', () => {
    const r = federationPushSchema.safeParse({ ...happy, observedAtMs: 1.5 });
    expect(r.success).toBe(false);
  });

  it('accepts a zero observedAtMs (epoch is valid for testing)', () => {
    const r = federationPushSchema.safeParse({ ...happy, observedAtMs: 0 });
    expect(r.success).toBe(true);
  });
});
