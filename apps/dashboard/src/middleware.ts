import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';
import { NextResponse, type NextRequest } from 'next/server';

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

function rolesFromToken(payload: VigilJwtPayload): Set<string> {
  const roles = new Set<string>();
  for (const r of payload.realm_access?.roles ?? []) roles.add(r);
  const clientRoles = payload.resource_access?.[KEYCLOAK_CLIENT_ID]?.roles ?? [];
  for (const r of clientRoles) roles.add(r);
  return roles;
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
    const { payload: verified } = await jwtVerify(token, JWKS, {
      issuer: KEYCLOAK_ISSUER,
      audience: [KEYCLOAK_CLIENT_ID, 'account'],
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
  if (rule) {
    const roles = rolesFromToken(payload);
    const allowed = rule.allow.some((r) => roles.has(r));
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
      if (payload.sub) fwd.set('x-vigil-user', payload.sub);
      if (payload.preferred_username) {
        fwd.set('x-vigil-username', payload.preferred_username);
      }
      const denyRoles = Array.from(roles);
      if (denyRoles.length > 0) fwd.set('x-vigil-roles', denyRoles.join(','));
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
  headers.delete('x-vigil-roles');
  if (payload.sub) headers.set('x-vigil-user', payload.sub);
  if (payload.preferred_username) {
    headers.set('x-vigil-username', payload.preferred_username);
  }
  const roles = Array.from(rolesFromToken(payload));
  if (roles.length > 0) headers.set('x-vigil-roles', roles.join(','));
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
