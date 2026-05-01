import { randomInt } from 'node:crypto';

/**
 * AUDIT-092 — uniform without-replacement sample of `k` elements from `rows`.
 *
 * Implementation: partial Fisher-Yates with `crypto.randomInt(i, n)`. The
 * AI-Safety-Doctrine §B.1 sampler MUST produce a uniform sample — both
 * `Math.random()` (predictable) and `[...rows].sort(() => Math.random() - 0.5)`
 * (the textbook biased shuffle) violate that contract.
 *
 * Lives in its own module so it can be unit-tested without dragging the
 * sampler's `@vigil/llm` side-effect import into the test runner.
 */
export function uniformSample<T>(rows: ReadonlyArray<T>, k: number): T[] {
  const n = rows.length;
  if (k <= 0 || n === 0) return [];
  if (k >= n) return [...rows];
  const arr = [...rows];
  for (let i = 0; i < k; i++) {
    const j = randomInt(i, n);
    const ai = arr[i] as T;
    const aj = arr[j] as T;
    arr[i] = aj;
    arr[j] = ai;
  }
  return arr.slice(0, k);
}
