/**
 * Tier-28 audit closure — bulk-id caps on SourceRepo + EntityRepo.
 *
 * node-postgres has a hard ~32k parameter-binding ceiling per query.
 * Pre-T28, getEventsByIds / getCanonicalMany passed the entire input
 * array as IN-clause bindings; any caller passing > ~32k ids hit an
 * opaque "bind message has X parameter formats but Y parameters" 500.
 *
 * Defence: refuse at MAX_BULK_IDS = 1000 with a clear error so callers
 * learn to chunk instead of debugging the driver error.
 *
 * These tests don't need a live DB — they exercise the boundary check
 * before any drizzle call is made. The mock `db` only needs `select`
 * to exist for the empty-input early-return path.
 */
import { describe, expect, it } from 'vitest';

import { EntityRepo, ENTITY_REPO_MAX_BULK_IDS } from '../src/repos/entity.js';
import { SourceRepo, SOURCE_REPO_MAX_BULK_IDS } from '../src/repos/source.js';

import type { Db } from '../src/client.js';

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve([] as never),
      limit: () => Promise.resolve([] as never),
    }),
  }),
} as unknown as Db;

function uuidArray(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const hex = i.toString(16).padStart(8, '0');
    return `${hex}-0000-0000-0000-000000000000`;
  });
}

describe('Tier-28 — SourceRepo.getEventsByIds bulk cap', () => {
  const repo = new SourceRepo(fakeDb);

  it('returns [] on empty input (early-out, no DB call)', async () => {
    const out = await repo.getEventsByIds([]);
    expect(out).toEqual([]);
  });

  it('accepts exactly MAX_BULK_IDS ids', async () => {
    // Doesn't throw — passes through to drizzle (which our fake stub
    // returns []). The cap is `>` so MAX itself is fine.
    await expect(repo.getEventsByIds(uuidArray(SOURCE_REPO_MAX_BULK_IDS))).resolves.toEqual([]);
  });

  it('rejects MAX_BULK_IDS + 1 ids with a clear cap-named error', async () => {
    await expect(repo.getEventsByIds(uuidArray(SOURCE_REPO_MAX_BULK_IDS + 1))).rejects.toThrow(
      /cap is 1000.*chunk/,
    );
  });

  it('rejects 32k ids (driver-ceiling DoS vector)', async () => {
    await expect(repo.getEventsByIds(uuidArray(32_000))).rejects.toThrow(/cap is 1000/);
  });

  it('cap constant value pinned to 1000 — a future bump is intentional', () => {
    expect(SOURCE_REPO_MAX_BULK_IDS).toBe(1000);
  });
});

describe('Tier-28 — EntityRepo.getCanonicalMany bulk cap', () => {
  const repo = new EntityRepo(fakeDb);

  it('returns [] on empty input (early-out)', async () => {
    const out = await repo.getCanonicalMany([]);
    expect(out).toEqual([]);
  });

  it('accepts exactly MAX_BULK_IDS ids', async () => {
    await expect(repo.getCanonicalMany(uuidArray(ENTITY_REPO_MAX_BULK_IDS))).resolves.toEqual([]);
  });

  it('rejects MAX_BULK_IDS + 1 ids', async () => {
    await expect(repo.getCanonicalMany(uuidArray(ENTITY_REPO_MAX_BULK_IDS + 1))).rejects.toThrow(
      /cap is 1000.*chunk/,
    );
  });

  it('cap constant value pinned to 1000', () => {
    expect(ENTITY_REPO_MAX_BULK_IDS).toBe(1000);
  });
});
