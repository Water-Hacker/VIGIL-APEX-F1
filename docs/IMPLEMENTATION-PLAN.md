# IMPLEMENTATION PLAN — Ring-by-Ring Build

This document is the master plan for the full code implementation of VIGIL
APEX MVP. We code **one ring after the other, starting from Ring 0**, with
self-critique gates between each ring.

The PPTX architecture (`docs/archive/RTPFC_Governance_Intelligence_Platform.pptx`)
defines the rings; the SRD/Build Companions define the implementation. We
honour both.

## Self-critique gate (applied after each component)

Before marking any component done, the agent answers:

1. Does this code meet the SRD spec exactly, with cited section numbers?
2. Is every external input validated (Zod / sanitised SQL / CSP / rate-limited)?
3. Are secrets only accessed via Vault, never hardcoded, never in env directly?
4. Is every operation idempotent or has a deterministic dedup key?
5. Is failure logged with structured context, with metrics, with a traceable correlation ID?
6. Is the code testable; are unit tests written before claiming completion?
7. Does it run as non-root in a minimal container with read-only filesystem?
8. Is the audit trail captured for any consequential action?
9. Could a malicious input here produce a fabricated finding? (anti-hallucination)
10. Could this code be deleted entirely with no loss? (YAGNI check)

Only after all 10 are answered "yes, here's the proof" does a component
land on `main`.

---

## Ring 0 — Decentralised Infrastructure Backbone

**Goal**: Every package and every container the rest of the system depends on,
configured to production-grade standards, with API placeholders only (no
secret values). Spinnable via `docker compose up` in development.

### R0.A — Repository Foundation
- [ ] `package.json` (root, pnpm workspaces, scripts)
- [ ] `pnpm-workspace.yaml`
- [ ] `turbo.json` with build/dev/lint/test/typecheck pipelines
- [ ] `tsconfig.base.json` (strict, ES2022, paths)
- [ ] `.editorconfig`, `.prettierrc`, `.eslintrc.cjs`
- [ ] `.nvmrc`, `.npmrc`, `.dockerignore`
- [ ] `.husky/` pre-commit + commit-msg hooks
- [ ] `lint-staged.config.cjs` + `commitlint.config.cjs`
- [ ] `.env.example` (every var the production stack needs, commented)
- [ ] `Makefile` with developer entry points
- [ ] `.github/workflows/ci.yml`, `phase-gate.yml`, `secret-scan.yml`, `contract-test.yml`

### R0.B — Foundation Packages
- [ ] `packages/shared` — types, Zod schemas, IDs, time, currency, errors
- [ ] `packages/db-postgres` — Drizzle schema (all 7 schemas), migrations, repos
- [ ] `packages/db-neo4j` — Bolt client, custom GDS (PageRank, Louvain, NodeSim)
- [ ] `packages/queue` — Redis Streams idempotent worker base, backpressure, DLQ
- [ ] `packages/observability` — pino logger, Prometheus metrics, OTel tracing
- [ ] `packages/security` — Vault client, mTLS auto-renew, libsodium helpers, FIDO2 verifier
- [ ] `packages/llm` — Anthropic + Bedrock + local tier router, prompt registry, circuit breaker, cost tracker, anti-hallucination meta-wrapper
- [ ] `packages/audit-chain` — Postgres hash chain (resolves W-11), Polygon anchor client, verifier
- [ ] `packages/governance` — contract ABIs, vote ceremony helper, quorum logic
- [ ] `packages/dossier` — deterministic PDF render (docx-js + LibreOffice), QR codes, signing
- [ ] `packages/patterns` — `PatternDef` interface, registry, signal types
- [ ] `packages/adapters` — adapter base class, registry, scheduling, proxy rotation

### R0.C — Smart Contracts
- [ ] `contracts/hardhat.config.ts` — Polygon mainnet + Mumbai testnet + local hardhat
- [ ] `contracts/contracts/VIGILAnchor.sol` — append-only hash registry
- [ ] `contracts/contracts/VIGILGovernance.sol` — 5-pillar 3-of-5 quorum
- [ ] `contracts/test/VIGILAnchor.test.ts` — gas, replay, access control, reorg
- [ ] `contracts/test/VIGILGovernance.test.ts` — quorum math, recusal, deadlock
- [ ] `contracts/scripts/deploy.ts` + `verify.ts` (block explorer)

