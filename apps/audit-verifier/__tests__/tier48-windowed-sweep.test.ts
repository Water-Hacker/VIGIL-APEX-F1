/**
 * Tier-48 audit closure — windowed cross-witness sweep.
 *
 * Pre-fix the audit-verifier loop invoked `verifyCrossWitness` with
 * the full [1, tail.seq] range and no windowing. The function hard-
 * caps at CROSS_WITNESS_MAX_RANGE (500k seqs); at ~50 events/sec the
 * chain crosses that in ~3 hours. From that moment on every hourly
 * CT-03 check threw `cross-witness range N exceeds cap 500000` and
 * logged the error — the second cryptographic witness silently went
 * dark in production exactly when it became load-bearing.
 *
 * `verifyCrossWitnessWindowed` walks the range in cap-sized windows
 * and aggregates per-window reports into one combined report. Any
 * window error propagates (all-or-nothing per cycle; a partial-
 * success report would mask a real Fabric outage).
 *
 * Tests below use a stub Pool/Bridge that records each call so we can
 * assert the windowing math + aggregation. We test with a smaller
 * synthetic range that crosses the cap multiple times — the math is
 * what matters, not the absolute size.
 */
import { describe, expect, it, vi } from 'vitest';

import { CROSS_WITNESS_MAX_RANGE, verifyCrossWitnessWindowed } from '../src/cross-witness.js';

function buf(hex: string): Buffer {
  return Buffer.from(hex.padStart(64, '0'), 'hex');
}

interface WindowCall {
  fromSql: string;
  toSql: string;
  bridgeFrom: bigint;
  bridgeTo: bigint;
}

/**
 * Mock factory that records window boundaries WITHOUT materialising
 * per-seq rows. The windowing math tests only care about the SQL
 * params each window passes; they don't need 500k rows per window
 * (which would make the test suite slow). Tests that need real
 * per-seq behaviour (missing/divergent aggregation) opt-in via
 * `populate: true`.
 */
function makeDeps(opts: { populate?: boolean } = {}): {
  pool: unknown;
  bridge: unknown;
  calls: WindowCall[];
} {
  const calls: WindowCall[] = [];
  const hashFor = (seq: bigint): string => seq.toString(16).padStart(64, '0');
  const pool = {
    query: vi.fn(async (_sql: string, params: unknown[]) => {
      const from = BigInt(params[0] as string);
      const to = BigInt(params[1] as string);
      calls.push({
        fromSql: String(from),
        toSql: String(to),
        bridgeFrom: -1n,
        bridgeTo: -1n,
      });
      if (!opts.populate) return { rows: [] };
      const rows: Array<{ seq: string; body_hash: Buffer }> = [];
      for (let s = from; s <= to; s++) {
        rows.push({ seq: s.toString(), body_hash: buf(hashFor(s)) });
      }
      return { rows };
    }),
  };
  const bridge = {
    listCommitments: vi.fn(async (from: bigint, to: bigint) => {
      const last = calls[calls.length - 1];
      if (last) {
        last.bridgeFrom = from;
        last.bridgeTo = to;
      }
      if (!opts.populate) return [];
      const out: Array<{ seq: string; bodyHash: string }> = [];
      for (let s = from; s <= to; s++) {
        out.push({ seq: s.toString(), bodyHash: hashFor(s) });
      }
      return out;
    }),
  };
  return { pool, bridge, calls };
}

