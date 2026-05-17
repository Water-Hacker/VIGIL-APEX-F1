# VIGIL APEX — Reviewer's entry guide

> Welcome. You're here because VIGIL APEX has been proposed for UNDP
> partnership and the source code is now in your hands for two weeks
> of review. This document is the entry point — it tells you what to
> read first, what to run, what to skim, and what to skip.

**Author:** Junior Thuram Nana (solo architect; bus factor disclosed in
[docs/UNDP-REVIEW-RISKS.md](docs/UNDP-REVIEW-RISKS.md) R-01).
**Project status:** Phase 1 (code-complete; institutional gates pending).
**Code state at this commit:** 60/60 packages pass typecheck + lint +
test; 90/90 hardening modes closed at the code layer.

---

## Read these first, in this order

### If you have 4 hours

These six files give you 80% of the picture:

1. **[docs/UNDP-REVIEW-RISKS.md](docs/UNDP-REVIEW-RISKS.md)** — 12 risks the
   architect already knows about, with current mitigations and the
   partnership asks that close each one. Read this _before_ the
   architecture so you frame the rest of the review correctly.
2. **[TRUTH.md](TRUTH.md)** — the canonical state-of-the-project sheet.
   Numbers, counts, hostnames, current phase pointer. Supersedes any
   drift in older docs.
3. **[docs/source/SRD-v3.md](docs/source/SRD-v3.md)** — the binding system
   requirements document. Skim §1 (mission), §3 (constraints), §5
   (threat model), §10 (sources), §19 (Bayesian engine), §20 (anti-
   hallucination doctrine), §28 (tip portal). The rest can be
   sectionally referenced as you need.
4. **[THREAT-MODEL-CMR.md](THREAT-MODEL-CMR.md)** — Cameroon-specific
   TTPs the system is designed to resist. Distinguishes VIGIL APEX
   from generic anti-corruption tooling.
5. **[docs/source/AI-SAFETY-DOCTRINE-v1.md](docs/source/AI-SAFETY-DOCTRINE-v1.md)** —
   the 12-layer anti-hallucination doctrine. LLM-in-the-loop is the
   most institutionally-sensitive part of the system.
6. **[docs/source/TAL-PA-DOCTRINE-v1.md](docs/source/TAL-PA-DOCTRINE-v1.md)** —
   the _"the watcher is watched"_ doctrine: every operator action,
   council vote, and system event is itself audit-chained.

### If you have a full day (add these)

7. **[docs/audit/08-audit-chain.md](docs/audit/08-audit-chain.md)** — the
   three-witness audit chain architecture (Postgres + Hyperledger
   Fabric + Polygon). This is the integrity property the rest of
   the system rests on.
8. **[docs/work-program/PHASE-1-COMPLETION.md](docs/work-program/PHASE-1-COMPLETION.md)** —
   the single status board across every track (A code, B docs, C
   operational, D test quality, E security, F architect-blocked).
   The Track-F section is the bottleneck for deployment.
9. **[docs/weaknesses/INDEX.md](docs/weaknesses/INDEX.md)** — the 27
   weaknesses identified during assimilation, with current status
   per weakness. The 🟦 (architect-blocked) and ⬛ (deferred) rows
   are the live risk register.
10. **[docs/decisions/log.md](docs/decisions/log.md)** — 23 numbered
    architectural decisions with rationale. Follow the chronology
    to understand WHY the system is shaped the way it is.
11. **[docs/source/EXEC-v1.md](docs/source/EXEC-v1.md)** — institutional
    gates: council formation, CONAC engagement, calibration seed.
    Anything tagged with a §-number in PHASE-1-COMPLETION.md
    references this doc.
12. **[docs/sample-dossier/sample-dossier-fr.md](docs/sample-dossier/sample-dossier-fr.md)** —
    a synthetic dossier showing the actual output shape. Bilingual
    counterpart at
    [sample-dossier-en.md](docs/sample-dossier/sample-dossier-en.md).
    The accompanying [sample-manifest.json](docs/sample-dossier/sample-manifest.json)
    shows the JSON envelope worker-conac-sftp uploads alongside.
