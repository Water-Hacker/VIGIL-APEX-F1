import { wrapSecret, type Secret } from './secrets.js';

/**
 * Shamir's Secret Sharing — GF(2^8), byte-wise.
 *
 * Used by the tip-portal council quorum (SRD §28.4): the operator-team
 * private key is split into 5 shares at provisioning time; 3 are required
 * to reconstruct it for sensitive-tip decryption. Each council member
 * holds one share encrypted to their YubiKey via age-plugin-yubikey
 * (see `infra/host-bootstrap/03-vault-shamir-init.sh`).
 *
 * Wire format for one share: a single Buffer where byte 0 is the X
 * coordinate (1..255) and bytes 1.. are the Y values (one per secret
 * byte). Shares are exchanged base64-encoded.
 *
 * This implementation is intentionally minimal — encrypts/decrypts only.
 * Generation lives in the host bootstrap because share material must
 * never re-enter a long-running process after creation.
 */

// GF(256) tables — generated with primitive polynomial 0x11d (Rijndael).
// EXP[i] = 0x03^i (mod p); LOG[x] is the inverse so that gfMul(a, b) =
// EXP[(LOG[a] + LOG[b]) mod 255]. EXP[255] mirrors EXP[0] = 1 to make
// the modular arithmetic in gfMul/gfDiv branch-free.
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

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a]! + LOG[b]!) % 255]!;
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('shamir: division by zero');
  if (a === 0) return 0;
  return EXP[(LOG[a]! + 255 - LOG[b]!) % 255]!;
}

/**
 * Combine ≥ threshold shares into the original secret bytes. Each share
 * is `[x, y0, y1, ...]` where `x` is the share's X coordinate.
 *
 * Throws if the shares disagree on length, if X coordinates collide, or
 * if any X coordinate is zero (which would be the secret itself).
 */
export function shamirCombine(shares: ReadonlyArray<Uint8Array>): Uint8Array {
  if (shares.length < 2) {
    throw new Error('shamir: need at least 2 shares to combine');
  }
  const len = shares[0]!.length;
  if (len < 2) {
    throw new Error('shamir: malformed share (too short)');
  }
  const xs = new Set<number>();
  for (const s of shares) {
    if (s.length !== len) {
      throw new Error('shamir: shares have inconsistent length');
    }
    const x = s[0]!;
    if (x === 0) throw new Error('shamir: share has zero X coordinate');
    if (xs.has(x)) throw new Error('shamir: duplicate X coordinate');
    xs.add(x);
  }

  const secret = new Uint8Array(len - 1);
  for (let byteIdx = 1; byteIdx < len; byteIdx++) {
    // Lagrange interpolation at x = 0 over GF(256).
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
      const xi = shares[i]![0]!;
      const yi = shares[i]![byteIdx]!;
      let num = 1;
      let den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (j === i) continue;
        const xj = shares[j]![0]!;
        num = gfMul(num, xj); // (0 - xj) = xj in GF(2^8) since char 2
        den = gfMul(den, xi ^ xj);
      }
      acc ^= gfMul(yi, gfDiv(num, den));
    }
    secret[byteIdx - 1] = acc;
  }
  return secret;
}

/**
 * Convenience wrapper: take base64-encoded shares (the wire form used by
 * the council UI + Vault), decode, combine, and return a `Secret<T>`
 * handle so the reconstructed key never escapes as a bare string.
 */
export function shamirCombineFromBase64(sharesB64: ReadonlyArray<string>): Secret<Uint8Array> {
  const shares = sharesB64.map((s) => decodeBase64(s));
  const combined = shamirCombine(shares);
  return wrapSecret(combined);
}

function decodeBase64(s: string): Uint8Array {
  // Avoid coupling to Node's Buffer; works in any modern runtime.
  const g = globalThis as { atob?: (s: string) => string };
  if (typeof g.atob === 'function') {
    const bin = g.atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  throw new Error('shamir: no base64 decoder available in this runtime');
}
