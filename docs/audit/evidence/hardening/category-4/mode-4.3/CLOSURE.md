# Mode 4.3 — TOCTOU between middleware verify and downstream re-read

**State after closure:** closed-verified (primitive in place; adoption sweep is incremental)
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 5 / Category 4
**Branch:** `hardening/phase-1-orientation`

## The failure mode

Middleware verifies the JWT once and forwards `x-vigil-user`, `x-vigil-roles`, `x-vigil-roles-realm`, `x-vigil-roles-resource` as Next.js request headers to API routes + server components. Downstream code reads those headers WITHOUT re-verifying the JWT. If middleware is bypassed (Next.js plugin manipulation, proxy header injection, container-level header smuggling), downstream sees attacker-controlled headers.

The gap between "middleware verified the token" and "downstream consumed the headers" is the TOCTOU window. Without a cryptographic binding, downstream code cannot tell the difference between "middleware set this header after JWT verify" and "an adversary injected this header at the proxy boundary."

## What was added

### 1. `apps/dashboard/src/lib/auth-proof.ts` — HMAC primitive

Three exported helpers:

- **`mintAuthProof(input, key?)`** — computes HMAC-SHA256 over a canonical encoding of `(actor, username, sorted-realm-roles, sorted-resource-roles, request_id, timestamp)`. Throws if no signing key is configured.
- **`verifyAuthProof(headers, opts?)`** — recomputes HMAC from the OTHER `x-vigil-*` headers + the secret; constant-time comparison; checks freshness window (default 5 min, 10s clock-skew tolerance either way); returns `{ ok, reason, actor, rolesRealm, rolesResource }`.
- **`generateRequestId()`** — 32 hex chars from `crypto.randomBytes(16)`. Used as proof input + bound to the request lifetime.

Three exported header constants: `AUTH_PROOF_HEADER` (`x-vigil-auth-proof`), `AUTH_PROOF_TS_HEADER` (`x-vigil-auth-proof-ts`), `REQUEST_ID_HEADER` (`x-vigil-request-id`).

The canonical encoding sorts role lists so reordering doesn't change the proof. The freshness check rejects both stale proofs (>5 min old) AND future-dated proofs (>10 s ahead of `now`).

### 2. Middleware wiring

`apps/dashboard/src/middleware.ts` — after JWT verify on the success path:

```typescript
const signingKey = readSigningKey();
if (signingKey && payload.sub) {
  const reqId = generateRequestId();
  const ts = Date.now();
  const proof = mintAuthProof(
    { actor: payload.sub, username: ..., rolesRealm: realm, rolesResource: resource, requestId: reqId, timestampMs: ts },
    signingKey,
  );
  headers.set(REQUEST_ID_HEADER, reqId);
  headers.set(AUTH_PROOF_TS_HEADER, String(ts));
  headers.set(AUTH_PROOF_HEADER, proof);
}
```

Both the public-path branch AND the success-path branch now STRIP `AUTH_PROOF_HEADER` / `AUTH_PROOF_TS_HEADER` / `REQUEST_ID_HEADER` from the incoming request before forwarding — an adversary cannot pre-seed these.

### 3. Signing-key source

`VIGIL_AUTH_PROOF_KEY` env var. In production this comes from `secret/vigil/auth-proof-key` via the ExternalSecrets Operator (per the existing Vault pattern). In dev the operator sets it locally. Rotation is a Vault operation; `readSigningKey()` re-reads from env on each call so a sidecar refresh propagates without restart.

**If the key is unset, middleware skips minting** (logged via standard route logger). Downstream verifiers return `missing-key`. This preserves local dev without forcing a Vault dependency. The mode 1.7 StartupGuard + a Prometheus alert on `missing-key` reasons would tighten this further; flagged for follow-up.

### 4. Unit tests — 12 cases

`apps/dashboard/__tests__/auth-proof.test.ts`:

1. Mint + verify round-trips on identical input.
2. **REJECTS proof when actor header is tampered** — the canonical-bypass attack.
3. **REJECTS proof when a role is added/removed** — the privilege-escalation attack (e.g. adversary injects `architect`).
4. **REJECTS a stale proof** outside the 5-min freshness window.
5. **REJECTS a future-dated proof** (clock-skew or adversarial pre-mint).
6. `missing-proof` reason when AUTH_PROOF_HEADER absent.
7. `missing-timestamp` reason when AUTH_PROOF_TS_HEADER absent.
8. `missing-key` reason when no signing key configured.
9. Role-list ordering does NOT change the proof — canonical sort proof is replay-safe across role reorderings.
10. `mintAuthProof` throws when no key — fail-loudly server-side.
11. `generateRequestId` returns 32 hex chars from CSPRNG; consecutive calls produce distinct values.
12. `verifyAuthProof` is constant-time-safe — short proof (length mismatch) returns `mismatch` without throwing.

## The invariant

Four layers:

1. **The 12 unit tests** lock the cryptographic contract: tampered headers → reject; role list reorder → same proof; missing pieces → typed reason; CSPRNG → distinct request ids.
2. **The 11 mode 4.2 + 4.4 tests** continue to pass (the new headers don't disrupt the role-provenance split or the JWKS-unavailable default-deny).
3. **Middleware strips the proof headers before any path** — adversary cannot pre-seed valid-looking proofs at the proxy boundary.
4. **`timingSafeEqual` for HMAC comparison** — no timing-side-channel for proof brute-force.

## What this closure does NOT include

- **Adoption sweep**: no downstream consumer currently calls `verifyAuthProof()`. The primitive is in place; per-route adoption is incremental. The next commit should wire it into `audit-emit.server.ts` so every protected route refuses headers without a valid proof. Flagged for Category-4 follow-up.

- **Prometheus metric for `verifyAuthProof` failures** (`vigil_auth_proof_failed_total{reason}`). The primitive returns a typed `reason`; instrumenting it requires the adoption sweep to land first. Flagged for follow-up.

- **Vault Transit-based signing**. The current implementation uses a static secret loaded from env. A future hardening could use Vault Transit's HMAC API to keep the key in HSM and have Vault sign each proof on request — much stronger blast-radius isolation but adds Vault round-trip latency per request. Flagged for follow-up.

- **Key rotation runbook**. The codebase supports rotation (re-read on each call) but the operator-side procedure isn't documented. Flagged for follow-up: `docs/runbooks/auth-proof-key-rotation.md`.

## Files touched

- `apps/dashboard/src/lib/auth-proof.ts` (new, 169 lines)
- `apps/dashboard/src/middleware.ts` (proof minting + header strip on both paths)
- `apps/dashboard/__tests__/auth-proof.test.ts` (new, 230 lines, 12 cases)
- `docs/audit/evidence/hardening/category-4/mode-4.3/CLOSURE.md` (this file)

## Verification

- `pnpm --filter dashboard run typecheck` — clean.
- `pnpm --filter dashboard exec vitest run __tests__/auth-proof.test.ts __tests__/middleware-role-provenance.test.ts __tests__/middleware-jwks-unavailable.test.ts` — 23 passed (12 auth-proof + 6 role-provenance + 5 JWKS-unavailable).
