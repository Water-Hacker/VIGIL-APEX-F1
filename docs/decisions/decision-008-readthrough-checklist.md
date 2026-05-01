# DECISION-008 (Production-readiness pass, Tier 1–7) — Architect Read-Through Checklist

> Use this checklist to promote DECISION-008 from **PROVISIONAL** → **FINAL**
> in [docs/decisions/log.md](log.md). Walk every item; sign each box; write
> a one-line decision-log update when done. Pattern mirrors
> [decision-012-readthrough-checklist.md](decision-012-readthrough-checklist.md).

**Decision body:** [docs/decisions/log.md](log.md) §DECISION-008 (line 1588 onward).

**Date opened:** 2026-04-28
**Promoted to FINAL on:** **\_\_\_\_**\_**\_\_\_\_**
**Architect signature:** **\_\_\_\_**\_**\_\_\_\_**

> **AUDIT-022** is the audit-trail anchor for this checklist. Once every
> box is signed, AUDIT-022 in [`AUDIT.md`](../../AUDIT.md) flips from
> `blocked-on-architect-decision` to `fixed`.

---

## §1 Tier 1 — Fail-closed gates (9 files)

For each gate, confirm the failure mode is the one you want.

- [ ] [`apps/worker-anchor/src/index.ts`](../../apps/worker-anchor/src/index.ts) — refuses boot on null/empty `POLYGON_ANCHOR_CONTRACT`. Fallback to public RPC warns rather than crashes. **Architect call:** is "warn + run on public RPC" the correct degraded mode for an isolated regional node, or should it also refuse?
- [ ] [`apps/audit-verifier/src/index.ts`](../../apps/audit-verifier/src/index.ts) — same null-address discipline.
- [ ] [`apps/worker-conac-sftp/src/index.ts`](../../apps/worker-conac-sftp/src/index.ts) — `requiredEnv()` + `requireGpgFingerprint()` refuse empty / `PLACEHOLDER` / non-40-hex fingerprints; `SIGNER_NAME` env required.
- [ ] [`apps/worker-dossier/src/index.ts`](../../apps/worker-dossier/src/index.ts) — gpg-sign failure returns retry, NOT an unsigned dossier write. Boot-time GPG fingerprint validation. The `VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER=true` opt-in works only pre-Phase-1 + non-production.
- [ ] [`packages/federation-stream/src/server.ts`](../../packages/federation-stream/src/server.ts) — insecure gRPC only when `VIGIL_FEDERATION_INSECURE_OK=true`; otherwise throws on missing TLS material.
- [ ] [`apps/worker-minfi-api/src/index.ts`](../../apps/worker-minfi-api/src/index.ts) — `loadMinfiMtls()` pre-checks each cert/key/ca path with `existsSync` before `readFileSync`.
- [ ] [`apps/adapter-runner/src/index.ts`](../../apps/adapter-runner/src/index.ts) — `PROXY_TOR_ENABLED=1` requires explicit `PROXY_TOR_SOCKS_HOST`.
- [ ] [`packages/llm/src/providers/local.ts`](../../packages/llm/src/providers/local.ts) — refuses to default `LOCAL_LLM_BASE_URL` to `host.docker.internal`; the tier-2 sovereign LLM endpoint must be explicit.
- [ ] [`packages/db-postgres/drizzle.config.ts`](../../packages/db-postgres/drizzle.config.ts) — throws if `POSTGRES_URL` unset.
- [ ] **Architect cross-check:** the 9 gates collectively prevent boot of a misconfigured node into a production network. Confirm there is no gate I would have wanted that is missing.

## §2 Tier 2 — Config hygiene (.env.example, 64 entries)

- [ ] [`.env.example`](../../.env.example) lists every `process.env.*` consumer in the running code (cross-check via [`scripts/check-env-vars.ts`](../../scripts/check-env-vars.ts) if wired, otherwise spot-check the 64 added entries against the diff).
- [ ] The `~30 orphaned keys` deferred for follow-up are operationally inert today (docker-compose env-file passthroughs and Keycloak admin tooling). **Architect call:** confirm no orphaned key gates a binding doctrine commitment.
- [ ] `getAdapterUserAgent()` honoring `ADAPTER_USER_AGENT` is correctly wired into both [`apps/adapter-runner/src/adapters/_helpers.ts`](../../apps/adapter-runner/src/adapters/_helpers.ts) and [`packages/adapters/src/fingerprint.ts`](../../packages/adapters/src/fingerprint.ts).
- [ ] `SIGNER_NAME` env-driven (replacing the hardcoded value) is the right shape — the operator's identity is not baked into the binary.

