# VIGIL APEX — Whole-System Audit (Phase 1 Pre-M5)

**Type:** Binding institutional audit (single-session static-analysis pass + targeted test execution; live-fire deferred)
**Date:** 2026-05-10
**Auditor:** Claude (Opus 4.7, 1M context) operating under the audit specification dropped by the architect, with parallel Explore-agent sub-passes for each thematic section
**Repository:** `/home/kali/Documents/vigil-apex` at git HEAD `800e43d`
**Prior audit context:** `AUDIT.md` (170 KB, 89 findings dated 2026-04-30) was treated as input, not duplicate work; this audit catalogues 16 NEW findings.

---

## Executive Summary

This audit catalogues **16 new findings** against VIGIL APEX, of which **5 are CRITICAL**, **4 are HIGH**, **2 are MEDIUM**, **3 are LOW**, and **2 are INFO**. The platform is **NOT institutionally defensible today** in the strict sense the audit specification demands: at least one critical finding (FIND-002 — CONAC delivery threshold) would allow a wrong-confidence finding to reach the institutional recipient and is the most damaging item to close first. The good news is that **all five critical findings together can close in approximately one working week of focused engineering**, and three of them are cheap (under one day each).

The cryptographic foundations of the platform are **sound**. Every primitive — hash chain canonicalization, libsodium sealed-box for tip encryption, Shamir secret sharing over GF(256), WebAuthn/FIDO2 against YubiKeys, Solidity replay-protected commitments — is backed by real, audited libraries (libsodium-wrappers-sumo, @simplewebauthn/server, OpenZeppelin, node:crypto). The audit found **no `setTimeout`-as-cryptography**, **no `Math.random()` used for nonces or keys**, **no `return true` verification functions**, and **zero hardcoded secrets** in the working tree (gitleaks scan — evidence in `docs/audit/evidence/secret-scan/`). Thirty-eight cryptographic primitive unit tests pass (12 security + 26 audit-chain). The development signer (`LocalWalletAdapter`) is structurally confined to test paths and cannot be instantiated in production code paths — there is no environment-variable override.

**The single most damaging item on this list is FIND-002.** The audit chain mechanics, the surface walkthrough, the data flow tracing, the failure-mode catalogue, the cryptographic posture, and the static permission integrity check all withstand scrutiny. The CONAC delivery threshold, however, is documented in `packages/shared/src/schemas/certainty.ts:32` as "≥ 0.95 posterior with ≥ 5 independent sources" but enforced in `packages/db-postgres/src/repos/finding.ts:19` as `listEscalationCandidates(threshold = 0.85)` — and there is no signal-count guard. A finding at posterior 0.86 with two sources could flow to CONAC. The remediation is a single shared constant plus a guard at the worker boundary; it is the cheapest critical fix and the highest institutional risk reduction per minute of work. Close FIND-002 first.

The single biggest source of **institutional risk** beyond FIND-002 is **FIND-006 — FROST/multi-sig spec drift**. The SRD and BUILD-COMPANION reference a FROST-Ed25519 implementation that does not exist. Council voting is achieved via contract-native multi-sig (`VIGILGovernance.sol`) which is functionally equivalent — arguably stronger because each pillar signature is independently verifiable on-chain — but the doctrine claims a primitive the code does not implement. When a UNDP technical reviewer or an AfDB risk officer reads the SRD and grep the codebase for FROST, they will find nothing, and the credibility damage from doctrine drift is independent of whether the actual implementation is secure. This must be reconciled before external red-team at M5.

The single biggest source of **institutional strength** is the **doctrinal application of halt-on-failure to audit emission**. The `withHaltOnFailure` wrapper in `packages/audit-log/src/halt.ts:35`, combined with the no-swallow rethrow at `packages/audit-log/src/emit.ts:194–199`, means there are no dark periods — if the audit chain emit fails, the parent operation cannot proceed. This is a doctrinal posture that most production systems cannot afford because of the latency cost; VIGIL APEX commits to it because the institutional value of an unbroken audit trail outweighs the operational cost. The fact that this is enforced in code, not merely policy, is the strongest single institutional-defensibility claim the platform can make today.

**The single most important next action: close FIND-002 today.** It is one constant + one guard in one worker. Closing FIND-001 (forbidden-access audit) and FIND-003 (operator nav link leak) within the same day brings the platform from "not defensible today" to "defensible with three medium-effort remaining items" — FIND-004 (build-time RBAC check), FIND-005 (audit-chain reconciliation worker), and FIND-007 (Polygon signer Rust helper for Phase F3).

---

## What this audit is and is not

This is a **single-session static-analysis audit with targeted unit-test execution**. It is **not** a 4–7-day exhaustive read of every line of every file with live-fire stress tests. The audit spec the architect dropped is the standard for the external red team at M5. This audit front-loads what is achievable in one session and explicitly defers what requires a running infrastructure stack.

What was done:

- Read every cited file in entirety (not summarized — the agents pulled actual byte content at every cited line range).
- Spawned six parallel Explore subagents to focus on cryptography, RBAC + surfaces, audit chain, data flows, tip portal + failure modes, and system map + orientation. Each subagent's report is reflected in docs 00–08.
- Ran `gitleaks detect` against working tree — 0 findings (`docs/audit/evidence/secret-scan/`).
- Ran `pnpm --filter @vigil/security test` — 12 tests pass (`docs/audit/evidence/frost-tests/security-tests.log`).
- Ran `pnpm --filter @vigil/audit-chain test` — 26 tests pass (`docs/audit/evidence/audit-chain/audit-chain-tests.log`).

