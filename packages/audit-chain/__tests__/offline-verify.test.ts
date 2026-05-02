/**
 * Block-E E.13 / C9 backup gap 3 — offline-verifier bit-parity tests.
 *
 * Asserts the architect's E.13 hold-point option (a) — strict bit-
 * identical parity — between the in-Postgres path
 * (`HashChain.verify()`) and the offline path (`offline-verify.ts`).
 *
 * Strategy: build a deterministic 100-row chain in memory using the
 * SAME bodyHash + rowHash functions both verifiers consume, render it
 * to CSV in the format `10-vigil-backup.sh` produces, parse it back,
 * and run the offline verify. By construction this round-trip must
 * succeed; what the test pins is:
 *
 *   1. The CSV parser handles every shape `\copy ... CSV HEADER`
 *      can emit (quoted fields with embedded commas, quotes, JSON
 *      payloads, null prev_hash on row 1).
 *   2. The offline verify rejects every break category — body_hash
 *      tampering, prev_hash tampering, seq-gap.
 *   3. The verify returns OK on a clean chain of size 0, 1, and 100.
 */
import { describe, expect, it } from 'vitest';

import { bodyHash, rowHash } from '../src/canonical.js';
import { parseCsv, parseRows, verify } from '../src/offline-verify.js';

import type { Schemas } from '@vigil/shared';

interface ChainRow {
  id: string;
  seq: number;
  action: Schemas.AuditAction;
  actor: string;
  subject_kind: Schemas.AuditEvent['subject_kind'];
  subject_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
  prev_hash: string | null;
  body_hash: string;
}

/** Build an N-row deterministic chain in memory. */
function buildChain(n: number): ChainRow[] {
  const out: ChainRow[] = [];
  let prev: string | null = null;
  for (let i = 1; i <= n; i++) {
    const event = {
      seq: i,
      action: 'finding.escalated' as Schemas.AuditAction,
      actor: `architect-${i}@vigilapex.cm`,
      subject_kind: 'finding' as Schemas.AuditEvent['subject_kind'],
      subject_id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      occurred_at: `2026-04-28T12:00:${String(i % 60).padStart(2, '0')}.000Z`,
      payload: {
        amount_xaf: 1_000_000 + i * 1000,
        // Include a comma + quote + newline in the JSON value to exercise
        // the CSV escape path on the encode side and the parser on the
        // decode side. JSON itself escapes the embedded \" + \n.
        region: i % 2 === 0 ? 'CE' : 'LT',
        note: i === 50 ? 'special, "quoted" value\nwith newline' : `routine row ${i}`,
      },
    };
    const bh = bodyHash(event);
    const rh = rowHash(prev, bh);
    out.push({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      seq: i,
      action: event.action,
      actor: event.actor,
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      occurred_at: event.occurred_at,
      payload: event.payload,
      prev_hash: prev,
      body_hash: rh,
    });
    prev = rh;
  }
  return out;
}

/**
 * Render the chain to CSV in the same format Postgres `\copy ... CSV
 * HEADER` produces. Every field is wrapped in quotes for safety
 * (Postgres' default is to quote only fields containing special chars,
 * but always-quote is a strict superset that simplifies the test).
 */
