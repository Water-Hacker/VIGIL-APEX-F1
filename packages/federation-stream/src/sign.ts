import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';

/**
 * Canonical signing for the federation EventEnvelope.
 *
 * The signature covers every field except `signature` and
 * `signing_key_id`. Canonicalisation is intentionally simple:
 *
 *   for each (field_number, value) in the protobuf-numbered order:
 *     emit u8(field_number) || u32_be(byte_length) || bytes(value)
 *
 * Strings are UTF-8 encoded; int64 fields are written as big-endian
 * 8-byte buffers; bytes fields are written verbatim. The resulting
 * buffer is signed with ed25519.
 *
 * This format is deliberately NOT proto-canonical — proto's
 * canonical encoding leaves room for ambiguity (default-value
 * elision, map-ordering). The explicit field-number prefix and
 * length prefix removes both.
 *
 * ANY change to this function is a wire-incompatible break and
 * MUST be paired with a federation-agent rotation plan.
 */

import type { EventEnvelopeUnsigned } from './types.js';

const FIELD_REGION = 2;
const FIELD_SOURCE_ID = 3;
const FIELD_DEDUP_KEY = 4;
const FIELD_PAYLOAD = 5;
const FIELD_OBSERVED_AT_MS = 6;
const FIELD_ENVELOPE_ID = 1;

function writeFieldString(buf: Buffer[], field: number, value: string): void {
  const v = Buffer.from(value, 'utf8');
  const header = Buffer.alloc(5);
  header.writeUInt8(field, 0);
  header.writeUInt32BE(v.byteLength, 1);
  buf.push(header, v);
}

function writeFieldBytes(buf: Buffer[], field: number, value: Uint8Array): void {
  const v = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  const header = Buffer.alloc(5);
  header.writeUInt8(field, 0);
  header.writeUInt32BE(v.byteLength, 1);
  buf.push(header, v);
}

function writeFieldInt64(buf: Buffer[], field: number, value: bigint | number): void {
  const v = Buffer.alloc(8);
  v.writeBigInt64BE(typeof value === 'bigint' ? value : BigInt(value), 0);
  const header = Buffer.alloc(5);
  header.writeUInt8(field, 0);
  header.writeUInt32BE(8, 1);
  buf.push(header, v);
}

/**
 * Build the canonical signing buffer for an envelope. Order is
 * fixed and matches the .proto field numbers (1, 2, 3, 4, 5, 6).
 * Fields 7 (signature) and 8 (signing_key_id) are excluded.
 */
export function canonicalSigningBytes(env: EventEnvelopeUnsigned): Buffer {
  const parts: Buffer[] = [];
  writeFieldString(parts, FIELD_ENVELOPE_ID, env.envelopeId);
  writeFieldString(parts, FIELD_REGION, env.region);
  writeFieldString(parts, FIELD_SOURCE_ID, env.sourceId);
  writeFieldString(parts, FIELD_DEDUP_KEY, env.dedupKey);
  writeFieldBytes(parts, FIELD_PAYLOAD, env.payload);
  writeFieldInt64(parts, FIELD_OBSERVED_AT_MS, env.observedAtMs);
  return Buffer.concat(parts);
}

/**
 * Sign an envelope. `privateKeyPem` is the ed25519 private key in
 * PEM form (the format Vault PKI emits). Returns a 64-byte
 * detached signature.
 */
export function signEnvelope(env: EventEnvelopeUnsigned, privateKeyPem: string): Buffer {
  const key = createPrivateKey(privateKeyPem);
  const msg = canonicalSigningBytes(env);
  // Node's ed25519 binding takes `null` for the algorithm parameter.
  return nodeSign(null, msg, key);
}

/**
 * Verify an envelope's signature. `publicKeyPem` is the ed25519
 * public key in PEM form (extracted from the federation-signer
 * cert published by the regional Vault subordinate CA).
 *
 * Returns true on valid signature, false otherwise. Never throws
 * — the receiver maps a false return into a SIGNATURE_INVALID
 * rejection in the PushAck.
 */
export function verifyEnvelope(
  env: EventEnvelopeUnsigned,
  signature: Uint8Array,
  publicKeyPem: string,
): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    const msg = canonicalSigningBytes(env);
    return nodeVerify(null, msg, key, Buffer.from(signature.buffer, signature.byteOffset, signature.byteLength));
  } catch {
    return false;
  }
}
