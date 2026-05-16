/**
 * Cross-witness reverse-scan regression test (FIND-013 closure).
 *
 * Mocks the Pool and FabricBridge to drive the three observable
 * outcomes of `verifyCrossWitness()`:
 *   - all witnesses agree (clean report)
 *   - Postgres has rows Fabric does not (missingFromFabric)
 *   - Fabric has rows Postgres does not (missingFromPostgres) — NEW
 *   - hash divergence
 */

import { describe, expect, it, vi } from 'vitest';

import { CROSS_WITNESS_MAX_RANGE, verifyCrossWitness } from '../src/cross-witness.js';

function buf(hex: string): Buffer {
  return Buffer.from(hex.padStart(64, '0'), 'hex');
}

function makePool(rows: ReadonlyArray<{ seq: string; body_hash: Buffer }>): unknown {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  };
}

function makeBridge(commitments: ReadonlyArray<{ seq: string; bodyHash: string }>): unknown {
  return {
    listCommitments: vi.fn().mockResolvedValue(commitments),
  };
}

const RANGE = { from: 1n, to: 100n };

describe('verifyCrossWitness (FIND-013 — reverse scan)', () => {
  it('reports a clean range when all three witnesses agree', async () => {
    const pool = makePool([
      { seq: '1', body_hash: buf('aa') },
      { seq: '2', body_hash: buf('bb') },
    ]);
    const bridge = makeBridge([
      { seq: '1', bodyHash: 'aa'.padStart(64, '0') },
      { seq: '2', bodyHash: 'bb'.padStart(64, '0') },
    ]);
    const report = await verifyCrossWitness(pool as never, bridge as never, RANGE);
    expect(report.checked).toBe(2);
    expect(report.missingFromFabric).toEqual([]);
    expect(report.missingFromPostgres).toEqual([]);
    expect(report.divergentSeqs).toEqual([]);
  });

  it('flags rows present in Postgres but absent from Fabric', async () => {
    const pool = makePool([
      { seq: '1', body_hash: buf('aa') },
      { seq: '2', body_hash: buf('bb') },
      { seq: '3', body_hash: buf('cc') },
    ]);
    const bridge = makeBridge([
      { seq: '1', bodyHash: 'aa'.padStart(64, '0') },
      // seq 2 missing
      { seq: '3', bodyHash: 'cc'.padStart(64, '0') },
    ]);
    const report = await verifyCrossWitness(pool as never, bridge as never, RANGE);
    expect(report.missingFromFabric).toEqual(['2']);
    expect(report.missingFromPostgres).toEqual([]);
  });

  it('FIND-013: flags Fabric commitments with no Postgres counterpart', async () => {
    const pool = makePool([
      { seq: '1', body_hash: buf('aa') },
      { seq: '3', body_hash: buf('cc') },
    ]);
    const bridge = makeBridge([
      { seq: '1', bodyHash: 'aa'.padStart(64, '0') },
      { seq: '2', bodyHash: 'bb'.padStart(64, '0') }, // ghost in Fabric
      { seq: '3', bodyHash: 'cc'.padStart(64, '0') },
      { seq: '7', bodyHash: 'dd'.padStart(64, '0') }, // ghost in Fabric
    ]);
    const report = await verifyCrossWitness(pool as never, bridge as never, RANGE);
    expect(report.missingFromPostgres).toEqual(['2', '7']);
    // Stable ordering by numeric seq.
    expect(report.missingFromFabric).toEqual([]);
  });

  it('flags hash divergence independently of reverse scan', async () => {
    const pool = makePool([{ seq: '1', body_hash: buf('aa') }]);
    const bridge = makeBridge([{ seq: '1', bodyHash: 'dead'.padStart(64, '0') }]);
    const report = await verifyCrossWitness(pool as never, bridge as never, RANGE);
    expect(report.divergentSeqs).toHaveLength(1);
    expect(report.divergentSeqs[0]!.seq).toBe('1');
    expect(report.missingFromPostgres).toEqual([]);
    expect(report.missingFromFabric).toEqual([]);
  });

  it('emits all three failure modes simultaneously when present', async () => {
    const pool = makePool([
      { seq: '1', body_hash: buf('aa') }, // OK
      { seq: '2', body_hash: buf('bb') }, // diverged
      { seq: '4', body_hash: buf('dd') }, // missing from Fabric
    ]);
    const bridge = makeBridge([
      { seq: '1', bodyHash: 'aa'.padStart(64, '0') },
      { seq: '2', bodyHash: 'beef'.padStart(64, '0') }, // diverged
      { seq: '99', bodyHash: 'ff'.padStart(64, '0') }, // missing from Postgres
    ]);
    const report = await verifyCrossWitness(pool as never, bridge as never, RANGE);
    expect(report.missingFromFabric).toEqual(['4']);
    expect(report.missingFromPostgres).toEqual(['99']);
    expect(report.divergentSeqs.map((d) => d.seq)).toEqual(['2']);
  });

  // ─── Tier-9 audit closures ─────────────────────────────────────────

  it('rejects a range larger than CROSS_WITNESS_MAX_RANGE (memory-DoS defence)', async () => {
    const pool = makePool([]);
    const bridge = makeBridge([]);
    // CROSS_WITNESS_MAX_RANGE is 500k seqs; request 500_001 to trip the cap.
    const oversize = { from: 1n, to: CROSS_WITNESS_MAX_RANGE + 1n };
    await expect(verifyCrossWitness(pool as never, bridge as never, oversize)).rejects.toThrow(
      /exceeds cap/,
    );
  });

  it('accepts a range exactly at CROSS_WITNESS_MAX_RANGE (no off-by-one at the boundary)', async () => {
    const pool = makePool([]);
    const bridge = makeBridge([]);
    // span = to - from + 1; want span === CROSS_WITNESS_MAX_RANGE.
    const exact = { from: 1n, to: CROSS_WITNESS_MAX_RANGE };
    await expect(verifyCrossWitness(pool as never, bridge as never, exact)).resolves.toMatchObject({
      checked: 0,
    });
  });

  it('rejects a range where to < from (caller error)', async () => {
    const pool = makePool([]);
    const bridge = makeBridge([]);
    await expect(
      verifyCrossWitness(pool as never, bridge as never, { from: 100n, to: 1n }),
    ).rejects.toThrow(/range invalid/);
  });

  it('normalises Fabric bodyHash case before comparison (defensive)', async () => {
    // Hypothetical: a future chaincode rev returns UPPERCASE hex.
    // The PG side is lowercase. The post-fix `.toLowerCase()` on
    // Fabric values means the equality compare succeeds without
    // mis-reporting a divergence.
    const pool = makePool([{ seq: '1', body_hash: buf('abcdef') }]);
    const bridge = makeBridge([{ seq: '1', bodyHash: 'abcdef'.padStart(64, '0').toUpperCase() }]);
    const report = await verifyCrossWitness(pool as never, bridge as never, RANGE);
    expect(report.divergentSeqs).toEqual([]);
    expect(report.missingFromFabric).toEqual([]);
    expect(report.missingFromPostgres).toEqual([]);
  });
});
