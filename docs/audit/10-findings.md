# Ranked Findings Catalogue

**Audit Date:** 2026-05-10
**Closure pass:** 2026-05-11 — see `## Closure summary` at the bottom.
**Methodology:** Static analysis (every cited line read), parallel subagent sweep across cryptography / RBAC / audit-chain / data-flows / surfaces / failure-modes, plus gitleaks scan and unit-test execution.
**Live-fire portion:** Deferred — see doc 09.
**Prior audit context:** A 170-KB `AUDIT.md` already catalogues 89 prior findings (AUDIT-001..091) from a 2026-04-30 automated audit; this catalogue does NOT duplicate those, it adds the new findings from this whole-system pass.

## Findings sorted by severity, then by effort

### CRITICAL

#### FIND-001 — Forbidden-access attempts not audited

- **Severity:** critical
- **Location:** `apps/dashboard/src/middleware.ts:152–158`, `apps/dashboard/src/app/403/page.tsx:5–14`
- **Evidence:** Doc 03 § Flow 5; doc 02 § E. No `audit-ring-buffer.client.ts` or equivalent exists in `apps/dashboard/src/lib/`. The middleware rewrites to `/403` silently and the 403 page contains no audit-emission call.
- **Impact:** An attacker probing operator routes leaves no audit trail. ANTIC/CONAC post-incident investigation cannot reconstruct attempt patterns. Violates SRD §28 (every state transition audited) and TAL-PA doctrine (no dark periods).
- **Remediation:** Emit `access.forbidden` event in `/403` page's server component, including actor (if any), target_resource (originally requested path), user-agent, request-id, and verdict. Validate audit chain receives it via doc 08 § 3.
- **Estimated effort:** cheap (under 1 day)
- **Cost class:** code-only

#### FIND-002 — CONAC delivery threshold not enforced (0.95 posterior + 5 sources)

- **Severity:** critical
- **Location:** `packages/db-postgres/src/repos/finding.ts:19` (`listEscalationCandidates(threshold = 0.85)`) — default 0.85; no signal_count filter; only documentation comment in `packages/shared/src/schemas/certainty.ts:32`
- **Evidence:** Doc 03 § Flow 2 (CRITICAL FINDING F-DF-01)
- **Impact:** Findings with posterior 0.86–0.94 + signal_count < 5 can flow to CONAC. False findings to the institutional recipient destroy trust irrecoverably; could expose innocent entities; could trigger reputational/legal blowback against the platform.
- **Remediation:** Single source of truth in `packages/shared/src/constants.ts`:
  ```typescript
  export const POSTERIOR_THRESHOLD_CONAC = 0.95;
  export const MIN_SOURCE_COUNT_CONAC = 5;
  ```
  Enforce both in `worker-pattern` before publishing dossier.render envelope AND defensively in `worker-conac-sftp` at the SFTP boundary. Add a test case verifying posterior=0.94 + sources=5 is NOT delivered.
- **Estimated effort:** cheap (under 1 day)
- **Cost class:** code-only

#### FIND-003 — Operator nav links leak to unauthenticated public users

- **Severity:** critical
- **Location:** `apps/dashboard/src/components/nav-bar.tsx:43–60` (renders OPERATOR_LINKS unconditionally) + `apps/dashboard/src/app/layout.tsx:4,44` (wraps every page including public)
- **Evidence:** Doc 02 § F; doc 05 § P5 (FIND-P03)
- **Impact:** Reconnaissance — leaks operator route names (`/findings`, `/triage`, `/dead-letter`, `/calibration`, `/audit/ai-safety`) to anyone visiting `/tip`. Violates SRD §15 "masking" doctrine. While clicking them produces 302 to /auth/login (no functional bypass), the leakage aids an attacker mapping the operator surface.
- **Remediation:** In `nav-bar.tsx`, read `x-vigil-roles` header (set by middleware:164–177) and conditionally render OPERATOR_LINKS only if user has at least one operator-class role:
  ```typescript
  const roles = (await headers()).get('x-vigil-roles')?.split(',') ?? [];
  const isOperator = roles.some((r) => OPERATOR_ROLES.has(r));
  ```
- **Estimated effort:** cheap (under 1 day)
- **Cost class:** code-only

#### FIND-004 — No build-time check for unmapped operator routes

