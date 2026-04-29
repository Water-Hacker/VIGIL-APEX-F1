import { describe, expect, it } from 'vitest';

import type { FabricCommitment, SubmitOutcome } from '../src/types.js';

describe('@vigil/fabric-bridge — types', () => {
  it('FabricCommitment shape matches chaincode contract (seq:string, bodyHash:hex64)', () => {
    const c: FabricCommitment = {
      seq: '42',
      bodyHash: 'a'.repeat(64),
      recordedAt: '2026-04-29T12:00:00Z',
    };
    expect(c.seq).toBe('42');
    expect(c.bodyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(c.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('SubmitOutcome supports recorded / duplicate / divergence variants', () => {
    const outcomes: SubmitOutcome[] = [
      { kind: 'recorded', txId: 'tx-1', blockHeight: 100 },
      { kind: 'duplicate', txId: 'tx-2' },
      { kind: 'divergence', existingBodyHash: 'a'.repeat(64), newBodyHash: 'b'.repeat(64) },
    ];
    for (const o of outcomes) {
      expect(['recorded', 'duplicate', 'divergence']).toContain(o.kind);
    }
  });
});
