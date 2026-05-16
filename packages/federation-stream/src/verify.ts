import { verifyEnvelope } from './sign.js';
import {
  ALL_REGION_CODES,
  DEFAULT_BACKWARD_WINDOW_MS,
  DEFAULT_FORWARD_WINDOW_MS,
  MAX_PAYLOAD_BYTES,
  type EventEnvelope,
  type RegionCode,
  type RejectionCode,
} from './types.js';

export interface KeyResolver {
  /**
   * Look up the ed25519 public key (PEM) for a given signing_key_id.
   * Returns null if the key is unknown or revoked.
   *
   * Implementations: production resolves via Vault PKI's published
   * cert at `pki-region-<code>/cert/<serial>`; test fixtures resolve
   * via an in-memory map.
   */
  resolve(signingKeyId: string): Promise<string | null> | (string | null);
}

export interface ReceiverPolicy {
  readonly forwardWindowMs?: number;
  readonly backwardWindowMs?: number;
  readonly maxPayloadBytes?: number;
  readonly nowMs?: () => number;
}

export interface VerificationResult {
  readonly ok: boolean;
  readonly code?: RejectionCode;
  readonly detail?: string;
}

/**
 * Region-prefix check on the signing_key_id.
 *
 * The architect-region-pki Vault policy already denies cross-region
 * issuance at the mount layer — this is a defense-in-depth check at
 * the receiver. A signing_key_id of "CE:42" is only valid for
 * envelopes whose region is "CE".
 */
function regionMatchesKeyId(region: string, signingKeyId: string): boolean {
  const colon = signingKeyId.indexOf(':');
  if (colon <= 0) return false;
  return signingKeyId.slice(0, colon) === region;
}

function isKnownRegion(region: string): region is RegionCode {
  return (ALL_REGION_CODES as readonly string[]).includes(region);
}

/**
 * Stateless per-envelope verification used by the core-side
 * federation-receiver. The receiver runs this for every envelope
 * arriving on the PushEvents stream; rejected envelopes go into
 * the PushAck's `rejected` list with a code, accepted envelopes
 * are forwarded into ingestion.
 *
 * Explicit non-goals:
 *   - This function does NOT enforce dedup (the receiver tracks
 *     dedup keys in Redis with a TTL window — that lives in
 *     worker-federation-receiver, not here).
 *   - This function does NOT enforce per-region rate limits (also
 *     receiver-side, also stateful).
 */
export async function verifyEnvelopeWithPolicy(
  env: EventEnvelope,
  resolver: KeyResolver,
  policy: ReceiverPolicy = {},
): Promise<VerificationResult> {
  if (!isKnownRegion(env.region)) {
    return { ok: false, code: 'REGION_MISMATCH', detail: `unknown region ${env.region}` };
  }
  if (!regionMatchesKeyId(env.region, env.signingKeyId)) {
    return {
      ok: false,
      code: 'REGION_MISMATCH',
      detail: `signing_key_id ${env.signingKeyId} does not belong to region ${env.region}`,
    };
  }

  const maxBytes = policy.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;
  if (env.payload.byteLength > maxBytes) {
    return {
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      detail: `payload ${env.payload.byteLength}B exceeds cap ${maxBytes}B`,
    };
  }

  // Tier-42 audit closure: explicit shape check on observedAtMs.
  // Pre-fix, a non-finite value (NaN, Infinity) skipped both window
  // comparisons (NaN > x and NaN < x are both false in JS) and
  // proceeded to signature verification. The canonical-bytes encoder
  // would then `BigInt(NaN)` and the verify path would fall through
  // to SIGNATURE_INVALID — but the operator would see an opaque
  // sig-failure for a structural-input problem, masking the real
  // root cause. Reject with REPLAY_WINDOW since shape-of-timestamp
  // is morally a replay-window concern.
  if (
    !Number.isFinite(env.observedAtMs) ||
    !Number.isInteger(env.observedAtMs) ||
    env.observedAtMs < 0
  ) {
    return {
      ok: false,
      code: 'REPLAY_WINDOW',
      detail: `observed_at must be a non-negative integer epoch-ms; got ${env.observedAtMs}`,
    };
  }
  const now = (policy.nowMs ?? Date.now)();
  const forward = policy.forwardWindowMs ?? DEFAULT_FORWARD_WINDOW_MS;
  const backward = policy.backwardWindowMs ?? DEFAULT_BACKWARD_WINDOW_MS;
  if (env.observedAtMs > now + forward) {
    return {
      ok: false,
      code: 'REPLAY_WINDOW',
      detail: `observed_at ${env.observedAtMs} > now+${forward}ms (${now + forward})`,
    };
  }
  if (env.observedAtMs < now - backward) {
    return {
      ok: false,
      code: 'REPLAY_WINDOW',
      detail: `observed_at ${env.observedAtMs} < now-${backward}ms (${now - backward})`,
    };
  }

  const pem = await resolver.resolve(env.signingKeyId);
  if (!pem) {
    return {
      ok: false,
      code: 'KEY_UNKNOWN',
      detail: `signing_key_id ${env.signingKeyId} not registered`,
    };
  }

  if (!verifyEnvelope(env, env.signature, pem)) {
    return { ok: false, code: 'SIGNATURE_INVALID' };
  }

  return { ok: true };
}

/**
 * In-memory KeyResolver for tests and for the bootstrap window
 * before the core-side cert sync agent has populated its cache.
 * Keys are added via `register(keyId, publicKeyPem)` and removed
 * via `revoke(keyId)`.
 */
export class StaticKeyResolver implements KeyResolver {
  private readonly keys = new Map<string, string>();
  resolve(signingKeyId: string): string | null {
    return this.keys.get(signingKeyId) ?? null;
  }
  register(signingKeyId: string, publicKeyPem: string): void {
    this.keys.set(signingKeyId, publicKeyPem);
  }
  revoke(signingKeyId: string): void {
    this.keys.delete(signingKeyId);
  }
}
