/**
 * Hardening mode 4.3 — TOCTOU between middleware verify and downstream
 * re-read.
 *
 * The problem this closes: middleware verifies the JWT once and forwards
 * `x-vigil-user`, `x-vigil-roles`, `x-vigil-roles-realm`,
 * `x-vigil-roles-resource` to downstream API routes + server components.
 * Downstream code reads those headers WITHOUT re-verifying the JWT.
 * If middleware is bypassed (Next.js plugin manipulation, proxy
 * injection, container-level header smuggling), downstream sees
 * attacker-controlled headers.
 *
 * Closure: middleware additionally signs the identity-header set with a
 * server-side HMAC key and emits the result as `x-vigil-auth-proof`.
 * Downstream consumers that need cryptographic provenance call
 * `verifyAuthProof(headers)` and refuse to proceed unless the proof
 * matches.
 *
 * Implementation: uses Web Crypto API (`crypto.subtle.sign`) rather
 * than `node:crypto`. Web Crypto is available in BOTH Next.js
 * middleware (Edge Runtime) AND Node.js server components / API
 * routes (Node 18+) — the same primitive works on both sides of the
 * boundary. `node:crypto` would have worked on the API-route side but
 * Next.js middleware rejects it because Edge Runtime doesn't ship
 * Node built-ins.
 *
 * Threat model:
 * - Adversary CAN inject HTTP headers (proxy compromise, Next.js plugin).
 * - Adversary CANNOT read the server-side HMAC key (Vault-issued at
 *   boot; if Vault is compromised, this defence falls but so does the
 *   rest of the platform).
 *
 * The HMAC binds:
 * - The actor identity.
 * - The realm + resource role provenance (mode 4.2 split).
 * - A per-request id (replay across requests is detectable).
 * - A timestamp (replay outside the freshness window is detectable).
 *
 * The signing key is read from `VIGIL_AUTH_PROOF_KEY` env (dev) or
 * `secret/vigil/auth-proof-key` Vault path (production, via the
 * standard External Secrets Operator projection). Rotation is a Vault
 * operation; downstream verifiers re-read the key on each call so
 * rotation propagates without restart.
 */

/** Freshness window — proofs older than this are rejected. Default 5 min. */
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1_000;

/** Header that carries the HMAC. */
export const AUTH_PROOF_HEADER = 'x-vigil-auth-proof';

/** Header that carries the request id (also used as proof input). */
export const REQUEST_ID_HEADER = 'x-vigil-request-id';

/** Header that carries the proof-mint timestamp (ms since epoch). */
export const AUTH_PROOF_TS_HEADER = 'x-vigil-auth-proof-ts';

export interface AuthProofInput {
  readonly actor: string | null;
  readonly username: string | null;
  readonly rolesRealm: ReadonlyArray<string>;
  readonly rolesResource: ReadonlyArray<string>;
  readonly requestId: string;
  readonly timestampMs: number;
}

export interface AuthProofVerifyResult {
  readonly ok: boolean;
  readonly reason?: 'missing-proof' | 'missing-timestamp' | 'missing-key' | 'stale' | 'mismatch';
  readonly actor?: string;
  readonly rolesRealm?: ReadonlyArray<string>;
  readonly rolesResource?: ReadonlyArray<string>;
}

/**
 * Read the signing key. Returns `null` if no key is configured; callers
 * must treat that as a hard failure in production. Tests inject the key
 * directly via the helpers below.
 */
export function readSigningKey(): string | null {
  return process.env.VIGIL_AUTH_PROOF_KEY ?? null;
}

/**
 * Canonical encoding of the proof input. Each field is null/empty-safe
 * and joined with a delimiter that the role names cannot contain.
 * Role lists are sorted-then-joined so the proof is independent of
 * the order roles appear in the JWT.
 */
function canonicalEncoding(input: AuthProofInput): string {
  const realm = [...input.rolesRealm].sort().join(',');
  const resource = [...input.rolesResource].sort().join(',');
  return [
    input.actor ?? '',
    input.username ?? '',
    realm,
    resource,
    input.requestId,
    String(input.timestampMs),
  ].join('|');
}

/** Hex-encode a Uint8Array without using Node Buffer (Edge-safe). */
function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, '0');
  }
  return s;
}

