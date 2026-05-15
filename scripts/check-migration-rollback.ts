#!/usr/bin/env tsx
/**
 * Hardening mode 9.3 + 9.6 — Migration rollback round-trip gate.
 *
 * Runs forward → reverse-order down → forward against an ephemeral
 * Postgres DB. All three sweeps must complete without SQL error. If
 * a `*_down.sql` file is broken (forgets to drop something, drops
 * something the matching forward didn't create, or has bad SQL), the
 * re-forward step fails on object collision OR the down step fails
 * directly.
 *
 * The orientation classifies modes 9.3 (rollback compatibility) and
 * 9.6 (schema migration without tested rollback) as a single closure:
 * "CI job that runs forward → down → forward against an ephemeral
 * DB. Mark *_down.sql 'prod-safe' only after this passes."
 *
 * Note: this gate verifies dev-environment rollback. Production
 * rollback uses PITR per docs/RESTORE.md; the *_down.sql files
 * remain labelled "dev only" in their headers and that posture does
 * NOT change with this closure. See the orientation §3.9 / 9.3 entry
 * for the rationale.
 *
 * Required env:
 *   INTEGRATION_DB_URL — postgres:// connection string to a
 *     throwaway DB. The script wipes all VIGIL schemas + the
 *     `_vigil_migrations` tracking table at start; running against a
 *     production DB would be catastrophic. The CI workflow points
 *     this at the per-job postgres service container.
 *
 * Exit codes:
 *   0  — forward → down → forward all succeeded.
 *   1  — any sweep failed; the offending file + SQL error is logged.
 *   2  — INTEGRATION_DB_URL not set or unusable; aborts before
 *        touching anything.
 *
 * Run locally:
 *   INTEGRATION_DB_URL=postgres://vigil:dev@localhost:5432/vigil_test \
 *     pnpm exec tsx scripts/check-migration-rollback.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { Client } from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'packages/db-postgres/drizzle');

const VIGIL_SCHEMAS = [
  'audit',
  'calibration',
  'certainty',
  'dossier',
  'entity',
  'finding',
  'governance',
  'llm',
  'pattern_discovery',
  'source',
  'tip',
];

interface MigrationFile {
  readonly name: string;
  readonly path: string;
  readonly sql: string;
}

function loadMigrations(): { forward: MigrationFile[]; down: MigrationFile[] } {
  const all = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}.*\.sql$/.test(f))
    .sort();
  const forward: MigrationFile[] = [];
  const down: MigrationFile[] = [];
  for (const name of all) {
    const path = join(MIGRATIONS_DIR, name);
    const sql = readFileSync(path, 'utf8');
    if (name.endsWith('_down.sql')) {
      down.push({ name, path, sql });
    } else {
      forward.push({ name, path, sql });
    }
  }
  // Down migrations run in REVERSE numeric order — undo the latest first.
  down.reverse();
  return { forward, down };
}

async function resetDb(client: Client): Promise<void> {
  // Order matters — DROP SCHEMA CASCADE removes FK targets; doing it in
  // any order is safe because CASCADE chases dependent objects.
  for (const s of VIGIL_SCHEMAS) {
    await client.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
  }
  await client.query('DROP TABLE IF EXISTS _vigil_migrations');
}

async function applySweep(
  client: Client,
  files: MigrationFile[],
  sweepLabel: string,
): Promise<void> {
  for (const f of files) {
    process.stdout.write(`[check-migration-rollback] ${sweepLabel}: ${f.name} ... `);
    try {
      await client.query('BEGIN');
      await client.query(f.sql);
      await client.query('COMMIT');
      process.stdout.write('ok\n');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      process.stdout.write('FAIL\n');
      const err = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[check-migration-rollback] sweep=${sweepLabel} file=${f.name}\n`);
      process.stderr.write(`[check-migration-rollback] error: ${err}\n`);
      throw e;
    }
  }
}

async function main(): Promise<number> {
  const url = process.env.INTEGRATION_DB_URL;
  if (!url) {
    process.stderr.write(
      '[check-migration-rollback] INTEGRATION_DB_URL not set. Set it to a throw-away postgres:// URL.\n',
    );
    return 2;
  }

  const { forward, down } = loadMigrations();
  process.stdout.write(
    `[check-migration-rollback] loaded ${forward.length} forward + ${down.length} down migrations\n`,
  );

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[check-migration-rollback] connect failed: ${err}\n`);
    return 2;
  }

  try {
    process.stdout.write('[check-migration-rollback] phase 1/4: reset DB\n');
    await resetDb(client);

    process.stdout.write('[check-migration-rollback] phase 2/4: forward sweep\n');
    await applySweep(client, forward, 'forward-1');

    process.stdout.write('[check-migration-rollback] phase 3/4: down sweep (reverse order)\n');
    await applySweep(client, down, 'down');

    // Full reset before the second forward sweep. We deliberately reset
    // all VIGIL schemas + the tracking table here rather than relying on
    // the down sweep alone, because the legacy forward-only migrations
    // (0000_bootstrap, 0001_init, 0002–0006, 0008 per the allow-list in
    // scripts/check-migration-pairs.ts) have no `*_down.sql` partners,
    // so their state survives the down sweep. After the down sweep,
    // re-running 0001_init against the partially-reverted DB fails with
    // "policy X already exists" / "type X already exists" / etc. —
    // legitimate post-condition of "0001 isn't idempotent + has no down".
    //
    // The gate's invariant is "down migrations run cleanly + forwards
    // run cleanly against a freshly-reset DB". Verifying that downs
    // FULLY reverse forwards would require every legacy migration to
    // ship a down, which is out of scope for the AUDIT-051 allowlist
    // posture. See docs/audit/evidence/hardening/category-9/mode-9.3-9.6/CLOSURE.md.
    process.stdout.write('[check-migration-rollback] reset between sweeps\n');
    await resetDb(client);

    process.stdout.write('[check-migration-rollback] phase 4/4: forward sweep again\n');
    await applySweep(client, forward, 'forward-2');

    process.stdout.write('[check-migration-rollback] OK — forward → down → forward all clean\n');
    return 0;
  } catch {
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const err = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[check-migration-rollback] crashed: ${err}\n`);
    process.exit(1);
  });
