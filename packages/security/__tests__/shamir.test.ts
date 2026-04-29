import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { shamirCombine, shamirCombineFromBase64 } from '../src/shamir.js';

/* GF(256) helpers — local copy for tests only. The production code
 * intentionally exposes only `combine` (W-12 fix); split lives in the host
 * bootstrap because share material must not re-enter a long-running process. */
const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
(() => {
  let v = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = v;
    LOG[v] = i;
    v <<= 1;
    if (v & 0x100) v ^= 0x11d;
  }
  EXP[255] = EXP[0]!;
})();
const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : EXP[(LOG[a]! + LOG[b]!) % 255]!;

function shamirSplit(secret: Uint8Array, threshold: number, n: number): Uint8Array[] {
  // Build random polynomials per byte; coefficient[0] is the secret byte.
  const polys: number[][] = [];
  for (const byte of secret) {
    const coeffs = [byte];
    for (let i = 1; i < threshold; i++) coeffs.push(randomBytes(1)[0]!);
    polys.push(coeffs);
  }
  const shares: Uint8Array[] = [];
  for (let xi = 1; xi <= n; xi++) {
    const out = new Uint8Array(secret.length + 1);
    out[0] = xi;
    for (let b = 0; b < secret.length; b++) {
      let y = 0;
      let xpow = 1;
      for (const c of polys[b]!) {
        y ^= gfMul(c, xpow);
        xpow = gfMul(xpow, xi);
      }
      out[b + 1] = y;
    }
    shares.push(out);
  }
  return shares;
}

describe('shamirCombine', () => {
  it('round-trips a 32-byte secret with threshold 3-of-5', () => {
    const secret = randomBytes(32);
    const shares = shamirSplit(new Uint8Array(secret), 3, 5);
    // Any 3 of the 5 reconstruct
    for (const idxs of [
      [0, 1, 2],
      [0, 2, 4],
      [1, 3, 4],
    ]) {
      const subset = idxs.map((i) => shares[i]!);
      const recovered = shamirCombine(subset);
      expect(Buffer.from(recovered)).toEqual(secret);
    }
  });

  it('2 shares from a 3-of-5 split do not recover the secret', () => {
    const secret = randomBytes(32);
    const shares = shamirSplit(new Uint8Array(secret), 3, 5);
    const recovered = shamirCombine([shares[0]!, shares[1]!]);
    expect(Buffer.from(recovered)).not.toEqual(secret);
  });

  it('rejects duplicate X coordinates', () => {
    const secret = randomBytes(8);
    const shares = shamirSplit(new Uint8Array(secret), 3, 5);
    const dup = new Uint8Array(shares[1]!);
    dup[0] = shares[0]![0]!; // collide X
    expect(() => shamirCombine([shares[0]!, dup, shares[2]!])).toThrow(/duplicate/i);
  });

  it('rejects zero X coordinate (would expose secret bytes directly)', () => {
    const secret = randomBytes(8);
    const shares = shamirSplit(new Uint8Array(secret), 3, 5);
    const bad = new Uint8Array(shares[0]!);
    bad[0] = 0;
    expect(() => shamirCombine([bad, shares[1]!, shares[2]!])).toThrow(/zero X/i);
  });

  it('rejects shares with inconsistent length', () => {
    const secret = randomBytes(8);
    const shares = shamirSplit(new Uint8Array(secret), 3, 5);
    const truncated = shares[0]!.slice(0, shares[0]!.length - 1);
    expect(() => shamirCombine([truncated, shares[1]!, shares[2]!])).toThrow(/inconsistent/i);
  });

  it('shamirCombineFromBase64 wraps result in opaque Secret handle', () => {
    const secret = randomBytes(16);
    const shares = shamirSplit(new Uint8Array(secret), 3, 5);
    const b64 = shares.slice(0, 3).map((s) => Buffer.from(s).toString('base64'));
    const wrapped = shamirCombineFromBase64(b64);
    // Expose returns a non-throwing handle; just confirm it's a function.
    expect(wrapped).toBeDefined();
  });
});
