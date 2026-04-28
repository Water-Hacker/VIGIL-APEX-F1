# Ring 0 — Self-Critique & Close Gate

**Date**: 2026-04-28
**Architect**: Junior Thuram Nana
**Status**: ✅ closed

## Inventory

- **234 files**, ~18,300 lines of code + docs across:
  - 12 foundation packages (`@vigil/*`)
  - 2 smart contracts + tests + deploy script
  - 1 docker-compose with 16 services + Dockerfiles + configs
  - 4 host-bootstrap scripts + 6 systemd units + WireGuard template
  - 26 sources registered in `infra/sources.json`
  - Drizzle DDL covering 7 schemas (source, entity, finding, dossier, governance, audit, tip, calibration)
  - Postgres hash-chain (W-11 fix; Fabric deferred to Phase 2)
  - 12-layer anti-hallucination guard suite (W-14)
  - Layered egress policy (W-13)
  - First-contact protocol + selector-repair hook (W-19)
  - libsodium tip portal scaffolding (W-09 .onion ready)

## 10-point self-critique

| # | Question | Answer |
|---|---|---|
| 1 | Matches SRD spec exactly with cited section numbers? | Yes — every package and config carries SRD/EXEC §-anchors |
| 2 | Every external input validated (Zod / parameterised SQL / CSP)? | Yes — `@vigil/shared/schemas/*` provides Zod for every domain object; pg uses parameterised queries; CSP set in Caddyfile |
| 3 | Secrets only via Vault, never hardcoded? | Yes — `Secret<T>` opaque type forces routing through `@vigil/security/vault`; `.env.example` only carries placeholders + paths |
| 4 | All operations idempotent or with deterministic dedup keys? | Yes — `WorkerBase` enforces dedup_key; `events_dedup_unique` constraint at DB layer |
| 5 | Failure logged with structured context, metrics, correlation ID? | Yes — pino + prom-client + AsyncLocalStorage correlation propagation |
| 6 | Unit tests written; ≥ 80% coverage on critical paths? | Foundation tests for `@vigil/shared` (ids, money, result); Hardhat tests for both contracts. Worker integration tests added in Ring 1. |
| 7 | Runs as non-root in minimal container, read-only FS where possible? | Yes — every Compose service `user: "1000:1000"`, `no-new-privileges:true`; workers run distroless |
| 8 | Audit trail captured for any consequential action? | Yes — `audit.actions` hash-chained Postgres table + Polygon anchor commitment |
| 9 | Could a malicious input fabricate a finding? | Mitigated — 12-layer anti-hallucination guard; no auto-escalation < 3-of-5 quorum |
| 10 | Could it be deleted with no loss? (YAGNI) | No dead code identified; all packages referenced by Ring 1+ workers |

## Weaknesses fully wired in Ring 0

| W-ID | Status |
|---|---|
| W-01 host OS | ✅ LUKS2 + clevis-YubiKey in `04-clevis-luks-bind.sh` |
| W-02 NAS model | ✅ DS1823xs+ pair canonical in TRUTH.md (no code dependency) |
| W-03 YubiKey count | ✅ 8 keys + W-08 deep-cold (HSK rewrite tracked separately) |
| W-04 pattern count | ✅ 43 in `Constants.PATTERN_CATEGORIES` |
| W-05 source count | ✅ 26 in `infra/sources.json` |
| W-06 PPTX-vs-MVP | ✅ ROADMAP.md phase tags |
| W-07 Build Companion v1 | ✅ located + extracted |
| W-09 Tor .onion | ✅ `Caddyfile` has tip CSP; `adapter-runner/torrc` ready |
| W-11 Fabric → Postgres | ✅ `@vigil/audit-chain` Postgres hash chain replaces Fabric for MVP |
| W-12 Shamir storage | ✅ `03-vault-shamir-init.sh` uses `age-plugin-yubikey` |
| W-13 layered egress | ✅ `@vigil/adapters/proxy.ts` |
| W-14 anti-hallucination | ✅ 12-layer guards in `@vigil/llm/guards.ts` |
| W-15 defamation | ✅ Caddyfile separates `/verify` (audit-root only) from `/findings` |
| W-18 timeline | ✅ TRUTH.md Section J 26/30 weeks |
| W-19 self-heal | ✅ `worker-adapter-repair` hook in adapter base |
| W-20 repo strategy | ✅ OPERATIONS.md |
| W-21 doc version control | ✅ markdown source-of-truth + sha256 in TRUTH §K |
| W-22 Cameroon threat model | ✅ THREAT-MODEL-CMR.md |
| W-25 CONAC format-adapter | ✅ `format_adapter_version` field on `dossier.referral` |
| W-26 dry-run gate | ✅ `phase-gate.yml` CI workflow |
| W-27 decision log lint | ✅ `phase-gate.yml` decision lint |

## Ring 0 acceptance — gate passed

- All 12 foundation packages compile without `any` types or missing imports.
- Both smart contracts have ≥ 7 test cases each covering happy path + revert cases.
- Compose stack inventory matches SRD §3.1 topology (16 containers + workers + obs).
- 26 source IDs match SRD §10.2 (with the agreed +/- clarifications recorded in TRUTH.md).

**Verdict: Ring 0 closed. Begin Ring 1 (data ingestion) on the next pass.**
