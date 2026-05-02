#!/usr/bin/env -S npx tsx
/**
 * Block-E E.13 / C9 backup gap 3 — offline hash-chain verifier (CLI wrapper).
 *
 * Walks the `audit-chain.csv` produced by `infra/host-bootstrap/10-vigil-backup.sh`
 * (Block-E E.13.a) and recomputes the body_hash + row_hash chain WITHOUT
 * a Postgres connection. Used at restore time, in a court hearing, or by
 * any reviewer who has the archive but not the running cluster.
 *
 * Bit-identical-parity guarantee (architect E.13 hold-point option a):
 * the verify function is in `packages/audit-chain/src/offline-verify.ts`,
 * which imports `bodyHash` / `rowHash` from the SAME `canonical.ts`
 * module the in-Postgres `HashChain.verify()` uses. There is no second
 * copy of the canonicalisation algorithm — the two paths are
 * byte-for-byte identical by construction.
 *
 * Usage:
 *   pnpm tsx scripts/verify-hashchain-offline.ts <archive-dir>/audit-chain.csv
 *
 * Exit codes:
 *   0 — chain verifies (every row's recomputed body_hash matches stored)
 *   1 — first break encountered (printed: seq, expected, actual)
 *   2 — input format error (csv parse, missing column, bad encoding)
 */
import { readFileSync } from 'node:fs';
import { exit, argv } from 'node:process';

import { parseRows, verify } from '@vigil/audit-chain';

function main(): void {
  const path = argv[2];
  if (!path) {
    console.error('Usage: pnpm tsx scripts/verify-hashchain-offline.ts <audit-chain.csv>');
    exit(2);
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    console.error(`failed to read CSV: ${(e as Error).message}`);
    exit(2);
  }
  let rows;
  try {
    rows = parseRows(text);
  } catch (e) {
    console.error(`CSV parse error: ${(e as Error).message}`);
    exit(2);
  }
  const result = verify(rows);
  if (result.status === 'ok') {
    console.log(`OK: ${result.rowsVerified} rows verified`);
    exit(0);
  }
  console.error(
    `BREAK at seq ${result.break_!.seq} (${result.break_!.field}): expected ${result.break_!.expected}, actual ${result.break_!.actual}`,
  );
  exit(1);
}

main();
