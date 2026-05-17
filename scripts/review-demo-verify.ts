#!/usr/bin/env tsx
/**
 * scripts/review-demo-verify.ts — UNDP review demo verifier.
 *
 * Walks the entire `audit.actions` chain via `HashChain.verify()` and
 * exits 0 if every row chains cleanly. The next step of the demo
 * (the tamper test) re-runs this OR the recompute-body-hash CLI
 * after a raw-SQL UPDATE to confirm the integrity guarantee.
 */

import process from 'node:process';

import { HashChain } from '@vigil/audit-chain';
import { createLogger } from '@vigil/observability';
import { Pool } from 'pg';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, max: 2 });
  const logger = createLogger({ service: 'review-demo-verify' });
  const chain = new HashChain(pool, logger);

  try {
    const verified = await chain.verify();
    process.stdout.write(`  ✓ chain.verify() walked ${verified} row(s); no break detected\n`);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    process.stderr.write(`  ✗ chain.verify() FAILED: ${err.message}\n`);
    process.exit(2);
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  const err = e instanceof Error ? e : new Error(String(e));
  process.stderr.write(`fatal: ${err.message}\n`);
  process.exit(2);
});