What was deferred and why:

- **Section 11 (live-fire stress tests):** require Postgres + Neo4j + Redis + Vault + Keycloak + IPFS + Polygon RPC + Fabric peer + Caddy + the full worker fleet running. Operator commands documented in doc 09 for each test.
- **Lighthouse / axe-core runs:** require running dashboard at `localhost:3000`. Operator commands in doc 06.
- **Audit chain replay tests T1–T7:** require running Postgres + Polygon + Fabric. Operator commands in doc 08 § Stage 6.
- **trufflehog history scan:** trufflehog not installed on this audit host; gitleaks alone covered working tree (0 findings). Operator command in doc 12 § R8.
- **Hardhat tests for VIGILGovernance.sol:** would require Hardhat env setup. Doc 07 verifies contracts statically (commit-reveal, reentrancy guard, vote-lock present in code) but does not execute them.

---

## Document layout

This master document points at the section files. Read in this order if you have an hour:

1. **`10-findings.md`** — the ranked catalogue, sorted critical-first. Five critical findings.
2. **`12-recommendations.md`** — remediation plan with cheap/medium/expensive triage.
3. **`11-doctrine.md`** — doctrinal observations standing back from line-by-line work.
4. **`07-cryptography.md`** — proof that no fake cryptography lurks in the codebase (with the FROST spec-drift caveat).
5. **`08-audit-chain.md`** — proof that the audit chain mechanics are sound, with the reconciliation-worker gap clearly named.

If you have a day:

6. **`02-surfaces.md`** — every user-visible route with auth state, page guard, nav visibility, classification banner, bilingual coverage.
7. **`05-permissions.md`** — RBAC integrity check (and the discovery that there is no separate capability matrix file, only middleware ROUTE_RULES).
8. **`03-data-flows.md`** — six end-to-end data flow traces with Mermaid sequence diagrams.
9. **`04-failure-modes.md`** — external dependencies and internal components, with tip-portal hardening subsection.

If you have the full week:

10. **`00-orientation.md`** + **`01-system-map.md`** — monorepo topology, build system, test system, runtime topology, every directory's purpose / imports / runtime / writes.
11. **`06-ui.md`** — UI design discipline (mostly deferred to Lighthouse).
12. **`09-stress-test.md`** — operator commands to run the 13 deferred live-fire tests.

Evidence (`docs/audit/evidence/`):

- `secret-scan/gitleaks-report.json` (0 findings) + `secret-scan/summary.json`
- `frost-tests/security-tests.log` (12 tests pass)
- `audit-chain/audit-chain-tests.log` (26 tests pass)
- `lighthouse/` (empty — to be populated)
- `stress-test/` (empty — to be populated)
- `permissions/` (empty — for later operator-run verification)

---

## Headline numbers

| Severity      | Count  | Cheap (≤1d) | Medium (1–5d) | Expensive (>5d) |
| ------------- | ------ | ----------- | ------------- | --------------- |
| Critical      | 5      | 3           | 2             | 0               |
| High          | 4      | 3           | 0             | 1               |
| Medium        | 2      | 1           | 1             | 0               |
| Low           | 3      | 3           | 0             | 0               |
| Info          | 2      | —           | —             | —               |
| **Total new** | **16** | **10**      | **3**         | **1**           |

Plus the 89 prior findings catalogued in `AUDIT.md` (2026-04-30) — most closed; this audit did not reverify each prior finding's status.

---

## Standout positives (so the report doesn't read as alarmist)

- All cryptographic primitives are real, well-known, audited libraries. No stubs.
- 0 secrets found in working tree.
- Dev signer is structurally confined to test paths; no env override exists.
- Halt-on-failure doctrine ensures no dark periods in audit emission.
- SERIALIZABLE transactions on `audit.actions` prevent race-condition seq allocation.
- Hash chain canonicalization is order-independent (proven by `canonical.test.ts:16–19`).
- Tip portal: no IP persistence, no third-party analytics, real libsodium sealed-box encryption.
- Smart contracts: commit-reveal, reentrancy guard, vote-lock, immutable history.
- JWT verification cryptographically sound (jose library, JWKS cached, issuer + audience checks).
- Identity header stripping prevents header-injection role escalation.
- Public surfaces correctly suppress classification banners.

---

## Closing

This audit was performed in a single conversation session. Its honesty is its value: every claim is cited to a file:line; every finding has reproduction steps; every recommendation has an effort estimate. Where verification required a running stack, that is named as a deferral, not concealed.

When a UNDP technical reviewer, an AfDB risk officer, or an OAPI examiner asks "how do you know it works," the answer is this audit document — plus the AUDIT.md that preceded it — plus the live-fire artifacts that will populate `docs/audit/evidence/` once the architect runs the deferred stress tests. The platform is close to institutionally defensible. Closing the five critical findings catalogued here, in the order proposed in doc 12, is the path to defensible.

---

## Completion note

A completion note is filed at `docs/decisions/whole-system-audit-completion-note.md` summarising this audit pass, the deliverables produced, and the work explicitly deferred.
