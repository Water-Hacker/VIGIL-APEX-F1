import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';
import { NextResponse, type NextRequest } from 'next/server';

import {
  AUTH_PROOF_HEADER,
  AUTH_PROOF_TS_HEADER,
  REQUEST_ID_HEADER,
  generateRequestId,
  mintAuthProof,
  readSigningKey,
} from './lib/auth-proof';

/**
 * VIGIL APEX dashboard middleware (Phase C1).
 *
 * One pass per request, runs at the Next.js edge:
 *   1. Allow public surfaces straight through (/, /tip*, /verify/*, /ledger,
 *      /api/tip/*, /api/verify/*, /tip/status*).
 *   2. For everything else, require a Keycloak-issued access token in the
 *      `vigil_access_token` HttpOnly cookie. Verify against the realm JWKS.
 *   3. Map the path prefix to the required Keycloak role and 403 on mismatch.
 *
 * Roles (from realm `vigil`, resource `vigil-dashboard`):
 *   - operator         — /findings, /dead-letter, /calibration
 *   - council_member   — /council, /council/proposals/*
 *   - tip_handler      — /triage, /triage/tips
 *   - auditor          — /audit, /verify (deeper than public)
 *   - architect        — anything; effectively superuser
 */

interface VigilJwtPayload extends JWTPayload {
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
  preferred_username?: string;
}

const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER ?? 'https://kc.vigilapex.cm/realms/vigil';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'vigil-dashboard';
const KEYCLOAK_JWKS_URL =
  process.env.KEYCLOAK_JWKS_URL ?? `${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`;

// JWKS is fetched on first request and cached for 10 minutes per `jose`
// defaults. Single edge runtime instance shares it across requests.
const JWKS = createRemoteJWKSet(new URL(KEYCLOAK_JWKS_URL));

const PUBLIC_PREFIXES = [
  '/',
  '/tip',
  '/verify',
  '/ledger',
  '/privacy',
  '/terms',
  '/public',
  '/api/tip',
  '/api/verify',
  '/api/health',
  '/api/audit/public',
  '/api/audit/aggregate',
  '/_next',
  '/favicon.ico',
  '/robots.txt',
] as const;

// `Role` import is type-only because middleware runs on the edge runtime;
// keeping the import tree minimal protects bundle size. The runtime value
// `ROLES` is enumerated above by the source-of-truth roles.ts file
// (FIND-008 closure in audit doc 10).
import type { Role } from '@vigil/security';

interface RouteRule {
  prefix: string;
  /** Any of these roles is sufficient. */
  allow: ReadonlyArray<Role>;
}

/**
 * Authorization matrix. SINGLE SOURCE OF TRUTH for which Keycloak roles
 * may access which URL prefixes. Typed against `Role` so a typo
 * (e.g. `'councl_member'`) fails compilation. Closes FIND-008.
 *
 * The build-time check `scripts/check-rbac-coverage.ts` (FIND-004
 * closure) imports these prefixes and enforces that every operator
 * page under `apps/dashboard/src/app/` has a matching rule here.
 */
export const ROUTE_RULES: ReadonlyArray<RouteRule> = [
  { prefix: '/findings', allow: ['operator', 'auditor', 'architect'] },
  { prefix: '/dead-letter', allow: ['operator', 'architect'] },
  { prefix: '/calibration', allow: ['operator', 'architect'] },
  { prefix: '/council', allow: ['council_member', 'architect'] },
  { prefix: '/triage', allow: ['tip_handler', 'architect'] },
  { prefix: '/audit', allow: ['auditor', 'architect'] },
  // Civil-society read-only portal (Tier 5 / W-15). Read-only by middleware:
  // POSTs and PATCHes against /civil-society/* are not allowed at this layer.
  { prefix: '/civil-society', allow: ['civil_society', 'auditor', 'architect'] },
  { prefix: '/api/findings', allow: ['operator', 'auditor', 'architect'] },
  { prefix: '/api/dead-letter', allow: ['operator', 'architect'] },
  { prefix: '/api/calibration', allow: ['operator', 'architect'] },
  { prefix: '/api/council', allow: ['council_member', 'architect'] },
  { prefix: '/api/triage', allow: ['tip_handler', 'architect'] },
  // DECISION-010
  { prefix: '/api/dossier', allow: ['operator', 'auditor', 'architect'] },
  // Tier-5 dashboard RBAC audit closure: /api/audit/* (excluding the
  // already-public /api/audit/public and /api/audit/aggregate caught
  // earlier by isPublic) carries auditor-curation endpoints. Pre-fix
  // the discovery-queue/curate handler's own doc claimed middleware
  // enforcement that did NOT exist — the route was protected only by
  // its handler-level defensive role check.
  { prefix: '/api/audit', allow: ['auditor', 'architect'] },
  // Tier-5 dashboard RBAC audit closure: /api/realtime is the SSE
  // broadcast of tip-arrival + finding-threshold + vote events. The
  // route's existing in-handler gate only checks `x-vigil-user`
  // presence, not role — so any authenticated user (including
  // civil_society) could subscribe. Restrict to operator-class roles.
  {
    prefix: '/api/realtime',
    allow: ['operator', 'auditor', 'tip_handler', 'council_member', 'architect'],
  },
];