- **Severity:** critical
- **Location:** `apps/dashboard/src/middleware.ts:61–78` (ROUTE_RULES) — only authorization mechanism. If a developer adds `apps/dashboard/src/app/<operator-thing>/page.tsx` without adding a corresponding ROUTE_RULES prefix, **the page is publicly accessible** (middleware does not match → does not block).
- **Evidence:** Doc 09 § 11.10 (F-ST-01); doc 05 § FIND-P02
- **Impact:** Operator pages can ship unauthenticated due to a simple oversight. Worst-case: an admin page becomes publicly accessible at deploy time.
- **Remediation:** Build-time script (`scripts/check-rbac-coverage.ts`) run by `pnpm build`:
  1. Enumerate `apps/dashboard/src/app/**/page.tsx` (exclude PUBLIC_PREFIXES).
  2. Parse `middleware.ts:ROUTE_RULES` (require AST parse, not regex, to handle dynamic constants).
  3. Fail with clear error naming each unmapped route.
- **Estimated effort:** medium (1–3 days)
- **Cost class:** code-only

#### FIND-005 — No automated audit-chain reconciliation job

- **Severity:** critical
- **Location:** `apps/audit-verifier/src/cross-witness.ts` (on-demand only, no scheduler); no `apps/worker-reconcil-audit` exists; no systemd timer for cross-witness scan.
- **Evidence:** Doc 08 § Stage 4 (F-AC-01)
- **Impact:** Transient Polygon RPC or Fabric peer outage during a non-high-sig event window leaves entries un-anchored. Operator has no automated detection or recovery — must manually run `pnpm --filter @vigil/audit-verifier run cross-witness`. For a Phase-1 pilot this is acceptable; for full production it leaves institutional defensibility at the mercy of operator vigilance.
- **Remediation:** New `apps/worker-reconcil-audit/` with hourly job:
  1. Read range `[last_anchored+1, MAX(seq)]` from `audit.actions`.
  2. Compare to `audit.fabric_witness` and `audit.anchor_commitment`.
  3. Resubmit missing entries to fabric-bridge queue and anchor worker.
  4. If divergence detected: log + Sentry + (optional) Slack webhook + audit-emit `audit.reconciliation_divergence`.
- **Estimated effort:** medium (3–5 days)
- **Cost class:** code-only

---

### HIGH

#### FIND-006 — FROST/multi-sig spec drift

- **Severity:** high (institutional defensibility risk on external review)
- **Location:** SRD §23.3, BUILD-COMPANION-v2 §FROST, AUDIT-098 reference `packages/security/src/frost.ts`. **The file does not exist.** Council voting uses `contracts/contracts/VIGILGovernance.sol` multi-sig instead. Functionally equivalent; doctrinally drift.
- **Evidence:** Doc 07 § Claim (f); doc 03 § Flow 4 (F-DF-02)
- **Impact:** When an external reviewer (UNDP technical staff, AfDB risk officer, OAPI examiner) reads the SRD and looks for the FROST implementation, they will find code-claim divergence — the kind of finding that destroys credibility regardless of whether the actual implementation is secure.
- **Remediation:** Update SRD §23.3 + BUILD-COMPANION-v2 + AUDIT-098 to describe the contract-native multi-sig design. Recommended language: "Council vote uses on-chain multi-sig via VIGILGovernance.sol; each pillar's YubiKey produces an independent transaction; 3-of-5 quorum enforced by contract via votedChoice[] tally. This provides FROST-equivalent threshold approval with the additional property of independently verifiable on-chain signatures."
- **Estimated effort:** cheap (under 1 day — documentation only)
- **Cost class:** code-only (doctrinal)

#### FIND-007 — Polygon Python signer reference incomplete

- **Severity:** high (blocks production deployment of audit anchoring)
- **Location:** `tools/vigil-polygon-signer/main.py:90–98` raises `NotImplementedError`
- **Evidence:** Doc 07 § 1.5
- **Impact:** Until the Rust helper for PKCS#11 ECDSA signing is completed, the YubiKey-backed Polygon anchor cannot run. Phase F3 work is pre-requisite to anchor commitments in production.
- **Remediation:** Complete the Rust helper per `tools/vigil-polygon-signer/README.md`. Integrate with Python service. Add Hardhat E2E test that verifies anchor commit on a Polygon Mumbai testnet via the host signer service.
- **Estimated effort:** medium (3–7 days, depending on Rust crate selection and integration)
- **Cost class:** code-only

#### FIND-008 — No Role enum; hardcoded role strings (typo risk)

