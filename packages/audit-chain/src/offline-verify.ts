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

export interface Divergence {
  /** Row sequence number where the divergence was observed. */
  seq: number;
  /** Which check fired. */
  field: 'body_hash' | 'prev_hash' | 'seq_gap';
  /** Hash / value the verifier expected. */
  expected: string;
  /** Hash / value found in the CSV. */
  actual: string;
}

export interface VerifyResult {
  status: 'ok' | 'break';
  rowsVerified: number;
  /**
   * EVERY divergence found, in seq order. The legacy `break_` field
   * is `divergences[0]` if non-empty (kept for back-compat with
   * pre-E.13.c callers — the test suite reads this field directly).
   * Architect E.13 review request #4 (continue-and-collect).
   */
  divergences: Divergence[];
  /** First divergence — convenience accessor (= divergences[0] or undefined). */
  break_?: Divergence;
}

/**
 * Bit-identical mirror of `HashChain.verify()` in
 * `packages/audit-chain/src/hash-chain.ts`. Rebuilds prev_hash chain
 * from CSV input only — no Postgres connection needed.
 *
 * Architect E.13.c review:
 *   - Continues scanning past every break (does NOT stop at the first
 *     divergence) so the caller sees the full divergence surface, not
 *     a single hint that gets re-fired on every subsequent row.
 *   - When body_hash mismatches, the rolling `prev` pointer advances
 *     to the row's STORED body_hash (treating downstream rows as a
 *     continuation from the broken point) — this surfaces independent
 *     divergences cleanly without flooding the report with cascade-
 *     errors.
 *   - When prev_hash mismatches, the rolling pointer continues from
 *     the row's stored body_hash for the same reason.
 */
export function verify(rows: ParsedRow[]): VerifyResult {
  const divergences: Divergence[] = [];
  let prev: string | null = null;
  let seqExpected = rows.length > 0 ? rows[0]!.seq : 1;
  let verified = 0;
  for (const row of rows) {
    if (row.seq !== seqExpected) {
      divergences.push({
        seq: row.seq,
        field: 'seq_gap',
        expected: String(seqExpected),
        actual: String(row.seq),
      });
      // Re-anchor the seq tracker to this row so subsequent rows are
      // checked against THEIR own seq+1, not the gap-extended count.
      seqExpected = row.seq;
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
    let bodyHashOk = true;
    if (rh !== row.body_hash) {
      divergences.push({
        seq: row.seq,
        field: 'body_hash',
        expected: rh,
        actual: row.body_hash,
      });
      bodyHashOk = false;
    }
    if ((row.prev_hash ?? null) !== prev) {
      divergences.push({
        seq: row.seq,
        field: 'prev_hash',
        expected: prev ?? '<null>',
        actual: row.prev_hash ?? '<null>',
      });
    }
    // Advance rolling prev to the RECOMPUTED row hash (not the stored
    // body_hash) so a single broken row doesn't cascade-fail every
    // subsequent row. The rolling pointer thereby represents "what
    // the chain SHOULD look like at this point" — independent partial-
    // tampering events at row N+k surface as fresh divergences instead
    // of being masked by the row-N break propagating downstream.
    prev = rh;
    seqExpected = row.seq + 1;
    if (bodyHashOk) verified++;
  }
  if (divergences.length === 0) {
    return { status: 'ok', rowsVerified: verified, divergences };
  }
  const result: VerifyResult = {
    status: 'break',
    rowsVerified: verified,
    divergences,
  };
  if (divergences[0]) result.break_ = divergences[0];
  return result;
}

/**
 * Render a deterministic, GPG-signable verification report.
 *
 * Architect E.13.c review #4(c): the report itself must be signable so
 * a court can verify the verification result is the result the script
 * actually produced. Output is byte-deterministic (no timestamps, no
 * random ids) so re-running the verifier on the same CSV produces the
 * same report bytes — making the GPG signature stable across reruns.
 *
 * Format:
 *   line 1: "vigil-audit-chain-verifier v1"
 *   line 2: "csv-format: audit-chain.csv v1 (10 columns)"
 *   line 3: "rows-input: <n>"
 *   line 4: "rows-verified: <n>"
 *   line 5: "status: OK" or "status: BREAK (<m> divergences)"
 *   line 6: "---"
 *   per divergence (if any):
 *     "seq=<n> field=<f> expected=<hex|str> actual=<hex|str>"
 *
 * The reviewer pipes this through `gpg --clearsign` or writes to
 * disk and `gpg --detach-sign`s it. The architect's signature on the
 * report attests "I ran this verifier on this CSV and got this
 * result" — the verifier itself does not call gpg.
 */
export function renderReport(rowsInput: number, result: VerifyResult): string {
  const lines: string[] = [];
  lines.push('vigil-audit-chain-verifier v1');
  lines.push('csv-format: audit-chain.csv v1 (10 columns)');
  lines.push(`rows-input: ${rowsInput}`);
  lines.push(`rows-verified: ${result.rowsVerified}`);
  if (result.status === 'ok') {
    lines.push('status: OK');
  } else {
    lines.push(`status: BREAK (${result.divergences.length} divergences)`);
  }
  lines.push('---');
  for (const d of result.divergences) {
    lines.push(`seq=${d.seq} field=${d.field} expected=${d.expected} actual=${d.actual}`);
  }
  return lines.join('\n') + '\n';
}
