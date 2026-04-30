/**
 * AUDIT-029 — pickFingerprint must not use Math.random for the no-seed
 * branch. Predictable PRNG output gives a target site a fingerprint
 * cluster it can rate-limit / block. Use Node's crypto.randomInt for
 * cryptographic-strength selection.
 *
 * The seeded path (when callers pass a request id / hash) is unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pickFingerprint } from '../src/fingerprint.js';

describe('AUDIT-029 — pickFingerprint cryptographic randomness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT call Math.random in the no-seed branch', () => {
    const spy = vi.spyOn(Math, 'random');
    for (let i = 0; i < 100; i++) pickFingerprint();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns a valid profile in the no-seed branch', () => {
    const fp = pickFingerprint();
    expect(fp.userAgent).toBeTruthy();
    expect(fp.userAgent.length).toBeGreaterThan(0);
    expect(fp.viewport.width).toBeGreaterThan(0);
    expect(fp.viewport.height).toBeGreaterThan(0);
    expect(['fr-CM', 'en-CM', 'fr-FR', 'en-US']).toContain(fp.locale);
    expect(fp.timezone).toBe('Africa/Douala');
    expect(fp.acceptLanguage).toMatch(/^(fr|en)-CM/);
  });

  it('seeded path is deterministic (unchanged)', () => {
    const a = pickFingerprint('request-id-42');
    const b = pickFingerprint('request-id-42');
    expect(a).toEqual(b);
  });

  it('no-seed path covers all four viewport bins over many calls (distribution sanity)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const fp = pickFingerprint();
      seen.add(`${fp.viewport.width}x${fp.viewport.height}`);
    }
    // crypto.randomInt over 200 calls should hit all 4 bins with
    // overwhelming probability (1 - 4 * (3/4)^200 ≈ 1 - 1e-24).
    expect(seen.size).toBe(4);
  });
});
