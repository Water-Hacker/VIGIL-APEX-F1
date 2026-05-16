/**
 * Tier-20 audit closure tests — seq precision-ceiling guard + verify pagination.
 *
 * SEQ_HARD_CAP defends the canonical-form contract from precision loss:
 * once seq crosses 2^53, `Number(bigint)` rounds and two distinct seqs
 * canonicalise to the same string. `append()` refuses to write past
 * `Number.MAX_SAFE_INTEGER` so the operator hits a loud, intentional
 * AUDIT_SEQ_PRECISION_CEILING error instead of silently producing
 * collision-prone hashes.
 *
 * `verify()` no longer issues a single unbounded SELECT — it paginates
 * in `batchSize` increments so a verify of a multi-million-row chain
 * does not load the whole range into Node memory.
 *
 * Tests use a minimal Pool mock that records each query() call so we
 * can assert behavior without a live Postgres.
 */

import { describe, expect, it, vi } from 'vitest';

import { HashChain, SEQ_HARD_CAP } from '../src/hash-chain.js';

import type { Pool, PoolClient } from 'pg';

interface MockRow {
  id?: string;
  seq?: string;
  body_hash?: Buffer;
  prev_hash?: Buffer | null;
  action?: string;
  actor?: string;
  subject_kind?: string;
  subject_id?: string;
  occurred_at?: Date;
  payload?: Record<string, unknown>;
}

function mkPool(opts: {
  tailRow?: MockRow | null;
  verifyBatches?: ReadonlyArray<ReadonlyArray<MockRow>>;
}): { pool: Pool; queryCalls: Array<{ sql: string; params: unknown[] }> } {
  const queryCalls: Array<{ sql: string; params: unknown[] }> = [];
  let verifyIdx = 0;
  const client: Partial<PoolClient> = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queryCalls.push({ sql, params: params ?? [] });
      // BEGIN / COMMIT / ROLLBACK — return empty
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(sql.trim())) {
        return { rows: [], rowCount: 0 } as never;
      }
      // append() tail-read
      if (/SELECT seq, body_hash FROM audit\.actions ORDER BY seq DESC/.test(sql)) {
        return {
          rows: opts.tailRow ? [opts.tailRow] : [],
          rowCount: opts.tailRow ? 1 : 0,
        } as never;
      }
      // verify() batch read — SQL spans newlines; use /s flag.
      if (/SELECT id, seq, action.*FROM audit\.actions.*WHERE seq BETWEEN/s.test(sql)) {
        const batch = opts.verifyBatches?.[verifyIdx++] ?? [];
        return { rows: batch, rowCount: batch.length } as never;
      }
      // INSERT
      if (/INSERT INTO audit\.actions/.test(sql)) {
        return { rows: [], rowCount: 1 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    }) as never,
    release: vi.fn() as never,
  };
  const pool: Partial<Pool> = {
    connect: vi.fn(async () => client as PoolClient) as never,
    query: client.query,
  };
  return { pool: pool as Pool, queryCalls };
}

describe('SEQ_HARD_CAP constant', () => {
  it('equals Number.MAX_SAFE_INTEGER as a BigInt', () => {
    expect(SEQ_HARD_CAP).toBe(BigInt(Number.MAX_SAFE_INTEGER));
    expect(SEQ_HARD_CAP).toBe(9_007_199_254_740_991n);
  });
});

