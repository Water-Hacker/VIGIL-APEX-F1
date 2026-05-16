/**
 * Tier-44 audit closure — extended write-boundary gates on HashChain.append.
 *
 * Two defences:
 *
 *   (1) action + subject_kind canonical-separator gate. These fields appear
 *       in the canonical `|`-delimited line alongside actor + subject_id:
 *         <seq>|<action>|<actor>|<subject_kind>|<subject_id>|<occurred_at>|<json>
 *       Pre-fix, only actor and subject_id were gated. action and
 *       subject_kind are TS-enum-typed but a caller doing
 *       `someString as Schemas.AuditAction` bypasses that constraint at
 *       runtime — defence in depth says gate them with the same regex.
 *
 *   (2) occurred_at round-trip normalisation. The verify path reads back
 *       the stored TIMESTAMPTZ via the pg driver (→ JS Date) and recomputes
 *       the hash from `row.occurred_at.toISOString()`, which always
 *       produces "YYYY-MM-DDTHH:MM:SS.sssZ". Pre-fix, append() hashed
 *       whatever input string the caller passed — so a microsecond-
 *       precision ISO string like "2026-05-16T17:00:00.123456+00:00"
 *       would hash one way and verify another, silently breaking the
 *       chain. Post-fix, append() round-trips through `new Date(...)
 *       .toISOString()` BEFORE hashing.
 *
 * Tests use the same mock-pool pattern as hash-chain-seq-cap.test.ts —
 * no live Postgres required.
 */

import { describe, expect, it, vi } from 'vitest';

import { HashChain } from '../src/hash-chain.js';

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

function mkPool(opts: { tailRow?: MockRow | null }): {
  pool: Pool;
  inserts: Array<{ params: unknown[] }>;
} {
  const inserts: Array<{ params: unknown[] }> = [];
  const client: Partial<PoolClient> = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(sql.trim())) {
        return { rows: [], rowCount: 0 } as never;
      }
      if (/SELECT seq, body_hash FROM audit\.actions ORDER BY seq DESC/.test(sql)) {
        return {
          rows: opts.tailRow ? [opts.tailRow] : [],
          rowCount: opts.tailRow ? 1 : 0,
        } as never;
      }
      if (/INSERT INTO audit\.actions/.test(sql)) {
        inserts.push({ params: params ?? [] });
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
  return { pool: pool as Pool, inserts };
}

