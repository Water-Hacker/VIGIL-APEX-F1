#!/usr/bin/env -S npx tsx
/**
 * Block-E E.13 / C9 backup gap 3 — offline hash-chain verifier (CLI wrapper).
 *
 * Walks the `audit-chain.csv` produced by `infra/host-bootstrap/10-vigil-backup.sh`
 * (Block-E E.13.a) and recomputes the body_hash + row_hash chain WITHOUT
 * a Postgres connection. Used at restore time, in a court hearing, or by
 * any reviewer who has the archive but not the running cluster.
 *
 * Bit-identical-parity guarantee (architect E.13 hold-point option a +
 * E.13.c review #1): the verify function is in
 * `packages/audit-chain/src/offline-verify.ts`, which imports
 * `bodyHash` / `rowHash` from the SAME `canonical.ts` module the
 * in-Postgres `HashChain.verify()` uses. The two paths are
 * byte-for-byte identical by construction.
 *
 * Verifier semantics (architect E.13.c review #4):
 *   - Identifies the first row where the chain breaks.
 *   - Continues scanning past that point and collects every
 *     subsequent independent divergence (cascade-suppressed via the
 *     recomputed-rh rolling-pointer trick).
 *   - Emits a deterministic, GPG-signable verification report on
 *     stdout. The architect signs the report bytes via
 *     `gpg --detach-sign` to attest "I ran this verifier on this
 *     CSV and got this result".
 *
 * Exit code contract (architect E.13.c review #5):
 *   0 — chain intact (zero divergences)
 *   1 — chain has divergences (report listed)
 *   2 — input error (CSV malformed, header invalid, payload not JSON)
 *
 * Usage:
 *   pnpm tsx scripts/verify-hashchain-offline.ts <archive-dir>/audit-chain.csv
 *   pnpm tsx scripts/verify-hashchain-offline.ts <csv> | gpg --detach-sign --armor -o report.sig
 */
import { readFileSync } from 'node:fs';
import { exit, argv, stdout } from 'node:process';

import { parseRows, renderReport, verify } from '@vigil/audit-chain';

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
  // Emit the deterministic, GPG-signable report on stdout.
  stdout.write(renderReport(rows.length, result));
  exit(result.status === 'ok' ? 0 : 1);
}

main();