### R0.D — Container Fabric
- [ ] `infra/docker/docker-compose.yaml` — full 16-container stack
- [ ] `infra/docker/dockerfiles/Dashboard.Dockerfile` (multi-stage, distroless)
- [ ] `infra/docker/dockerfiles/Worker.Dockerfile`
- [ ] `infra/docker/dockerfiles/AdapterRunner.Dockerfile` (Playwright + Tor)
- [ ] `infra/docker/postgres/postgresql.conf` + `pg_hba.conf` + init SQL
- [ ] `infra/docker/neo4j/neo4j.conf`
- [ ] `infra/docker/redis/redis.conf`
- [ ] `infra/docker/ipfs/init.sh`
- [ ] `infra/docker/vault/config.hcl` + policies
- [ ] `infra/docker/keycloak/realm-vigil.json` (FIDO2-only)
- [ ] `infra/docker/caddy/Caddyfile`
- [ ] `infra/docker/prometheus/prometheus.yml` + alert rules
- [ ] `infra/docker/grafana/dashboards/` (system, workers, llm, ledger)
- [ ] `infra/docker/.env.compose.example`

### R0.E — Host Bootstrap & Systemd
- [ ] `infra/host-bootstrap/01-system-prep.sh`
- [ ] `infra/host-bootstrap/02-yubikey-enrol.sh`
- [ ] `infra/host-bootstrap/03-vault-shamir-init.sh`
- [ ] `infra/host-bootstrap/04-clevis-luks-bind.sh` (W-12: age-plugin-yubikey)
- [ ] `infra/systemd/vigil-vault-unseal.service`
- [ ] `infra/systemd/vigil-polygon-signer.service`
- [ ] `infra/systemd/vigil-time.service`
- [ ] `infra/systemd/vigil-watchdog.{service,timer}`
- [ ] `infra/systemd/vigil-backup.{service,timer}`
- [ ] `infra/systemd/vigil-cert-renew.{service,timer}`
- [ ] `infra/wireguard/wg0.conf.template`

### R0.F — Sources Registry
- [ ] `infra/sources.json` — all 26 sources with URL, cron, owner, rate limit, fallback

---

## Ring 1 — Omnivore Data Ingestion

### R1.A — Adapter Framework
- [ ] `apps/adapter-runner` — runs on Hetzner N02; loads `sources.json`; schedules
- [ ] Proxy pool manager (Hetzner DC → Bright Data residential → Tor over Bright Data, per W-13)
- [ ] User-Agent + fingerprint discipline
- [ ] Captcha handler with budget enforcement
- [ ] Robots.txt + ToS persistence
- [ ] First-contact protocol (archive HTML on first parse failure, alert)
- [ ] `worker-adapter-repair` (W-19): LLM selector regeneration with PR proposal

### R1.B — Adapters (one file per source, all 26)
Cameroonian core (procurement + finance + sectoral):
- [ ] `armp`, `minmap-portal`, `coleps-tenders`, `minfi-portal`, `dgb-budget`,
- [ ] `dgtcfm-treasury`, `dgtcfm-bons`, `dgi-attestations`, `minepat-bip`,
- [ ] `mintp`, `minee`, `minsante`, `minedub`, `minesec`, `minhdu`,
- [ ] `rccm-search`, `cour-des-comptes`, `journal-officiel`, `anif-pep`

International corroboration:
- [ ] `worldbank-sanctions`, `afdb-sanctions`, `eu-sanctions`, `ofac-sdn`,
- [ ] `un-sanctions`, `opensanctions`, `opencorporates`

Reference adapters (full implementation, hand-written): ARMP, RCCM, OFAC SDN.
Other 23 follow the same template with parameter substitution per BUILD-V2.

### R1.C — Document Pipeline
- [ ] `apps/worker-document` — fetch → SHA-256 → MIME detect → language detect → OCR (Tesseract local + Textract fallback) → IPFS pin → DB persist

---

## Ring 2 — AI Brain

### R2.A — Pattern Engine
- [ ] `packages/patterns` — registry, base `PatternDef`, signal types, prior schema
- [ ] All 43 patterns across 8 categories (Reference: P-A-001 from BUILD-V1; rest follow template):
  - Category A (procurement): 9 patterns
  - Category B (beneficial-ownership): 7 patterns
  - Category C (price-reasonableness): 6 patterns
  - Category D (performance verification): 5 patterns
  - Category E (sanctions): 4 patterns
  - Category F (network anomalies): 5 patterns
  - Category G (document integrity): 4 patterns
  - Category H (temporal anomalies): 3 patterns
