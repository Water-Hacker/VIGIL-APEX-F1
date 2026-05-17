# VIGIL APEX — Autonomous Completion Plan

> Authored: 2026-05-16 (Boil-the-ocean session, branch
> `hardening/boil-the-ocean`).
>
> Mission, verbatim from the architect:
>
> > Scout this entire system, create a detailed step-by-step plan that
> > guides you and contains every single implementation, fix, patch left
> > to be done. Use this file to autonomously work and fix all these
> > without asking permission. Keep all code local; no commits or pushes
> > to GitHub. Take your time, reason over every detail, possible
> > weaknesses, failures. Start implementing and only stop when 100 %
> > complete, all tests ran, no errors in codebase, and hand off for
> > architect to commit. Run fully autonomously.
>
> The standard isn't good enough — it's holy shit, that's done.

---

## 1. Scope reconciliation

### 1.1 What is already done

Per `docs/work-program/PHASE-1-COMPLETION.md` (last refresh 2026-05-02)

- this session's prior hardening sweeps (tiers T36–T51, PRs #50–#65):

| Area                                          | State                                         |
| --------------------------------------------- | --------------------------------------------- |
| Build, typecheck, lint, tests                 | all green per workspace                       |
| Anti-hallucination corpus                     | 224 rows (target 200, surpassed)              |
| SafeLlmRouter coverage                        | 100 %, permanent CI guard                     |
| Pattern catalogue + coverage gate             | 43 patterns, 1:1 fixtures, CI-enforced        |
| Decision log + weaknesses tracker             | 18/27 🟩, 5 institutional, 1 deferred         |
| Audit chain (Postgres + Polygon + Fabric)     | shipped, cross-witness verifier shipped       |
| Council vote ceremony (5-pillar 3-of-5)       | shipped + E2E tested                          |
| Tip portal Tor flow                           | shipped + E2E tested + privacy invariant test |
| CONAC SFTP delivery                           | shipped + E2E tested                          |
| Federation stream                             | shipped + tier-42 hardening                   |
| Dossier rendering                             | shipped + tier-46 hardening                   |
| Snyk + SBOM + gitleaks + Renovate             | shipped                                       |
| Hardening tiers T1–T51 (this session + prior) | shipped via PRs                               |

### 1.2 What this plan addresses

The hardening sweep has covered ~16 packages and apps. The remaining
**uncovered surface** is what this plan walks. I am NOT redoing prior
green work; I am extending the audit to areas that have not had a
hardening-tier pass yet.

**Targets (12 packages + ~25 apps):**

Packages (untouched by T36–T51):

- `packages/security` — Vault, sodium, Shamir, FIDO. **Highest priority** (root of trust).
- `packages/observability` — LoopBackoff, RetryBudget, StartupGuard, sentinel-quorum.
- `packages/shared` — errors, schemas, constants, ids, time, routing.
- `packages/db-postgres` — repos + Drizzle queries (SQL injection surface).
- `packages/db-neo4j` — Cypher client.
- `packages/patterns` — 43 deterministic detectors + dispatcher.
- `packages/certainty-engine` — Bayesian aggregation.
- `packages/llm` — providers, prompt-renderer, canary, call-record.
- `packages/fabric-bridge` — Fabric gateway client.
- `packages/satellite-client` — satellite imagery client.
- `packages/audit-log` — user-action chain.
- `packages/py-common` — Python helpers.

Apps:

- **High-leverage**: `worker-anchor`, `worker-dossier`, `worker-extractor`, `worker-document`, `worker-conac-sftp`, `worker-score`, `worker-pattern`, `worker-entity`, `worker-reconcil-audit`, `worker-audit-watch`, `worker-fabric-bridge`.
- **Wider surface**: `dashboard` (Next.js API routes — many), `api`, `audit-bridge`, `adapter-runner` (main loop).
- **Federation**: `worker-federation-receiver`, `worker-federation-agent`.
- **Other**: `worker-minfi-api`, `worker-image-forensics`, `worker-satellite`, `worker-outcome-feedback`, `worker-tip-channels`.

Host services (tools/):

- `tools/vigil-polygon-signer` — YubiKey-backed signing socket service.
- `tools/vigil-vault-unseal` — Vault unseal coordinator.

### 1.3 Approach

For each target:

1. Read the source (skim for size; deep-dive for crypto/auth surfaces).
2. List real findings (bugs, missing validation, opaque error paths, race conditions, unbounded loops, secret-handling lapses).
3. Apply targeted fixes preserving existing behaviour for legitimate input.
4. Add focused regression tests (vitest, source-grep where dep-heavy).
5. Confirm typecheck + tests pass.

**No commits, no pushes.** All work lives on branch
`hardening/boil-the-ocean` as uncommitted working-tree changes (or, if
volume requires, as a chain of local commits on that branch — never
pushed). Architect reviews + decides commit cadence.

---

## 2. Tier inventory — autonomous work units

Each tier is a **focused fix** with tests. Tiers run in the order
listed — earlier tiers establish primitives used by later tiers.

### Tier 52 — `packages/security` (root-of-trust crypto)

**Surface**: Vault client, sealed-box, Shamir, FIDO2/WebAuthn, sodium memory hygiene.

**Audit targets**:

- `src/sodium.ts` — wrap/unwrap, NFC normalisation, zero-on-error.
- `src/vault.ts` — token lifecycle, error surfaces, secret caching, retry budget.
- `src/sealed-box.ts` — base64 decode validation, ciphertext-size cap, key shape check.
- `src/shamir.ts` — share-format validation, k-of-n bounds, malformed share handling.
- `src/fido.ts` — WebAuthn challenge replay, counter monotonicity, algorithm pinning.
- `src/age.ts` (if present) — recipient validation, decrypt error surfaces.

**Known good baseline**: tier-16 added libsodium wipe + tier-50 added duplicate-share gate at the worker boundary; this tier covers the LIBRARY itself.

### Tier 53 — `apps/worker-anchor` (Polygon commit producer)

**Surface**: high-sig loop, batched commit loop, gas-price guard, retry semantics, range computation.

**Audit targets**:

- `src/index.ts` — main loop wiring.
- `src/high-sig-loop.ts` — high-significance per-event anchor.
- `src/batch-loop.ts` (or equivalent) — periodic batched anchor.
- Range computation correctness (off-by-one risks symmetric to T47/T48).
- Gas-price ceiling enforcement.
- Retry budget integration.

### Tier 54 — `packages/observability` (substrate)

**Surface**: LoopBackoff, RetryBudget, StartupGuard, sentinel-quorum, withCorrelation, registerShutdown.

**Audit targets**:

- `src/loop-backoff.ts` — bounded growth, jitter, reset semantics.
- `src/retry-budget.ts` — sliding window correctness, Redis Lua atomicity.
- `src/startup-guard.ts` — boot-success contract, fail-closed defaults.
- `src/sentinel-quorum.ts` — quorum decide, edge cases.
- Shutdown handler — leak risk, double-fire guards.

### Tier 55 — `apps/dashboard` API routes (citizen + operator surface)

**Surface**: ~30 Next.js API route handlers across `/api/tip`, `/api/triage`, `/api/findings`, `/api/council`, `/api/verify`, `/api/public/audit`, `/api/health`.

**Audit targets** (prioritised):

- `/api/tip/submit` — citizen tip ingestion (sealed-box, attachment caps, dedup).
- `/api/council/vote*` — WebAuthn assertion, challenge replay, idempotency.
- `/api/triage/tips/decrypt` — share-collection, audit emission.
- `/api/findings/[id]/recipient-body` — operator-only, recipient-body validation.
- `/api/verify/[ref]` — public, defamation surface (entity-name-free per W-15).
- `/api/public/audit` — public, pagination + payload-leak posture.
- `/api/health` — readiness/liveness boundaries.

### Tier 56 — `packages/db-postgres` (Drizzle repos)

**Surface**: ~25 repo files (FindingRepo, TipRepo, AuditEventRepo, GovernanceRepo, DossierRepo, etc.).

**Audit targets**:

- SQL injection (Drizzle parameterises by default, but raw `.execute()` calls are risky).
- Transaction boundaries (atomicity of multi-write operations).
- `LIMIT` / `OFFSET` bounds (no unbounded scans).
- Listing endpoints — server-side max page size.
- `ORDER BY` from user input (column allowlist).

### Tier 57 — `packages/llm` (rest of the LLM stack)

**Surface**: providers (Anthropic, Bedrock), prompt-renderer, canary, call-record, safe.

**Audit targets**:

- `src/providers/anthropic.ts`, `bedrock.ts` — API key handling, error surfaces, response validation.
- `src/safe.ts` — closed-context boundary enforcement, source-tag escaping.
- `src/canary.ts` — daily canary verification, false-positive defence.
- `src/prompt-renderer.ts` — template injection, untrusted-input handling.
- `src/call-record.ts` — audit-emission completeness.

