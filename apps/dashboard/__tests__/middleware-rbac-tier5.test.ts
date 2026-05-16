import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tier-5 dashboard RBAC audit — three closures pinned here:
 *
 *   1. Default-deny on unmatched `/api/*` paths: pre-fix, a new API
 *      route handler that wasn't in ROUTE_RULES was reachable by ANY
 *      authenticated user. The post-PR-15 audit caught two such
 *      handlers (/api/audit/discovery-queue/curate and /api/realtime)
 *      shipping with no middleware rule. Middleware now 403s on any
 *      `/api/*` path that's neither public nor in ROUTE_RULES.
 *
 *   2. JWT audience tightening: pre-fix accepted tokens with
 *      `aud: account` (Keycloak's self-service client). That's a
 *      confused-deputy risk — a token minted for a different client
 *      could be replayed at this middleware. Now only the
 *      dashboard's own client id is accepted.
 *
 *   3. New ROUTE_RULES entries: /api/audit (auditor + architect) and
 *      /api/realtime (operator-class roles). Pinned here so a refactor
 *      that drops these silently re-opens the gap.
 *
 * The jose mock is configurable per-test so we can simulate "valid
 * token with role X" and "wrong-audience token" scenarios.
 */

let middleware: typeof import('../src/middleware').middleware;
let NextRequestCtor: typeof import('next/server').NextRequest;
let mockJwtVerifyImpl: () => Promise<{ payload: Record<string, unknown> }>;

beforeEach(async () => {
  vi.resetModules();
  vi.doMock('jose', async (importOriginal) => {
    const actual = await importOriginal<typeof import('jose')>();
    return {
      ...actual,
      createRemoteJWKSet: vi.fn(() => () => {
        throw new Error('mock: JWKS unused in this test');
      }),
      jwtVerify: vi.fn(() => mockJwtVerifyImpl()),
    };
  });
  ({ middleware } = await import('../src/middleware'));
  ({ NextRequest: NextRequestCtor } = await import('next/server'));
});

function makeRequest(
  pathname: string,
  opts: { token?: string } = {},
): InstanceType<typeof NextRequestCtor> {
  const url = `http://localhost${pathname}`;
  const headers = new Headers();
  if (opts.token) {
    headers.set('cookie', `vigil_access_token=${opts.token}`);
  }
  return new NextRequestCtor(url, { headers });
}

function withPayload(payload: Record<string, unknown>): void {
  mockJwtVerifyImpl = () => Promise.resolve({ payload });
}

describe('tier-5 closure: default-deny on unmatched /api/* paths', () => {
  it('returns 403 for an authenticated request to an unmatched /api/* path', async () => {
    // A hypothetical new route handler not yet in ROUTE_RULES. Pre-fix
    // this would pass through to the handler with status 200 (or
    // whatever the handler returned). Post-fix middleware refuses
    // before the handler runs.
    withPayload({
      sub: 'user-uuid',
      preferred_username: 'alice',
      realm_access: { roles: ['operator'] },
    });
    const req = makeRequest('/api/some-unmatched-route', { token: 'fake.jwt' });
    const res = await middleware(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('forbidden-unmatched-route');
  });

  it('returns 403 even when the user has the architect role (no rule = no allow-list)', async () => {
    // The architect role allows EVERYTHING that's in ROUTE_RULES. The
    // default-deny gate fires BEFORE the role check, so even architect
    // can't access an unruled API path. By design — forces the rule
    // to exist, not the privileged user to compensate.
    withPayload({
      sub: 'architect-uuid',
      realm_access: { roles: ['architect'] },
    });
    const req = makeRequest('/api/zzz-future-route', { token: 'fake.jwt' });
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });

  it('passes through UI paths that are unmatched (legacy behaviour — coverage gate catches at build)', async () => {
    // Non-/api/ paths preserve pre-fix behaviour: unmatched UI paths
    // pass through. The build-time `check-rbac-coverage.ts` gate
    // catches missing UI rules; runtime fallback is permissive.
    withPayload({
      sub: 'user-uuid',
      realm_access: { roles: ['operator'] },
    });
    const req = makeRequest('/some-unmatched-ui-path', { token: 'fake.jwt' });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('does NOT 403 on /api/tip/* (public, caught by isPublic before the gate)', async () => {
    // Public API paths skip the protected branch entirely. The
    // default-deny gate must not fire on them.
    const req = makeRequest('/api/tip/public-key');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});

describe('tier-5 closure: new ROUTE_RULES entries', () => {
  it('/api/audit/discovery-queue/curate allows auditor', async () => {
    withPayload({
      sub: 'user-uuid',
      realm_access: { roles: ['auditor'] },
    });
    const req = makeRequest('/api/audit/discovery-queue/curate', { token: 'fake.jwt' });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('/api/audit/discovery-queue/curate denies operator (auditor-only)', async () => {
    withPayload({
      sub: 'user-uuid',
      realm_access: { roles: ['operator'] },
    });
    const req = makeRequest('/api/audit/discovery-queue/curate', { token: 'fake.jwt' });
    const res = await middleware(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('forbidden');
  });

  it('/api/realtime allows operator', async () => {
    withPayload({
      sub: 'user-uuid',
      realm_access: { roles: ['operator'] },
    });
    const req = makeRequest('/api/realtime', { token: 'fake.jwt' });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('/api/realtime denies civil_society (operator-class only)', async () => {
    // civil_society can read public ledger surfaces but must not
    // subscribe to the realtime broadcast (tip-arrival + finding-
    // threshold + vote events).
    withPayload({
      sub: 'user-uuid',
      realm_access: { roles: ['civil_society'] },
    });
    const req = makeRequest('/api/realtime', { token: 'fake.jwt' });
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });
});

describe('tier-5 closure: JWT audience tightening', () => {
  it('rejects a token whose audience does not match the dashboard client id', async () => {
    // jose.jwtVerify with `audience: 'vigil-dashboard'` throws on any
    // token where `aud` isn't 'vigil-dashboard'. We simulate that
    // throw here — the middleware's catch path then 401s for /api/*.
    mockJwtVerifyImpl = () =>
      Promise.reject(new Error('JWTClaimValidationFailed: unexpected "aud"'));
    const req = makeRequest('/api/findings/x', { token: 'fake.jwt' });
    const res = await middleware(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('invalid-token');
  });
});
