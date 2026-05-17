/**
 * Tier-56 audit closure — defence-in-depth ceiling on repo listing `limit`.
 *
 * Pre-fix, every `*Repo.list*(... limit)` passed the caller-supplied
 * `limit` straight to `.limit(limit)` on Drizzle. The dashboard API
 * routes clamp at the boundary (e.g., `audit/public/route.ts` clamps
 * to 500), but internal worker callers / scripts / dr-rehearsal
 * harness bypassed that clamping.
 *
 * A buggy worker passing `limit = 10_000_000` would attempt to load
 * that many rows into Node heap — OOM-killing the worker AND stalling
 * the Postgres connection while it returns the result set.
 *
 * `clampRepoLimit` is the centralised cap applied at every repo
 * call site. Returns a safe integer in `[1, MAX_REPO_LIMIT]` and
 * tolerates NaN / Infinity / negative / fractional inputs.
 */
import { describe, expect, it } from 'vitest';

import { MAX_REPO_LIMIT, clampRepoLimit } from '../src/limit-cap.js';

describe('Tier-56 — clampRepoLimit', () => {
  it('exposes MAX_REPO_LIMIT = 10_000', () => {
    expect(MAX_REPO_LIMIT).toBe(10_000);
  });

  it('returns the value unchanged when in range', () => {
    expect(clampRepoLimit(50)).toBe(50);
    expect(clampRepoLimit(1)).toBe(1);
    expect(clampRepoLimit(MAX_REPO_LIMIT)).toBe(MAX_REPO_LIMIT);
  });

  it('clamps above MAX_REPO_LIMIT to MAX_REPO_LIMIT', () => {
    expect(clampRepoLimit(10_001)).toBe(MAX_REPO_LIMIT);
    expect(clampRepoLimit(10_000_000)).toBe(MAX_REPO_LIMIT);
    expect(clampRepoLimit(Number.MAX_SAFE_INTEGER)).toBe(MAX_REPO_LIMIT);
  });

  it('floors fractional values', () => {
    expect(clampRepoLimit(50.7)).toBe(50);
    expect(clampRepoLimit(99.999)).toBe(99);
  });

  it('clamps zero / negative to 1', () => {
    expect(clampRepoLimit(0)).toBe(1);
    expect(clampRepoLimit(-1)).toBe(1);
    expect(clampRepoLimit(-1_000_000)).toBe(1);
  });

  it('rejects NaN / Infinity → defaultLimit (or 100 if not provided)', () => {
    expect(clampRepoLimit(Number.NaN)).toBe(100);
    expect(clampRepoLimit(Number.POSITIVE_INFINITY)).toBe(100);
    expect(clampRepoLimit(Number.NEGATIVE_INFINITY)).toBe(100);
    expect(clampRepoLimit(Number.NaN, 25)).toBe(25);
  });

  it('returns the default when value is undefined', () => {
    expect(clampRepoLimit(undefined)).toBe(100);
    expect(clampRepoLimit(undefined, 50)).toBe(50);
  });
});