/** Hex-decode to Uint8Array without using Node Buffer (Edge-safe). */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hexToBytes: odd-length input');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/** Constant-time compare. Returns false if lengths differ; otherwise
 *  scans all bytes regardless of mismatch position. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function importHmacKey(keyMaterial: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(keyMaterial),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Mint a proof for the given input. Returns the hex HMAC. The caller
 * sets it as the `x-vigil-auth-proof` header. Throws if no signing key
 * is configured (callers MUST configure VIGIL_AUTH_PROOF_KEY).
 *
 * Async: Web Crypto's `sign` is async; the API is uniform across Edge
 * Runtime and Node.js.
 */
export async function mintAuthProof(input: AuthProofInput, key?: string): Promise<string> {
  const signingKey = key ?? readSigningKey();
  if (!signingKey) {
    throw new Error(
      'mintAuthProof: VIGIL_AUTH_PROOF_KEY is unset. Production deployments must set this via the ExternalSecret projection of secret/vigil/auth-proof-key.',
    );
  }
  const cryptoKey = await importHmacKey(signingKey);
  const enc = new TextEncoder();
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(canonicalEncoding(input)));
  return bytesToHex(new Uint8Array(sig));
}

/**
 * Generate a request id. 16 random bytes hex-encoded — collision-safe
 * for the lifetime of any reasonable request fleet. Uses Web Crypto
 * (`crypto.getRandomValues`) — Edge-safe.
 */
export function generateRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * Verify a proof against the headers on a request. The caller passes a
 * `Headers`-like object (any object with a `get(name)` method).
 *
 * Returns `{ ok: false, reason }` if any required header is missing,
 * the timestamp is outside the freshness window, or the HMAC does not
 * match. Returns `{ ok: true, actor, rolesRealm, rolesResource }` on
 * success.
 */
export async function verifyAuthProof(
  headers: { get(name: string): string | null },
  opts: {
    readonly key?: string;
    readonly nowMs?: number;
    readonly maxAgeMs?: number;
  } = {},
): Promise<AuthProofVerifyResult> {
  const signingKey = opts.key ?? readSigningKey();
  if (!signingKey) {
    return { ok: false, reason: 'missing-key' };
  }

  const proof = headers.get(AUTH_PROOF_HEADER);
  if (!proof) {
    return { ok: false, reason: 'missing-proof' };
  }

  const tsRaw = headers.get(AUTH_PROOF_TS_HEADER);
  if (!tsRaw) {
    return { ok: false, reason: 'missing-timestamp' };
  }
  const tsMs = Number(tsRaw);
  if (!Number.isFinite(tsMs)) {
    return { ok: false, reason: 'missing-timestamp' };
  }

  const now = opts.nowMs ?? Date.now();
  const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const age = now - tsMs;
  // Reject ancient proofs AND future-dated proofs (clock skew or
  // adversarial pre-mint). Tolerate 10 s of clock skew either way.
  if (age > maxAge || age < -10_000) {
    return { ok: false, reason: 'stale' };
  }

  const input: AuthProofInput = {
    actor: headers.get('x-vigil-user'),
    username: headers.get('x-vigil-username'),
    rolesRealm: parseCsvHeader(headers.get('x-vigil-roles-realm')),
    rolesResource: parseCsvHeader(headers.get('x-vigil-roles-resource')),
    requestId: headers.get(REQUEST_ID_HEADER) ?? '',
    timestampMs: tsMs,
  };

  const expected = await mintAuthProof(input, signingKey);

  // Length-mismatch short-circuits to mismatch (hex-decoding a
  // wrong-length string is undefined behaviour for our purposes;
  // surface as the same opaque "mismatch" reason).
  if (expected.length !== proof.length) {
    return { ok: false, reason: 'mismatch' };
  }
  let providedBytes: Uint8Array;
  try {
    providedBytes = hexToBytes(proof);
  } catch {
    return { ok: false, reason: 'mismatch' };
  }
  const expectedBytes = hexToBytes(expected);
  if (!constantTimeEqual(expectedBytes, providedBytes)) {
    return { ok: false, reason: 'mismatch' };
  }

  return {
    ok: true,
    actor: input.actor ?? undefined,
    rolesRealm: input.rolesRealm,
    rolesResource: input.rolesResource,
  };
}

function parseCsvHeader(value: string | null): ReadonlyArray<string> {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