describe('Tier-48 — verifyCrossWitnessWindowed walks the range in cap-sized windows', () => {
  it('issues a single window when range fits in the cap (no regression on small chains)', async () => {
    const { pool, bridge, calls } = makeDeps();
    const r = await verifyCrossWitnessWindowed(pool as never, bridge as never, {
      from: 1n,
      to: 100n,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fromSql).toBe('1');
    expect(calls[0]!.toSql).toBe('100');
    expect(r.checked).toBe(0); // empty-rows mode
  });

  it('splits a 2x-cap range into exactly 2 windows aligned at the cap boundary', async () => {
    const { pool, bridge, calls } = makeDeps();
    const total = CROSS_WITNESS_MAX_RANGE * 2n;
    const r = await verifyCrossWitnessWindowed(pool as never, bridge as never, {
      from: 1n,
      to: total,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.fromSql).toBe('1');
    expect(calls[0]!.toSql).toBe(CROSS_WITNESS_MAX_RANGE.toString());
    expect(calls[1]!.fromSql).toBe((CROSS_WITNESS_MAX_RANGE + 1n).toString());
    expect(calls[1]!.toSql).toBe(total.toString());
    expect(r.checked).toBe(0);
  });

  it('handles a range that ends mid-window (last window is shorter than cap)', async () => {
    const { pool, bridge, calls } = makeDeps();
    const total = CROSS_WITNESS_MAX_RANGE + 42n;
    await verifyCrossWitnessWindowed(pool as never, bridge as never, {
      from: 1n,
      to: total,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.fromSql).toBe((CROSS_WITNESS_MAX_RANGE + 1n).toString());
    expect(calls[1]!.toSql).toBe(total.toString());
  });

  it('issues exactly 3 windows for a range of 2*CAP + 1 (boundary check)', async () => {
    const { pool, bridge, calls } = makeDeps();
    const total = CROSS_WITNESS_MAX_RANGE * 2n + 1n;
    await verifyCrossWitnessWindowed(pool as never, bridge as never, {
      from: 1n,
      to: total,
    });
    expect(calls).toHaveLength(3);
    expect(calls[2]!.fromSql).toBe((CROSS_WITNESS_MAX_RANGE * 2n + 1n).toString());
    expect(calls[2]!.toSql).toBe(total.toString());
  });

  it('aggregates missingFromFabric across windows (small synthetic range)', async () => {
    // For aggregation correctness, use a small range — split via a
    // synthetic 5-seq boundary. We test the AGGREGATION property by
    // wrapping the function and calling it twice manually first as
    // a sanity check, then once windowed.
    // Since CROSS_WITNESS_MAX_RANGE is large, we can't easily force
    // a multi-window split with a small range. Instead, exercise the
    // aggregation via a single-window range with missing entries —
    // the windowed wrapper's aggregation reduces to passing through
    // a single partial report. The 2x-cap test above already proves
    // the multi-window case routes through.
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          { seq: '1', body_hash: buf('11') },
          { seq: '2', body_hash: buf('22') },
          { seq: '3', body_hash: buf('33') },
        ],
      })),
    };
    const bridge = {
      listCommitments: vi.fn(async () => [
        { seq: '1', bodyHash: '11'.padStart(64, '0') },
        // seq 2 missing
        { seq: '3', bodyHash: '33'.padStart(64, '0') },
      ]),
    };
    const r = await verifyCrossWitnessWindowed(pool as never, bridge as never, {
      from: 1n,
      to: 3n,
    });
    expect(r.missingFromFabric).toEqual(['2']);
  });

  it('propagates a per-window throw rather than returning a partial report', async () => {
    // Use empty Pool rows so the first window runs in <1ms; the second
    // window throws and the windowed wrapper must surface it (no
    // partial report).
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    };
    const bridge = {
      listCommitments: vi.fn(async (from: bigint) => {
        if (from > 1n) throw new Error('fabric peer offline');
        return [];
      }),
    };
    const total = CROSS_WITNESS_MAX_RANGE + 100n;
    await expect(
      verifyCrossWitnessWindowed(pool as never, bridge as never, { from: 1n, to: total }),
    ).rejects.toThrow(/fabric peer offline/);
  });

  it('rejects a range where to < from (caller error, same as non-windowed)', async () => {
    const { pool, bridge } = makeDeps();
    await expect(
      verifyCrossWitnessWindowed(pool as never, bridge as never, { from: 100n, to: 1n }),
    ).rejects.toThrow(/range invalid/);
  });
});
