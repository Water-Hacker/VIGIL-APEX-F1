import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StartupGuard } from '../src/startup-guard.js';

/**
 * Mode 1.7 — Infinite restart loop without circuit breaker.
 *
 * The unit tests below pin the StartupGuard contract:
 *
 *   - First boot with no history: armed, no trip.
 *   - N successful checks within the window: each appends an entry;
 *     no trip until the count exceeds maxFailures.
 *   - Trip path: sleeps for the configured duration then calls exit
 *     with the configured code.
 *   - Entries older than windowMs are pruned and don't count.
 *   - markBootSuccess removes the in-progress entry so a normal boot
 *     doesn't accumulate a false-positive.
 *
 * The exit + sleep behaviour is injected via DI so tests don't hang
 * or actually kill the test runner.
 */

describe('StartupGuard (mode 1.7)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'startup-guard-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('first boot with no history: arms without tripping; writes entry to sentinel file', async () => {
    const exit = vi.fn();
    const guard = new StartupGuard({
      serviceName: 'svc-a',
      sentinelDir: tmpDir,
      maxFailures: 5,
      windowMs: 60_000,
      tripSleepInitialMs: 1,
      tripSleepCapMs: 1,
    });
    await guard.check({ now: () => 1_000, exit: exit as never });
    expect(exit).not.toHaveBeenCalled();

    const raw = await readFile(join(tmpDir, 'svc-a.startup-failures.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version: number; failures: number[] };
    expect(parsed.version).toBe(1);
    expect(parsed.failures).toEqual([1_000]);
  });

  it('does not trip when entries are below maxFailures', async () => {
    const exit = vi.fn();
    const sentinelPath = join(tmpDir, 'svc-b.startup-failures.json');
    await writeFile(
      sentinelPath,
      JSON.stringify({ version: 1, failures: [10_000, 11_000, 12_000] }),
    );
    const guard = new StartupGuard({
      serviceName: 'svc-b',
      sentinelDir: tmpDir,
      maxFailures: 5,
      windowMs: 60_000,
      tripSleepInitialMs: 1,
      tripSleepCapMs: 1,
    });
    await guard.check({ now: () => 13_000, exit: exit as never });
    expect(exit).not.toHaveBeenCalled();

    const after = JSON.parse(await readFile(sentinelPath, 'utf8')) as {
      failures: number[];
    };
    // 3 prior + 1 new boot-in-progress = 4 entries.
    expect(after.failures).toEqual([10_000, 11_000, 12_000, 13_000]);
  });

  it('trips and exits when maxFailures is reached within the window', async () => {
    const exit = vi.fn();
    const sentinelPath = join(tmpDir, 'svc-c.startup-failures.json');
    await writeFile(sentinelPath, JSON.stringify({ version: 1, failures: [1, 2, 3, 4, 5] }));
    const guard = new StartupGuard({
      serviceName: 'svc-c',
      sentinelDir: tmpDir,
      maxFailures: 5,
      windowMs: 60_000,
      tripSleepInitialMs: 1,
      tripSleepCapMs: 5,
      exitCode: 42,
    });
    await guard.check({ now: () => 100, exit: exit as never });
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(42);
  });

  it('prunes entries older than windowMs', async () => {
    const exit = vi.fn();
    const sentinelPath = join(tmpDir, 'svc-d.startup-failures.json');
    // 5 entries at t=1..5, but window is 60s and now=200_000 — all
    // entries are far older than the cutoff (200_000 - 60_000 = 140_000).
    await writeFile(sentinelPath, JSON.stringify({ version: 1, failures: [1, 2, 3, 4, 5] }));
    const guard = new StartupGuard({
      serviceName: 'svc-d',
      sentinelDir: tmpDir,
      maxFailures: 5,
      windowMs: 60_000,
      tripSleepInitialMs: 1,
      tripSleepCapMs: 1,
    });
    await guard.check({ now: () => 200_000, exit: exit as never });
    expect(exit).not.toHaveBeenCalled();

    // Pruned entries dropped; only the new boot-in-progress remains.
    const after = JSON.parse(await readFile(sentinelPath, 'utf8')) as { failures: number[] };
    expect(after.failures).toEqual([200_000]);
  });

  it('markBootSuccess removes the boot-in-progress entry', async () => {
    const exit = vi.fn();
    const sentinelPath = join(tmpDir, 'svc-e.startup-failures.json');
    const guard = new StartupGuard({
      serviceName: 'svc-e',
      sentinelDir: tmpDir,
      maxFailures: 5,
      windowMs: 60_000,
      tripSleepInitialMs: 1,
      tripSleepCapMs: 1,
    });
    await guard.check({ now: () => 1_000, exit: exit as never });
    expect(JSON.parse(await readFile(sentinelPath, 'utf8'))).toEqual({
      version: 1,
      failures: [1_000],
    });

    await guard.markBootSuccess();
    // Sentinel file removed when the only entry was the boot-in-progress.
    await expect(readFile(sentinelPath, 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('markBootSuccess preserves OTHER prior failure entries (not just the current boot)', async () => {
    const exit = vi.fn();
    const sentinelPath = join(tmpDir, 'svc-f.startup-failures.json');
    await writeFile(sentinelPath, JSON.stringify({ version: 1, failures: [10, 20] }));
    const guard = new StartupGuard({
      serviceName: 'svc-f',
      sentinelDir: tmpDir,
      maxFailures: 5,
      windowMs: 60_000,
      tripSleepInitialMs: 1,
      tripSleepCapMs: 1,
    });
    await guard.check({ now: () => 30, exit: exit as never });
    await guard.markBootSuccess();

    // Old failures preserved; current-boot entry removed.
    const after = JSON.parse(await readFile(sentinelPath, 'utf8')) as { failures: number[] };
    expect(after.failures).toEqual([10, 20]);
  });

  it('corrupt sentinel file is treated as empty (forwards-compat)', async () => {
    const exit = vi.fn();
    const sentinelPath = join(tmpDir, 'svc-g.startup-failures.json');
    await writeFile(sentinelPath, '{not-valid-json');
    const guard = new StartupGuard({
      serviceName: 'svc-g',
      sentinelDir: tmpDir,
      maxFailures: 5,
      windowMs: 60_000,
      tripSleepInitialMs: 1,
      tripSleepCapMs: 1,
    });
    await guard.check({ now: () => 1_000, exit: exit as never });
    expect(exit).not.toHaveBeenCalled();
    // File rewritten with valid content.
    const after = JSON.parse(await readFile(sentinelPath, 'utf8')) as { failures: number[] };
    expect(after.failures).toEqual([1_000]);
  });

  // ── Code-review follow-ups ────────────────────────────────────────────

  it('atomic write — no stale `.tmp` files left behind on success', async () => {
    const { readdir } = await import('node:fs/promises');
    const exit = vi.fn();
    const guard = new StartupGuard({
      serviceName: 'svc-atomic',
      sentinelDir: tmpDir,
      maxFailures: 5,
      windowMs: 60_000,
      tripSleepInitialMs: 1,
      tripSleepCapMs: 1,
    });
    await guard.check({ now: () => 1_000, exit: exit as never });
    await guard.markBootSuccess();
    // After a clean boot + success, the dir contains no tmp files
    // (atomic rename removed the `.tmp.<pid>` artefact).
    const entries = await readdir(tmpDir);
    expect(entries.filter((e) => e.includes('.tmp.'))).toEqual([]);
  });

  it('exact-once removal: same-millisecond double-boot only removes ONE marker', async () => {
    const sentinelPath = join(tmpDir, 'svc-collision.startup-failures.json');
    // Two prior entries at the same timestamp (simulating two concurrent
    // boots that both registered at t=5_000).
    await writeFile(sentinelPath, JSON.stringify({ version: 1, failures: [5_000, 5_000, 9_999] }));
    const exit = vi.fn();
    const guard = new StartupGuard({
      serviceName: 'svc-collision',
      sentinelDir: tmpDir,
      maxFailures: 10,
      windowMs: 60_000,
      tripSleepInitialMs: 1,
      tripSleepCapMs: 1,
    });
    // This boot also lands at t=5_000 (the collision case).
    await guard.check({ now: () => 5_000, exit: exit as never });
    // After arm: [5_000, 5_000, 9_999, 5_000] — three entries at t=5_000.
    const armed = JSON.parse(await readFile(sentinelPath, 'utf8')) as { failures: number[] };
    expect(armed.failures.filter((t) => t === 5_000).length).toBe(3);

    await guard.markBootSuccess();
    // Exact-once removal: only ONE 5_000 entry deleted, the other two
    // (representing in-flight peer boots) survive. Pre-fix `filter`
    // would have deleted all three.
    const cleared = JSON.parse(await readFile(sentinelPath, 'utf8')) as { failures: number[] };
    expect(cleared.failures.filter((t) => t === 5_000).length).toBe(2);
    expect(cleared.failures).toContain(9_999);
  });

  it('writeSentinel failure throws + does not silently bypass the guard', async () => {
    const exit = vi.fn();
    // Point at a non-existent + un-createable path so writeFile throws.
    // Construct against a known-writable dir for the constructor, then
    // swap the sentinelPath at the prototype level to an unwritable one.
    const guard = new StartupGuard({
      serviceName: 'svc-fail-loud',
      sentinelDir: tmpDir,
      maxFailures: 5,
      windowMs: 60_000,
      tripSleepInitialMs: 1,
      tripSleepCapMs: 1,
    });
    (guard as unknown as { sentinelPath: string }).sentinelPath =
      '/dev/null/cannot-write/here.json';
    await expect(guard.check({ now: () => 1_000, exit: exit as never })).rejects.toThrow(
      /sentinel write failed/,
    );
    expect(exit).not.toHaveBeenCalled(); // boot did NOT silently proceed
  });

  it('preflight: writable sentinel dir is a no-op; unwritable dir warns without throwing', async () => {
    const warn = vi.fn();
    const guard = new StartupGuard({
      serviceName: 'svc-pre',
      sentinelDir: tmpDir,
      logger: {
        info: vi.fn(),
        warn,
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        silent: vi.fn(),
        level: 'info',
        child: vi.fn(),
      } as never,
    });
    await guard.preflight();
    expect(warn).not.toHaveBeenCalled();

    // Now swap to an unwritable path and confirm warn-without-throw.
    (guard as unknown as { sentinelPath: string }).sentinelPath = '/dev/null/x/y.json';
    await expect(guard.preflight()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
