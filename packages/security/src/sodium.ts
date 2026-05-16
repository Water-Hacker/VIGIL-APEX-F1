import sodium from 'libsodium-wrappers-sumo';

import { type Secret, wrapSecret, expose } from './secrets.js';

/**
 * libsodium helpers — used for tip-portal client-side encryption (SRD §28.4)
 * and for any other modern symmetric/asymmetric needs.
 *
 * Format conventions:
 *   - Public keys / ciphertexts: base64 (NOT base64url) for interoperability with sodium.js in the browser
 *   - Private keys: held only as `Secret<Uint8Array>`
 *
 * The tip portal flow:
 *   1. Browser fetches operator-team public key from /tip
 *   2. Browser computes `crypto_box_seal(message, pk)`
 *   3. Browser submits ciphertext only — server never sees plaintext
 *   4. Decryption requires operator-team private key (Vault) + 3-of-5 council
 *      Shamir share recovery for sensitive tips
 */

let initialised = false;
async function ready(): Promise<void> {
  if (initialised) return;
  await sodium.ready;
  initialised = true;
}

/* =============================================================================
 * Sealed-box (anonymous public-key encryption) — for tip portal
 * ===========================================================================*/

export interface KeyPairB64 {
  readonly publicKey: string;
  readonly privateKey: Secret<string>;
}

export async function generateBoxKeyPair(): Promise<KeyPairB64> {
  await ready();
  const kp = sodium.crypto_box_keypair();
  return {
    publicKey: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    privateKey: wrapSecret(sodium.to_base64(kp.privateKey, sodium.base64_variants.ORIGINAL)),
  };
}

export async function sealedBoxEncrypt(
  plaintext: Uint8Array | string,
  recipientPubKeyB64: string,
): Promise<string> {
  await ready();
  const m = typeof plaintext === 'string' ? sodium.from_string(plaintext) : plaintext;
  const pk = sodium.from_base64(recipientPubKeyB64, sodium.base64_variants.ORIGINAL);
  const c = sodium.crypto_box_seal(m, pk);
  return sodium.to_base64(c, sodium.base64_variants.ORIGINAL);
}

export async function sealedBoxDecrypt(
  ciphertextB64: string,
  recipientPubKeyB64: string,
  recipientPrivKey: Secret<string>,
): Promise<Uint8Array> {
  await ready();
  const c = sodium.from_base64(ciphertextB64, sodium.base64_variants.ORIGINAL);
  const pk = sodium.from_base64(recipientPubKeyB64, sodium.base64_variants.ORIGINAL);
  const sk = sodium.from_base64(expose(recipientPrivKey), sodium.base64_variants.ORIGINAL);
  return sodium.crypto_box_seal_open(c, pk, sk);
}

/* =============================================================================
 * Shamir-style secret sharing — used by Vault Shamir scheme integration
 * (W-12 fix: shares stored via age-plugin-yubikey, not challenge-response)
 *
 * libsodium does not ship Shamir; we use Vault's native Shamir for the master
 * key, then encrypt each share with `age` to a YubiKey-bound recipient. The
 * helper below is a thin wrapper over the `age` CLI used in the host bootstrap.
 * The implementation is intentionally minimal here — full integration lives
 * in `infra/host-bootstrap/03-vault-shamir-init.sh`.
 * ===========================================================================*/

/* =============================================================================
 * Generic AEAD — for at-rest field-level encryption in Postgres
 * ===========================================================================*/

export async function aeadEncrypt(
  plaintext: Uint8Array,
  key: Secret<Uint8Array>,
): Promise<{
  nonce: string;
  ciphertext: string;
}> {
  await ready();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    null,
    null,
    nonce,
    expose(key),
  );
  return {
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
    ciphertext: sodium.to_base64(ct, sodium.base64_variants.ORIGINAL),
  };
}

export async function aeadDecrypt(
  nonceB64: string,
  ciphertextB64: string,
  key: Secret<Uint8Array>,
): Promise<Uint8Array> {
  await ready();
  const nonce = sodium.from_base64(nonceB64, sodium.base64_variants.ORIGINAL);
  const ct = sodium.from_base64(ciphertextB64, sodium.base64_variants.ORIGINAL);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, null, nonce, expose(key));
}

export async function generateAeadKey(): Promise<Secret<Uint8Array>> {
  await ready();
  return wrapSecret(sodium.crypto_aead_xchacha20poly1305_ietf_keygen());
}

/* =============================================================================
 * Hashing helpers — used in audit chain & tip dedup
 * ===========================================================================*/

export async function sha256Hex(input: Uint8Array | string): Promise<string> {
  await ready();
  const m = typeof input === 'string' ? sodium.from_string(input) : input;
  return sodium.to_hex(sodium.crypto_hash_sha256(m));
}

export async function sha512Hex(input: Uint8Array | string): Promise<string> {
  await ready();
  const m = typeof input === 'string' ? sodium.from_string(input) : input;
  return sodium.to_hex(sodium.crypto_hash_sha512(m));
}

/* =============================================================================
 * Sensitive-memory hygiene
 * ===========================================================================*/

/**
 * Best-effort zeroing of a `Uint8Array` buffer carrying sensitive material
 * (decrypted plaintext, reconstructed private keys, intermediate secrets).
 *
 * libsodium's `memzero` overwrites the buffer in place with zeros and is
 * compiled to not be elided by an optimising JIT — which a hand-rolled
 * `.fill(0)` may be, depending on the V8 escape analysis pass. Use this
 * helper in `finally` blocks immediately after the last legitimate use of
 * a sensitive buffer.
 *
 * Caveats:
 *   - Only zeroes the buffer you pass. Strings derived via
 *     `TextDecoder.decode(plaintext)` cannot be zeroed (V8 strings are
 *     immutable). Prefer keeping sensitive data as `Uint8Array` until
 *     the last possible moment.
 *   - V8 may have copied the buffer for inline caching; we cannot reach
 *     those copies. This is best-effort, not a guarantee.
 *   - Calling this multiple times is harmless.
 *
 * Tier-16 audit closure: worker-tip-triage previously held the decrypted
 * tip plaintext + reconstructed Shamir SK alive until function return
 * (heap-snapshot exposure window).
 */
export async function wipe(buf: Uint8Array | null | undefined): Promise<void> {
  if (!buf || buf.length === 0) return;
  await ready();
  sodium.memzero(buf);
}
