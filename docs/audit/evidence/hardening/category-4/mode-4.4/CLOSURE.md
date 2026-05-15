# Mode 4.4 — Default-permissive fallback when authZ unavailable

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 5 / Category 4
**Branch:** `hardening/phase-1-orientation`

## The failure mode

When the Keycloak JWKS endpoint is unreachable (Keycloak down, network partition, malformed response), the JWT-verify step at `apps/dashboard/src/middleware.ts:148-161` throws. The catch block redirects UI requests to `/auth/login` and returns 401 for API requests — default-deny is correct **by construction**.

Pre-closure: no test proved this behaviour. A future refactor could weaken the catch (e.g. "fall back to allow unsigned tokens during JWKS outage to keep the dashboard reachable") and no one would catch the regression until an actual outage exposed it.

## What was added

`apps/dashboard/__tests__/middleware-jwks-unavailable.test.ts` — 5 cases that mock `jose.jwtVerify` to throw (simulating any verification failure: JWKS unreachable, signature mismatch, malformed token, expired key) and assert the middleware response:

1. **`returns 401 JSON for /api/* when the token cannot be verified`** — bad token + protected API path → `{ error: 'invalid-token' }` status 401.
2. **`redirects to /auth/login for UI paths when the token cannot be verified`** — bad token + protected UI path → 307 to `/auth/login?next=/findings`.
3. **`redirects to /auth/login when NO token cookie is present`** — companion case; default-deny extends to the no-cookie short-circuit too.
4. **`returns 401 JSON for /api/* with NO token cookie`** — same default-deny for the API+no-cookie case.
5. **`still passes public paths through even when jose mock would reject`** — confirms default-deny does NOT accidentally extend to public surfaces; `/tip` still works during JWKS outages.

The mock setup uses `vi.mock('jose', ...)` to replace `createRemoteJWKSet` and `jwtVerify` with versions that throw. `vi.resetModules()` + `vi.doMock` in `beforeEach` ensures a fresh mock per test so `vi.fn` call counts don't bleed across tests.

The test verifies the response SHAPE (401 JSON / 307 redirect / 200 pass-through) — it doesn't lock the specific error codes or redirect URLs beyond `next=<path>` preservation. The invariant being protected: **unverified token MUST NOT become an allowed request**.

## The invariant

Three layers:

1. **The 5 unit tests** lock the default-deny behaviour. A future refactor that weakens the catch block fails all 4 default-deny tests.
2. **TypeScript types** — middleware returns `Promise<NextResponse>`; the catch block must return a NextResponse (never throw past the catch boundary).
3. **The public-paths test (#5)** locks the complementary property: default-deny does NOT extend to public surfaces. A future refactor that accidentally checks JWKS on `/tip` would fail this test, preserving anonymous accessibility.

## What this closure does NOT include

- **A Prometheus metric for JWKS-fetch failure rate**. The orientation suggested this for operator visibility. `jose` doesn't expose JWKS-fetch metrics directly; instrumenting requires wrapping `createRemoteJWKSet` with a counter middleware. Out of scope; flagged for follow-up. A simple alternative is to log when `jwtVerify` throws and rely on log-derived metrics.

- **Actual integration test against a mocked Keycloak server**. The unit-mock approach gives the same coverage at a fraction of the runtime; a containerised Keycloak in CI would be heavier than the failure-mode warrants.

- **A test against the `jose` cache window**. `jose` caches JWKS for ~10 min by default. During cache + Keycloak outage, verification of a previously-cached valid token still succeeds — that's correct behaviour (the operator's session continues). What this closure tests is the NO-CACHED-KEY path. The cache-still-warm path is correct by `jose`'s contract and would require mocking the cache directly to test.

## Files touched

- `apps/dashboard/__tests__/middleware-jwks-unavailable.test.ts` (new, 116 lines)
- `docs/audit/evidence/hardening/category-4/mode-4.4/CLOSURE.md` (this file)

No source changes — the default-deny behaviour was already correct; the closure is the regression invariant.

## Verification

- `pnpm --filter dashboard exec vitest run __tests__/middleware-jwks-unavailable.test.ts` — 5 passed.
- `pnpm --filter dashboard run typecheck` — clean.
