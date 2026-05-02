/**
 * Block-E E.13 / C9 backup gap 3 — pure-function offline hash-chain
 * verifier.
 *
 * The exported `verify()` here MUST recompute hashes byte-for-byte
 * identically to the in-Postgres `HashChain.verify()` (architect E.13
 * hold-point option a — strict bit-identical parity). To enforce this
 * by construction, both call paths import `bodyHash` / `rowHash` from
 * the same `canonical.ts` module — there is no second copy of the
 * canonicalisation algorithm to drift.
 *
 * The companion CLI wrapper `scripts/verify-hashchain-offline.ts` is a
 * thin shell over these functions: read the CSV, parse, verify, exit
 * with the appropriate code.
 */
import { bodyHash, rowHash } from './canonical.js';

import type { Schemas } from '@vigil/shared';

/** Columns produced by `10-vigil-backup.sh` Block-E E.13.a step. */
export const EXPECTED_COLUMNS = [
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
] as const;

export interface ParsedRow {
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

/**
 * Minimal RFC-4180 CSV parser. Inlined deliberately so the offline
 * verifier has zero third-party dependency surface a court reviewer
 * would have to audit.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c === '\r') {
        // skip — handled by \n
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseRows(text: string): ParsedRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new Error('CSV is empty');
  }
  const header = rows[0]!;
  for (let i = 0; i < EXPECTED_COLUMNS.length; i++) {
    if (header[i] !== EXPECTED_COLUMNS[i]) {
      throw new Error(
        `CSV header column ${i} expected "${EXPECTED_COLUMNS[i]}", got "${header[i]}"`,
      );
    }
  }
  const out: ParsedRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.length === 1 && r[0] === '') continue;
    if (r.length !== EXPECTED_COLUMNS.length) {
      throw new Error(`CSV row ${i} has ${r.length} fields, expected ${EXPECTED_COLUMNS.length}`);
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(r[7]!) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`CSV row ${i} payload not valid JSON: ${(e as Error).message}`);
    }
    out.push({
      id: r[0]!,
      seq: Number(r[1]!),
      action: r[2] as Schemas.AuditAction,
      actor: r[3]!,
      subject_kind: r[4] as Schemas.AuditEvent['subject_kind'],
      subject_id: r[5]!,
      occurred_at: r[6]!,
      payload,
      prev_hash: r[8] === '' ? null : r[8]!,
      body_hash: r[9]!,
    });
  }
  return out;
}

export interface VerifyResult {
  status: 'ok' | 'break';
  rowsVerified: number;
  break_?: {
    seq: number;
    expected: string;
    actual: string;
    field: 'body_hash' | 'prev_hash' | 'seq_gap';
  };
}

/**
 * Bit-identical mirror of `HashChain.verify()` in
 * `packages/audit-chain/src/hash-chain.ts`. Rebuilds prev_hash chain
 * from CSV input only — no Postgres connection needed.
 */
export function verify(rows: ParsedRow[]): VerifyResult {
  let prev: string | null = null;
  let seqExpected = rows.length > 0 ? rows[0]!.seq : 1;
  let verified = 0;
  for (const row of rows) {
    if (row.seq !== seqExpected) {
      return {
        status: 'break',
        rowsVerified: verified,
        break_: {
          seq: row.seq,
          expected: String(seqExpected),
          actual: String(row.seq),
          field: 'seq_gap',
        },
      };
    }
    const bh = bodyHash({
      seq: row.seq,
      action: row.action,
      actor: row.actor,
      subject_kind: row.subject_kind,
      subject_id: row.subject_id,
      occurred_at: row.occurred_at,
      payload: row.payload,
    });
    const rh = rowHash(prev, bh);
    if (rh !== row.body_hash) {
      return {
        status: 'break',
        rowsVerified: verified,
        break_: { seq: row.seq, expected: rh, actual: row.body_hash, field: 'body_hash' },
      };
    }
    if ((row.prev_hash ?? null) !== prev) {
      return {
        status: 'break',
        rowsVerified: verified,
        break_: {
          seq: row.seq,
          expected: prev ?? '<null>',
          actual: row.prev_hash ?? '<null>',
          field: 'prev_hash',
        },
      };
    }
    prev = row.body_hash;
    seqExpected = row.seq + 1;
    verified++;
  }
  return { status: 'ok', rowsVerified: verified };
}
