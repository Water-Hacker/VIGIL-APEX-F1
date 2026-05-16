/**
 * Tier-17 audit closure — wire `verifyAuthProof` into the API surface.
 *
 * The mode-4.3 HMAC defence in [./auth-proof.ts](./auth-proof.ts) was
 * minted by middleware but never consumed by any handler. That left the
 * defence dead from the operator's perspective: a middleware bypass
 * (Next.js plugin manipulation, container-level header smuggling, proxy
 * injection) could spoof `x-vigil-roles` directly into a write route
 * and the route would honour it.
 *
 * `requireAuthProof` is the consumer-side gate. Routes that perform a
 * sensitive write call it before any state mutation. The helper:
 *
 *   1. Reads the proof + role headers from the request.
 *   2. Verifies the HMAC against the canonical-encoded identity bundle.
 *   3. Checks the freshness window (5 min).
 *   4. Verifies the requested role is present in the realm-or-resource
 *      role set carried by the proof.
 *
 * Failure modes are surfaced as opaque JSON 401/403 responses with a
 * machine-readable `reason` so the operator UI can prompt re-auth
 * without leaking proof internals to a probing client.
 *
 * Dev-mode escape hatch: if `VIGIL_AUTH_PROOF_KEY` is unset AND
 * `NODE_ENV !== 'production'`, the helper falls back to the legacy
 * role-header check. Production deployments MUST set the key
 * (documented in the secret/vigil/auth-proof-key Vault path). When
 * unset in production, the helper fails closed (returns 503 to make
 * the misconfiguration loud).
 */

import { NextResponse, type NextRequest } from 'next/server';

import { verifyAuthProof } from './auth-proof';

export interface RequireAuthProofResult {
  /** When ok=true, the route MAY proceed. */
  readonly ok: boolean;
  /** When ok=false, return this response directly. */
  readonly response?: NextResponse;
  /**
   * When ok=true, the verified actor identity from the proof. Routes
   * should prefer this over `x-vigil-user` for any downstream write
   * (audit-chain row, dead-letter `resolved_by`, etc.) since the
   * proof-verified identity is cryptographically bound.
   */
  readonly actor?: string;
  /**
   * When ok=true, the union of realm + resource roles carried by the
   * proof. Routes use this set for additional role checks beyond the
   * one requested via `allowedRoles`.
   */
  readonly roles?: ReadonlyArray<string>;
}

export interface RequireAuthProofOptions {
  /**
   * Any of these roles must be present in the realm-or-resource role set
   * carried by the proof. Pass the full operator role allow-list for
   * the endpoint (e.g. `['operator', 'architect']` for dead-letter
   * retry). Empty / missing array = no role gate (proof alone is enough).
   */
  readonly allowedRoles?: ReadonlyArray<string>;
}

/**
 * Verify the proof + role gate on `req`. Returns either `{ ok: true, actor, roles }`
 * (caller proceeds) or `{ ok: false, response }` (caller returns the response
 * unchanged).
 *
 * In dev (no signing key, non-production env) this falls back to the
 * legacy role-header check so local development without a configured
 * key continues to work.
 */
export async function requireAuthProof(
  req: NextRequest,
  opts: RequireAuthProofOptions = {},
): Promise<RequireAuthProofResult> {
  const env = process.env.NODE_ENV ?? 'development';
  const signingKey = process.env.VIGIL_AUTH_PROOF_KEY;
  const isProduction = env === 'production';

  // Dev-mode fallback: when no signing key is configured AND we are
  // not running in production, accept the middleware-set role header
  // alone. This keeps `pnpm dev` running for the architect without
  // requiring the Vault projection.
  if (!signingKey) {
    if (isProduction) {
      // Fail closed in production: a missing key in production is a
      // deployment bug, not a user error. 503 makes the misconfig loud.
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'auth-proof-misconfigured', reason: 'missing-key' },
          { status: 503 },
        ),
      };
    }
    return requireLegacyRoles(req, opts);
  }

  const verdict = await verifyAuthProof(req.headers);
  if (!verdict.ok) {
    // Map the granular reason to the appropriate HTTP status:
    //   - missing-proof / missing-timestamp: 401 (caller must re-auth)
    //   - mismatch / stale: 401 (caller must re-mint a fresh proof)
    //   - missing-key: 503 (handled above; included for completeness)
    const status = verdict.reason === 'missing-key' ? 503 : 401;
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'auth-proof-invalid', reason: verdict.reason ?? 'unknown' },
        { status },
      ),
    };
  }

  const proofRoles = new Set<string>([
    ...(verdict.rolesRealm ?? []),
    ...(verdict.rolesResource ?? []),
  ]);
  if (opts.allowedRoles && opts.allowedRoles.length > 0) {
    const ok = opts.allowedRoles.some((r) => proofRoles.has(r));
    if (!ok) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'forbidden', reason: 'role-not-in-proof' },
          { status: 403 },
        ),
      };
    }
  }

  return {
    ok: true,
    actor: verdict.actor,
    roles: Array.from(proofRoles),
  };
}

function requireLegacyRoles(
  req: NextRequest,
  opts: RequireAuthProofOptions,
): RequireAuthProofResult {
  const roles = (req.headers.get('x-vigil-roles') ?? '').split(',').filter(Boolean);
  if (opts.allowedRoles && opts.allowedRoles.length > 0) {
    const ok = opts.allowedRoles.some((r) => roles.includes(r));
    if (!ok) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
      };
    }
  }
  return {
    ok: true,
    actor: req.headers.get('x-vigil-user') ?? undefined,
    roles,
  };
}