- [ ] Pattern unit-test fixtures (positive + negative per pattern)

### R2.B — Workers
- [ ] `apps/worker-entity` — LLM-assisted entity resolution; ER ≥ 90% target; review-band queue
- [ ] `apps/worker-pattern` — applies registry, emits signals
- [ ] `apps/worker-bayesian` — combines signals, computes posterior, calibration tracking
- [ ] `apps/worker-counter-evidence` — devil's-advocate Opus call before escalation
- [ ] `apps/worker-extract` — typed extraction with `{cid, page, char_span}` citations

### R2.C — LLM Infrastructure
- [ ] Tier router (Opus / Sonnet / Haiku selection by task class)
- [ ] Bedrock failover (circuit breaker on 3 failures / 60s)
- [ ] Local Qwen 3.5 / DeepSeek R1 sovereign tier (DEGRADED mode)
- [ ] Cost tracker (per-call $ logged; daily soft/hard ceiling)
- [ ] Anti-hallucination meta-wrapper (12 layers per SRD §20)
- [ ] Synthetic-hallucination corpus + nightly CI (W-14)

---

## Ring 3 — Intelligence Products

### R3.A — Operator Dashboard (Next.js 14)
- [ ] `apps/dashboard/(operator)/findings` list + detail
- [ ] `apps/dashboard/(operator)/dead-letter`
- [ ] `apps/dashboard/(operator)/calibration`
- [ ] `apps/dashboard/(operator)/alerts`
- [ ] `apps/dashboard/(operator)/triage/tips`
- [ ] Real-time updates via Socket.io
- [ ] Live heatmap (Mapbox GL + D3)

### R3.B — Council Portal
- [ ] `apps/dashboard/(council)/proposals` list
- [ ] `apps/dashboard/(council)/proposals/[id]` vote ceremony
- [ ] WebAuthn integration with native helper fallback (W-10)

### R3.C — Public Surfaces
- [ ] `apps/dashboard/(public)/verify` — audit-root + escalation metadata only (W-15)
- [ ] `apps/dashboard/(public)/verify/[ref]` — per-dossier verification
- [ ] `apps/dashboard/(public)/ledger` — public audit-chain checkpoints
- [ ] `apps/dashboard/(public)/tip` — clearnet tip submission
- [ ] `.onion` v3 hidden service config (W-09)

### R3.D — Auto-Dossier
- [ ] `apps/worker-dossier` — deterministic PDF render (FR + EN), QR, signing, IPFS pin

---

## Ring 4 — Enforcement Integration

- [ ] `apps/worker-conac-sftp` — format-adapter layer (W-25), manifest, ACK loop
- [ ] `apps/worker-minfi-api` — pre-disbursement scoring API (NestJS), idempotency
- [ ] `apps/worker-anchor` — Polygon mainnet anchor + Postgres hash chain commit
- [ ] Cour des Comptes Plan-B delivery adapter (W-25)

---

## Ring 5 — Governance Shield

- [ ] `apps/worker-governance` — Polygon contract event watcher
- [ ] `apps/audit-verifier` — hourly hash-chain integrity check (CT-01)
- [ ] Civil-society oversight surface (read-only council audit)
- [ ] Tip-decryption ceremony (3-of-5 council quorum, libsodium sealed-box)
- [ ] Multi-party key infrastructure already in `packages/security`

---

## Verification per Ring

After each ring closes:
- All packages build with `pnpm build` (no errors, no warnings)
- All unit tests pass with `pnpm test` (≥ 80% coverage on critical packages)
- All linters green
- `docker compose up -d` brings the ring's services up
- Health endpoints return 200 within 90 s of start
- Audit chain emits an `audit_event` of type `ring.<n>.completed`
- Architect signs the ring-completion entry in `docs/decisions/log.md`

## Build order (strict)

R0.A → R0.B → R0.C → R0.D → R0.E → R0.F → **Ring 0 closes**
R1.A → R1.B (5 reference + 21 framework) → R1.C → **Ring 1 closes**
R2.A → R2.C → R2.B → **Ring 2 closes**
R3.A → R3.D → R3.B → R3.C → **Ring 3 closes**
R4.full → **Ring 4 closes**
R5.full → **Ring 5 closes**

Estimated lines of code at completion: **70,000-100,000** including tests.

We start now with R0.A.
