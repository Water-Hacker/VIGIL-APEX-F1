import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mode 4.4 — Default-permissive fallback when authZ unavailable.
 *
 * The orientation flagged that no integration test proved the
 * default-deny behaviour when the Keycloak JWKS endpoint is
 * unreachable or returns a malformed key set. The code path in
 * middleware.ts:148-161 is correct by construction — `jwtVerify`
 * throws and the catch block redirects/401s — but absence of a test
 * means a future refactor could weaken the catch (e.g. "fall back
 * to allow unsigned tokens during JWKS outage") without anyone
 * noticing.
 *
 * This test mocks `jose.jwtVerify` to simulate the JWKS-failure
 * modes (network error, malformed JWKS, signature mismatch) and
 * asserts the middleware response is one of:
 *   - 401 JSON `{ error: '...' }` for `/api/...` paths
 *   - 302 redirect to `/auth/login?next=<path>` for UI paths
 *
 * It does NOT assert what error code or what redirect URL beyond the
 * shape — those are implementation choices. The invariant is:
 * unverified token → default-deny, not default-allow.
 */

// Mock `jose` BEFORE importing middleware. The mock has two behaviours:
//   - `createRemoteJWKSet` returns a sentinel callable.
//   - `jwtVerify` throws — simulating any verification failure including
//     JWKS-unavailable, signature mismatch, malformed token.
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(() => () => {
      throw new Error('mock: JWKS unavailable');
    }),
    jwtVerify: vi.fn(() => {
      throw new Error('mock: jwtVerify failed (simulating JWKS-unavailable)');
    }),
  };
});

// Importing middleware AFTER the mock ensures the module-load-time
// `createRemoteJWKSet` call sees the mocked version.
let middleware: typeof import('../src/middleware').middleware;
let NextRequestCtor: typeof import('next/server').NextRequest;

beforeEach(async () => {
  vi.resetModules();
  // Re-mock for each test so vi.fn state is fresh.
  vi.doMock('jose', async (importOriginal) => {
    const actual = await importOriginal<typeof import('jose')>();
    return {
      ...actual,
      createRemoteJWKSet: vi.fn(() => () => {
        throw new Error('mock: JWKS unavailable');
      }),
      jwtVerify: vi.fn(() => {
        throw new Error('mock: jwtVerify failed');
      }),
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

describe('mode 4.4 — middleware fails closed when JWKS / jwtVerify is unavailable', () => {
  it('returns 401 JSON for /api/* when the token cannot be verified', async () => {
    const req = makeRequest('/api/findings/some-id', { token: 'fake.jwt.token' });
    const res = await middleware(req);
    // Default-deny: a verified-by-mock-failure token MUST NOT be treated
    // as valid. /api/ paths return JSON 401, not pass-through.
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('invalid-token');
  });

  it('redirects to /auth/login for UI paths when the token cannot be verified', async () => {
    const req = makeRequest('/findings', { token: 'fake.jwt.token' });
    const res = await middleware(req);
    // Default-deny: UI paths redirect to login with `next` preserved.
    expect(res.status).toBe(307);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toMatch(/\/auth\/login/);
    expect(loc).toMatch(/next=%2Ffindings/);
  });

  it('redirects to /auth/login when NO token cookie is present', async () => {
    // Companion case: unauth'd request to a protected UI path also
    // default-denies — same behaviour as a bad token. (This case
    // doesn't depend on the jose mock; it's the no-cookie short-circuit
    // at middleware.ts:135-144.)
    const req = makeRequest('/findings');
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location') ?? '').toMatch(/\/auth\/login/);
  });

  it('returns 401 JSON for /api/* with NO token cookie', async () => {
    const req = makeRequest('/api/findings/x');
    const res = await middleware(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('unauthenticated');
  });

  it('still passes public paths through even when jose mock would reject', async () => {
    // Public surfaces don't call jwtVerify at all; the JWKS-mock-fail
    // should not affect them. Confirms the default-deny does not
    // accidentally extend to public paths.
    const req = makeRequest('/tip');
    const res = await middleware(req);
    // Public paths return NextResponse.next() which is status 200.
    expect(res.status).toBe(200);
    // And no identity headers leaked.
    expect(res.headers.get('x-vigil-user')).toBeNull();
  });
});
