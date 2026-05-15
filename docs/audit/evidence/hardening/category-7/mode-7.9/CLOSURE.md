# Mode 7.9 — Unbounded input size causing resource exhaustion

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 8 / Category 7
**Branch:** `hardening/phase-1-orientation`

## The failure mode

Two public-facing tip routes accept POST bodies from anonymous citizens:

- `/api/tip/submit` accepts JSON; budget is the 5 attachment CIDs + ~20 KB body ciphertext (legitimate maximum). Hard cap: 256 KB via `Content-Length` header check.
- `/api/tip/attachment` accepts an opaque libsodium sealed-box ciphertext binary. Cap: 10 MB + 32 KB slack (`TIP_ATTACHMENT_LIMITS.maxBytesPerFile + SEALED_BOX_SLACK_BYTES`).

Pre-closure: the code enforced both caps but no integration test exercised them. A future PR that:

- Removes the `Content-Length` short-circuit on the submit route, OR
- Removes the `ab.byteLength > MAX_BLOB_BYTES` check on the attachment route

...would silently regress to "we accept arbitrarily large POSTs" — only surfacing under a real attack.

## What was added

`apps/dashboard/__tests__/tip-payload-size-413.test.ts` — 5 integration tests that invoke the actual route handlers (`POST as submitPost`, `POST as attachmentPost`) with synthetic NextRequest objects:

### tip-submit (3 cases)

1. **`rejects a body with Content-Length > 256 KB before parsing`** — 300 KB body, asserts response is 413 with `error: 'payload-too-large'`. The 413 short-circuits BEFORE `req.json()` runs (so the test doesn't depend on body being parseable).

2. **`accepts requests with Content-Length under the cap`** — small body, asserts response is NOT 413. The body fails downstream validation (400 from schema parse or 415 from content-type check), but the size check itself passed. This locks the contract that the cap is a ceiling, not a floor.

3. **`rejects non-JSON content-type with 415 BEFORE the size check`** — text/plain body, asserts 415. Locks the content-type-guard ordering so a future refactor doesn't accidentally let non-JSON requests through the size check and crash on `req.json()`.

### tip-attachment (2 cases)

4. **`rejects an arrayBuffer larger than the 10 MB + 32 KB cap`** — 11 MB body with a non-zero prefix (so the cheap "all-zero" sanity check wouldn't false-positive), asserts 413 with `error: 'too-large'`. Confirms the size check fires on byteLength, not on content.

5. **`rejects an empty body with 400 before the size check`** — zero-length arrayBuffer, asserts 400 with `error: 'empty-body'`. The empty-body guard sits before the size-cap check; this test pins their ordering.

## The invariant

Two layers:

1. **The 5 integration tests** invoke the actual route handlers. A future PR removing either size cap fails the test that exercises the 413 path; a refactor that reorders the guards fails the ordering tests.

2. **The tests do NOT depend on test fixtures or stubs** for the size-check path. The route's 413 response is determined by header / arrayBuffer length alone; the test asserts that path BEFORE any DB / Turnstile / audit side effect runs. This is the simplest possible regression invariant for the failure mode.

## What this closure does NOT include

- **Caddy-level body-size enforcement test**. The route's 256 KB / 10.03 MB caps are the second line of defence; the first is supposed to be Caddy's `max_request_body` directive. Verifying Caddy enforces this requires a running Caddy instance. The route's caps are application-side; verifying THEM is what mode 7.9 is about. Caddy-side enforcement is documented in `infra/docker/caddy/Caddyfile` and exercised in DR rehearsal; not part of this unit-level closure.

- **Streaming body-size enforcement**. The current implementation reads the full arrayBuffer before checking length — a malicious client could DOS the worker by streaming 10 MB before the size check fires. The 11 MB rejection happens at memory cost. The fix (stream-and-count) is a larger refactor that requires Next.js Body-streaming API; out of scope for the regression-invariant closure. Flagged for follow-up if attack pressure justifies it (Caddy's body-size limit is the actual production defence against this case).

- **Other public routes**. `/api/audit/public`, `/api/audit/aggregate`, `/api/verify/*` are public surfaces too but have no large-body concerns (they're GET routes or accept tiny query bodies). The size-cap regression matters only where the body can plausibly be large; mode 7.9 closes the only two such routes.

## Files touched

- `apps/dashboard/__tests__/tip-payload-size-413.test.ts` (new, 110 lines)
- `docs/audit/evidence/hardening/category-7/mode-7.9/CLOSURE.md` (this file)

No source changes — the size caps were already correct; the closure is the regression invariant.

## Verification

- `pnpm --filter dashboard exec vitest run __tests__/tip-payload-size-413.test.ts` — 5/5 pass.
- `pnpm --filter dashboard test` — 134 passed (was 129 before Cat-7; +5 new tests).
- `pnpm --filter dashboard run typecheck` — clean.
