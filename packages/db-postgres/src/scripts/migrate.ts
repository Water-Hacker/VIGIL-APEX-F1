/**
 * Hand-rolled migration runner — applies the SQL files in `drizzle/` in order.
 *
 * We don't use `drizzle-kit migrate` because:
 *   - it requires the schema TS files to be reachable, which complicates the
 *     production migration container;
 *   - we hand-curate the SQL (0000_bootstrap, 0001_init) for fine-grained
 *     control of triggers / RLS / GRANTs that drizzle-kit doesn't generate.
 *
 * Strategy: a `_vigil_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)`
 * tracking table records what's been applied; running again is idempotent.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '@vigil/observability';

import { closePool, getPool } from '../client.js';

const logger = createLogger({ service: 'db-migrate' });

async function main(): Promise<void> {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');

  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _vigil_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Forward migrations only — files matching `*_down.sql` are
    // rollback partners (one per forward migration that ships an
    // inverse) and must NEVER be applied as part of the forward
    // sweep, otherwise we'd undo the schema we just created.
    // Rollbacks are run manually via `drizzle-kit drop` or the
    // dedicated reset workflow.
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql') && !f.endsWith('_down.sql'))
      .sort();
    for (const file of files) {
      const r = await client.query<{ name: string }>(
        'SELECT name FROM _vigil_migrations WHERE name = $1',
        [file],
      );
      if (r.rowCount && r.rowCount > 0) {
        logger.info({ file }, 'migration-skipped');
        continue;
      }
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _vigil_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info({ file }, 'migration-applied');
      } catch (e) {
        await client.query('ROLLBACK');
        logger.error({ file, err: e }, 'migration-failed');
        throw e;
      }
    }
  } finally {
    client.release();
    await closePool();
  }
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal');
  process.exit(1);
});
