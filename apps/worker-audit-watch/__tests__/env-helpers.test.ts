/**
 * Tier-11 audit-chain-callers audit — env-driven config validation for
 * worker-audit-watch.
 *
 * Pre-fix `Number(process.env.AUDIT_WATCH_WINDOW_HOURS ?? 24)` returned
 * NaN on a typo like "60min". The tick then computed
 * `Date.now() - NaN * 3600000 = NaN` and `new Date(NaN).toISOString()`
 * threw "Invalid time value" — silently boot, loudly crash on first
 * iteration. parsePositiveIntEnv / parseNonNegativeIntEnv catch this
 * at boot.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseNonNegativeIntEnv, parsePositiveIntEnv } from '../src/env-helpers.js';

const TEST_NAME = 'TEST_TIER11_ENV';
const ORIGINAL = process.env[TEST_NAME];

beforeEach(() => {
  delete process.env[TEST_NAME];
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[TEST_NAME];
  else process.env[TEST_NAME] = ORIGINAL;
});

describe('parsePositiveIntEnv', () => {
  it('returns fallback when env var is absent', () => {
    expect(parsePositiveIntEnv(TEST_NAME, 42)).toBe(42);
  });

  it('returns fallback when env var is the empty string', () => {
    process.env[TEST_NAME] = '';
    expect(parsePositiveIntEnv(TEST_NAME, 42)).toBe(42);
  });

  it('returns the parsed integer when valid', () => {
    process.env[TEST_NAME] = '300';
    expect(parsePositiveIntEnv(TEST_NAME, 1)).toBe(300);
  });

  it('throws on a non-numeric value (the pre-fix bug source)', () => {
    process.env[TEST_NAME] = '60min';
    expect(() => parsePositiveIntEnv(TEST_NAME, 1)).toThrow(/not a positive integer/);
  });

  it('throws on a NaN-via-Number value', () => {
    process.env[TEST_NAME] = 'abc';
    expect(() => parsePositiveIntEnv(TEST_NAME, 1)).toThrow(/not a positive integer/);
  });

  it('throws on zero (positive-only)', () => {
    process.env[TEST_NAME] = '0';
    expect(() => parsePositiveIntEnv(TEST_NAME, 1)).toThrow(/not a positive integer/);
  });

  it('throws on negative', () => {
    process.env[TEST_NAME] = '-5';
    expect(() => parsePositiveIntEnv(TEST_NAME, 1)).toThrow(/not a positive integer/);
  });

  it('throws on a float (must be integer)', () => {
    process.env[TEST_NAME] = '1.5';
    expect(() => parsePositiveIntEnv(TEST_NAME, 1)).toThrow(/not a positive integer/);
  });

  it('throws on Infinity', () => {
    process.env[TEST_NAME] = 'Infinity';
    expect(() => parsePositiveIntEnv(TEST_NAME, 1)).toThrow(/not a positive integer/);
  });

  it('error message names the env var so operators can find it', () => {
    process.env[TEST_NAME] = 'bad';
    expect(() => parsePositiveIntEnv(TEST_NAME, 1)).toThrow(new RegExp(TEST_NAME));
  });
});

describe('parseNonNegativeIntEnv', () => {
  it('accepts 0 (used for verify-rows disabled mode)', () => {
    process.env[TEST_NAME] = '0';
    expect(parseNonNegativeIntEnv(TEST_NAME, 100)).toBe(0);
  });

  it('accepts positive integers', () => {
    process.env[TEST_NAME] = '10000';
    expect(parseNonNegativeIntEnv(TEST_NAME, 1)).toBe(10000);
  });

  it('returns fallback when env var is absent', () => {
    expect(parseNonNegativeIntEnv(TEST_NAME, 10_000)).toBe(10_000);
  });

  it('throws on a non-numeric value', () => {
    process.env[TEST_NAME] = '10k';
    expect(() => parseNonNegativeIntEnv(TEST_NAME, 1)).toThrow(/not a non-negative integer/);
  });

  it('throws on negative', () => {
    process.env[TEST_NAME] = '-1';
    expect(() => parseNonNegativeIntEnv(TEST_NAME, 1)).toThrow(/not a non-negative integer/);
  });
});
