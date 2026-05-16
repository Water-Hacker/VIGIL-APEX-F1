/**
 * Tier-47 audit closure — ListCommitments inclusive-end semantics.
 *
 * Hyperledger Fabric's `getStateByRange(startKey, endKey)` is
 * INCLUSIVE-EXCLUSIVE: endKey is EXCLUSIVE. Pre-fix the chaincode
 * passed `KEY(to)` as endKey for what its API + math both treat as
 * inclusive `[from, to]`, silently dropping the last commitment.
 *
 * The off-chain audit-verifier walks the SAME range in Postgres
 * expecting inclusive `to` (see apps/audit-verifier/src/cross-
 * witness.ts CROSS_WITNESS_MAX_RANGE precedent). The missing last
 * commitment would surface as a false-positive divergence on the
 * Fabric side, triggering CT-03 alerts on otherwise-healthy chains.
 *
 * Tests use a stub Context that records the (startKey, endKey)
 * arguments passed to `getStateByRange`. The fix uses the EXCLUSIVE
 * endKey `KEY(toN + 1n)` — these tests pin that contract.
 */
import { describe, expect, it } from 'vitest';

import { AuditWitnessContract } from '../src/contract.js';

interface StubCall {
  readonly startKey: string;
  readonly endKey: string;
}

interface MockState {
  // Map of seq → Commitment JSON Buffer
  readonly map: Map<string, Buffer>;
}

function mkCtx(state: MockState): {
  ctx: unknown;
  calls: StubCall[];
} {
  const calls: StubCall[] = [];
  const stub = {
    getStateByRange: async (startKey: string, endKey: string) => {
      calls.push({ startKey, endKey });
      // Iterate state keys in lex order between [startKey, endKey).
      const sortedKeys = [...state.map.keys()].sort();
      let i = 0;
      const matchingKeys = sortedKeys.filter((k) => k >= startKey && k < endKey);
      return {
        next: async () => {
          if (i >= matchingKeys.length) return { done: true };
          const k = matchingKeys[i++]!;
          return {
            done: false,
            value: { key: k, value: state.map.get(k)! },
          };
        },
        close: async () => undefined,
      };
    },
    getState: async (key: string) => state.map.get(key) ?? Buffer.alloc(0),
    putState: async (key: string, value: Buffer) => {
      state.map.set(key, value);
    },
    setEvent: async () => undefined,
    getTxTimestamp: () => ({
      seconds: { toNumber: () => 1_730_000_000 },
      nanos: 0,
    }),
  };
  return { ctx: { stub }, calls };
}

function mkCommitment(seq: number, bodyHash: string): Buffer {
  return Buffer.from(
    JSON.stringify({ seq: String(seq), bodyHash, recordedAt: '2026-01-01T00:00:00.000Z' }),
  );
}

function key(seq: number | string): string {
  return `commit:${String(seq).padStart(20, '0')}`;
}

describe('Tier-47 — ListCommitments inclusive [from, to] range', () => {
  it('passes exclusive endKey = KEY(to + 1) to getStateByRange', async () => {
    const state: MockState = {
      map: new Map([
        [key(100), mkCommitment(100, 'a'.repeat(64))],
        [key(101), mkCommitment(101, 'b'.repeat(64))],
        [key(200), mkCommitment(200, 'c'.repeat(64))],
      ]),
    };
    const { ctx, calls } = mkCtx(state);
    const contract = new AuditWitnessContract();
    await contract.ListCommitments(ctx as never, '100', '200');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.startKey).toBe(key(100));
    // The fix: endKey is KEY(to + 1), not KEY(to). The latter would
    // exclude seq=200 due to Fabric's exclusive-endKey semantics.
    expect(calls[0]!.endKey).toBe(key(201));
  });

  it('returns the seq=to row (the one the pre-fix bug would have dropped)', async () => {
    const state: MockState = {
      map: new Map([
        [key(100), mkCommitment(100, 'a'.repeat(64))],
        [key(150), mkCommitment(150, 'b'.repeat(64))],
        [key(200), mkCommitment(200, 'c'.repeat(64))],
      ]),
    };
    const { ctx } = mkCtx(state);
    const contract = new AuditWitnessContract();
    const json = await contract.ListCommitments(ctx as never, '100', '200');
    const out = JSON.parse(json) as Array<{ seq: string }>;
    expect(out.map((c) => c.seq)).toEqual(['100', '150', '200']);
  });

  it('returns just the single seq when from === to (inclusive on both ends)', async () => {
    const state: MockState = {
      map: new Map([[key(42), mkCommitment(42, 'a'.repeat(64))]]),
    };
    const { ctx } = mkCtx(state);
    const contract = new AuditWitnessContract();
    const json = await contract.ListCommitments(ctx as never, '42', '42');
    const out = JSON.parse(json) as Array<{ seq: string }>;
    expect(out).toHaveLength(1);
    expect(out[0]!.seq).toBe('42');
  });

  it('belt-and-braces filter rejects a row at seq=to+1 if Fabric ever changed semantics', async () => {
    // Construct a state where the iterator would (in a hypothetical
    // future Fabric API) yield seq=to+1; the post-filter must drop it.
    // We simulate by constructing the iterator to include seq=201 via
    // a stub that ignores the endKey upper bound entirely.
    const state: MockState = {
      map: new Map([
        [key(100), mkCommitment(100, 'a'.repeat(64))],
        [key(200), mkCommitment(200, 'b'.repeat(64))],
        [key(201), mkCommitment(201, 'c'.repeat(64))], // would-be over-yielded
      ]),
    };
    let i = 0;
    const sorted = [...state.map.keys()].sort();
    const overyieldStub = {
      getStateByRange: async () => ({
        next: async () => {
          if (i >= sorted.length) return { done: true };
          const k = sorted[i++]!;
          return { done: false, value: { key: k, value: state.map.get(k)! } };
        },
        close: async () => undefined,
      }),
    };
    const ctx = { stub: overyieldStub };
    const contract = new AuditWitnessContract();
    const json = await contract.ListCommitments(ctx as never, '100', '200');
    const out = JSON.parse(json) as Array<{ seq: string }>;
    expect(out.map((c) => c.seq)).toEqual(['100', '200']);
  });

  it('still enforces the LIST_COMMITMENTS_MAX_RANGE cap (no regression on tier-18)', async () => {
    const { ctx } = mkCtx({ map: new Map() });
    const contract = new AuditWitnessContract();
    await expect(contract.ListCommitments(ctx as never, '1', '500001')).rejects.toThrow(
      /exceeds cap 500000/,
    );
  });

  it('still rejects from > to (no regression on tier-18 ordering check)', async () => {
    const { ctx } = mkCtx({ map: new Map() });
    const contract = new AuditWitnessContract();
    await expect(contract.ListCommitments(ctx as never, '500', '100')).rejects.toThrow(
      /from\/to range invalid/,
    );
  });
});