### Tier 58 — `apps/worker-dossier` (PDF render loop)

**Surface**: dossier render + GPG sign + LibreOffice handoff.

**Audit targets**:

- `src/index.ts` — main loop.
- LibreOffice subprocess (already T46-ish, but loop-side hardening).
- GPG sign failure path (T35 covered the lib; this is the worker integration).
- IPFS pin after render.

### Tier 59 — `packages/patterns` (43 deterministic detectors)

**Surface**: registry + dispatcher + 43 pattern modules + 43 fixtures.

**Audit targets**:

- Registry — duplicate ID detection, missing-field surfacing.
- Dispatcher — error isolation per pattern (one pattern's throw shouldn't kill the batch).
- Numerical stability across the 43 detectors (NaN / Infinity / negative).
- Pattern threshold bounds (strength ∈ [0,1] guaranteed).

### Tier 60 — `packages/certainty-engine` (Bayesian aggregation)

**Surface**: scoring, prior update, posterior computation.

**Audit targets**:

- Numerical overflow (T32 odds-clamp precedent: 1e15 ceiling).
- Negative-prior / NaN-prior rejection.
- Pattern-pair independence handling.
- Degenerate-input behaviour.

### Tier 61 — `apps/worker-extractor` (LLM-driven extraction)

**Surface**: SafeLlmRouter integration + citation enforcement + schema validation.

**Audit targets**:

- `src/llm-extractor.ts` — closed-context, citation requirement.
- `src/index.ts` — loop + handler.
- Schema-validation failure path (DLQ or retry?).
- Hallucination layer integration.

### Tier 62 — `apps/worker-document` (IPFS pinning)

**Surface**: document download + IPFS pin + extraction.

**Audit targets**:

- URL validation at the boundary (SSRF defence — should reuse `isPublicHttpUrl` from T37).
- Download size caps.
- IPFS-pin failure semantics.
- Content-type validation.

### Tier 63 — `apps/worker-conac-sftp` (PII delivery)

**Surface**: dossier delivery to CONAC/MINFI/COUR_DES_COMPTES/ANIF/CDC.

**Audit targets**:

- Format-adapter selection.
- SFTP credential handling.
- Delivery-receipt audit emission.
- Failure-mode handling (network outage vs auth failure vs path error).

### Tier 64 — `apps/audit-bridge` + `apps/worker-fabric-bridge` (Postgres → Fabric)

**Surface**: append-only bridge that writes Postgres audit rows to Fabric chaincode.

**Audit targets**:

- Bridge advance correctness (no skip, no double-write).
- Idempotency on retry.
- Range computation (T47 chaincode bug had a symmetric verifier-side at T48 — bridge is a third witness; check for the same class of off-by-one).

### Tier 65 — `apps/worker-reconcil-audit` + `apps/worker-audit-watch`

**Surface**: reconciliation worker that compares Postgres vs Fabric vs Polygon hourly.

**Audit targets**:

- Cross-witness divergence detection (complement T48).
- Alert emission (no silent suppression).
- Retry budget integration.

### Tier 66 — `apps/worker-score` + `apps/worker-pattern` + `apps/worker-entity`

**Surface**: scoring loop, deterministic pattern dispatcher, entity resolution.

**Audit targets**:

- Per-worker handler invariants.
- Idempotency at dedup_key boundary.
- Error isolation (one bad input shouldn't kill the loop).

### Tier 67 — `apps/api` + smaller apps

**Surface**: any remaining worker not covered above.

**Audit targets**: case-by-case review.

### Tier 68 — `tools/` host services (Polygon signer + Vault unseal)

**Surface**: standalone host services that hold cryptographic material.

**Audit targets**:

- Unix socket access control (T38 hardened the systemd unit; this audits the binary logic).
- PIN cache / unlock semantics.
- Signing request validation.
- Error-mode surface (DoS resilience).

### Tier 69 — Cross-cutting sweep

After per-target tiers complete:

- Run `pnpm -w typecheck` across the whole workspace.
- Run `pnpm -w test` across every workspace.
- Run `pnpm -w lint` at `--max-warnings=0`.
- Address any drift introduced by the per-tier fixes.
- Update / write the handoff summary.

---

## 3. Execution rules (autonomous mode)

### 3.1 Discipline

- Real fixes only. No nits, no rename-for-rename-sake.
- Every fix gets a regression test.
- Every fix preserves existing behaviour for legitimate input.
- No commits, no pushes — work stays in the working tree on
  `hardening/boil-the-ocean`. Architect commits when satisfied.

### 3.2 Test posture

- Vitest for TS workspaces — focused per-tier files named
  `tierNN-*.test.ts`.
- Hardhat for Solidity (T51 precedent).
- Source-grep regression tests where live infra is required
  (precedent: `worker-anchor/__tests__/contract-address-guard.test.ts`).
- After EACH tier, run the affected package's tests to confirm no
  regression. After the whole sweep, run the workspace-wide suites.

### 3.3 Error / log conventions

- Structured `err_name` / `err_message` (camelCase) per HARDEN-#7-adj.
- Plaintext-free reasons in handler outcomes.
- Numerical caps named via UPPER_SNAKE constants for visibility in grep.
- Audit-chain emission via `chain.append({...})` with action enum.

### 3.4 Stopping criteria

I stop ONLY when:

- Every tier in §2 has been walked.
- Every fix has tests.
- Workspace-wide typecheck + test sweep is green.
- Handoff summary is written.

### 3.5 Handoff artifacts

At completion, the architect will find:

1. This file (`AUTONOMOUS-COMPLETION-PLAN.md`) — the plan.
2. `docs/work-program/AUTONOMOUS-COMPLETION-HANDOFF.md` — the report
   (what changed, where, why, what tests prove it).
3. Working-tree state on `hardening/boil-the-ocean`:
   - Source modifications across the targeted areas.
   - New test files (`tierNN-*.test.ts`).
   - `git status` + `git diff --stat` summarises the surface.

Architect reviews, decides commit cadence (single squash vs per-tier
cherry-pick), pushes to GitHub.

---

## 4. Per-tier execution log

Each tier appends a one-paragraph log entry below as it completes:
findings, fix summary, test count, current workspace state. This is
the canonical record for the architect's review pass.

<!-- TIER LOG START -->

### T52 — `packages/security` (root-of-trust crypto) — ✅ DONE

Three defences shipped:

1. **`shamir.ts`** — bounded share count (`SHAMIR_MAX_SHARES = 255`, the GF(256) X-coord ceiling) + bounded per-share size (`SHAMIR_MAX_SHARE_BYTES = 64 KiB`, 1000x libsodium SK headroom) + strict base64 validation in `decodeBase64` (regex `[A-Za-z0-9+/]{0,2}` + length-mod-4 + try/catch wrap of atob). Pre-fix a malformed base64 share surfaced as an opaque `InvalidCharacterError` from atob — caught further up as a generic `shamir-combine-failure`, masking the actual defect. Post-fix, the boundary names the exact problem.

2. **`fido.ts`** — `verifyAuthentication` now enforces WebAuthn §6.1.1 clone-detection at the library boundary. Pre-fix every caller had to remember to compare `newCounter > storedCounter` themselves. Post-fix the library throws `FidoVerificationError` on a non-monotone bump (with the spec exemption for both-zero authenticators that never increment). Defence-in-depth on top of the route-level check in the dashboard.

3. **`sodium.ts`** — `sealedBoxDecrypt` wraps `crypto_box_seal_open` in try/finally and `memzero`s the decoded private-key Uint8Array before returning. Narrows the binary-form private-key heap exposure window. Best-effort per the existing `wipe()` doc; reliably zeroes the live buffer.

Tests: 11 new tier-52 cases (8 shamir bounds/validation, 2 sealedBox round-trip + wipe-on-throw, 1 fido source-grep regression for the new clone-detection check). 37 existing security tests still green. **Total 48.** Typecheck clean.

### T53 — `apps/worker-anchor` (Polygon commit producer) — ✅ DONE

Three closures that address the long-standing Tier-11 audit flag at `apps/worker-anchor/src/index.ts:180-201`:

1. **Boot-time chain↔DB cursor reconciliation detector**. Pre-fix, if a previous run's `anchor.commit()` succeeded on-chain but the subsequent `INSERT INTO audit.anchor_commitment` failed (DB outage / connection drop / SERIALIZABLE conflict), the on-chain contract's contiguity guard (`fromSeq != lastToSeq + 1`) silently wedged every subsequent retry — the operator saw nothing but generic POLYGON_COMMIT_FAILED logs forever. Post-fix, worker boot reads `chain.totalCommitments() + chain.getCommitment(last).toSeq` and compares to `MAX(seq_to) WHERE polygon_tx_hash IS NOT NULL`. Divergence emits a structured `logger.fatal` with both values so the on-call alert fires before any steady-state work happens. Auto-backfill deliberately NOT included — recovery requires architect review of which on-chain commitments to import.

2. **`high-sig-loop.processHighSigBatch` bail-out** at `MAX_CONSECUTIVE_BATCH_FAILURES = 5`. Pre-fix, a Polygon RPC outage caused all 50 events in the batch to fail one-by-one (~4 minutes burning network round-trips); the driver loop's LoopBackoff was effectively bypassed because no exception escaped (failures were caught per-event). Post-fix, the batch returns early after 5 consecutive failures.

3. **`processHighSigBatch` returns `HighSigBatchResult { succeeded, failed, attempted, bailedOut }`** instead of a bare success count. The driver loop now routes on the structured shape — `bailedOut` OR `failed > succeeded` counts as a loop-level failure for backoff. Also normalised `runHighSigAnchorLoop`'s catch-block log to the `err_name`/`err_message` convention (was raw `err`).

Type cleanup: `HighSigAnchorDeps.logger` was `any`; now `Logger` from `@vigil/observability`.

Tests: 3 new tier-53 cases (5-failure bail, interspersed-failure no-bail, empty-queue no-op) + 3 existing high-sig tests updated to the structured-result shape. 14 other worker-anchor tests still green. **Total 20.**

### T54 — `packages/observability` (substrate) — ✅ DONE

Three defences in the loop primitives every worker uses:

1. **LoopBackoff jitter** — optional `jitterRatio` (default 0, behaviour-preserving) multiplies the failure-path delay by a `crypto.randomInt`-derived factor in `[1 - r, 1 + r]`. Smooths the thundering-herd burst when ~12 worker fleets all wake at the same exponential delay after a shared-dependency recovers. HARDEN-#7 compliant (no `Math.random`). Validated: rejects ratios outside `[0, 1)`; clamps jittered delay to `[0, capMs]`; success path is unaffected (no random call).

2. **RetryBudget windowSeconds validation** — constructor now rejects `<= 0`, non-integer, NaN, Infinity. Pre-fix, a misconfigured `windowSeconds: 0` produced `Math.floor(now / 0) = Infinity`, which formed a constant Redis key (`vigil:retry-budget:<name>:Infinity`) — ALL retries across ALL windows landed on that one key, ceiling exhausted globally, budget appeared permanently dead. Now loud at boot.

3. **sentinel-quorum structured emit result** — `emitOutageAuditRow` returns `EmitOutageResult { ok, status?, error? }` instead of `void`. `runSentinelQuorum` propagates via new `emitOk` / `emitError` fields on its result. Pre-fix, the orchestrator reported `emitted: true` regardless of whether the audit-bridge actually accepted the row — silently undermining the "watcher is watched" doctrine (an outage detected but not audited is operationally indistinguishable from no outage). Legacy void-returning emit injection still works (defaults `emitOk = true` to preserve old contract).

Tests: 15 new tier-54 cases (6 LoopBackoff jitter, 5 RetryBudget validation, 4 sentinel-quorum emit-result). 149 existing observability tests still green. **Total 164.** Typecheck clean.

### T55 — `apps/dashboard` API routes — ✅ DONE

Two defences across 5 routes:

1. **Explicit proxy-header trust gate** — new `lib/trusted-client-ip.ts` helper centralises the `cf-connecting-ip` / `x-forwarded-for` read. Honours `TRUST_PROXY_HEADERS` env var (`true`/`false`), defaults to trusted-when-`NODE_ENV=production`. Pre-fix, 5 routes (`audit/public`, `audit/aggregate`, `tip/submit`, `tip/attachment`, plus `audit-emit.server`) unconditionally trusted the headers — a misconfigured prod (no Caddy / Caddy not stripping) OR a dev `next dev` exposed per-IP rate limits to spoofing. Post-fix, dev returns `null` → single anonymous bucket (single-tenant safe); misconfigured prod is loud at the rate-limit-distribution Grafana panel.

   Applied to: `/api/audit/public`, `/api/audit/aggregate`, `/api/tip/submit` (Turnstile remoteip), `/api/tip/attachment` (per-IP rate limit).

2. **`/api/tip/attachment` map leak fix** — `RECENT_BY_IP` map kept every IP key forever even after its timestamps expired (the filtered-empty array was set back at lines 53/57). For a public tip portal accumulating unique IPs, this is a slow but real memory leak. Cap at 100k entries; when full, evict oldest (FIFO via Map iterator order). Crypto-quality randomness not needed for eviction (oldest is deterministic).

Test impact: existing `public-audit-route.test.ts` rotated `x-forwarded-for` headers to dodge the per-IP limit — added `process.env.TRUST_PROXY_HEADERS = 'true'` at file top so the test intent (simulate a trusted-proxy environment) matches the new helper's gating. 7 new tier-55 cases pin the helper contract.

**Total 185** dashboard tests pass (was 178). Typecheck clean.

### T56 — `packages/db-postgres` (Drizzle repos) — ✅ DONE

Defence-in-depth on repo listing `limit`. Pre-fix, 20 `.limit(limit)` call sites across 11 repos passed the caller-supplied value straight to Drizzle. Dashboard API routes clamp at the boundary, but internal worker callers, scripts, and the dr-rehearsal harness bypass that clamping. A buggy worker passing `limit = 10_000_000` would OOM-kill itself and stall the Postgres connection.

Shipped:

- New `src/limit-cap.ts` exports `clampRepoLimit(value, default = 100)` + `MAX_REPO_LIMIT = 10_000`. Tolerant of NaN / Infinity / negative / fractional / undefined inputs.
- Applied at every `.limit(limit)` call site across audit, audit-log (×5), calibration, certainty (×2), dossier, dossier-outcome (×2), finding (×3 incl. new `getSignals` cap), governance, pattern-discovery, source, tip. 20 call sites total.
- `finding.getSignals` newly takes an optional `limit` (defaults via clamp to 1000); pre-fix it was unbounded — a long-running finding with thousands of signals would load the whole history.
- Repo-tighter caps that beat MAX_REPO_LIMIT (e.g., audit-log.listPublic's hard 500) are preserved; clampRepoLimit is the OUTER ceiling.

Tests: 7 new tier-56 cases pin the clamp contract. 59 existing db-postgres tests still green. **Total 66 active** (+13 skipped that require live Postgres). Typecheck clean.

### T57 — `packages/llm` rest of stack — ✅ DONE

**Real bug**: `SafeLlmRouter` recorded `cost_usd: 0` on every safe-routed call. The CostTracker's daily-ceiling enforcement was unaffected (separate counter at router.ts), but the per-call audit row was wrong — the AI-Safety dashboard's cost panel silently under-reported every closed-context call by exactly its actual cost. Cost-budget reviews based on the dashboard were misleading.

Fix: pull `costUsd` from the inner `LlmCallResult` and thread it into the sink. Also normalised the `sink-write-failed` log to `err_name`/`err_message` per HARDEN convention.

Tests: 2 new tier-57 cases (one verifies the real cost flows through, one verifies graceful 0 fallback when the inner result omits costUsd — protects against type-shape drift). 94 existing llm tests still green. **Total 96.** Typecheck clean.

### T58 — `apps/worker-dossier` — ✅ DONE

Three render-loop closures: (a) try/finally tmp-dir cleanup so failed renders don't leak /tmp PDFs; (b) 50 MiB PDF size cap to prevent OOM from pathological LibreOffice output; (c) stderr capture from soffice (4 KB cap) for actionable error messages. No test infra (heavy-I/O worker, AUDIT-069 zero-test allowlist); typecheck clean.

### T59 — `packages/patterns` (Bayesian) — ✅ DONE

**Real bug**: `correlationDamping > 1` produced `1 - damping < 0`; the `lr ** (1 - damping)` step INVERTED each redundant-pair's contribution — strong positive evidence became strong negative. Damping < 0 amplified instead of dampened. NaN/Infinity bypassed the `??` default. Fix: clamp to `[0, 1]` with `Number.isFinite` fallback to 0.5; also filter malformed pair tuples. **Total 722** (was 716); 6 new tier-59 cases.

### T60 — `packages/certainty-engine` (Bayesian) — ✅ DONE

NaN-propagation defence: `computePosterior` now validates `Number.isFinite` on `likelihood_ratio` + `effective_weight` per-component with NAMED `evidence_id` in the error message. Pre-fix NaN passed `< 0 / > 1` bounds (NaN comparisons false) and poisoned the odds product; eventual throw had a generic message. `effectiveWeights` uses an inline `clampUnit` mapping non-finite to 0. **Total 49** (was 41); 8 new tier-60 cases.

<!-- TIER LOG END -->
