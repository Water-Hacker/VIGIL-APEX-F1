# Mode 4.2 — Confused-deputy across service boundary

**State after closure:** closed-verified (Phase-1 cheap path; full split available)
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 5 / Category 4
**Branch:** `hardening/phase-1-orientation`

## The failure mode

Keycloak tokens carry two role lists:

- `realm_access.roles` — assigned globally by the realm admin to the user.
- `resource_access[KEYCLOAK_CLIENT_ID].roles` — assigned to the user specifically within this client by the per-client role mapper.

Pre-closure, `rolesFromToken` in `apps/dashboard/src/middleware.ts:110-116` merged both into a single `Set<string>` and emitted them combined as `x-vigil-roles`. Downstream consumers (dashboard pages, API handlers) could not tell where a role originated. A future per-client role mapper compromise — distinct from realm-admin compromise, which is a much higher bar — would silently grant elevated privileges that downstream code couldn't detect.

## What was added

### 1. Typed `rolesFromToken` return shape

The function now returns `{ realm: ReadonlyArray<string>, resource: ReadonlyArray<string>, merged: Set<string> }`. Existing callers (the rule.allow check + the downstream-headers code path) use `merged` for back-compat. Consumers that need realm-level provenance use `realm` directly.

### 2. Two new downstream headers

In addition to the existing `x-vigil-roles` (back-compat, merged set), middleware now emits:

- `x-vigil-roles-realm` — comma-joined realm roles.
- `x-vigil-roles-resource` — comma-joined resource roles for `KEYCLOAK_CLIENT_ID`.

Both the success path (line 197-217) and the `/403` rewrite path (line 163-194) carry the new headers. The /403 page can now show "you have realm role X but the route required resource role Y" with proper provenance.

### 3. Function exported for unit tests

`rolesFromToken` is now exported from `middleware.ts` (the only export). Not re-exported from any barrel; reviewers see the explicit export comment.

### 4. Six new unit tests

`apps/dashboard/__tests__/middleware-role-provenance.test.ts`:

1. **Realm-only token** — slices: `realm=[op,aud]`, `resource=[]`, merged contains both.
2. **Resource-only token** — slices: `realm=[]`, `resource=[council_member]`.
3. **Both present, kept DISTINCT** — `realm=[op]`, `resource=[aud]`, merged has both. Consumer can require realm provenance by checking `realm` alone.
4. **Dedup in merged, kept in slices** — same role at realm AND resource: `merged={op}`, `realm=[op]`, `resource=[op]`. Preserves source even when the value is duplicated.
5. **Ignores other clients' resource_access** — only the configured `KEYCLOAK_CLIENT_ID`'s resource roles count. A different client's role mapper cannot grant roles to this app.
6. **Empty token** — empty slices, empty merged.

## Phase-1 scope vs. long-term

The orientation proposed two paths:

- **Cheap path (chosen for this closure)**: split headers + document `KEYCLOAK_ISSUER` as the sole trusted root. Adoption of provenance-checking by downstream consumers is incremental.

- **Long-term path**: cryptographically sign the downstream header set so it cannot be spoofed even if middleware is bypassed. That's mode 4.3's territory (signed `x-vigil-auth-proof`) and a separate closure.

This commit closes 4.2 by giving downstream consumers the INFORMATION to check provenance. Mode 4.3 closes the TOCTOU gap (middleware-bypass attack) and would build on this primitive by signing the realm/resource split.

## The invariant

Three layers:

1. **The 6 unit tests** lock the typed return contract and the per-slice-preservation property.
2. **TypeScript types** — the function returns a structured object, not a Set. A future refactor that "simplifies" back to flat Set would require changing every caller (currently 2 in middleware.ts plus the test), all of which compile against the new shape.
3. **The new headers exist now** — downstream consumers can opt in to provenance checking incrementally. A consumer that wants realm-only authorisation reads `x-vigil-roles-realm` directly; default behaviour (read `x-vigil-roles`) is unchanged.

## What this closure does NOT include

- **A cryptographic binding** — `x-vigil-roles-realm` is set by middleware and trusted by downstream code. If middleware is bypassed (mode 4.3 territory), the new headers offer no extra protection over the existing `x-vigil-roles`. The split is provenance-of-source under the trust assumption that middleware ran; not provenance-of-trust under attacker injection.
- **Adoption sweep** — no downstream consumer currently reads the new headers. The primitive is in place; per-route adoption is incremental. Flagged for follow-up: any API route that has a "must be assigned by realm admin, not by client role mapper" requirement should be migrated to read `x-vigil-roles-realm`.
- **Documentation of `KEYCLOAK_ISSUER` as the sole trusted root** — this is policy, not code. Could be added to `docs/source/SRD-v3.md`; out of scope for the code-only pass.

## Files touched

- `apps/dashboard/src/middleware.ts` (typed return shape; new headers in both success + /403 paths; export `rolesFromToken`)
- `apps/dashboard/__tests__/middleware-role-provenance.test.ts` (new, 92 lines)
- `docs/audit/evidence/hardening/category-4/mode-4.2/CLOSURE.md` (this file)

## Verification

- `pnpm --filter dashboard run typecheck` — clean.
- `pnpm --filter dashboard exec vitest run __tests__/middleware-role-provenance.test.ts` — 6 passed.