13. **[OPERATIONS.md](OPERATIONS.md)** — the operational discipline
    (CI gates, secret management, branch policy, decision-log
    enforcement). Read alongside `.github/workflows/phase-gate.yml`.
14. **[docs/runbooks/audit-chain-divergence.md](docs/runbooks/audit-chain-divergence.md)** —
    a representative operator runbook. The P0 (CRITICAL) response
    procedure for the audit-chain integrity failure. The other 60
    runbooks under `docs/runbooks/` follow the same R1–R6 template.

### Skim, don't read end-to-end

- **[CLAUDE.md](CLAUDE.md)** — agent bootstrap for AI-assisted
  development sessions. Tells future agents what to load. Reviewers
  can skim §"Mandatory load order" then move on.
- **[ROADMAP.md](ROADMAP.md)** — phase trajectory. The phase pointer
  in `docs/decisions/log.md` is the operational source of truth.
- **[docs/source/BUILD-COMPANION-v1.md](docs/source/BUILD-COMPANION-v1.md)** +
  **[v2](docs/source/BUILD-COMPANION-v2.md)** — implementation
  reference. Skim the table of contents; use as a code reading
  index, not a linear read.
- **[docs/source/HSK-v1.md](docs/source/HSK-v1.md)** — YubiKey estate
  manual. Read only if you're reviewing the hardware-key custody
  model (R-07 risk).

### Safe to skip on a first review

- Most files under `docs/audit/evidence/hardening/category-*/mode-*/CLOSURE.md`
  (90 of them — one per hardening mode). Each documents how a
  specific failure mode was closed. Reference, not narrative.
- Individual weakness files under `docs/weaknesses/W-NN.md`. The
  INDEX.md aggregates them.
- Per-worker runbooks under `docs/runbooks/worker-*.md` unless
  you're auditing a specific worker's operational surface.

---

## What to run yourself

### 1. Verify the build (~5 minutes)

```bash
# From the repo root:
pnpm install                              # pnpm v9.7.0 per packageManager
pnpm -w turbo run typecheck               # expect 60/60 ✓
pnpm -w turbo run lint -- --max-warnings=0 # expect 60/60 ✓
pnpm -w turbo run test                    # expect 60/60 ✓ (~5 min)
```

If any of those is red on a clean clone, file it as a finding — the
architect should fix it before review continues.

### 2. Run the live demo (~3 minutes after install)

```bash
bash scripts/review-demo.sh
```

This spins up an ephemeral postgres in docker, applies the
audit-chain migrations, seeds 12 synthetic events via the production
`HashChain.append()` primitive, verifies the chain end-to-end, then
TAMPERS with a row via raw SQL and confirms the recompute-body-hash
truth-test catches it. Tears down on exit.

Demonstrates: **the load-bearing integrity guarantee of the system
holds against a raw-SQL UPDATE that bypasses application code.**

The demo runs against the same code production runs — no mocks, no
fakes. Source under [scripts/review-demo.sh](scripts/review-demo.sh)

- [scripts/review-demo-seed.ts](scripts/review-demo-seed.ts) +
  [scripts/review-demo-verify.ts](scripts/review-demo-verify.ts).

### 3. Read a synthetic dossier (~10 minutes)

Open [docs/sample-dossier/sample-dossier-fr.md](docs/sample-dossier/sample-dossier-fr.md)
(French primary) and
[sample-dossier-en.md](docs/sample-dossier/sample-dossier-en.md)
(English counterpart). These show the actual output shape a recipient
institution receives — bilingual, evidence-cited, counter-argued via
the adversarial pipeline, council-voted, hash-chain-anchored.

Synthetic data; no real entities. The structure + tone are the
production renderer's.

### 4. Optional: bring up the minimal substrate yourself (~5 minutes)

```bash
docker compose -f infra/docker/docker-compose.review.yaml up -d
# Connect to postgres:
psql postgres://vigil:review@127.0.0.1:5432/vigil

# Connect to redis:
redis-cli -h 127.0.0.1 -p 6379

# When done:
docker compose -f infra/docker/docker-compose.review.yaml down -v
```

