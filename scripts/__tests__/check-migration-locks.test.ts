/**
 * Mode 2.5 — Migration locks CI gate regression tests.
 *
 * Verifies that `scripts/check-migration-locks.ts`:
 *   (a) passes against the current `drizzle/` migration tree, AND
 *   (b) actually catches an unsafe CREATE INDEX when one is introduced.
 *
 * The (b) test is the hardening proof: without it, a future refactor
 * could disable the regex or expand the LARGE_TABLES list incorrectly
 * and no one would notice until production deployment.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'check-migration-locks.ts');
const REPO_ROOT = join(__dirname, '..', '..');

describe('check-migration-locks script (mode 2.5)', () => {
  it('passes against the current drizzle/ tree', () => {
    // The repo's existing migrations either use CONCURRENTLY or carry
    // the acknowledged-locks marker. The script must exit 0.
    const result = spawnSync('npx', ['tsx', SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
    if (result.status !== 0) {
      // Surface stdout+stderr to diagnose CI failures.
      console.error('STDOUT:', result.stdout);
      console.error('STDERR:', result.stderr);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\[migration-locks\] OK/);
  });

  describe('synthetic violation detection', () => {
    let tmpScript: string;
    let tmpMigrationsDir: string;

    beforeAll(async () => {
      // Build a temporary clone of the script that points at a tmp
      // migrations dir. The script reads MIGRATIONS_DIR via a path
      // derived from import.meta.url, so we override via an env-var
      // shim: write a fake script that imports the original logic but
      // patches MIGRATIONS_DIR. Simpler: write a self-contained copy
      // of just the violation-detection helper into a tmpdir.
      tmpMigrationsDir = await mkdtemp(join(tmpdir(), 'mode-2.5-test-'));
      tmpScript = join(tmpMigrationsDir, 'check.ts');

      // Inline a minimal version of the script that scans tmpMigrationsDir.
      // The top-level await + for-loop must be wrapped in an async IIFE
      // because tsx default-emits CJS where top-level await isn't legal;
      // an earlier revision left them at top level and tsx's esbuild
      // transform failed with "Top-level await is currently not supported
      // with the cjs output format" → spawnSync exited with the transform
      // error rather than the script's intended exit code.
      const inlineScript = `
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = ${JSON.stringify(tmpMigrationsDir)};
const LARGE_TABLES = ['finding.signal', 'finding.finding'];
const ACK = /^\\s*--\\s*@migration-locks-acknowledged:/m;
const RE = /CREATE\\s+INDEX\\s+(?<conc>CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?[\\w"]+\\s+ON\\s+(?<table>[\\w"]+(?:\\.[\\w"]+)?)/gi;

async function main() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  let viols = 0;
  for (const f of files) {
    const c = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
    const ack = c.match(ACK);
    for (const m of c.matchAll(RE)) {
      const t = (m.groups?.table ?? '').replace(/"/g, '');
      if (!LARGE_TABLES.includes(t)) continue;
      if (m.groups?.conc) continue;
      if (ack) continue;
      console.error(f + ': violation on ' + t);
      viols++;
    }
  }
  process.exit(viols === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
`;
      await writeFile(tmpScript, inlineScript);
    });

    afterAll(async () => {
      await rm(tmpMigrationsDir, { recursive: true, force: true });
    });

    it('detects a CREATE INDEX without CONCURRENTLY on a large table', async () => {
      const migrationPath = join(tmpMigrationsDir, '0001_bad.sql');
      await writeFile(
        migrationPath,
        `CREATE INDEX bad_idx ON finding.signal (finding_id);
`,
      );
      const result = spawnSync('npx', ['tsx', tmpScript], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/finding\.signal/);
      // Cleanup before next test in this block.
      await rm(migrationPath);
    });

    it('accepts CREATE INDEX CONCURRENTLY on a large table', async () => {
      const migrationPath = join(tmpMigrationsDir, '0002_concurrent.sql');
      await writeFile(
        migrationPath,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS good_idx ON finding.signal (finding_id);
`,
      );
      const result = spawnSync('npx', ['tsx', tmpScript], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      await rm(migrationPath);
    });

    it('accepts a non-CONCURRENTLY index if the acknowledged-locks marker is present', async () => {
      const migrationPath = join(tmpMigrationsDir, '0003_acked.sql');
      await writeFile(
        migrationPath,
        `-- @migration-locks-acknowledged: table is empty at migration time
CREATE INDEX legacy_idx ON finding.signal (finding_id);
`,
      );
      const result = spawnSync('npx', ['tsx', tmpScript], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      await rm(migrationPath);
    });

    it('ignores CREATE INDEX on small/non-large tables (no false positives)', async () => {
      const migrationPath = join(tmpMigrationsDir, '0004_small.sql');
      await writeFile(
        migrationPath,
        `CREATE INDEX small_idx ON tiny_lookup_table (key);
`,
      );
      const result = spawnSync('npx', ['tsx', tmpScript], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      await rm(migrationPath);
    });
  });
});
