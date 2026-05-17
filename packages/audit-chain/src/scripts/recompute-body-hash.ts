#!/usr/bin/env tsx
/**
 * T5 of TODO.md sweep — closes the runbook gap surfaced by mode-3.4 CLOSURE.
 *
 * `docs/runbooks/audit-chain-divergence.md` step 3 references a "truth-test"
 * tool that recomputes each row's body_hash from the canonical bytes and
 * compares against the on-disk value. The runbook called this tool
 * `recompute-body-hash.ts` but it had never been written; operators following
 * the divergence-response protocol hit "file not found" at exactly the moment
 * they needed it most.
 *
 * This script closes that gap. It is the third witness for diagnosis when the
 * reconciliation worker emits `audit.reconciliation_divergence`: given a
 * `seq` (or `--from N --to M` range), it reads the audit.actions row, calls
 * the existing `bodyHash` + `rowHash` helpers in `canonical.ts`, and prints
 * the two hashes side-by-side. A mismatch means the row's payload bytes were
 * tampered (Postgres truth was overwritten) AND the body_hash column was
 * NOT correspondingly updated — i.e. the corruption is local to the rows
 * the script flags.
 *
 * Exit codes (mirrors `apps/audit-verifier/src/cross-witness-cli.ts`):
 *   0   — every queried row's recomputed hash matches the stored hash
 *   2   — at least one mismatch (operator should follow runbook step 4)
 *   1   — usage error or DB connection failure
 *
 * Production invocation (per runbook step 3):
 *
 *   pnpm --filter @vigil/audit-chain exec tsx \
 *     src/scripts/recompute-body-hash.ts --from 1234 --to 1240
 *
 * Run-anywhere invocation (e.g. dev shell):
 *
 *   DATABASE_URL=postgres://... pnpm tsx \
 *     packages/audit-chain/src/scripts/recompute-body-hash.ts --seq 1234
 */

/// <reference types="node" />

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { bodyHash, rowHash } from '../canonical.js';

import type { Schemas } from '@vigil/shared';
import type { Pool } from 'pg';

/* -------------------------------------------------------------------------- */
/* Pure helpers — exported for tests (no Postgres required).                  */
/* -------------------------------------------------------------------------- */

export interface AuditRowForRecompute {
  readonly seq: number;
  readonly action: string;
  readonly actor: string;
  readonly subject_kind: string;
  readonly subject_id: string;
  /** ISO-8601 UTC string — must match what the chain hashed (post-NFC). */
  readonly occurred_at: string;
  readonly payload: Record<string, unknown>;
  /** Lowercase-hex of the row's body_hash column. */
  readonly stored_body_hash: string;
  /** Lowercase-hex of the prev row's body_hash, or null at seq=1. */
  readonly stored_prev_hash: string | null;
}

export interface RecomputeResult {
  readonly seq: number;
  readonly stored: string;
  readonly recomputed: string;
  readonly match: boolean;
}

/**
 * Recompute one row's chained `rowHash(prev, bodyHash(canonical(row)))` and
 * return it alongside the stored hash. Pure — no IO. Test-callable.
 */
export function recomputeForRow(row: AuditRowForRecompute): RecomputeResult {
  const recomputedBody = bodyHash({
    seq: row.seq,
    action: row.action as Schemas.AuditAction,
    actor: row.actor,
    subject_kind: row.subject_kind as Schemas.AuditEvent['subject_kind'],
    subject_id: row.subject_id,
    occurred_at: row.occurred_at,
    payload: row.payload,
  });
  const recomputed = rowHash(row.stored_prev_hash, recomputedBody);
  return {
    seq: row.seq,
    stored: row.stored_body_hash.toLowerCase(),
    recomputed: recomputed.toLowerCase(),
    match: row.stored_body_hash.toLowerCase() === recomputed.toLowerCase(),
  };
}

/* -------------------------------------------------------------------------- */
/* DB-bound helper — kept tiny so the pure layer above stays pure.             */
/* -------------------------------------------------------------------------- */

