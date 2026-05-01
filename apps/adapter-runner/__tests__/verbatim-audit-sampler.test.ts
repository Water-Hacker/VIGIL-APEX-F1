/**
 * AUDIT-092 — pin the AI-Safety-Doctrine §B.1 sampler's uniform-sample helper.
 *
 * Phase-1 description:
 *   `[...allRows].sort(() => Math.random() - 0.5).slice(0, sampleSize)` —
 *   non-cryptographic RNG + biased sort-by-random shuffle on a doctrine-
 *   load-bearing audit path. The doctrine claims "5 % uniform sample"; the
 *   pre-fix implementation does not deliver one.
 *
 * Closure: `uniformSample` is partial Fisher-Yates over `crypto.randomInt`.
 *
 * Tests pin:
 *   1. Boundary cases (k=0, n=0, k>=n, k=1).
 *   2. Output is a permutation-prefix of the input (every output element
 *      appears in input; no duplicates introduced).
 *   3. Source-grep: the trigger does not call `Math.random` and does not
 *      use the `sort(compareFn)` shuffle pattern.
 *   4. Distributional uniformity: over many trials, every input position
 *      appears in the output with empirical frequency within tolerance of
 *      the expected k/n. The biased pre-fix shuffle skewed end-positions
 *      toward the middle; this test would have failed for it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { uniformSample } from '../src/triggers/uniform-sample';

describe('AUDIT-092 — uniformSample boundary contract', () => {
  it('returns [] for k=0', () => {
    expect(uniformSample([1, 2, 3], 0)).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(uniformSample([], 5)).toEqual([]);
  });

  it('returns a permutation of the full input when k >= n', () => {
    const out = uniformSample([1, 2, 3, 4, 5], 5);
    expect(out.slice().sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns a permutation-prefix when k > n (clamped)', () => {
    const out = uniformSample([1, 2, 3], 10);
    expect(out.slice().sort()).toEqual([1, 2, 3]);
  });

  it('returns exactly k elements when 0 < k < n', () => {
    const input = Array.from({ length: 100 }, (_, i) => i);
    const out = uniformSample(input, 7);
    expect(out).toHaveLength(7);
    // Every output element is from the input.
    for (const v of out) expect(input).toContain(v);
    // No duplicates.
    expect(new Set(out).size).toBe(7);
  });

  it('does not mutate the input array', () => {
    const input = [10, 20, 30, 40, 50] as const;
    const before = [...input];
    uniformSample(input, 3);
    expect([...input]).toEqual(before);
  });
});

describe('AUDIT-092 — uniformSample distributional uniformity', () => {
  /**
   * Over T trials of sampling k from n, every input position should appear
   * in the output with empirical frequency ≈ k/n. We pick T large enough
   * that a biased shuffle (e.g., `sort(() => Math.random() - 0.5)` which
   * over-represents end positions in the first-k slice) would fail the
   * tolerance, and a uniform shuffle would pass.
   *
   * Tolerance is wide enough that statistical noise won't flake under CI,
   * narrow enough that the textbook biased-shuffle skew (well-documented
   * to over- or under-represent positions by 5-15% depending on engine
   * sort impl) would fail.
   */
  it('every input position appears with empirical freq within tolerance of k/n', () => {
    const N = 20;
    const K = 5;
    const TRIALS = 4_000;
    const input = Array.from({ length: N }, (_, i) => i);
    const counts = new Array<number>(N).fill(0);
    for (let t = 0; t < TRIALS; t++) {
      const out = uniformSample(input, K);
      for (const v of out) counts[v]++;
    }
    const expected = (TRIALS * K) / N;
    const tolerance = expected * 0.1; // ±10% empirical tolerance
    for (let i = 0; i < N; i++) {
      const c = counts[i] ?? 0;
      expect(
        Math.abs(c - expected),
        `position ${i} frequency ${c} outside [${expected - tolerance}, ${expected + tolerance}]`,
      ).toBeLessThan(tolerance);
    }
  });
});

describe('AUDIT-092 — source guards (trigger does not regress to biased RNG)', () => {
  it('verbatim-audit-sampler.ts does not import or call Math.random', () => {
    const src = readFileSync(join(__dirname, '../src/triggers/verbatim-audit-sampler.ts'), 'utf8');
    expect(src).not.toMatch(/Math\.random/);
  });

  it('verbatim-audit-sampler.ts does not use the sort-by-random shuffle pattern', () => {
    const src = readFileSync(join(__dirname, '../src/triggers/verbatim-audit-sampler.ts'), 'utf8');
    // Pattern: .sort((a, b) => ...) or .sort(() => ...) where body references
    // a random call. We grep for `.sort(() =>` since that's the canonical
    // biased-shuffle shape.
    expect(src).not.toMatch(/\.sort\(\(\)\s*=>/);
  });

  it('verbatim-audit-sampler.ts routes sampling through uniformSample', () => {
    const src = readFileSync(join(__dirname, '../src/triggers/verbatim-audit-sampler.ts'), 'utf8');
    expect(src).toMatch(/uniformSample\(allRows,\s*sampleSize\)/);
  });

  it('uniform-sample.ts imports randomInt from node:crypto', () => {
    const src = readFileSync(join(__dirname, '../src/triggers/uniform-sample.ts'), 'utf8');
    expect(src).toMatch(/randomInt[\s\S]{0,40}from\s+['"]node:crypto['"]/);
  });
});