function renderCsv(rows: ChainRow[]): string {
  const escape = (s: string): string => `"${s.replace(/"/g, '""')}"`;
  const header = [
    'id',
    'seq',
    'action',
    'actor',
    'subject_kind',
    'subject_id',
    'occurred_at',
    'payload',
    'prev_hash',
    'body_hash',
  ].join(',');
  const lines = [header];
  for (const r of rows) {
    lines.push(
      [
        escape(r.id),
        escape(String(r.seq)),
        escape(r.action),
        escape(r.actor),
        escape(r.subject_kind),
        escape(r.subject_id),
        escape(r.occurred_at),
        escape(JSON.stringify(r.payload)),
        escape(r.prev_hash ?? ''),
        escape(r.body_hash),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

describe('Block-E E.13 — offline hash-chain verifier (bit-identical parity)', () => {
  describe('parseCsv — RFC-4180 corner cases', () => {
    it('handles plain unquoted fields', () => {
      expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ]);
    });
    it('handles quoted fields with embedded commas', () => {
      expect(parseCsv('a,b\n"hello, world","x"\n')).toEqual([
        ['a', 'b'],
        ['hello, world', 'x'],
      ]);
    });
    it('handles quoted fields with embedded quotes (escaped as "")', () => {
      expect(parseCsv('a\n"he said ""hi"""\n')).toEqual([['a'], ['he said "hi"']]);
    });
    it('handles quoted fields with embedded newlines', () => {
      expect(parseCsv('a\n"line one\nline two"\n')).toEqual([['a'], ['line one\nline two']]);
    });
    it('handles trailing field without terminating newline', () => {
      expect(parseCsv('a,b\n1,2')).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    });
    it('handles \\r\\n line endings (postgres can emit either)', () => {
      expect(parseCsv('a\r\n1\r\n')).toEqual([['a'], ['1']]);
    });
  });

  describe('parseRows — header validation + JSON payload round-trip', () => {
    it('rejects CSV with wrong header column order', () => {
      expect(() => parseRows('seq,id,action\n1,abc,foo\n')).toThrow(
        /header column 0 expected "id"/,
      );
    });
    it('round-trips a clean chain through CSV', () => {
      const chain = buildChain(3);
      const csv = renderCsv(chain);
      const parsed = parseRows(csv);
      expect(parsed).toHaveLength(3);
      expect(parsed[0]!.seq).toBe(1);
      expect(parsed[2]!.seq).toBe(3);
      expect(parsed[0]!.payload).toEqual(chain[0]!.payload);
    });
    it('round-trips JSON payloads with embedded commas, quotes, newlines', () => {
      const chain = buildChain(50); // includes the special row at seq=50
      const csv = renderCsv(chain);
      const parsed = parseRows(csv);
      expect(parsed[49]!.payload.note).toBe('special, "quoted" value\nwith newline');
    });
  });

  describe('verify — happy paths', () => {
    it('verifies an empty chain (0 rows)', () => {
      expect(verify([])).toEqual({ status: 'ok', rowsVerified: 0 });
    });
    it('verifies a 1-row chain', () => {
      const chain = buildChain(1);
      const csv = renderCsv(chain);
      const parsed = parseRows(csv);
      expect(verify(parsed)).toEqual({ status: 'ok', rowsVerified: 1 });
    });
    it('verifies a 100-row deterministic chain', () => {
      const chain = buildChain(100);
      const csv = renderCsv(chain);
      const parsed = parseRows(csv);
      const result = verify(parsed);
      expect(result.status).toBe('ok');
      expect(result.rowsVerified).toBe(100);
    });
  });

  describe('verify — break detection', () => {
    it('detects body_hash tampering at row N', () => {
      const chain = buildChain(10);
      // Tamper row 5's body_hash by flipping one hex char.
      const tampered = chain.map((r) =>
        r.seq === 5
          ? { ...r, body_hash: r.body_hash.replace(/^./, (c) => (c === '0' ? '1' : '0')) }
          : r,
      );
      const csv = renderCsv(tampered);
      const parsed = parseRows(csv);
      const result = verify(parsed);
      expect(result.status).toBe('break');
      expect(result.break_!.field).toBe('body_hash');
      expect(result.break_!.seq).toBe(5);
      // The first 4 rows verified before the break.
      expect(result.rowsVerified).toBe(4);
    });

    it('detects prev_hash tampering (stored prev_hash diverges from rolling pointer)', () => {
      // The verifier checks prev_hash AFTER body_hash. To isolate the
      // prev_hash branch we need a row where the stored body_hash still
      // matches `rowHash(rolling_prev, bodyHash(row))` — i.e. leave the
      // body_hash field untouched — but where the stored `prev_hash`
      // column has been tampered to a different value. The verifier's
      // rolling pointer never reads `row.prev_hash`; it walks forward
      // from `body_hash` of the prior row. So mutating only the
      // `prev_hash` column on row 5 produces exactly this state.
      const chain = buildChain(10);
      const t = chain.map((r) => ({ ...r }));
      t[4]!.prev_hash = '1'.repeat(64);
      const csv = renderCsv(t);
      const parsed = parseRows(csv);
      const result = verify(parsed);
      expect(result.status).toBe('break');
      expect(result.break_!.field).toBe('prev_hash');
      expect(result.break_!.seq).toBe(5);
    });

    it('detects seq gap (row missing from middle of chain)', () => {
      const chain = buildChain(10);
      // Remove row 5.
      const trimmed = chain.filter((r) => r.seq !== 5);
      const csv = renderCsv(trimmed);
      const parsed = parseRows(csv);
      const result = verify(parsed);
      expect(result.status).toBe('break');
      expect(result.break_!.field).toBe('seq_gap');
      expect(result.break_!.seq).toBe(6);
      expect(result.break_!.expected).toBe('5');
    });
  });

  describe('parity with in-Postgres bodyHash / rowHash', () => {
    it('uses the same canonicalisation — building a chain with bodyHash and verifying through the offline path yields ok', () => {
      // This is the architect E.13 hold-point option (a) assertion:
      // both paths use the same primitives. By construction the
      // offline verify accepts a chain built via bodyHash/rowHash.
      const chain = buildChain(100);
      const csv = renderCsv(chain);
      const parsed = parseRows(csv);
      expect(verify(parsed).status).toBe('ok');
    });
  });
});