describe('HashChain.append — Tier-20 seq precision-ceiling guard', () => {
  it('writes normally below the cap', async () => {
    const { pool } = mkPool({
      tailRow: { seq: '42', body_hash: Buffer.alloc(32, 0xab) },
    });
    const chain = new HashChain(pool);
    const ev = await chain.append({
      action: 'tip.submitted',
      actor: 'worker-test',
      subject_kind: 'tip',
      subject_id: 'tip-001',
    });
    expect(ev.seq).toBe(43);
  });

  it('refuses to write past the safe-integer cap (precision-ceiling guard)', async () => {
    // tail seq is MAX, so next would be MAX+1 — past the cap. The
    // SERIALIZABLE retry loop wraps the throw in an AUDIT_APPEND_FAILED
    // after exhausting retries; the underlying cause carries the
    // AUDIT_SEQ_PRECISION_CEILING code. We assert on both forms so the
    // test pins the externally visible behaviour (operator sees an
    // error) AND the root cause is preserved on the `cause` chain.
    const { pool } = mkPool({
      tailRow: {
        seq: String(Number.MAX_SAFE_INTEGER),
        body_hash: Buffer.alloc(32, 0xab),
      },
    });
    const chain = new HashChain(pool);
    let caught: unknown;
    try {
      await chain.append({
        action: 'tip.submitted',
        actor: 'worker-test',
        subject_kind: 'tip',
        subject_id: 'tip-001',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    const err = caught as Error & { code?: string; cause?: unknown };
    expect(err.message).toMatch(/Hash chain append failed/);
    // The original precision-ceiling error is preserved on `.cause`.
    const cause = err.cause as Error & { code?: string };
    expect(cause).toBeDefined();
    expect(cause.message).toMatch(/exceeds JS Number\.MAX_SAFE_INTEGER/);
  });

  it('allows the very last representable seq (lastSeq = MAX-1, next = MAX)', async () => {
    const { pool } = mkPool({
      tailRow: {
        seq: String(Number.MAX_SAFE_INTEGER - 1),
        body_hash: Buffer.alloc(32, 0xab),
      },
    });
    const chain = new HashChain(pool);
    const ev = await chain.append({
      action: 'tip.submitted',
      actor: 'worker-test',
      subject_kind: 'tip',
      subject_id: 'tip-001',
    });
    expect(ev.seq).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('HashChain.verify — Tier-20 pagination', () => {
  function mkRow(seq: number, prev: Buffer | null, body: Buffer): MockRow {
    return {
      id: `id-${seq}`,
      seq: String(seq),
      action: 'tip.submitted',
      actor: 'worker-test',
      subject_kind: 'tip',
      subject_id: `tip-${seq}`,
      occurred_at: new Date('2026-01-01T00:00:00Z'),
      payload: {},
      prev_hash: prev,
      body_hash: body,
    };
  }

  it('returns 0 for an empty chain (single empty batch)', async () => {
    const { pool, queryCalls } = mkPool({ verifyBatches: [[]] });
    const chain = new HashChain(pool);
    const n = await chain.verify(1, 100);
    expect(n).toBe(0);
    // One query issued; loop exits on empty batch.
    expect(queryCalls.filter((q) => /BETWEEN/.test(q.sql))).toHaveLength(1);
  });

  it('paginates across multiple batches when range exceeds batchSize', async () => {
    // Need to actually compute valid prev_hash / body_hash chains for the
    // pagination tracer to walk without throwing HashChainBrokenError. We
    // pre-compute a tiny 3-row chain via canonical helpers and split it
    // across 2 batches of size 2.
    const { bodyHash, rowHash } = await import('../src/canonical.js');
    const row1Body = bodyHash({
      seq: 1,
      action: 'tip.submitted',
      actor: 'worker-test',
      subject_kind: 'tip',
      subject_id: 'tip-1',
      occurred_at: new Date('2026-01-01T00:00:00Z').toISOString(),
      payload: {},
    });
    const row1Stored = rowHash(null, row1Body);
    const row2Body = bodyHash({
      seq: 2,
      action: 'tip.submitted',
      actor: 'worker-test',
      subject_kind: 'tip',
      subject_id: 'tip-2',
      occurred_at: new Date('2026-01-01T00:00:00Z').toISOString(),
      payload: {},
    });
    const row2Stored = rowHash(row1Stored, row2Body);
    const row3Body = bodyHash({
      seq: 3,
      action: 'tip.submitted',
      actor: 'worker-test',
      subject_kind: 'tip',
      subject_id: 'tip-3',
      occurred_at: new Date('2026-01-01T00:00:00Z').toISOString(),
      payload: {},
    });
    const row3Stored = rowHash(row2Stored, row3Body);

    const { pool, queryCalls } = mkPool({
      verifyBatches: [
        // batch 1 (size 2): seq 1, 2
        [
          mkRow(1, null, Buffer.from(row1Stored, 'hex')),
          mkRow(2, Buffer.from(row1Stored, 'hex'), Buffer.from(row2Stored, 'hex')),
        ],
        // batch 2 (size 1): seq 3 — shorter than batchSize → loop exits
        [mkRow(3, Buffer.from(row2Stored, 'hex'), Buffer.from(row3Stored, 'hex'))],
      ],
    });
    const chain = new HashChain(pool);
    const n = await chain.verify(1, 3, /* batchSize */ 2);
    expect(n).toBe(3);
    const batchQueries = queryCalls.filter((q) => /BETWEEN/.test(q.sql));
    expect(batchQueries).toHaveLength(2);
    // First batch [1, 2], second batch [3, 3]
    expect(batchQueries[0]!.params).toEqual([1, 2]);
    expect(batchQueries[1]!.params).toEqual([3, 3]);
  });

  it('does not issue a single unbounded query when `to` is omitted', async () => {
    // With `to` omitted, upper = Number.MAX_SAFE_INTEGER. The first batch
    // should be [1, batchSize], not [1, MAX_SAFE_INTEGER].
    const { pool, queryCalls } = mkPool({ verifyBatches: [[]] });
    const chain = new HashChain(pool);
    await chain.verify(1, undefined, /* batchSize */ 1000);
    const batchQ = queryCalls.find((q) => /BETWEEN/.test(q.sql));
    expect(batchQ).toBeDefined();
    expect(batchQ!.params).toEqual([1, 1000]);
  });
});