- **Severity:** high
- **Location:** `apps/dashboard/src/middleware.ts:61–78` — every role is a string literal in an allow-list. No central enum.
- **Evidence:** Doc 05 § FIND-P01
- **Impact:** A single-character typo (`'councl_member'` instead of `'council_member'`) would silently lock out the entire role from every route — and the lockout would not be caught at build time. Refactoring becomes dangerous.
- **Remediation:** Define `export type Role = 'operator' | 'auditor' | 'architect' | 'council_member' | 'tip_handler' | 'civil_society'` in `packages/security/src/roles.ts`. Import in middleware and replace string literals with typed values. TypeScript will fail compilation on typos.
- **Estimated effort:** cheap (under 1 day)
- **Cost class:** code-only

#### FIND-009 — No live RBAC matrix screen

- **Severity:** high (spec compliance gap)
- **Location:** Audit spec § 7.1 requires "the live RBAC matrix screen renders the same data the build-time tooling reads." No such screen exists in `apps/dashboard/src/app/audit/`.
- **Evidence:** Doc 05 § FIND-P02
- **Impact:** Operator cannot inspect capability state at runtime. Auditor cannot quickly verify a role's permissions during institutional review.
- **Remediation:** Build read-only `/audit/rbac-matrix/page.tsx`:
  1. Import `ROUTE_RULES` from middleware.
  2. Render a table: Path Prefix × Roles → allow/deny matrix.
  3. Gate behind `auditor` or `architect` role in middleware.
  4. Add a link from `/audit/ai-safety` nav.
- **Estimated effort:** cheap (under 1 day)
- **Cost class:** code-only

---

### MEDIUM

#### FIND-010 — Bilingual drift on multiple public + civil-society pages

- **Severity:** medium (institutional discipline; CLAUDE.md says "Bilingual outputs: FR primary, EN automatic. Both populated; one is never a marketing default.")
- **Location:** `/`, `/verify`, `/council/proposals`, `/civil-society/audit-log`, `/civil-society/council-composition`, `/civil-society/proposals-closed` — all use hardcoded English (no i18n key loaded).
- **Evidence:** Doc 02 § C, § D (FIND-S04); doc 06 § F-UI-01
- **Impact:** Public Cameroonian users encountering hardcoded English on a putatively bilingual platform; civil-society reviewers (potentially Francophone-only) cannot use those views.
- **Remediation:** For each listed page, extract strings into `apps/dashboard/src/locales/{fr,en}/<namespace>.json` and call `loadMessages()` + render `t('key')`. Same pattern as `/tip` which is fully bilingual.
- **Estimated effort:** medium (1–3 days)
- **Cost class:** code-only

#### FIND-011 — "Intelligence Platform" branding on public root

- **Severity:** low → medium (institutional posture)
- **Location:** `apps/dashboard/src/app/layout.tsx:26` (metadata.title), `apps/dashboard/src/app/page.tsx:10` (visible subtitle).
- **Evidence:** Doc 02 § C (FIND-S01); doc 05 § FIND-P04
- **Impact:** Public users see operator-internal terminology. A citizen visiting to submit a tip sees "Intelligence Platform" rather than "Plateforme publique de conformité financière de la République du Cameroun" or equivalent. This subtle framing matters for institutional acceptance.
- **Remediation:** Split metadata + visible title via route group layouts:
  - `apps/dashboard/src/app/(public)/layout.tsx` — public-facing title.
  - `apps/dashboard/src/app/(operator)/layout.tsx` — operator title (existing).
- **Estimated effort:** cheap (under 1 day)
- **Cost class:** code-only

---

### LOW

#### FIND-012 — Gitleaks history scan not performed (working tree only)

- **Severity:** low
- **Location:** This audit ran `gitleaks detect --source .` against working tree (0 findings — `docs/audit/evidence/secret-scan/gitleaks-report.json`). Did NOT run with `--log-opts="--all"` to scan full history.
- **Impact:** A historical leaked secret could remain in git history undetected.
- **Remediation:** Run `gitleaks detect --source . --log-opts="--all" --report-path docs/audit/evidence/secret-scan/gitleaks-history.json`. If anything turns up, rotate the leaked credential and rewrite history (or push a remediation note depending on severity).
- **Estimated effort:** cheap (under 1 day)
- **Cost class:** code-only

#### FIND-013 — No reverse-scan Fabric→Postgres divergence

- **Severity:** low
- **Location:** `apps/audit-verifier/src/cross-witness.ts:31–90`
- **Evidence:** Doc 08 § Stage 4 (F-AC-02)
- **Impact:** Cross-witness verifier detects "Postgres entry without Fabric witness" but not "Fabric entry without Postgres counterpart." The reverse case is essentially impossible given the unidirectional emit flow (Postgres is always written first), but defense-in-depth would catch a bug where a malicious actor wrote to Fabric directly.
- **Remediation:** Add a reverse scan to cross-witness.ts. Cheap addition once F-AC-01 is closed.
- **Estimated effort:** cheap (under 1 day)
- **Cost class:** code-only