Does NOT bring up the dashboard / workers / Vault / Tor — those need
ceremonies you can't perform (YubiKey provisioning, Shamir share
distribution, Tor onion key generation). The full compose stack at
`infra/docker/docker-compose.yaml` is what the architect runs; the
review-mode compose is a stripped-down substrate for your live
demo + your own DB poking.

### 5. Optional: run the full compose smoke test (~10 minutes; may fail without secrets)

```bash
bash scripts/smoke-stack.sh --help
bash scripts/smoke-stack.sh
```

This brings up the entire 39-service production stack. It WILL emit
warnings about PLACEHOLDER secrets — the architect's `.env` is not
in the repo (gitleaks + .gitignore enforce this), so secret-bound
services (Vault, Tor, IPFS Cluster, Polygon signer) will not boot
cleanly. The script's exit conditions document what's expected to
work without secrets vs not.

---

## What's shipped + tested vs what's designed + pending architect ceremony

Reviewers consistently ask: "is X working or is it just designed?"
Here's the honest split:

### Shipped + tested (production code paths, exercised by 4000+ test cases)

- Audit chain primitives (Postgres + canonical bytes + verify)
- Polygon-anchor adapter (testnet; mainnet wallet pending architect)
- libsodium sealed-box tip ciphertext encryption + decryption
- Shamir share split + combine (GF(256), 3-of-5)
- WebAuthn/FIDO2 council vote path (W-10 native libykcs11 deferred)
- 12-layer anti-hallucination doctrine (SafeLlmRouter chokepoint)
- 43 pattern detectors with 1:1 fixture coverage
- Bayesian certainty engine with adversarial pipeline
- Counter-evidence devil's-advocate worker
- Dossier renderer (DOCX + LibreOffice → PDF)
- CONAC SFTP delivery worker (manifest + ACK loop)
- Three-witness reconciliation (Postgres ↔ Fabric ↔ Polygon)
- Federation stream client + server (gRPC, signed envelopes)
- Tor v3 hidden service onion config
- Multi-recipient format-adapter (CONAC, Cour des Comptes, MINFI,
  ANIF, CDC)
- 23 worker runbooks; 14 operational runbooks (backup, DR rehearsal,
  Shamir init, council rotation, secret rotation, etc.)
- 90/90 hardening modes (82 CV + 6 N/A-Closed + 2 ceremony-pending)
- 10 phase-gate CI lints + secret-scan + a11y + visual + SBOM
- Helm chart for 3-node HA k3s deployment

### Designed + tested at code layer but pending architect ceremony

- Vault Raft cluster bootstrap (script ships; Shamir 5-of-5 ceremony
  needs YubiKeys + 5 named council members)
- Cosign image signing (CI job ships; YubiKey-backed cosign keypair
  pending architect ceremony — modes 9.9 + 10.8 Code-CV-Ceremony-Pending)
- YubiKey provisioning ceremony (procedure + scripts ship; hardware
  procurement pending — W-18 customs delay budgeted)
- Polygon mainnet anchor (testnet wired; mainnet wallet + funding
  pending architect)

### Designed, partially implemented, deferred by spec

- W-10 native libykcs11 helper (WebAuthn fallback ships Phase-1;
  native helper deferred M3-M4)
- W-16 calibration seed (calibration tables ready; ground-truth
  case population deferred to M2 exit)
- D7 visual-regression CI hard-blocking (harness ships; baseline-
  stamp pending architect)
- 7 PROVISIONAL decisions awaiting architect read-through promotion
  (DECISION-001..007)

### Architect-blocked (institutional / external, not buildable by code)

- Council formation (5 pillars named, vetted, YubiKey-enrolled)
- CONAC engagement letter countersigned
- ANTIC declaration filed under Loi 2010/021
- Backup architect named + retained
- Off-jurisdiction safe-deposit-box selected (Geneva/Lisbon/Zurich)
- Cameroonian counsel retained (R-04 risk)
- Civic-society co-design partner selected (R-06 risk)
- Hosting target finalised (Hetzner Falkenstein vs OVH Strasbourg)
- Operational domain finalised (`vigil.gov.cm` vs `vigilapex.cm`)

