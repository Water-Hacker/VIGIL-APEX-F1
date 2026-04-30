/**
 * Benchmark-price service — pure-function helpers + repo shape.
 *
 * The repo's SQL paths require a live Postgres; those are covered by
 * the integration test in apps/worker-extractor's e2e suite. This file
 * pins the pure logic (percentile interpolation + threshold constants)
 * that the SQL path delegates to.
 */
import { describe, expect, it } from 'vitest';

import { BENCHMARK_MIN_BUCKET_SAMPLE, percentile } from '../src/repos/benchmark-price.js';

describe('percentile', () => {
  it('returns the only element for a singleton list', () => {
    expect(percentile([42], 0.5)).toBe(42);
  });

  it('returns the median of an odd-length list', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it('interpolates between two indices for an even-length list', () => {
    // For [1,2,3,4]: q=0.5 → idx = 1.5 → 0.5*2 + 0.5*3 = 2.5 → rounded 3
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(3);
  });

  it('clamps q ≤ 0 to the first element', () => {
    expect(percentile([10, 20, 30], 0)).toBe(10);
    expect(percentile([10, 20, 30], -1)).toBe(10);
  });

  it('clamps q ≥ 1 to the last element', () => {
    expect(percentile([10, 20, 30], 1)).toBe(30);
    expect(percentile([10, 20, 30], 2)).toBe(30);
  });

  it('returns 0 for empty list', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('computes p25 / p75 for a 100-row sample', () => {
    const list = Array.from({ length: 100 }, (_, i) => i + 1);
    // idx = (n-1)*q = 99 * 0.25 = 24.75 (frac toward hi = 0.75)
    // lerp(25, 26, 0.75) = 25*0.25 + 26*0.75 = 25.75 → rounds to 26
    expect(percentile(list, 0.25)).toBe(26);
    // idx = 49.5; lerp(50, 51, 0.5) = 50.5 → rounds to 51
    expect(percentile(list, 0.5)).toBe(51);
    // idx = 74.25; lerp(75, 76, 0.25) = 75.25 → rounds to 75
    expect(percentile(list, 0.75)).toBe(75);
  });

  it('rounds non-integer interpolations', () => {
    // [1,4]: q=0.5 → idx=0.5 → 0.5*1 + 0.5*4 = 2.5 → rounded 3
    expect(percentile([1, 4], 0.5)).toBe(3);
  });
});

describe('benchmark constants', () => {
  it('exposes the minimum bucket sample threshold', () => {
    expect(BENCHMARK_MIN_BUCKET_SAMPLE).toBe(5);
  });
});
