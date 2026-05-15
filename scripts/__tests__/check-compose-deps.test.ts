/**
 * Mode 1.3 — depends_on cycle detector regression tests.
 *
 * Verifies that scripts/check-compose-deps.ts:
 *   (a) passes against the real infra/docker/docker-compose.yaml,
 *   (b) catches a synthetic self-loop,
 *   (c) catches a synthetic two-node cycle,
 *   (d) catches a synthetic three-node cycle.
 *
 * Synthetic fixtures are written to a tmpdir and passed via the
 * COMPOSE_PATH env override.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'check-compose-deps.ts');
const REPO_ROOT = join(__dirname, '..', '..');

describe('check-compose-deps script (mode 1.3)', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mode-1.3-test-'));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('passes against the real docker-compose.yaml', () => {
    const r = spawnSync('npx', ['tsx', SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
      console.error('STDOUT:', r.stdout);
      console.error('STDERR:', r.stderr);
    }
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\[compose-deps\] OK/);
  });

  it('detects a self-loop', async () => {
    const fixturePath = join(tmpDir, 'self-loop.yaml');
    await writeFile(
      fixturePath,
      `services:
  alpha:
    image: nginx
    depends_on:
      alpha: { condition: service_healthy }
`,
    );
    const r = spawnSync('npx', ['tsx', SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, COMPOSE_PATH: fixturePath },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/self-loop/);
    expect(r.stderr).toMatch(/alpha/);
  });

  it('detects a two-node cycle', async () => {
    const fixturePath = join(tmpDir, 'two-cycle.yaml');
    await writeFile(
      fixturePath,
      `services:
  alpha:
    depends_on:
      beta: { condition: service_healthy }
  beta:
    depends_on:
      alpha: { condition: service_healthy }
`,
    );
    const r = spawnSync('npx', ['tsx', SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, COMPOSE_PATH: fixturePath },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/cycle detected/);
  });

  it('detects a three-node cycle', async () => {
    const fixturePath = join(tmpDir, 'three-cycle.yaml');
    await writeFile(
      fixturePath,
      `services:
  alpha:
    depends_on:
      beta: { condition: service_healthy }
  beta:
    depends_on:
      gamma: { condition: service_healthy }
  gamma:
    depends_on:
      alpha: { condition: service_healthy }
`,
    );
    const r = spawnSync('npx', ['tsx', SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, COMPOSE_PATH: fixturePath },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /cycle detected.*alpha.*beta.*gamma|cycle detected.*beta.*gamma.*alpha|cycle detected.*gamma.*alpha.*beta/,
    );
  });

  it('accepts a valid acyclic DAG', async () => {
    const fixturePath = join(tmpDir, 'dag.yaml');
    await writeFile(
      fixturePath,
      `services:
  alpha:
    image: nginx
  beta:
    depends_on:
      alpha: { condition: service_healthy }
  gamma:
    depends_on:
      alpha: { condition: service_healthy }
      beta: { condition: service_healthy }
`,
    );
    const r = spawnSync('npx', ['tsx', SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, COMPOSE_PATH: fixturePath },
    });
    expect(r.status).toBe(0);
  });

  it('accepts depends_on in array form', async () => {
    const fixturePath = join(tmpDir, 'array-form.yaml');
    await writeFile(
      fixturePath,
      `services:
  alpha:
    image: nginx
  beta:
    depends_on:
      - alpha
`,
    );
    const r = spawnSync('npx', ['tsx', SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, COMPOSE_PATH: fixturePath },
    });
    expect(r.status).toBe(0);
  });
});