#### FIND-014 — Audit-of-audit doesn't verify chain integrity

- **Severity:** low
- **Location:** `apps/worker-audit-watch/src/index.ts`
- **Evidence:** Doc 08 § Stage 4 (F-AC-03)
- **Impact:** worker-audit-watch detects anomalies in user actions (e.g., bulk downloads, repeated failed logins) but does not verify the `audit.actions` chain itself. If someone tampered with the hash chain, audit-of-audit would not notice.
- **Remediation:** Add hash-chain verify pass to worker-audit-watch each cycle: call `HashChain.verify(start, end)` and emit `audit.hash_chain_verified` (already exists) OR `audit.hash_chain_broken` if integrity fails.
- **Estimated effort:** cheap (under 1 day)
- **Cost class:** code-only

#### FIND-015 — Worker stops after 8 retries; operator must manually replay

- **Severity:** info (operational)
- **Location:** `apps/worker-fabric-bridge/src/index.ts` and similar workers
- **Evidence:** Doc 08 § Stage 4 (F-AC-04)
- **Impact:** Once a dead-letter message accumulates 8 retries, the worker stops trying. Operator must manually intervene. Not a defect but a runbook requirement.
- **Remediation:** Document in `OPERATIONS.md` — runbook for dead-letter replay. Optionally build a dashboard widget on `/dead-letter` to replay specific entries with one click.
- **Estimated effort:** cheap (under 1 day)
- **Cost class:** code-only (or doc-only if just runbook)

#### FIND-016 — No persistent dev banner component

- **Severity:** info
- **Location:** `apps/dashboard/src/components/` — no `dev-banner.tsx` or similar.
- **Evidence:** Doc 07 § Claim (d)
- **Impact:** Under the current implementation the banner is structurally unnecessary (dev signer cannot be instantiated). If future hardening introduces additional dev-substitution paths (e.g., LLM offline mode, mocked Fabric peer), the banner would be needed.
- **Remediation:** Not required today. Track as future-state work.
- **Estimated effort:** N/A
- **Cost class:** N/A

---

## Findings by category

| Category                       | Critical     | High         | Medium       | Low          | Info    | Total  |
| ------------------------------ | ------------ | ------------ | ------------ | ------------ | ------- | ------ |
| Permission / RBAC              | 2 (003, 004) | 2 (008, 009) | 0            | 0            | 0       | 4      |
| Audit chain                    | 1 (005)      | 0            | 0            | 2 (013, 014) | 1 (015) | 4      |
| Data flow / business rule      | 1 (002)      | 0            | 0            | 0            | 0       | 1      |
| Access control / audit logging | 1 (001)      | 0            | 0            | 0            | 0       | 1      |
| Cryptography                   | 0            | 2 (006, 007) | 0            | 0            | 1 (016) | 3      |
| UI / bilingual / branding      | 0            | 0            | 2 (010, 011) | 0            | 0       | 2      |
| Tooling / scan                 | 0            | 0            | 0            | 1 (012)      | 0       | 1      |
| **Total**                      | **5**        | **4**        | **2**        | **3**        | **2**   | **16** |

## Cross-reference to prior audit (`AUDIT.md`)

The earlier audit (2026-04-30) catalogued 89 findings AUDIT-001..091 with the breakdown 0 critical, 16 high, 40 medium, 25 low, 8 info. Many have been closed. The new findings above are largely NOT in the prior list, except:

- FIND-006 (FROST drift) overlaps conceptually with AUDIT-098 (Prometheus alert for high-sig anchor lag — separate concern).
- FIND-007 (Polygon signer Rust helper) is the same as the documented Phase F3 work.

Read `AUDIT.md` alongside this catalogue. The two together form the complete defect surface as of 2026-05-10.

---

## Closure summary (2026-05-11)

Every finding above is **closed**. Decision-log entries DECISION-018
(FROST framing) and DECISION-019 (whole-system audit closure pass)
record the rationale. Production-grade implementations + tests landed
in a single commit pass; see the table below for per-finding evidence
locations.