describe('Tier-44 — action / subject_kind canonical-separator gate', () => {
  it('rejects an action containing `|` (defence even though action is TS-typed)', async () => {
    const { pool } = mkPool({ tailRow: { seq: '0', body_hash: Buffer.alloc(32, 0) } });
    const chain = new HashChain(pool);
    let caught: unknown;
    try {
      // `as never` bypass mirrors what a runtime-typing bypass would do.
      await chain.append({
        action: 'forged|kind|subject' as never,
        actor: 'worker-test',
        subject_kind: 'tip',
        subject_id: 'tip-001',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as Error).message).toMatch(/forbidden canonical-separator/);
    expect((caught as { code?: string }).code).toBe('AUDIT_FORBIDDEN_FIELD_CHAR');
  });

  it('rejects a subject_kind containing `|` (same reason)', async () => {
    const { pool } = mkPool({ tailRow: { seq: '0', body_hash: Buffer.alloc(32, 0) } });
    const chain = new HashChain(pool);
    let caught: unknown;
    try {
      await chain.append({
        action: 'tip.submitted',
        actor: 'worker-test',
        subject_kind: 'kind|injection' as never,
        subject_id: 'tip-001',
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string }).code).toBe('AUDIT_FORBIDDEN_FIELD_CHAR');
  });

  it('rejects an action containing NUL', async () => {
    const { pool } = mkPool({ tailRow: { seq: '0', body_hash: Buffer.alloc(32, 0) } });
    const chain = new HashChain(pool);
    let caught: unknown;
    try {
      await chain.append({
        action: 'tip\x00.submitted' as never,
        actor: 'worker-test',
        subject_kind: 'tip',
        subject_id: 'tip-001',
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string }).code).toBe('AUDIT_FORBIDDEN_FIELD_CHAR');
  });
});

describe('Tier-44 — occurred_at round-trip normalisation', () => {
  it('normalises microsecond-precision input to JS Date ISO form before hashing', async () => {
    const { pool, inserts } = mkPool({
      tailRow: { seq: '0', body_hash: Buffer.alloc(32, 0) },
    });
    const chain = new HashChain(pool);
    const ev = await chain.append({
      action: 'tip.submitted',
      actor: 'worker-test',
      subject_kind: 'tip',
      subject_id: 'tip-001',
      occurred_at: '2026-05-16T17:00:00.123456+00:00',
    });
    // The returned event's occurred_at must be the JS-Date-roundtripped
    // form (ms precision, trailing Z) so that what we hashed matches
    // what verify() will reconstruct from Postgres TIMESTAMPTZ.
    expect(ev.occurred_at).toBe('2026-05-16T17:00:00.123Z');
    // The INSERT carries the SAME normalised string — the column write
    // and the body_hash compute used the same value, keeping the chain
    // self-consistent.
    const insertParams = inserts[0]!.params;
    // INSERT params order: id, seq, action, actor, subject_kind,
    // subject_id, occurred_at, payload, prev_hash, body_hash. The
    // occurred_at is at index 6.
    expect(insertParams[6]).toBe('2026-05-16T17:00:00.123Z');
  });

  it('normalises an explicit non-UTC offset to UTC Z form', async () => {
    const { pool, inserts } = mkPool({
      tailRow: { seq: '0', body_hash: Buffer.alloc(32, 0) },
    });
    const chain = new HashChain(pool);
    const ev = await chain.append({
      action: 'tip.submitted',
      actor: 'worker-test',
      subject_kind: 'tip',
      subject_id: 'tip-001',
      occurred_at: '2026-05-16T19:00:00+02:00',
    });
    expect(ev.occurred_at).toBe('2026-05-16T17:00:00.000Z');
    expect(inserts[0]!.params[6]).toBe('2026-05-16T17:00:00.000Z');
  });

  it('passes through an already-canonical ISO string unchanged', async () => {
    const { pool, inserts } = mkPool({
      tailRow: { seq: '0', body_hash: Buffer.alloc(32, 0) },
    });
    const chain = new HashChain(pool);
    const canonical = '2026-05-16T17:00:00.123Z';
    const ev = await chain.append({
      action: 'tip.submitted',
      actor: 'worker-test',
      subject_kind: 'tip',
      subject_id: 'tip-001',
      occurred_at: canonical,
    });
    expect(ev.occurred_at).toBe(canonical);
    expect(inserts[0]!.params[6]).toBe(canonical);
  });

  it('rejects an unparseable occurred_at with AUDIT_OCCURRED_AT_INVALID', async () => {
    const { pool } = mkPool({ tailRow: { seq: '0', body_hash: Buffer.alloc(32, 0) } });
    const chain = new HashChain(pool);
    let caught: unknown;
    try {
      await chain.append({
        action: 'tip.submitted',
        actor: 'worker-test',
        subject_kind: 'tip',
        subject_id: 'tip-001',
        occurred_at: 'not-a-date',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe('AUDIT_OCCURRED_AT_INVALID');
    expect((caught as Error).message).toMatch(/not a parseable date/);
  });

  it('defaults occurred_at to now() when not supplied (already-canonical)', async () => {
    const { pool, inserts } = mkPool({
      tailRow: { seq: '0', body_hash: Buffer.alloc(32, 0) },
    });
    const chain = new HashChain(pool);
    const ev = await chain.append({
      action: 'tip.submitted',
      actor: 'worker-test',
      subject_kind: 'tip',
      subject_id: 'tip-001',
    });
    // The default `new Date().toISOString()` is already canonical;
    // round-tripping it once is a no-op. Just assert the column write
    // matches the returned event (chain self-consistency).
    expect(inserts[0]!.params[6]).toBe(ev.occurred_at);
    expect(ev.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('Tier-44 — gated values participate in body_hash compute', () => {
  it('hashes the round-tripped occurred_at, not the raw input', async () => {
    // Two appends with different INPUT occurred_at strings that
    // normalise to the SAME canonical form (same instant, different
    // expression) must produce identical body_hashes.
    const { pool: poolA, inserts: insertsA } = mkPool({
      tailRow: { seq: '0', body_hash: Buffer.alloc(32, 0) },
    });
    const { pool: poolB, inserts: insertsB } = mkPool({
      tailRow: { seq: '0', body_hash: Buffer.alloc(32, 0) },
    });
    const chainA = new HashChain(poolA);
    const chainB = new HashChain(poolB);
    await chainA.append({
      action: 'tip.submitted',
      actor: 'worker-test',
      subject_kind: 'tip',
      subject_id: 'tip-001',
      occurred_at: '2026-05-16T17:00:00.000Z',
    });
    await chainB.append({
      action: 'tip.submitted',
      actor: 'worker-test',
      subject_kind: 'tip',
      subject_id: 'tip-001',
      occurred_at: '2026-05-16T19:00:00.000+02:00',
    });
    // body_hash is at INSERT param index 9. Same instant → same hash.
    expect(insertsA[0]!.params[9]).toEqual(insertsB[0]!.params[9]);
  });
});