Full enumeration in
[docs/work-program/PHASE-1-COMPLETION.md](docs/work-program/PHASE-1-COMPLETION.md)
Track F.

---

## What the architect is asking UNDP to fund

In one line: **everything outside the agent's reach on the
"architect-blocked" list above.**

In a paragraph: the technical platform is mature; partnership funds
the _institutional + validation_ half of the system. Specifically
(detailed in [docs/UNDP-REVIEW-RISKS.md](docs/UNDP-REVIEW-RISKS.md)):

1. **Backup architect retainer** — closes the bus-factor risk that
   blocks every deployment conversation.
2. **Calibration data partnership** — closes the "we don't know if
   our 0.87 posterior means anything" gap.
3. **Independent security audit** — closes the "all reviews by the
   same author" gap.
4. **Cameroonian counsel retainer** — closes the defamation /
   ANTIC / data-sovereignty exposure.
5. **Civic co-design engagement** — closes the "designed by one
   engineer in isolation" gap.
6. **Scoped pilot with one institution** — closes the "zero real-
   world operational data" gap.

Year-one budget envelope:
**~$300–500k** covering items 1–5 + the pilot scoping.
**Not** the deployment grant; that's year-three after the design
partnership produces operational data.

---

## Things the architect is NOT asking UNDP to do

- **Sign off on the cryptographic design.** That's an architect
  responsibility; UNDP partnership funds the _review_ of the design,
  not the design itself.
- **Take ownership of the codebase.** The architect maintains the
  code; UNDP partnership unlocks institutional ceremonies the
  architect cannot perform alone.
- **Commit to exclusivity.** VIGIL APEX should also engage Open
  Government Partnership, Anti-Corruption Resource Centre, and
  Cameroonian civic-society funding channels — UNDP partnership is
  the anchor, not the only relationship.
- **Approve a year-one deployment.** The system is not ready;
  asking would burn the relationship. The honest framing is
  design-partnership now, pilot in year two, deployment evaluation
  in year three.

---

## Surface inventory by directory

Quick map of where things live:

