/**
 * Block-E E.11 / A5.4 — salt-collision-check trigger.
 *
 * Asserts:
 *   1. Empty view → returns clean status, no throw, no error log.
 *   2. View with collision rows → throws SaltCollisionError carrying
 *      the rows; logs `audit.public_export.salt_collision` event so
 *      the Prometheus alert-rule scraper can fire.
 *   3. The error message is operator-actionable (names the env var
 *      to rotate).
 */
import { describe, expect, it, vi } from 'vitest';

import { SaltCollisionError, runSaltCollisionCheck } from '../src/triggers/salt-collision-check.js';

import type { Db } from '@vigil/db-postgres';
import type { Logger } from '@vigil/observability';

function makeLogger(): Logger & {
  infoCalls: unknown[];
  errorCalls: unknown[];
} {
  const infoCalls: unknown[] = [];
  const errorCalls: unknown[] = [];
  const fn =
    (calls: unknown[]) =>
    (...args: unknown[]) => {
      calls.push(args);
    };
  return {
    info: fn(infoCalls) as Logger['info'],
    error: fn(errorCalls) as Logger['error'],
    warn: fn([]) as Logger['warn'],
    debug: fn([]) as Logger['debug'],
    fatal: fn([]) as Logger['fatal'],
    trace: fn([]) as Logger['trace'],
    child: () => makeLogger() as Logger,
    level: 'info',
    bindings: () => ({}),
    flush: () => undefined,
    silent: fn([]) as Logger['silent'],
    isLevelEnabled: () => true,
    onChild: () => undefined,
    levelVal: 30,
    levels: { values: {}, labels: {} },
    customLevels: {},
    useOnlyCustomLevels: false,
    setBindings: () => undefined,
    infoCalls,
    errorCalls,
  } as unknown as Logger & { infoCalls: unknown[]; errorCalls: unknown[] };
}

function makeDb(rows: unknown[]): Db {
  return {
    execute: vi.fn(async () => ({ rows })),
  } as unknown as Db;
}

describe('Block-E E.11 / A5.4 — runSaltCollisionCheck', () => {
  it('returns clean when the view is empty', async () => {
    const logger = makeLogger();
    const db = makeDb([]);
    const result = await runSaltCollisionCheck({ db, logger });
    expect(result.status).toBe('clean');
    expect(result.collisionCount).toBe(0);
    expect(logger.errorCalls.length).toBe(0);
    expect(logger.infoCalls.length).toBe(1);
  });

  it('throws SaltCollisionError when the view returns collision rows', async () => {
    const logger = makeLogger();
    const collidingRow = {
      curr_id: 'export-2026-Q3',
      curr_period: '2026-Q3',
      prev_period: '2026-Q1',
      salt_fingerprint: 'deadbeef',
    };
    const db = makeDb([collidingRow]);
    await expect(runSaltCollisionCheck({ db, logger })).rejects.toBeInstanceOf(SaltCollisionError);
    // Check that the error carries the row data (separate call since
    // rejects.toBeInstanceOf consumed the promise).
    const db2 = makeDb([collidingRow]);
    const err = await runSaltCollisionCheck({ db: db2, logger: makeLogger() }).catch(
      (e: unknown) => e as SaltCollisionError,
    );
    expect(err).toBeInstanceOf(SaltCollisionError);
    expect(err.collisions).toHaveLength(1);
    expect(err.collisions[0]!.salt_fingerprint).toBe('deadbeef');
    expect(err.collisions[0]!.curr_period).toBe('2026-Q3');
    expect(err.collisions[0]!.prev_period).toBe('2026-Q1');
  });

  it('logs the `audit.public_export.salt_collision` event for Prometheus scrape', async () => {
    const logger = makeLogger();
    const db = makeDb([
      {
        curr_id: 'export-2026-Q3',
        curr_period: '2026-Q3',
        prev_period: '2026-Q2',
        salt_fingerprint: 'cafebabe',
      },
    ]);
    await expect(runSaltCollisionCheck({ db, logger })).rejects.toBeDefined();
    expect(logger.errorCalls.length).toBe(1);
    const [structured] = logger.errorCalls[0] as [Record<string, unknown>, string];
    expect(structured.event).toBe('audit.public_export.salt_collision');
    expect(Array.isArray(structured.collisions)).toBe(true);
  });

  it('error message names AUDIT_PUBLIC_EXPORT_SALT (operator-actionable)', async () => {
    const logger = makeLogger();
    const db = makeDb([
      {
        curr_id: 'a',
        curr_period: '2026-Q3',
        prev_period: '2026-Q2',
        salt_fingerprint: 'aaaaaaaa',
      },
    ]);
    const err = await runSaltCollisionCheck({ db, logger }).catch((e: unknown) => e as Error);
    expect(err.message).toContain('AUDIT_PUBLIC_EXPORT_SALT');
    expect(err.message.toLowerCase()).toContain('rotate');
  });

  it('handles array-shaped result (drizzle pg compatibility)', async () => {
    const logger = makeLogger();
    // Some drizzle drivers return rows as a plain array, not {rows: []}.
    // The trigger probes both shapes.
    const arrayResult = [
      {
        curr_id: 'a',
        curr_period: '2026-Q3',
        prev_period: '2026-Q2',
        salt_fingerprint: 'aaaaaaaa',
      },
    ];
    const db = {
      execute: vi.fn(async () => arrayResult),
    } as unknown as Db;
    await expect(runSaltCollisionCheck({ db, logger })).rejects.toBeInstanceOf(SaltCollisionError);
  });
});