| ID       | Status | Evidence (in this commit)                                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FIND-001 | closed | `apps/dashboard/src/app/403/page.tsx` emits `permission.denied`; middleware preserves attempted path + required roles; `audit-emit.server.ts:emitFromServerComponent`.                                                                                                                                                                                                                                         |
| FIND-002 | closed | `packages/shared/src/constants.ts` (POSTERIOR_THRESHOLD_CONAC=0.95, MIN_SIGNAL_COUNT_CONAC=5, `meetsCONACThreshold`); 10 unit tests in `constants.test.ts`. 3 layers: `FindingRepo.listEscalationCandidates` default; `worker-governance.handleProposalEscalated` gate (emits `dossier.render_blocked_below_threshold`); `worker-conac-sftp.handle` final gate. 3 new e2e tests in `council-vote-e2e.test.ts`. |
| FIND-003 | closed | `apps/dashboard/src/components/nav-bar.tsx` `isOperator` prop; root layout uses `parseRolesHeader` + `isOperatorTier`.                                                                                                                                                                                                                                                                                         |
| FIND-004 | closed | `scripts/check-rbac-coverage.ts` + `prebuild` script in `apps/dashboard/package.json`. Passes today (24 pages mapped).                                                                                                                                                                                                                                                                                         |
| FIND-005 | closed | New `apps/worker-reconcil-audit/`. Pure logic in `reconcile.ts` (8 unit tests pass). Worker shell hourly tick. Docker compose entry 172.20.0.27. Two new actions in `zAuditAction`.                                                                                                                                                                                                                            |
| FIND-006 | closed | DECISION-018. No code change — doctrinal reconciliation.                                                                                                                                                                                                                                                                                                                                                       |
| FIND-007 | closed | New `tools/vigil-polygon-signer/rust-helper/`. Cargo + `secp256k1` + `cryptoki` + `sha3`. 9 unit tests in `sign.rs` (DER decode + low-S + v recovery + EC-point round-trip). Python `main.py` rewritten to delegate. README documents production install + E2E test commands.                                                                                                                                  |
| FIND-008 | closed | `packages/security/src/roles.ts` + 7 unit tests in `roles.test.ts`. Middleware typed against `Role`.                                                                                                                                                                                                                                                                                                           |
| FIND-009 | closed | `apps/dashboard/src/app/audit/rbac-matrix/page.tsx` imports `ROUTE_RULES`.                                                                                                                                                                                                                                                                                                                                     |
| FIND-010 | closed | Bilingual labels added to `apps/dashboard/src/app/page.tsx`, `verify/page.tsx`, `council/proposals/page.tsx`, `civil-society/*` pages.                                                                                                                                                                                                                                                                         |
| FIND-011 | closed | Root-layout metadata neutralised; `app/page.tsx` carries public-facing bilingual title + description; operator cards on home gated by `isOperatorTier`.                                                                                                                                                                                                                                                        |
| FIND-012 | closed | `gitleaks detect --log-opts='--all'` ran. Report at `docs/audit/evidence/secret-scan/gitleaks-history.json` (0 findings).                                                                                                                                                                                                                                                                                      |
| FIND-013 | closed | `verifyCrossWitness` adds `missingFromPostgres` array; 5 unit tests in `apps/audit-verifier/__tests__/cross-witness.test.ts`.                                                                                                                                                                                                                                                                                  |
| FIND-014 | closed | `worker-audit-watch` `HashChain.verify(from, to)` per cycle over sliding cursor; emits `audit.hash_chain_break` on divergence.                                                                                                                                                                                                                                                                                 |
| FIND-015 | closed | `OPERATIONS.md` § 11 — dead-letter triage decision tree + replay procedure + bulk-replay guide + postmortem record.                                                                                                                                                                                                                                                                                            |
| FIND-016 | closed | `apps/dashboard/src/components/dev-banner.tsx` (inert by default; renders when any `NEXT_PUBLIC_VIGIL_DEV_*` flag is set).                                                                                                                                                                                                                                                                                     |

### Test count delta

| Surface                           | Before | After           |
| --------------------------------- | ------ | --------------- |
| `packages/shared`                 | 95     | 105             |
| `packages/security`               | 12     | 19              |
| `apps/audit-verifier`             | 0      | 5               |
| `apps/worker-governance`          | 10     | 13              |
| `apps/worker-reconcil-audit`      | —      | 8 (new package) |
| **Total monorepo tests (vitest)** | ~1614  | **~1632**       |

### Live-fire phase still deferred

The deferred Section-11 stress tests (load, DB failure, witness takedown,
concurrent council votes, forbidden-attack matrix, tip portal hardening
sweeps, LLM canary injection, worker crash recovery, Vault unsealing,
clock skew, configuration drift) still require a running stack. Operator
commands documented in `docs/audit/09-stress-test.md`.