interface DbRow {
  seq: string;
  action: string;
  actor: string;
  subject_kind: string;
  subject_id: string;
  occurred_at: Date;
  payload: Record<string, unknown>;
  prev_hash: Buffer | null;
  body_hash: Buffer;
}

export async function recomputeRange(
  pool: Pool,
  from: number,
  to: number,
): Promise<ReadonlyArray<RecomputeResult>> {
  if (from < 1 || to < from) return [];
  const r = await pool.query<DbRow>(
    `SELECT seq, action, actor, subject_kind, subject_id, occurred_at, payload,
            prev_hash, body_hash
       FROM audit.actions
      WHERE seq BETWEEN $1 AND $2
   ORDER BY seq ASC`,
    [from, to],
  );
  return r.rows.map((row) =>
    recomputeForRow({
      seq: Number(row.seq),
      action: row.action,
      actor: row.actor,
      subject_kind: row.subject_kind,
      subject_id: row.subject_id,
      // The HashChain.append() path stores the post-toISOString() form;
      // matching that pipeline here is what makes the recompute identical.
      occurred_at: row.occurred_at.toISOString(),
      payload: row.payload,
      stored_body_hash: row.body_hash.toString('hex'),
      stored_prev_hash: row.prev_hash ? row.prev_hash.toString('hex') : null,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* CLI parser — exported for tests so the contract is locked.                  */
/* -------------------------------------------------------------------------- */

export interface ParsedArgs {
  readonly from: number;
  readonly to: number;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let from: number | null = null;
  let to: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seq' || a === '-s') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1) throw new Error('--seq requires a positive integer');
      from = v;
      to = v;
    } else if (a === '--from') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1) throw new Error('--from requires a positive integer');
      from = v;
    } else if (a === '--to') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1) throw new Error('--to requires a positive integer');
      to = v;
    } else if (a === '--help' || a === '-h') {
      throw new Error('USAGE');
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  if (from === null) throw new Error('missing --seq or --from');
  if (to === null) to = from;
  if (to < from) throw new Error('--to must be >= --from');
  return { from, to };
}

const USAGE = `\
recompute-body-hash — verify audit.actions body_hash against the canonical form.

USAGE:
  recompute-body-hash --seq N
  recompute-body-hash --from N --to M

ENV:
  DATABASE_URL  Postgres connection string (required for CLI mode).

EXIT CODES:
  0  every queried row matches
  2  one or more rows mismatch (chain potentially tampered; see
     docs/runbooks/audit-chain-divergence.md step 4)
  1  usage error or DB connection failure
`;

/* -------------------------------------------------------------------------- */
/* CLI entry-point (skipped under vitest import).                              */
/* -------------------------------------------------------------------------- */

async function cliMain(): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'USAGE') {
      process.stdout.write(USAGE);
      return 0;
    }
    process.stderr.write(`[recompute-body-hash] ${msg}\n${USAGE}`);
    return 1;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('[recompute-body-hash] DATABASE_URL is required\n');
    return 1;
  }

  // Lazy-load pg so unit tests of the pure helpers never need it installed.
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const results = await recomputeRange(pool, parsed.from, parsed.to);
    if (results.length === 0) {
      process.stdout.write(
        `[recompute-body-hash] no rows in [${parsed.from}, ${parsed.to}] — nothing to verify\n`,
      );
      return 0;
    }
    let mismatched = 0;
    for (const r of results) {
      const status = r.match ? 'match' : 'MISMATCH';
      process.stdout.write(
        `seq=${r.seq} db_hash=${r.stored} recomputed=${r.recomputed} status=${status}\n`,
      );
      if (!r.match) mismatched++;
    }
    process.stdout.write(
      `[recompute-body-hash] checked ${results.length} row(s); ${mismatched} mismatch(es)\n`,
    );
    return mismatched === 0 ? 0 : 2;
  } finally {
    await pool.end();
  }
}

const invokedAsScript = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  cliMain().then(
    (code) => process.exit(code),
    (e: unknown) => {
      const err = e instanceof Error ? e : new Error(String(e));
      process.stderr.write(`[recompute-body-hash] fatal: ${err.message}\n`);
      process.exit(1);
    },
  );
}