## §3 Tier 3 — Adapter base hardening

- [ ] [`packages/adapters/src/rate-limit.ts`](../../packages/adapters/src/rate-limit.ts) — `DailyRateLimiter` keyed by `adapter:ratelimit:<src>:<yyyy-mm-dd>` with 36h TTL covers day rollover. Counter increments only on successful runs (failed/blocked attempts don't burn the budget) — confirm this matches the contract you want with each source's published rate-limit policy.
- [ ] [`packages/adapters/src/robots.ts`](../../packages/adapters/src/robots.ts) — `RobotsChecker` with 24h Redis cache and a real RFC-9309-style longest-match parser. Failure-to-fetch robots.txt is treated as **allow**. **Architect call:** confirm fail-open is the right default — fail-closed would refuse fetches when robots.txt itself is unreachable.
- [ ] [`packages/adapters/src/backoff.ts`](../../packages/adapters/src/backoff.ts) — `runWithBackoff` retries 3× at 0/10s/30s on transient errors only (5xx / ECONNRESET / ETIMEDOUT / ENOTFOUND); 4xx propagates immediately so the first-contact handler runs. The retry budget aligns with adapter cron cadence.
- [ ] All three are wired as pre-flight gates in [`apps/adapter-runner/src/run-one.ts`](../../apps/adapter-runner/src/run-one.ts).
- [ ] [`apps/adapter-runner/src/adapters/minfi-bis.ts`](../../apps/adapter-runner/src/adapters/minfi-bis.ts) — mTLS bytes wired into a real `undici.Agent` dispatcher; production TLS handshake actually presents the client cert (rather than just sending a header).
- [ ] [`apps/adapter-runner/src/adapters/anif-amlscreen.ts`](../../apps/adapter-runner/src/adapters/anif-amlscreen.ts) — `ANIF_PEP_SURFACE_ALLOWED` egress gate: PEP rows are stripped at the adapter unless the env explicitly opts in. Sanction rows pass through (public commitments).

## §4 Tier 4 — Source-count reconciliation

- [ ] The canonical source count is **27** (TRUTH.md §C). The +1 over the SRD's "26" is `anif-amlscreen` (added per DECISION-008, MOU-gated AML feed). The SRD §10.2.1 erratum has been added.
- [ ] [`infra/sources.json`](../../infra/sources.json) (or wherever the deployed source registry lives) lists exactly 27 entries.
- [ ] No deployment-time tooling counts sources from a stale list.

## §5 Tier 5 — WebAuthn challenge + civil-society portal

WebAuthn challenge ratification:

- [ ] [`apps/dashboard/src/app/api/council/vote/route.ts`](../../apps/dashboard/src/app/api/council/vote/route.ts) — the `void parsed.data.webauthn_assertion` line is replaced with a real `verifyAuthentication` call bound to the open challenge.
- [ ] The challenge is consumed on success (cannot be replayed); the WebAuthn counter is bumped.
- [ ] Migration `0006_webauthn_challenge.sql` is paired with a `_down.sql` (per DECISION-017 / AUDIT-051) — confirm at [`packages/db-postgres/drizzle/0006_webauthn_challenge.sql`](../../packages/db-postgres/drizzle/0006_webauthn_challenge.sql) and the corresponding down (or accept legacy forward-only via DECISION-017's closed allowlist).

Civil-society read-only portal:

- [ ] [`apps/dashboard/src/lib/civil-society.server.ts`](../../apps/dashboard/src/lib/civil-society.server.ts) — three accessors: `listAuditLogPage`, `listClosedProposals`, `listCouncilComposition`. Subject IDs masked via deterministic short hash (W-15 surface).
- [ ] Council composition exposes pillar fill state only; no individual identities (EXEC §13). **Architect cross-check:** confirm "fill state only" is the right level of public exposure for the council's working state.
- [ ] [`apps/dashboard/src/app/civil-society/`](../../apps/dashboard/src/app/civil-society/) — three pages under `audit-log`, `proposals-closed`, `council-composition`.
- [ ] [`apps/dashboard/src/middleware.ts`](../../apps/dashboard/src/middleware.ts) `/civil-society` rule allows `civil_society`, `auditor`, `architect` Keycloak roles.

## §6 Tier 6 — Critical-path tests (7 files)

For each test file, confirm the named property is the one you wanted to pin.

- [ ] [`packages/audit-chain/__tests__/canonical.test.ts`](../../packages/audit-chain/__tests__/canonical.test.ts) — bodyHash determinism (key order, NFC unicode), rowHash chain, null prev_hash semantics.
- [ ] [`packages/governance/__tests__/quorum.test.ts`](../../packages/governance/__tests__/quorum.test.ts) — 3-of-5 escalate, 4-of-5 release, recusal-as-abstain, expiry, double-vote rejection.
- [ ] [`packages/security/__tests__/sodium.test.ts`](../../packages/security/__tests__/sodium.test.ts) — sealed-box round-trip, cross-keypair rejection, tamper detection.
- [ ] [`packages/security/__tests__/shamir.test.ts`](../../packages/security/__tests__/shamir.test.ts) — 3-of-5 reconstruction; 2-of-5 fails; duplicate-X / zero-X / length-inconsistent rejection.
- [ ] [`packages/adapters/__tests__/backoff.test.ts`](../../packages/adapters/__tests__/backoff.test.ts) — transient classification, retry budget, no-retry-on-4xx.
- [ ] [`packages/adapters/__tests__/robots.test.ts`](../../packages/adapters/__tests__/robots.test.ts) — agent-specific override, longest-match path rule, cache-then-reuse, 404-as-allow, fail-open on network error.
- [ ] [`packages/adapters/__tests__/rate-limit.test.ts`](../../packages/adapters/__tests__/rate-limit.test.ts) — under cap allows, at cap refuses, day-rollover yields fresh bucket, TTL set.
- [ ] **Architect cross-check:** `verifyCrossWitness` test deferral (function signature hardcodes `pg.Pool` and `FabricBridge`; testing requires interface refactor) is acceptable as a follow-up rather than a blocker.

## §7 Tier 7 — This decision entry

- [ ] The body of DECISION-008 in [log.md](log.md) accurately describes the seven tiers as shipped (no drift between the entry and the merged commits).
- [ ] The "Alternatives considered" section captures the three proposals the architect explicitly rejected (orphaned-env-key rewrite, L8/L9/L10/L12 hallucination guards in worker-extract, deletion of `apps/api/.gitkeep`).
- [ ] The "Reversibility" claim — each tier is independent and trivially revertible; the WebAuthn migration's reverse is `DROP TABLE` + `ALTER DROP COLUMN` — is correct.
- [ ] The audit-event-id `pending` exemption is recorded in [`scripts/check-decisions.ts`](../../scripts/check-decisions.ts) and the migration-on-first-chain-init plan is the workflow you want for retroactive anchoring.

## §8 Cross-document consistency

- [ ] [`AUDIT.md`](../../AUDIT.md) AUDIT-022 row references this checklist (`docs/decisions/decision-008-readthrough-checklist.md`).
- [ ] [`docs/work-program/PHASE-1-COMPLETION.md`](../work-program/PHASE-1-COMPLETION.md) — does any open work item assume DECISION-008 has already been promoted? If so, those items either move to a follow-up branch or wait for this checklist to land.
- [ ] No new code committed since DECISION-008 was filed contradicts the doctrine in the seven tiers.

## §9 Promotion mechanic

When every box above is signed:

1. **Edit [`docs/decisions/log.md`](log.md)** — change the `Status` field at line 1592 from `PROVISIONAL` to `FINAL`. Add a `Promoted to FINAL: 2026-MM-DD` line. Remove the `> **STATUS: PROVISIONAL — body is forward-looking …** (AUDIT-071)` blockquote banner that immediately follows the table.
2. **Edit [`AUDIT.md`](../../AUDIT.md)** — flip AUDIT-022's status from `blocked-on-architect-decision` to `fixed (commit <sha-of-this-promotion>)`.
3. **Commit** — message `docs(repo): DECISION-008 promote PROVISIONAL → FINAL (architect read-through complete)`. Body cites the date, this checklist's path, and a one-line summary of any caveats raised during the read-through (e.g., a tier-3 fail-open default the architect wants to revisit later).
4. **Optional:** if any §1-§8 box surfaces a defect that needs a code change before promotion, halt promotion, file a new AUDIT-NNN against the specific tier, fix in a follow-up branch, then return to this checklist.

The build agent does NOT promote; the architect's signature on this checklist is the trigger.
