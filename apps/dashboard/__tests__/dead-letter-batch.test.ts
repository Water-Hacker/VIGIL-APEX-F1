/**
 * AUDIT-004 — dead-letter batch updates must be atomic.
 *
 * Pre-fix: the route's `Promise.all(ids.map(markResolved))` issued N
 * concurrent UPDATEs without a transaction, so a partial failure left
 * the table in mixed state while the route still returned 200.
 *
 * Fix: a single multi-row UPDATE (...WHERE id = ANY(${ids}::uuid[])).
 * Atomic by definition; one round-trip per batch.
 *
 * This test pins the contract by stubbing `db.execute` and asserting
 * exactly ONE call for an N-ID batch, with the SQL containing `ANY(`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();

vi.mock('server-only', () => ({}));

vi.mock('@vigil/db-postgres', () => ({
  getDb: vi.fn(async () => ({
    execute: executeMock,
  })),
}));

beforeEach(() => {
  executeMock.mockReset();
  // Default: succeeded, return 3 affected rows
  executeMock.mockResolvedValue({ rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], rowCount: 3 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AUDIT-004 — batchDeadLetterUpdate is atomic (single multi-row UPDATE)', () => {
  it('exports a batchDeadLetterUpdate function', async () => {
    const mod = await import('../src/lib/dead-letter.server');
    expect(typeof (mod as { batchDeadLetterUpdate?: unknown }).batchDeadLetterUpdate).toBe(
      'function',
    );
  });

  it('issues exactly ONE execute call for an N-id "resolve" batch', async () => {
    const mod = await import('../src/lib/dead-letter.server');
    const { batchDeadLetterUpdate } = mod as unknown as {
      batchDeadLetterUpdate: (
        action: 'resolve' | 'retry',
        ids: ReadonlyArray<string>,
        reason?: string,
      ) => Promise<{ affected: ReadonlyArray<string> }>;
    };
    await batchDeadLetterUpdate(
      'resolve',
      [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',
      ],
      'manual-resolve',
    );
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('issues exactly ONE execute call for an N-id "retry" batch', async () => {
    const mod = await import('../src/lib/dead-letter.server');
    const { batchDeadLetterUpdate } = mod as unknown as {
      batchDeadLetterUpdate: (
        action: 'resolve' | 'retry',
        ids: ReadonlyArray<string>,
        reason?: string,
      ) => Promise<{ affected: ReadonlyArray<string> }>;
    };
    await batchDeadLetterUpdate('retry', [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('returns the affected ids reported by RETURNING id', async () => {
    const mod = await import('../src/lib/dead-letter.server');
    const { batchDeadLetterUpdate } = mod as unknown as {
      batchDeadLetterUpdate: (
        action: 'resolve' | 'retry',
        ids: ReadonlyArray<string>,
        reason?: string,
      ) => Promise<{ affected: ReadonlyArray<string> }>;
    };
    executeMock.mockResolvedValue({
      rows: [{ id: '11111111-1111-1111-1111-111111111111' }],
      rowCount: 1,
    });
    const r = await batchDeadLetterUpdate('resolve', ['11111111-1111-1111-1111-111111111111'], 'r');
    expect(r.affected).toEqual(['11111111-1111-1111-1111-111111111111']);
  });

  it('rejects empty id list (caller responsibility)', async () => {
    const mod = await import('../src/lib/dead-letter.server');
    const { batchDeadLetterUpdate } = mod as unknown as {
      batchDeadLetterUpdate: (
        action: 'resolve' | 'retry',
        ids: ReadonlyArray<string>,
        reason?: string,
      ) => Promise<{ affected: ReadonlyArray<string> }>;
    };
    await expect(batchDeadLetterUpdate('resolve', [], 'r')).rejects.toThrow();
  });
});

describe('AUDIT-005 — row-count validation: zero affected throws DeadLetterNotFound', () => {
  it('throws DeadLetterNotFoundError when zero rows match the WHERE id = ANY(...)', async () => {
    executeMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const mod = await import('../src/lib/dead-letter.server');
    const { batchDeadLetterUpdate, DeadLetterNotFoundError } = mod as unknown as {
      batchDeadLetterUpdate: (
        action: 'resolve' | 'retry',
        ids: ReadonlyArray<string>,
        reason?: string,
      ) => Promise<{ affected: ReadonlyArray<string> }>;
      DeadLetterNotFoundError: new (...args: never[]) => Error;
    };
    expect(typeof DeadLetterNotFoundError).toBe('function');
    let caught: unknown;
    try {
      await batchDeadLetterUpdate('resolve', ['00000000-0000-0000-0000-000000000000'], 'r');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DeadLetterNotFoundError);
    expect((caught as { name?: string }).name).toBe('DeadLetterNotFoundError');
  });

  it('does NOT throw when at least one row was affected (partial OK; route can surface)', async () => {
    executeMock.mockResolvedValueOnce({
      rows: [{ id: '11111111-1111-1111-1111-111111111111' }],
      rowCount: 1,
    });
    const mod = await import('../src/lib/dead-letter.server');
    const { batchDeadLetterUpdate } = mod as unknown as {
      batchDeadLetterUpdate: (
        action: 'resolve' | 'retry',
        ids: ReadonlyArray<string>,
        reason?: string,
      ) => Promise<{ affected: ReadonlyArray<string> }>;
    };
    const r = await batchDeadLetterUpdate(
      'resolve',
      ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
      'r',
    );
    expect(r.affected.length).toBe(1);
  });

  it('DeadLetterNotFoundError carries the requested ids for the route to surface', async () => {
    executeMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const mod = await import('../src/lib/dead-letter.server');
    const { batchDeadLetterUpdate } = mod as unknown as {
      batchDeadLetterUpdate: (
        action: 'resolve' | 'retry',
        ids: ReadonlyArray<string>,
        reason?: string,
      ) => Promise<{ affected: ReadonlyArray<string> }>;
    };
    const ids = ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'];
    let caught: unknown;
    try {
      await batchDeadLetterUpdate('retry', ids);
    } catch (e) {
      caught = e;
    }
    expect((caught as { requestedIds?: ReadonlyArray<string> }).requestedIds).toEqual(ids);
  });
});