function isPublic(pathname: string): boolean {
  // `/` only matches the bare root, not `/anything`.
  if (pathname === '/') return true;
  return PUBLIC_PREFIXES.some((p) => p !== '/' && (pathname === p || pathname.startsWith(`${p}/`)));
}

function matchRule(pathname: string): RouteRule | null {
  for (const rule of ROUTE_RULES) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
      return rule;
    }
  }
  return null;
}

/**
 * Hardening mode 4.2 — confused-deputy across service boundary.
 *
 * `rolesFromToken` previously returned a flat Set<string> that merged
 * realm-level roles (assigned to the user globally in Keycloak) with
 * resource-level roles (assigned within this client's role-mapper).
 * The merge meant downstream consumers couldn't tell whether a role
 * came from the trusted realm root or from a per-client mapping that
 * a different Keycloak admin might be able to mutate.
 *
 * Phase-1 closure: KEYCLOAK_ISSUER is the sole trusted root by policy
 * (architect-managed; no other realms can issue these tokens). Both
 * realm and resource roles are treated as authoritative for
 * authorisation decisions, but we now emit them under DISTINCT
 * downstream headers so a future consumer that wants stricter
 * provenance can require specifically realm-level roles.
 *
 * Headers emitted:
 *   x-vigil-roles            — merged set (back-compat for existing
 *                              consumers; same contract as before).
 *   x-vigil-roles-realm      — roles from realm_access.roles.
 *   x-vigil-roles-resource   — roles from resource_access[CLIENT_ID].roles.
 *
 * Consumers requiring realm-level provenance read the realm header
 * directly and intersect with the operator-level role set.
 */
