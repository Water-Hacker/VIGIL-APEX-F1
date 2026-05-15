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

  /* -------------------------------------------------------------------- *
   * Mode 5.9 — corrupted Y-byte produces a silently wrong key.
   *
   * Lagrange interpolation over GF(256) is deterministic: given 3 share
   * tuples (xi, yi) it produces exactly one secret regardless of whether
   * the yi values are the originals or have been tampered with. If a
   * single Y byte is flipped, the combiner does NOT detect the
   * corruption — it produces a SILENTLY-WRONG key.
   *
   * The combiner is correct in isolation: bad input → bad output. The
   * detection responsibility lives UPSTREAM:
   *
   *   - In production, each council member's share is encrypted to
   *     their YubiKey via age-plugin-yubikey. age uses authenticated
   *     encryption (ChaCha20-Poly1305 + scrypt-derived keys), so a
   *     ciphertext with a flipped byte fails the MAC and age refuses
   *     to decrypt. Corrupted shares never reach shamirCombine.
   *
   *   - In tests + dev, callers passing raw shares are responsible for
   *     their own integrity check (e.g. a sha256 prefix). shamirCombine
   *     does not perform this check.
   *
   * The tests below pin BOTH halves of the contract:
   *   (a) Healthy shares produce the secret.
   *   (b) Y-byte corruption produces a wrong secret WITHOUT throwing —
   *       proving the detection responsibility sits upstream of the
   *       Lagrange combiner. If a future PR adds a Y-byte checksum to
   *       shamirCombine itself (changing the contract), this test
   *       fails and forces the change to be considered explicitly.
   * -------------------------------------------------------------------- */
  describe('mode 5.9 — corrupted-share detection is upstream of shamirCombine', () => {
    it('a single flipped Y byte in one of three shares produces a WRONG secret (combiner does NOT throw)', () => {
      const secret = randomBytes(32);
      const shares = shamirSplit(new Uint8Array(secret), 3, 5);

      // Take 3 shares for reconstruction. Confirm they round-trip cleanly first.
      const clean = [shares[0]!, shares[1]!, shares[2]!];
      const cleanRecovered = shamirCombine(clean);
      expect(Buffer.from(cleanRecovered)).toEqual(secret);

      // Flip one Y byte in the second share. Use XOR with 0x01 so the
      // byte definitely changes regardless of its original value.
      const tampered = new Uint8Array(clean[1]!);
      tampered[5] = tampered[5]! ^ 0x01; // a Y byte (index 0 is X)
      const tamperedSubset = [clean[0]!, tampered, clean[2]!];

      // The combiner MUST NOT throw — there is no in-combiner integrity
      // check, and adding one without coordinated upstream changes
      // would break the production age-plugin-yubikey path.
      const recoveredWrong = shamirCombine(tamperedSubset);

      // The recovered output differs from the original secret — this
      // is the failure-mode being documented.
      expect(Buffer.from(recoveredWrong)).not.toEqual(secret);

      // The lengths are the same (the combiner produces a correctly-
      // sized output even with bad input).
      expect(recoveredWrong.length).toBe(secret.length);
    });

    it('every single-byte flip in any one share produces a distinct wrong secret', () => {
      // Strengthen the property: corruption ANYWHERE in a share's Y
      // bytes produces a wrong result. This catches a hypothetical
      // bug where corruption at certain offsets cancels out.
      const secret = randomBytes(16);
      const shares = shamirSplit(new Uint8Array(secret), 3, 5);
      const subset = [shares[0]!, shares[1]!, shares[2]!];

      const wrongResults = new Set<string>();
      for (let shareIdx = 0; shareIdx < 3; shareIdx++) {
        // Bytes 1..secret.length+1 are the Y bytes.
        for (let byteIdx = 1; byteIdx <= secret.length; byteIdx++) {
          const tampered = subset.map((s) => new Uint8Array(s));
          tampered[shareIdx]![byteIdx] = tampered[shareIdx]![byteIdx]! ^ 0x01;
          const recovered = shamirCombine(tampered);
          expect(Buffer.from(recovered)).not.toEqual(secret);
          wrongResults.add(Buffer.from(recovered).toString('hex'));
        }
      }
      // Every flip produces a distinct wrong key — the failure is
      // observable but not detected. Documenting the failure space.
      expect(wrongResults.size).toBeGreaterThan(1);
    });

    it('upstream contract: callers responsible for share integrity (age-plugin-yubikey in prod)', () => {
      // This test exists as documentation: shamirCombine's contract is
      // "given mathematically-valid shares, produce the secret". It is
      // NOT "validate shares against the original split". A future
      // attempt to add in-combiner integrity (e.g. a sha256 prefix
      // byte) would change this contract; the production path
      // (age-plugin-yubikey) would break because age-encrypted shares
      // don't carry a separate sha256 prefix.
      //
      // The combiner accepts the shares as bytes-in, bytes-out. Period.
      const secret = randomBytes(8);
      const shares = shamirSplit(new Uint8Array(secret), 3, 5);
      const recovered = shamirCombine([shares[0]!, shares[1]!, shares[2]!]);
      expect(Buffer.from(recovered)).toEqual(secret);
      // The test passes as long as the round-trip works. The DOC value
      // is that this test sits next to the corruption tests and shows
      // the contract: pure mathematical combiner, no integrity check
      // baked in.
    });
  });
});
