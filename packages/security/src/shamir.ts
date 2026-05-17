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
 *
 * Hardening mode 5.9 — IMPORTANT: this function does NOT verify Y-byte
 * integrity. Lagrange interpolation over GF(256) is bytes-in, bytes-out:
 * a single flipped Y byte produces a SILENTLY WRONG secret. The
 * combiner cannot distinguish "valid shares for a different secret"
 * from "tampered shares for the original secret."
 *
 * Share-integrity validation is an UPSTREAM responsibility:
 *   - Production: each share is age-encrypted to a council member's
 *     YubiKey via age-plugin-yubikey. age uses authenticated
 *     encryption; ciphertext tampering fails the MAC and age refuses
 *     to decrypt. Corrupted shares never reach shamirCombine.
 *   - Tests/dev: callers passing raw shares must verify integrity
 *     themselves (e.g. via a separate sha256 prefix per share).
 *
 * Regression-locked by `mode 5.9 — corrupted-share detection is
 * upstream of shamirCombine` test suite in shamir.test.ts. If a future
 * PR adds in-combiner integrity, that test will fail and force the
 * change to be coordinated with the age-plugin-yubikey path.
 */
/**
 * Tier-52 audit closure — bounds on share count and per-share size.
 *
 * SHAMIR_MAX_SHARES: GF(256) has 255 non-zero X coordinates, so 255 is
 * the absolute upper bound. A pathological caller passing 1000 shares
 * would do 1000² interpolation work in the Lagrange loop AND would
 * always trip the duplicate-X check (since only 255 X values exist),
 * but we should reject loud, fast, and with a clear error rather than
 * compute the whole O(N²) loop just to discover the collision.
 *
 * SHAMIR_MAX_SHARE_BYTES: caps individual share size to 64 KiB. The
 * Vault Shamir scheme splits the 32-byte master key (or up to
 * libsodium's 64-byte private key, plus 1-byte X prefix = 65 bytes);
 * 64 KiB is 1000x headroom. A malformed share claiming to be 1 GB
 * would otherwise drive the per-byte interpolation loop into a
 * many-minute runaway.
 */
export const SHAMIR_MAX_SHARES = 255;
export const SHAMIR_MAX_SHARE_BYTES = 64 * 1024;

export function shamirCombine(shares: ReadonlyArray<Uint8Array>): Uint8Array {
  if (shares.length < 2) {
    throw new Error('shamir: need at least 2 shares to combine');
  }
  if (shares.length > SHAMIR_MAX_SHARES) {
    // Tier-52: GF(256) has only 255 non-zero X coordinates anyway, but
    // reject before the O(N²) interpolation runs.
    throw new Error(
      `shamir: ${shares.length} shares exceeds max ${SHAMIR_MAX_SHARES} (GF(256) X-coord ceiling)`,
    );
  }
  const len = shares[0]!.length;
  if (len < 2) {
    throw new Error('shamir: malformed share (too short)');
  }
  if (len > SHAMIR_MAX_SHARE_BYTES) {
    throw new Error(
      `shamir: share length ${len} exceeds max ${SHAMIR_MAX_SHARE_BYTES} (1000x headroom over libsodium SK)`,
    );
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

// Tier-52: strict base64 (standard alphabet, optional padding). Reject
// at the boundary so an upstream caller submitting malformed shares
// sees a clear "shamir: malformed base64 share" instead of a generic
// `InvalidCharacterError` from atob (which then gets caught further up
// as "shamir-combine-failure", masking the actual defect).
const BASE64_STRICT = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeBase64(s: string): Uint8Array {
  if (typeof s !== 'string' || s.length === 0) {
    throw new Error('shamir: empty or non-string base64 share');
  }
  if (!BASE64_STRICT.test(s)) {
    throw new Error('shamir: malformed base64 share (non-standard characters)');
  }
  if (s.length % 4 !== 0) {
    throw new Error('shamir: malformed base64 share (length not multiple of 4)');
  }
  // Avoid coupling to Node's Buffer; works in any modern runtime.
  const g = globalThis as { atob?: (s: string) => string };
  if (typeof g.atob === 'function') {
    let bin: string;
    try {
      bin = g.atob(s);
    } catch (e) {
      // Defence-in-depth: atob can still throw on edge cases the regex
      // misses (e.g. internal padding). Re-wrap with the canonical
      // shamir error message.
      throw new Error(
        `shamir: malformed base64 share (decode failed: ${e instanceof Error ? e.message : 'unknown'})`,
      );
    }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  throw new Error('shamir: no base64 decoder available in this runtime');
}
