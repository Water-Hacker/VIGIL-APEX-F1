# Doctrinal Observations

Standing back from the line-by-line work, the audit makes the following doctrinal observations.

## Single source of truth — partially applied

**Sound:**

- ROUTE_RULES in `middleware.ts` is the single authorization source — no duplicate matrix elsewhere.
- HashChain canonical serialization is shared by `audit-chain` and the offline verifier (one `canonical.ts`).
- Role list extracted from one ROUTE_RULES; same roles flow through every layer.

**Drift:**

- **CONAC delivery threshold** (FIND-002) — claimed "0.95 posterior + 5 sources" but enforced as "0.85 posterior, no source check." Comment in `certainty.ts:32` documents one value; code uses another.
- **FROST vs multi-sig** (FIND-006) — SRD references FROST; code implements contract-native multi-sig.
- **Role names** are repeated as bare strings in `middleware.ts` and in every page that reads `x-vigil-roles` — single Role type would fix (FIND-008).

## Defence in depth — strong at most boundaries

**Strong boundaries:**

- **Authentication:** Keycloak OIDC + WebAuthn + JWT verification on every request + identity-header stripping (anti-spoofing).
- **Tip portal:** Client-side libsodium + Caddy rate limit + Turnstile + magic-byte validation + canonical-base64 + no IP persistence.
- **Smart contracts:** Commit-reveal + reentrancy guard + per-member-per-proposal vote lock + immutable history.
- **Audit chain:** SHA-256 hash chaining + SERIALIZABLE isolation + halt-on-failure + idempotent witness inserts.

**Single-layer boundaries (flag):**

- **CONAC delivery threshold** — depends on a single query default. Nothing in `worker-conac-sftp` re-validates posterior before SFTP write. **Should be defended at both worker-pattern and worker-conac-sftp.**
- **Forbidden access** — relies on middleware alone for both denial AND audit. The 403 page has no separate audit emission. **Should fire audit at both middleware (if edge runtime allows) and the 403 page server component.**

## Fail closed — mostly yes

**Fail-closed verified:**

- Tip portal public key resolver returns 503 if PLACEHOLDER (`route.ts:13–17`).
- GPG fingerprint resolver fails closed if missing (`worker-conac-sftp/src/index.ts:45–53`).
- JWT missing → redirect to login (middleware:126–128).
- Quorum < 3 shares → schema rejects + worker dead-letters (`triage-flow.ts:67–72`).
- Vault sealed → platform refuses to start (architect recon; not directly tested in this audit).
- Dev signer cannot be instantiated in production (no env-var override path).

**Fail-open or permissive defaults (flag):**

- ROUTE_RULES matching: if a route prefix is NOT in ROUTE_RULES and NOT in PUBLIC_PREFIXES, what happens? Need to read `middleware.ts:148–159` carefully. Per agent recon, the answer appears to be: middleware does not match → request passes through → page renders without role check. This is the root of FIND-004.

## Institutional honesty — real cryptography, accurate code

The cryptography audit (doc 07) confirms every primitive is backed by real, audited libraries:

- libsodium-wrappers-sumo (XChaCha20-Poly1305, sealed-box, SHA-256)
- @simplewebauthn/server (FIDO2)
- @noble/curves (indirectly via ethers.js for ECDSA)
- node:crypto (SHA-256 for hash chain)
- OpenZeppelin (Solidity reentrancy guard, access control)

No setTimeout-as-cryptography. No Math.random for nonces/keys. No return-true verifiers. No hardcoded secrets (gitleaks 0 findings).

**Honesty gap:** the persistent dev banner that SRD assumes exists does not exist in the components directory. This is fine TODAY (dev signer cannot be instantiated) but is a missing piece if the architecture later supports any dev-substitution path.

## Bilingual discipline — drift

CLAUDE.md mandates "Bilingual outputs: FR primary, EN automatic. Both populated; one is never a marketing default." The `/tip` portal honours this discipline beautifully (fully bilingual inline). Other pages (`/`, `/verify`, `/council/proposals`, `/civil-society/*`) ship with hardcoded English (FIND-010). This is a discipline drift to close before institutional review.

## Documentation freshness — drift present but bounded

`docs/decisions/log.md` is current through DECISION-016 (citizen tips retention). The TRUTH.md is updated through W-18 baseline (per Section J). The audit spec dropped today references FROST repeatedly; FROST does not exist in code (FIND-006). This is the most material drift: SRD/BUILD-COMPANION speak of cryptographic primitives that the code never implemented.

`docs/weaknesses/INDEX.md` and `docs/work-program/PHASE-1-COMPLETION.md` were not deeply read in this session and may carry their own drift.

## Telemetry coverage — incomplete

Most state transitions emit audit events:

- `tip.received`, `tip.decrypted`, `tip.promoted`
- `finding.created`, `finding.posterior_updated`, `finding.escalated`
- `council.proposal_opened`, `council.vote_cast`, `council.proposal_escalated`
- `audit.hash_chain_verified` (audit-of-audit cycle)

**Silent transitions (FIND-001):** Forbidden access. Should emit `access.forbidden`.

## Operator ergonomics — partial assessment

`/dead-letter` is reachable to operator and architect. `/calibration` shows reliability bands. `/audit/ai-safety` shows LLM call counts, canary triggers, schema violations. These are actionable. Recovery actions for several failure modes (worker crash, Postgres down, Polygon RPC down) are not yet enshrined in `OPERATIONS.md` runbooks (FIND-015 references this).

## Summary

The doctrine is largely consistently applied. The drifts that matter:

1. **CONAC threshold drift** (FIND-002) — institutionally damaging if a wrong finding reaches CONAC.
2. **FROST/multi-sig drift** (FIND-006) — externally damaging on review.
3. **Forbidden audit silence** (FIND-001) — doctrinally damaging (TAL-PA: no dark periods).
4. **Bilingual drift** on operator-internal pages (FIND-010) — culturally damaging in a French-primary context.
5. **Build-time RBAC coverage** (FIND-004) — operationally damaging if a future page ships unguarded.

Close those five before external red-team at M5 and the platform stands on its own doctrine.
