import { describe, expect, it } from 'vitest';

import { bodyHash, canonicalise, rowHash } from '../src/canonical.js';

const EV = {
  seq: 1,
  action: 'finding.escalated' as const,
  actor: 'architect@vigilapex.cm',
  subject_kind: 'finding' as const,
  subject_id: '00000000-0000-0000-0000-000000000001',
  occurred_at: '2026-04-28T12:00:00.000Z',
  payload: { amount_xaf: 5_000_000, region: 'CE' },
};

describe('canonical', () => {
  it('canonicalise is deterministic regardless of payload key order', () => {
    const a = canonicalise(EV);
    const b = canonicalise({ ...EV, payload: { region: 'CE', amount_xaf: 5_000_000 } });
    expect(a).toBe(b);
  });

  it('bodyHash differs when any field changes', () => {
    const base = bodyHash(EV);
    expect(bodyHash({ ...EV, seq: 2 })).not.toBe(base);
    expect(bodyHash({ ...EV, action: 'finding.archived' as const })).not.toBe(base);
    expect(bodyHash({ ...EV, actor: 'someone-else' })).not.toBe(base);
    expect(bodyHash({ ...EV, occurred_at: '2026-04-28T12:00:00.001Z' })).not.toBe(base);
    expect(bodyHash({ ...EV, payload: { ...EV.payload, amount_xaf: 5_000_001 } })).not.toBe(base);
  });

  it('NFC normalisation stabilises composed vs decomposed unicode', () => {
    const composed = { ...EV, actor: 'café@vigil' }; // é
    const decomposed = { ...EV, actor: 'café@vigil' }; // e + combining acute
    expect(bodyHash(composed)).toBe(bodyHash(decomposed));
  });

  it('rowHash chains prev_hash deterministically', () => {
    const body = bodyHash(EV);
    const r1 = rowHash(null, body);
    const r2 = rowHash(null, body);
    expect(r1).toBe(r2);
    const r3 = rowHash(r1, bodyHash({ ...EV, seq: 2 }));
    expect(r3).not.toBe(r1);
  });

  it('rowHash with null prev_hash equals rowHash with all-zeroes string', () => {
    const body = bodyHash(EV);
    expect(rowHash(null, body)).toBe(rowHash('0'.repeat(64), body));
  });
});
