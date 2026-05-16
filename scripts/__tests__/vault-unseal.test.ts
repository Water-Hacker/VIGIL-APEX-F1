/**
 * Tier-2 audit — vigil-vault-unseal/main.sh exit-code logic.
 *
 * Pre-fix bug: the probe at the top of the script was
 *
 *   if ! vault status; then
 *     if [[ "$?" -ne 2 ]]; then ... exit 3; fi
 *   fi
 *
 * Inside the then-branch of `if ! cmd`, `$?` is ALWAYS 0 (the exit
 * status of the negation, NOT the underlying command). The inner
 * `0 != 2` test therefore always evaluated true, so the script
 * always exited 3 on a sealed Vault (rc=2). Boot-time auto-unseal
 * never worked.
 *
 * Post-fix: capture the rc explicitly via `|| rc=$?` and switch
 * on it (0 = unsealed, 2 = sealed, 1 = unreachable, else fatal).
 *
 * These tests drive the script with a fake `vault` binary on PATH
 * that exits with a chosen code, plus a SHARES_DIR pointed at a
 * tmpdir, and assert the script's exit code + stderr messaging.
 * They do NOT need real Vault, real age, or real YubiKeys.
 */

import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', '..', 'tools', 'vigil-vault-unseal', 'main.sh');

async function makeFakeVault(dir: string, exitCode: number): Promise<string> {
  // Synthesize a "vault" binary that exits with the chosen code.
  // No matter what subcommand is invoked, the rc is fixed.
  const path = join(dir, 'vault');
  await writeFile(path, `#!/usr/bin/env bash\nexit ${exitCode}\n`);
  await chmod(path, 0o755);
  return path;
}

describe('vigil-vault-unseal — exit code logic', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vault-unseal-test-'));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('exits 0 immediately when `vault status` returns 0 (unsealed)', async () => {
    const binDir = await mkdtemp(join(tmpDir, 'rc0-'));
    await makeFakeVault(binDir, 0);
    // No JQ available in the test env to parse the second `vault status -format=json`
    // call (which is run when rc=0 to check `sealed: false`). Provide a fake jq too.
    const jqPath = join(binDir, 'jq');
    await writeFile(jqPath, '#!/usr/bin/env bash\necho false\n');
    await chmod(jqPath, 0o755);

    const r = spawnSync('bash', [SCRIPT, '--interactive'], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        VAULT_BIN: join(binDir, 'vault'),
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/already unsealed/);
  });

  it('proceeds past the probe when `vault status` returns 2 (sealed) — the pre-fix critical bug', async () => {
    const binDir = await mkdtemp(join(tmpDir, 'rc2-'));
    await makeFakeVault(binDir, 2);
    // No shares dir on purpose — we want the script to bail at the
    // shares-dir-missing check (exit 4), proving the rc=2 probe
    // DID NOT trigger the old exit-3 bug.
    const r = spawnSync('bash', [SCRIPT, '--auto'], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        VAULT_BIN: join(binDir, 'vault'),
        SHARES_DIR: '/nonexistent/shares-dir',
        SHAMIR_THRESHOLD: '3',
      },
      encoding: 'utf8',
    });
    // The pre-fix bug would have produced status 3 (Vault unreachable).
    // Post-fix, the probe sees rc=2 (sealed), proceeds to mode-handling,
    // then fails on the missing SHARES_DIR with exit 4.
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/shares-dir missing|SHARES_DIR/i);
    expect(r.stderr).not.toMatch(/Vault is unreachable/);
  });

  it('exits 3 with "Vault is unreachable" when `vault status` returns 1 (network/CLI error)', async () => {
    const binDir = await mkdtemp(join(tmpDir, 'rc1-'));
    await makeFakeVault(binDir, 1);
    const r = spawnSync('bash', [SCRIPT, '--auto'], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        VAULT_BIN: join(binDir, 'vault'),
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/Vault is unreachable.*rc=1/);
  });

  it('reports rc explicitly in the unreachable-error message (observability)', async () => {
    // Different unreachable rc (e.g., 5 — vault CLI's general error)
    // should still be caught by the "anything not 0 or 2" branch.
    const binDir = await mkdtemp(join(tmpDir, 'rc5-'));
    await makeFakeVault(binDir, 5);
    const r = spawnSync('bash', [SCRIPT, '--auto'], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        VAULT_BIN: join(binDir, 'vault'),
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/rc=5/);
  });
});
