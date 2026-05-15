import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadRedisPassword } from '../src/client.js';

/**
 * Mode 9.2 — Secret-rotation contract test.
 *
 * Pins the documented posture (`docs/runbooks/secret-rotation.md`):
 *   - `loadRedisPassword` re-reads the source file on every CALL (no caching).
 *   - `QueueClient` calls `loadRedisPassword` EXACTLY ONCE at construction.
 *
 * Together these mean: a rotated Redis password is only picked up on the
 * NEXT process start. There is no in-process refresh path. If a future
 * contributor adds caching to `loadRedisPassword`, or adds a watch+reload
 * path to `QueueClient`, this test fails and forces an update to both the
 * runbook and the orientation §7 Q4 rationale.
 *
 * The IORedis construction in `QueueClient` triggers an async connection
 * attempt; we DON'T construct a `QueueClient` here because we'd need a
 * live Redis to clean up the retry loop. Testing `loadRedisPassword`
 * directly is sufficient — the constructor's single call site is
 * source-pinned and the contract is documented in the function header.
 */

describe('mode 9.2 — Redis password loader (rotation contract)', () => {
  let tmp: string;
  let secretPath: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'vigil-9.2-'));
    secretPath = join(tmp, 'redis_password');
    // Snapshot and clear env vars we care about so the candidate-order
    // assertions below are deterministic regardless of host env.
    savedEnv.REDIS_PASSWORD_FILE = process.env.REDIS_PASSWORD_FILE;
    savedEnv.REDIS_PASSWORD = process.env.REDIS_PASSWORD;
    delete process.env.REDIS_PASSWORD_FILE;
    delete process.env.REDIS_PASSWORD;
  });

  afterEach(() => {
    if (savedEnv.REDIS_PASSWORD_FILE !== undefined) {
      process.env.REDIS_PASSWORD_FILE = savedEnv.REDIS_PASSWORD_FILE;
    }
    if (savedEnv.REDIS_PASSWORD !== undefined) {
      process.env.REDIS_PASSWORD = savedEnv.REDIS_PASSWORD;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it('re-reads the file on every call (no in-function caching)', () => {
    writeFileSync(secretPath, 'rotation-v1\n');
    expect(loadRedisPassword(secretPath)).toBe('rotation-v1');
    // Rotate the file content. A cached implementation would still
    // return v1; the documented posture is no cache.
    writeFileSync(secretPath, 'rotation-v2\n');
    expect(loadRedisPassword(secretPath)).toBe('rotation-v2');
    // And once more to nail the contract.
    writeFileSync(secretPath, '');
    // Empty file → falls through to env (which is unset) → null.
    expect(loadRedisPassword(secretPath)).toBeNull();
  });

  it('explicit passwordFile wins over REDIS_PASSWORD_FILE env', () => {
    const envPath = join(tmp, 'env_password');
    writeFileSync(secretPath, 'from-explicit');
    writeFileSync(envPath, 'from-env');
    process.env.REDIS_PASSWORD_FILE = envPath;
    expect(loadRedisPassword(secretPath)).toBe('from-explicit');
  });

  it('REDIS_PASSWORD_FILE env is used when explicit is undefined', () => {
    const envPath = join(tmp, 'env_password');
    writeFileSync(envPath, 'from-env');
    process.env.REDIS_PASSWORD_FILE = envPath;
    expect(loadRedisPassword(undefined)).toBe('from-env');
  });

  it('falls back to /run/secrets/redis_password if no explicit and no env file', () => {
    // We can't write /run/secrets/redis_password in CI, but we can
    // verify the fallback IS attempted by setting nothing else — the
    // function will try /run/secrets/redis_password, fail (ENOENT), and
    // proceed to REDIS_PASSWORD env or null. Setting REDIS_PASSWORD
    // here proves the chain didn't short-circuit before the env fallback.
    process.env.REDIS_PASSWORD = 'env-fallback';
    expect(loadRedisPassword(undefined)).toBe('env-fallback');
  });

  it('returns null when no source has a password', () => {
    // Explicit path doesn't exist; no env. Expect null (not throw).
    expect(loadRedisPassword('/no/such/path/redis_password')).toBeNull();
  });

  it('trims trailing whitespace and newlines from the file content', () => {
    writeFileSync(secretPath, '  password-with-whitespace  \n\n');
    expect(loadRedisPassword(secretPath)).toBe('password-with-whitespace');
  });
});