| Directory                      | What's there                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/`              | Next.js operator + public surfaces; rate-limited public verify + audit endpoints                              |
| `apps/worker-*/`               | 25 background workers; one app per worker per consumer-group concurrency unit                                 |
| `apps/adapter-runner/`         | Source-adapter execution shell (29 adapters across CONAC, ARMP, court rolls, satellite, etc.)                 |
| `apps/audit-bridge/`           | Unix-domain-socket bridge into the canonical audit chain (single-writer)                                      |
| `apps/audit-verifier/`         | CT-01/CT-02/CT-03 cross-witness verifier loop                                                                 |
| `packages/audit-chain/`        | Postgres hash-chain primitive + canonical bytes + Polygon anchor adapter                                      |
| `packages/queue/`              | Redis Streams worker base + dedup-Lua + retry budget                                                          |
| `packages/db-postgres/`        | Drizzle schema + repos + 13 numbered SQL migrations                                                           |
| `packages/db-neo4j/`           | Neo4j graph mirror for entity relationships                                                                   |
| `packages/llm/`                | Anthropic + Bedrock providers + SafeLlmRouter chokepoint + 12-layer guards                                    |
| `packages/security/`           | libsodium + Shamir + Vault client + WebAuthn/FIDO2 + age-plugin-yubikey integration                           |
| `packages/patterns/`           | 43 PatternDef files (P-A-001..P-P-NNN) + 43 fixture-test pairs                                                |
| `packages/certainty-engine/`   | Bayesian posterior + adversarial pipeline (order-rand + devil's-advocate + counterfactual + secondary-review) |
| `packages/dossier/`            | DOCX renderer + GPG detach-sign + QR-code embed                                                               |
| `packages/observability/`      | pino logger + Prometheus metrics + OpenTelemetry tracing + LoopBackoff + sentinel quorum                      |
| `packages/governance/`         | Council vote arithmetic + DECISION-010 routing                                                                |
| `packages/shared/`             | Schemas + Constants + IDs + canonical time + tip sanitisation + calibration seed I/O                          |
| `packages/fabric-bridge/`      | Hyperledger Fabric chaincode client (audit-witness)                                                           |
| `packages/federation-stream/`  | Cross-region gRPC replication (signed envelopes; client + server)                                             |
| `packages/adapters/`           | Adapter SDK + the 29 source-specific adapters                                                                 |
| `contracts/contracts/`         | Solidity: `VIGILGovernance.sol` (5-pillar quorum) + `VIGILAnchor.sol` (audit-anchor)                          |
| `chaincode/audit-witness/`     | Hyperledger Fabric chaincode (Go) — the second cryptographic witness                                          |
| `tools/vigil-polygon-signer/`  | Rust YubiKey-backed signer (Unix-domain-socket adapter)                                                       |
| `tools/vigil-vault-unseal/`    | Vault Shamir unseal helper                                                                                    |
| `infra/docker/`                | 39-service production compose + per-service config                                                            |
| `infra/k8s/charts/vigil-apex/` | Helm chart for 3-node HA k3s deployment                                                                       |
| `infra/host-bootstrap/`        | 15 numbered host-bootstrap scripts (system-prep, YubiKey enrolment, Vault init, etc.)                         |
| `infra/systemd/`               | systemd units for off-cluster services (sentinel quorum, watchdog, backup)                                    |
| `infra/observability/falco/`   | 11 Falco runtime-security rules                                                                               |
| `infra/vault-policies/`        | Per-app Vault policies (HCL)                                                                                  |
| `infra/forgejo/hooks/`         | git pre-receive hooks (gitleaks, commitlint scope enforcement)                                                |
| `scripts/`                     | Operational scripts (DR rehearsal, smoke stack, SBOM gen, etc.)                                               |
| `scripts/__tests__/`           | Tests for the scripts themselves (8 test files)                                                               |
| `load-tests/`                  | k6 load-test definitions                                                                                      |
| `docs/source/`                 | Doctrine documents (SRD, EXEC, BUILD-COMPANION v1/v2, HSK, TAL-PA, AI-SAFETY-DOCTRINE)                        |
| `docs/decisions/`              | 23 numbered ADRs + closure notes                                                                              |
| `docs/weaknesses/`             | 27 W-NN files + INDEX                                                                                         |
| `docs/runbooks/`               | 61 operator runbooks (23 worker + canonical R1–R6 ceremonies)                                                 |
| `docs/audit/`                  | Code-audit evidence (FRONTIER-AUDIT layers + 90-mode hardening per-mode CLOSURE)                              |
| `docs/patterns/`               | Auto-generated catalogue + per-pattern P-X-NNN.md files                                                       |
| `docs/work-program/`           | Phase-1 completion tracker + per-block plans                                                                  |
| `docs/security/`               | Threat-coverage matrix                                                                                        |
| `docs/sample-dossier/`         | This review's synthetic sample dossier                                                                        |
| `personal/`                    | gitignored — architect's local state (calibration seed, council candidates)                                   |

---

## Asking the architect a question

If during your review you need clarification:

- Architectural intent — read the relevant DECISION-NNN in
  [docs/decisions/log.md](docs/decisions/log.md) first.
- Why a specific failure mode was closed — read the mode's
  `CLOSURE.md` under `docs/audit/evidence/hardening/`.
- Why a weakness is the status it is — read the weakness's
  `docs/weaknesses/W-NN.md`.
- Anything else — direct question to the architect; bilingual FR/EN
  responses available.

---

## A final note

This document is honest about what's done and what isn't. The
architect would rather you find a stated weakness than an unstated
one — the former is mitigated, the latter is a surprise. The
[risk register](docs/UNDP-REVIEW-RISKS.md) enumerates 12 concerns
in detail, each with the current mitigation and the partnership
ask that would close it.

The technical platform is mature enough to underwrite a design
partnership. It is _not_ mature enough to underwrite a deployment
grant. That distinction is the heart of what the architect is
asking UNDP to fund.

Welcome to the review. Take your time; the architecture rewards
careful reading.
