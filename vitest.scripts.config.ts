/**
 * Root vitest config for scripts/__tests__/.
 *
 * The scripts/ dir is workspace-level (not a pnpm package), so the
 * per-package vitest configs don't pick up its tests. Before this
 * config existed, 6 test files at `scripts/__tests__/*.test.ts`
 * existed as documentation only — they were never executed by CI.
 *
 * This config narrowly scopes vitest to `scripts/__tests__/`. The
 * `test:scripts` npm script + the `scripts-tests` CI job invoke
 * vitest with this config:
 *
 *   pnpm exec vitest run --config vitest.scripts.config.ts
 *
 * Flagged by hardening Cat 6 secondary findings (CLOSURE notes).
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Root pinned to this file's directory (repo root) so the include
  // glob resolves to `scripts/__tests__/...` regardless of which
  // package's vitest binary invokes the config.
  root: __dirname,
  test: {
    name: 'scripts',
    environment: 'node',
    include: ['scripts/__tests__/**/*.test.ts'],
    // Each test that spawns a subprocess (e.g. check-compose-deps.test.ts
    // uses `spawnSync` to invoke its own script) needs the workspace's
    // tsx on PATH. Default for vitest is the test's cwd, which is the
    // repo root in this config — good enough.
    testTimeout: 15_000, // some scripts shell out to openssl / pg_isready
  },
});
