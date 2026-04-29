/**
 * worker-fabric-bridge — payload-validation contract.
 *
 * The worker consumes envelopes from STREAMS.AUDIT_PUBLISH. The payload
 * shape is fixed (audit_event_id UUID, seq string|number, body_hash 64-hex)
 * because the chaincode `RecordCommitment(seq, bodyHash)` parameter shape
 * is the cross-witness contract — drift breaks divergence detection.
 */
import { describe, expect, it } from 'vitest';

import { zFabricBridgePayload } from '../src/payload.js';

describe('worker-fabric-bridge payload schema', () => {
  it('accepts a numeric seq and normalises to a string', () => {
    const r = zFabricBridgePayload.parse({
      audit_event_id: '11111111-1111-1111-1111-111111111111',
      seq: 42,
      body_hash: 'a'.repeat(64),
    });
    expect(r.seq).toBe('42');
    expect(typeof r.seq).toBe('string');
  });

  it('accepts a string seq verbatim', () => {
    const r = zFabricBridgePayload.parse({
      audit_event_id: '11111111-1111-1111-1111-111111111111',
      seq: '9007199254740993', // > MAX_SAFE_INTEGER — must survive as string
      body_hash: 'b'.repeat(64),
    });
    expect(r.seq).toBe('9007199254740993');
  });

  it('rejects non-UUID audit_event_id', () => {
    const r = zFabricBridgePayload.safeParse({
      audit_event_id: 'not-a-uuid',
      seq: 1,
      body_hash: 'a'.repeat(64),
    });
    expect(r.success).toBe(false);
  });

  it('rejects body_hash that is not 64 hex chars', () => {
    for (const bad of [
      '',
      'abc',
      'a'.repeat(63),
      'a'.repeat(65),
      'g'.repeat(64),
      '0x' + 'a'.repeat(64),
    ]) {
      const r = zFabricBridgePayload.safeParse({
        audit_event_id: '11111111-1111-1111-1111-111111111111',
        seq: 1,
        body_hash: bad,
      });
      expect(r.success, `body_hash="${bad}" must be rejected`).toBe(false);
    }
  });

  it('accepts upper-case hex (chaincode is case-insensitive at the regex)', () => {
    const r = zFabricBridgePayload.parse({
      audit_event_id: '11111111-1111-1111-1111-111111111111',
      seq: 1,
      body_hash: 'A'.repeat(64),
    });
    expect(r.body_hash).toBe('A'.repeat(64));
  });

  it('rejects extra unrecognised fields silently (zod default — flag any caller drift)', () => {
    const r = zFabricBridgePayload.safeParse({
      audit_event_id: '11111111-1111-1111-1111-111111111111',
      seq: 1,
      body_hash: 'a'.repeat(64),
      _injection: 'malicious',
    });
    expect(r.success).toBe(true); // non-strict by default; the contract is on the named fields
  });
});
