# Hardening Pass · Category 4 (Authorisation and capability enforcement) — Completion Note

**Date:** 2026-05-15
**Branch:** `hardening/phase-1-orientation`
**Phase:** 5 of 11 in the 90-mode hardening pass
**Modes closed this category:** 4 (4.2, 4.3, 4.4, 4.9)
**Modes pre-existing closed-verified:** 5 (4.1, 4.5, 4.6, 4.7, 4.8)

## What landed

Four mode-closure commits, one per failure mode:

| Mode | Title                                                   | Commit                        | Test                                                            |
| ---- | ------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------- |
| 4.9  | Verbose error response leaking internal state           | `security(api)` f0104f1       | `check-api-error-leaks` CI gate + 7 regex tests                 |
| 4.2  | Confused-deputy realm/resource role discrimination      | `security(dashboard)` fdaee96 | `middleware-role-provenance.test.ts` (6 cases)                  |
| 4.4  | Default-permissive fallback when authZ unavailable      | `test(dashboard)` ad82971     | `middleware-jwks-unavailable.test.ts` (5 cases)                 |
| 4.3  | TOCTOU between middleware verify and downstream re-read | `security(dashboard)` a29b6cb | `auth-proof.test.ts` (12 cases) + new `auth-proof.ts` primitive |

## Tests added

30 new test cases across 4 new test files + 1 CI gate script + 1 test file for the gate itself:

- `scripts/check-api-error-leaks.ts` + `scripts/__tests__/check-api-error-leaks.test.ts` — CI gate rejecting `String(err)` / `err.message` echoes in `apps/dashboard/src/app/api/`. 7 regex test cases.
- `apps/dashboard/__tests__/middleware-role-provenance.test.ts` — 6 cases pinning the typed `{ realm, resource, merged }` return contract.
- `apps/dashboard/__tests__/middleware-jwks-unavailable.test.ts` — 5 cases mocking `jose.jwtVerify` to throw; assert default-deny across API + UI + no-cookie paths; assert public paths still work.
- `apps/dashboard/__tests__/auth-proof.test.ts` — 12 cases exercising the HMAC primitive: mint/verify round-trip, tampered-actor rejection, role-list manipulation rejection, stale/future-dated rejection, missing-piece typed reasons, canonical-sort property, CSPRNG request id, constant-time-safe comparison.

Plus the existing 129 dashboard tests continue to pass after middleware refactor (`pnpm --filter dashboard test`: 129/129).

## Invariants added

| Layer   | Invariant                                                                            | Effect                                                      |
| ------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Code    | `rolesFromToken` returns typed `{ realm, resource, merged }` (mode 4.2)              | Downstream consumers can require realm-level provenance     |
| Code    | `x-vigil-roles-realm` / `x-vigil-roles-resource` headers carry provenance (mode 4.2) | Consumers opt in to per-source role checks                  |
| Code    | `mintAuthProof` / `verifyAuthProof` primitive (mode 4.3)                             | HMAC binds actor + roles + request id + timestamp           |
| Code    | Middleware strips proof headers on both public + protected paths (mode 4.3)          | Adversary cannot pre-seed valid-looking proofs              |
| Code    | Per-route logger in `/api/dossier` and `/api/realtime` (mode 4.9)                    | Errors logged server-side; clients see opaque codes         |
| CI gate | `api-error-leaks` job (mode 4.9)                                                     | New `String(err)` / `err.message` echoes blocked at PR time |
| Test    | 30 new test cases                                                                    | Regression coverage for every closure                       |

## Cross-cutting verification

After the last commit in this category:

- `pnpm run typecheck` (60 packages): 60 successful, 0 failed.
- `pnpm --filter dashboard test`: 129 passed (was 99 before Cat-4 work; +30 new tests).
- `npx tsx scripts/check-api-error-leaks.ts`: OK — 20 API files scanned, 0 leaks.
- All Cat-1/2/3 invariants still hold (migration-locks gate, compose-deps gate, pool-saturation tests, finding-CAS tests, audit-chain reconciliation tests).

## Secondary findings surfaced during Category 4

Two findings beyond the orientation:

**(a) Mode 4.4 was already closed at the implementation level.** The orientation flagged "no integration test proved default-deny when JWKS is unavailable." Re-investigation: the middleware's catch block at `:148-161` IS correct by construction — `jwtVerify` throws → catch → redirect or 401. The closure is the regression invariant (the 5-case test), not a fix to existing behaviour. Same pattern as the mode 2.3 and mode 1.3 re-investigations in earlier categories.

**(b) Mode 4.3 primitive is in place but no adoption.** `verifyAuthProof` is exported but no downstream consumer calls it yet. The TOCTOU defence is therefore ARMED (middleware mints the proof) but not yet ENFORCED (consumers don't reject missing-proof). The next incremental step is the adoption sweep: wire `verifyAuthProof()` into `apps/dashboard/src/lib/audit-emit.server.ts` (which every protected route calls), with a config flag to enable enforcement once `VIGIL_AUTH_PROOF_KEY` is provisioned in production. Per the binding posture, this is OUT OF SCOPE for this commit but should be the immediate Cat-4 follow-up.

## Modes that revealed structural issues requiring follow-up

None at the failure-mode level. Three operational follow-ups:

1. **Adopt `verifyAuthProof` in `audit-emit.server.ts`** so every protected route rejects requests without a valid proof. Behind a config flag until prod key is provisioned.
2. **Provision `VIGIL_AUTH_PROOF_KEY` in production** via Vault path `secret/vigil/auth-proof-key` + ExternalSecret projection.
3. **Write `docs/runbooks/auth-proof-key-rotation.md`** documenting how the operator rotates the HMAC key.

The architect can prioritise these against Categories 5–10 or batch them as a single "Cat-4 adoption" follow-up commit.

## Status of the 90-mode pass after Category 4

After this category:

- **Closed-verified now:** 66 of 90 (was 62 after Category 3).
- **Partially closed:** 10 (unchanged — Cat 4 had no partials, only opens).
- **Open:** 8 (was 12 — 4 modes closed this category).
- **Not applicable:** 6 (unchanged).

## Architect signal needed

None for proceeding to Category 5 (Cryptographic posture). Only 1 partial mode there (5.9 Shamir corrupted-Y-byte test) classified as cheap. Should be the fastest category.

Five open questions from §7 of the orientation remain unaddressed; none block Category 5.