// Exported for unit tests; not re-exported from any barrel.
export function rolesFromToken(payload: VigilJwtPayload): {
  realm: ReadonlyArray<string>;
  resource: ReadonlyArray<string>;
  merged: Set<string>;
} {
  const realm = payload.realm_access?.roles ?? [];
  const resource = payload.resource_access?.[KEYCLOAK_CLIENT_ID]?.roles ?? [];
  const merged = new Set<string>([...realm, ...resource]);
  return { realm, resource, merged };
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) {
    // Public paths are unauthenticated; strip identity headers an adversary
    // could attempt to spoof (no consumer reads them on public surfaces, but
    // belt-and-braces matches the protected-path branch below).
    const headers = new Headers(req.headers);
    headers.delete('x-vigil-user');
    headers.delete('x-vigil-username');
    headers.delete('x-vigil-roles');
    headers.delete('x-vigil-roles-realm');
    headers.delete('x-vigil-roles-resource');
    // Mode 4.3 — same belt-and-braces strip for the auth-proof set.
    headers.delete(AUTH_PROOF_HEADER);
    headers.delete(AUTH_PROOF_TS_HEADER);
    headers.delete(REQUEST_ID_HEADER);
    // Surface the path to the root layout's NavBar so the active link
    // styling works without each page passing the prop.
    headers.set('x-vigil-pathname', pathname);
    return NextResponse.next({ request: { headers } });
  }

  const token = req.cookies.get('vigil_access_token')?.value;
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/auth/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  let payload: VigilJwtPayload;
  try {
    // Tier-5 dashboard RBAC audit closure: audience is the dashboard
    // client only. The prior list included `'account'` — Keycloak's
    // default audience for self-service operations on the
    // account-management client. Allowing it here was a confused-
    // deputy risk: a token minted for the `account` client could be
    // replayed against this middleware. Dashboard-bound tokens have
    // `aud: vigil-dashboard`; nothing else is legitimate.
    const { payload: verified } = await jwtVerify(token, JWKS, {
      issuer: KEYCLOAK_ISSUER,
      audience: KEYCLOAK_CLIENT_ID,
    });
    payload = verified as VigilJwtPayload;
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'invalid-token' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/auth/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  const rule = matchRule(pathname);
  // Tier-5 dashboard RBAC audit closure: default-deny for any
  // `/api/*` path that is neither public (caught earlier by isPublic)
  // nor matched by an explicit ROUTE_RULES entry. Pre-fix, an
  // authenticated request to an unmatched `/api/*` path passed
  // through — so any new API route was implicitly accessible to ALL
  // authenticated users (including low-privilege roles like
  // civil_society) until someone remembered to add a rule.
  //
  // UI routes (non-/api/) keep the legacy pass-through because the
  // build-time `check-rbac-coverage.ts` gate catches missing rules
  // on page.tsx routes. API routes weren't covered by that gate;
  // this runtime gate closes the gap as defence-in-depth.
  if (!rule && pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'forbidden-unmatched-route' }, { status: 403 });
  }
  if (rule) {
    const { realm, resource, merged } = rolesFromToken(payload);
    const allowed = rule.allow.some((r) => merged.has(r));
    if (!allowed) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
      // Preserve identity + requested path on the rewrite so the /403 page
      // can emit a structured `access.forbidden` audit event (FIND-001
      // closure in whole-system-audit doc 10). The page reads these via
      // next/headers() and refuses to render until the audit event lands.
      const url = req.nextUrl.clone();
      url.pathname = '/403';
      const fwd = new Headers(req.headers);
      fwd.delete('x-vigil-user');
      fwd.delete('x-vigil-username');
      fwd.delete('x-vigil-roles');
      fwd.delete('x-vigil-roles-realm');
      fwd.delete('x-vigil-roles-resource');
      if (payload.sub) fwd.set('x-vigil-user', payload.sub);
      if (payload.preferred_username) {
        fwd.set('x-vigil-username', payload.preferred_username);
      }
      const denyRoles = Array.from(merged);
      if (denyRoles.length > 0) fwd.set('x-vigil-roles', denyRoles.join(','));
      // Mode 4.2 — preserve provenance on the deny rewrite too.
      if (realm.length > 0) fwd.set('x-vigil-roles-realm', realm.join(','));
      if (resource.length > 0) fwd.set('x-vigil-roles-resource', resource.join(','));
      fwd.set('x-vigil-forbidden-path', pathname);
      // The rule's allow-list is informational for the audit row so a
      // reviewer can see which roles WOULD have been sufficient.
      fwd.set('x-vigil-forbidden-required-roles', rule.allow.join(','));
      return NextResponse.rewrite(url, { request: { headers: fwd } });
    }
  }

  // Pass identity downstream via request headers (server components read
  // these without re-verifying). Strip first to defend against spoofing.
  const headers = new Headers(req.headers);
  headers.delete('x-vigil-user');
  headers.delete('x-vigil-username');
  headers.delete('x-vigil-roles');
  headers.delete('x-vigil-roles-realm');
  headers.delete('x-vigil-roles-resource');
  // Mode 4.3 — strip any caller-supplied proof/request-id/ts headers
  // so an adversary can't pre-seed them with values that would be
  // re-signed by middleware.
  headers.delete(AUTH_PROOF_HEADER);
  headers.delete(AUTH_PROOF_TS_HEADER);
  headers.delete(REQUEST_ID_HEADER);

  if (payload.sub) headers.set('x-vigil-user', payload.sub);
  if (payload.preferred_username) {
    headers.set('x-vigil-username', payload.preferred_username);
  }
  const { realm, resource, merged } = rolesFromToken(payload);
  const allRoles = Array.from(merged);
  if (allRoles.length > 0) headers.set('x-vigil-roles', allRoles.join(','));
  // Mode 4.2 — emit role provenance separately so downstream consumers
  // that need realm-level guarantees (i.e. roles assigned by the
  // canonical Keycloak realm admin, not by a per-client role mapper)
  // can require specifically realm-sourced roles. Back-compat:
  // x-vigil-roles continues to carry the merged set.
  if (realm.length > 0) headers.set('x-vigil-roles-realm', realm.join(','));
  if (resource.length > 0) headers.set('x-vigil-roles-resource', resource.join(','));

  // Mode 4.3 — cryptographically bind the identity-header set so
  // downstream consumers can detect middleware bypass (Next.js plugin
  // manipulation, proxy header injection, container-level smuggling).
  // The HMAC binds actor + roles + request-id + timestamp under a
  // server-side key. Downstream calls verifyAuthProof() to refuse
  // headers that don't carry a valid proof.
  //
  // If the signing key is not configured (dev without
  // VIGIL_AUTH_PROOF_KEY set), we skip minting — downstream verifiers
  // will return `missing-key` and the operator runbook documents that
  // the key must be configured in production. This avoids a hard
  // dependency on Vault for local development.
  const signingKey = readSigningKey();
  if (signingKey && payload.sub) {
    const reqId = generateRequestId();
    const ts = Date.now();
    const proof = await mintAuthProof(
      {
        actor: payload.sub,
        username: payload.preferred_username ?? null,
        rolesRealm: realm,
        rolesResource: resource,
        requestId: reqId,
        timestampMs: ts,
      },
      signingKey,
    );
    headers.set(REQUEST_ID_HEADER, reqId);
    headers.set(AUTH_PROOF_TS_HEADER, String(ts));
    headers.set(AUTH_PROOF_HEADER, proof);
  }

  // Surface the path to the root layout's NavBar so active-link
  // styling works without each page passing the prop.
  headers.set('x-vigil-pathname', pathname);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    // Run on everything except Next internals + static files.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
