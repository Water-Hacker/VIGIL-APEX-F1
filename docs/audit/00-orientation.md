# VIGIL APEX Audit Orientation

**Repository root:** `/home/kali/Documents/vigil-apex`  
**Audit date:** 2026-05-10  
**Version:** 0.1.0

---

## 1. Monorepo Topology

### 1.1 Workspace Packages (`packages/`)

| Package             | Purpose                                                                                                                                 | Location                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `adapters`          | Adapter base class, registry, scheduling, proxy rotation. Hosts all 26 adapters.                                                        | `/home/kali/Documents/vigil-apex/packages/adapters`          |
| `audit-chain`       | Postgres hash chain (W-11 MVP) + Polygon anchor verifier. Tamper-evident audit log.                                                     | `/home/kali/Documents/vigil-apex/packages/audit-chain`       |
| `audit-log`         | TAL-PA SDK — Total Action Logging with Public Anchoring (DECISION-012). Workers + dashboard import emit() to record every user action.  | `/home/kali/Documents/vigil-apex/packages/audit-log`         |
| `certainty-engine`  | Bayesian certainty engine — turns pattern matches + evidence into calibrated posterior with likelihood ratios + independence weighting. | `/home/kali/Documents/vigil-apex/packages/certainty-engine`  |
| `db-neo4j`          | Neo4j Bolt client + custom GDS (PageRank, Louvain, NodeSimilarity).                                                                     | `/home/kali/Documents/vigil-apex/packages/db-neo4j`          |
| `db-postgres`       | Drizzle ORM schemas + migrations + repos for VIGIL APEX Postgres.                                                                       | `/home/kali/Documents/vigil-apex/packages/db-postgres`       |
| `dossier`           | Deterministic bilingual PDF dossier renderer + signing.                                                                                 | `/home/kali/Documents/vigil-apex/packages/dossier`           |
| `fabric-bridge`     | Hyperledger Fabric SDK wrapper used by worker-fabric-bridge and cross-witness audit verifier.                                           | `/home/kali/Documents/vigil-apex/packages/fabric-bridge`     |
| `federation-stream` | Phase-3 federation event stream (regional → core). Signed-envelope gRPC client/server.                                                  | `/home/kali/Documents/vigil-apex/packages/federation-stream` |
| `governance`        | Smart-contract ABIs and quorum-logic helpers (SRD §22-§23).                                                                             | `/home/kali/Documents/vigil-apex/packages/governance`        |
| `llm`               | LLM tier router (Anthropic + Bedrock failover + local sovereign), prompt registry, anti-hallucination, cost tracker.                    | `/home/kali/Documents/vigil-apex/packages/llm`               |
| `observability`     | Structured logger (pino), Prometheus metrics, OpenTelemetry tracing.                                                                    | `/home/kali/Documents/vigil-apex/packages/observability`     |
| `patterns`          | PatternDef interface, registry, and 43 fraud-detection patterns (categories A–H).                                                       | `/home/kali/Documents/vigil-apex/packages/patterns`          |
| `py-common`         | Shared helpers for Python workers (logging, metrics, redis consumer base, postgres pool, vault, secrets).                               | `/home/kali/Documents/vigil-apex/packages/py-common`         |
| `queue`             | Redis Streams idempotent-consumer worker base (SRD §15).                                                                                | `/home/kali/Documents/vigil-apex/packages/queue`             |
| `satellite-client`  | TypeScript shim that builds and publishes SatelliteRequest envelopes for worker-satellite (Python) to consume.                          | `/home/kali/Documents/vigil-apex/packages/satellite-client`  |
| `security`          | Vault client, mTLS auto-renew, libsodium ops, FIDO2/WebAuthn verifier.                                                                  | `/home/kali/Documents/vigil-apex/packages/security`          |
| `shared`            | VIGIL APEX shared types, schemas, errors, constants — foundation for every other package.                                               | `/home/kali/Documents/vigil-apex/packages/shared`            |

### 1.2 Applications (`apps/`)

| Application                  | Purpose                                                                                                                     | Location                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `adapter-runner`             | Loads sources.json, schedules adapters per cron, dispatches results to Redis stream vigil:adapter:out.                      | `/home/kali/Documents/vigil-apex/apps/adapter-runner`             |
| `api`                        | (API server; description not extracted)                                                                                     | `/home/kali/Documents/vigil-apex/apps/api`                        |
| `audit-bridge`               | UDS HTTP sidecar — exposes audit-chain.append() so non-TS workers (Python worker-satellite, Bash) can write to audit chain. | `/home/kali/Documents/vigil-apex/apps/audit-bridge`               |
| `audit-verifier`             | Hourly hash-chain integrity check (CT-01) + Polygon-anchor match (CT-02).                                                   | `/home/kali/Documents/vigil-apex/apps/audit-verifier`             |
| `dashboard`                  | VIGIL APEX dashboard — operator + council + public verify + tip portal (Next.js 14).                                        | `/home/kali/Documents/vigil-apex/apps/dashboard`                  |
| `worker-adapter-repair`      | W-19 self-healing — LLM re-derives broken adapter selectors and shadow-tests against live source before promotion.          | `/home/kali/Documents/vigil-apex/apps/worker-adapter-repair`      |
| `worker-anchor`              | Periodic anchor of audit-chain tail to Polygon mainnet via Unix-socket signer.                                              | `/home/kali/Documents/vigil-apex/apps/worker-anchor`              |
| `worker-audit-watch`         | TAL-PA anomaly detection (DECISION-012). Evaluates deterministic rules over rolling window of audit.user_action_event rows. | `/home/kali/Documents/vigil-apex/apps/worker-audit-watch`         |
| `worker-conac-sftp`          | CONAC SFTP delivery worker — manifest, ACK loop, format-adapter layer (W-25).                                               | `/home/kali/Documents/vigil-apex/apps/worker-conac-sftp`          |
| `worker-counter-evidence`    | Devil's-advocate pass at posterior >= 0.85 (SRD §19.6).                                                                     | `/home/kali/Documents/vigil-apex/apps/worker-counter-evidence`    |
| `worker-document`            | Document fetch → SHA-256 → MIME → OCR → IPFS pin pipeline.                                                                  | `/home/kali/Documents/vigil-apex/apps/worker-document`            |
| `worker-dossier`             | Renders bilingual FR/EN PDF dossiers; signs with YubiKey-backed GPG; pins to IPFS.                                          | `/home/kali/Documents/vigil-apex/apps/worker-dossier`             |
| `worker-entity`              | Entity resolution — LLM-assisted alias dedup + relationship extraction.                                                     | `/home/kali/Documents/vigil-apex/apps/worker-entity`              |
| `worker-extractor`           | Procurement field extractor — deterministic + LLM. Bridges raw ADAPTER_OUT to ENTITY_RESOLVE.                               | `/home/kali/Documents/vigil-apex/apps/worker-extractor`           |
| `worker-fabric-bridge`       | Postgres audit.actions → Fabric audit-witness chaincode replication. Phase G.                                               | `/home/kali/Documents/vigil-apex/apps/worker-fabric-bridge`       |
| `worker-federation-agent`    | Phase-3 regional federation agent. Drains FEDERATION_PUSH stream, signs envelopes, pushes to Yaoundé core over gRPC.        | `/home/kali/Documents/vigil-apex/apps/worker-federation-agent`    |
| `worker-federation-receiver` | Phase-3 core-side federation receiver. Verifies signed envelopes, forwards into pattern-detect pipeline.                    | `/home/kali/Documents/vigil-apex/apps/worker-federation-receiver` |
| `worker-governance`          | Polygon contract event watcher → Postgres projection of proposals/votes/members.                                            | `/home/kali/Documents/vigil-apex/apps/worker-governance`          |
| `worker-image-forensics`     | (Image forensics worker; description not in package.json)                                                                   | `/home/kali/Documents/vigil-apex/apps/worker-image-forensics`     |
| `worker-minfi-api`           | MINFI pre-disbursement scoring API (SRD §26).                                                                               | `/home/kali/Documents/vigil-apex/apps/worker-minfi-api`           |
| `worker-pattern`             | Pattern worker — applies @vigil/patterns registry to incoming subjects.                                                     | `/home/kali/Documents/vigil-apex/apps/worker-pattern`             |
| `worker-satellite`           | Satellite & GIS worker — Rasterio + STAC + Sentinel Hub. Computes activity_score for category-D patterns.                   | `/home/kali/Documents/vigil-apex/apps/worker-satellite`           |
| `worker-score`               | Bayesian certainty engine — combines signals into posterior; triggers counter-evidence at 0.85.                             | `/home/kali/Documents/vigil-apex/apps/worker-score`               |
| `worker-tip-triage`          | Tip triage — paraphrase and route to operator review queue.                                                                 | `/home/kali/Documents/vigil-apex/apps/worker-tip-triage`          |

### 1.3 Smart Contracts (`contracts/`)

| Item                     | Purpose                                                                                                       | Location                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `contracts/` (directory) | VIGIL APEX smart contracts — Polygon mainnet (SRD §22). Compiled from Solidity; generated typechain bindings. | `/home/kali/Documents/vigil-apex/contracts` |

### 1.4 Chaincode (`chaincode/`)

| Item            | Purpose                                                                                                              | Location                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `audit-witness` | VIGIL APEX audit-witness chaincode — second cryptographic witness over the Postgres hash chain (Hyperledger Fabric). | `/home/kali/Documents/vigil-apex/chaincode/audit-witness` |

### 1.5 Infrastructure (`infra/`)

| Directory        | Purpose                                                                                                                     | Location                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `ansible`        | (Ansible playbooks; content not extracted)                                                                                  | `/home/kali/Documents/vigil-apex/infra/ansible`        |
| `certainty`      | Certainty engine configuration — independence-weights.json, likelihood-ratios.json.                                         | `/home/kali/Documents/vigil-apex/infra/certainty`      |
| `docker`         | Docker Compose stack + Dockerfiles for all services (N03–N10). Adapter runner image, dashboard, workers, observability.     | `/home/kali/Documents/vigil-apex/infra/docker`         |
| `forgejo`        | Forgejo Git hooks and server config (pre-receive.d).                                                                        | `/home/kali/Documents/vigil-apex/infra/forgejo`        |
| `host-bootstrap` | Host bootstrap scripts: system prep, YubiKey enrol, Vault Shamir init, Clevis LUKS bind, secret materialisation.            | `/home/kali/Documents/vigil-apex/infra/host-bootstrap` |
| `k8s`            | Kubernetes manifests + Helm charts (ArgoCD, regional node charts). Phase-2 scaffold.                                        | `/home/kali/Documents/vigil-apex/infra/k8s`            |
| `llm`            | LLM pricing configuration (pricing.json).                                                                                   | `/home/kali/Documents/vigil-apex/infra/llm`            |
| `observability`  | Observability stack config — Falco, Grafana.                                                                                | `/home/kali/Documents/vigil-apex/infra/observability`  |
| `systemd`        | systemd unit files: vigil-vault-unseal, vigil-polygon-signer, vigil-key-rotation, vigil-backup, vigil-time, vigil-watchdog. | `/home/kali/Documents/vigil-apex/infra/systemd`        |
| `vault-policies` | Vault HCL policies (architect, backup-snapshot, council-decryptor, dashboard, fabric).                                      | `/home/kali/Documents/vigil-apex/infra/vault-policies` |
| `wireguard`      | WireGuard tunnel config (wg0.conf.template, N01 ↔ N02 Hetzner).                                                             | `/home/kali/Documents/vigil-apex/infra/wireguard`      |

### 1.6 Tools & Utilities

| Item                   | Purpose                                                                     | Location                                                     |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `vigil-polygon-signer` | Polygon transaction signer (Python). Runs on host; signs via YubiKey.       | `/home/kali/Documents/vigil-apex/tools/vigil-polygon-signer` |
| `vigil-vault-unseal`   | Vault unsealer (Bash). Runs on host; retrieves YubiKey-backed key material. | `/home/kali/Documents/vigil-apex/tools/vigil-vault-unseal`   |
| `vigil-key-rotation`   | Key rotation utility (Bash). Rotates cryptographic material on schedule.    | `/home/kali/Documents/vigil-apex/tools/vigil-key-rotation`   |
| `e2e-smoke.sh`         | End-to-end smoke test suite (Bash).                                         | `/home/kali/Documents/vigil-apex/tools`                      |
| `verify-dossier.sh`    | Dossier verification script (Bash).                                         | `/home/kali/Documents/vigil-apex/tools`                      |

### 1.7 Load Tests & Documentation

| Item          | Purpose                                                                                                                                                | Location                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `load-tests/` | Load testing scripts: k6 (tip portal, verify page), Locust (MINFI API).                                                                                | `/home/kali/Documents/vigil-apex/load-tests` |
| `docs/`       | Comprehensive documentation: SRD v3, patterns (43 catalogue), decisions, incident response, runbooks, weaknesses (W-01 through W-27), source material. | `/home/kali/Documents/vigil-apex/docs`       |

---

## 2. Build System

**Package manager:** pnpm v9.7.0 (enforced via `packageManager` field, `/home/kali/Documents/vigil-apex/package.json`).  
**Node version:** 22.13.0 to <23.0.0 (enforced via `engines`, `.nvmrc` = `22.13.0`).  
**TypeScript target:** ES2022 (`tsconfig.base.json`).  
**Python version:** 3.12.6 (`.python-version`).

**Workspace protocol:** pnpm, configured in `/home/kali/Documents/vigil-apex/pnpm-workspace.yaml`:

- `apps/*`
- `packages/*`
- `contracts`

**Build tool:** Turbo v2.1.2. Configuration at `/home/kali/Documents/vigil-apex/turbo.json`:

- Build task dependencies: `^build` (dependencies must build first).
- Dev task: `persistent: true`, `cache: false`, `dependsOn: ["^build"]`.
- Test, lint, typecheck tasks configured with input/output tracking.
- Global dependencies: `tsconfig.base.json`, `.env.example`, `pnpm-workspace.yaml`.
- Global env pass-through: NODE_ENV, LOG_LEVEL, OTEL_EXPORTER_OTLP_ENDPOINT, VIGIL_PHASE, plus Vault, Postgres, Redis, Neo4j, IPFS, Anthropic, AWS Bedrock URLs.

**Lockfile:** `/home/kali/Documents/vigil-apex/pnpm-lock.yaml` (pnpm v9 format).

**Overrides** (pnpm): axios >= 1.7.4, ws >= 8.17.1 (supply-chain vulnerability hardening).

---

## 3. Test System

### 3.1 Test Runners

**Vitest** (TypeScript/JavaScript): Primary test runner for packages and most apps.

- Config: Individual `vitest.config.ts` files in packages; Turbo executes via `turbo run test`.
- Example packages: `audit-log`, `db-neo4j`, `security`, `patterns`, `queue`, `dossier`, `llm`, `observability`, `certainty-engine`, `adapters`, `audit-chain`, `satellite-client`, `governance`, `fabric-bridge`, `federation-stream`.
- Example apps: `adapter-runner`, `dashboard`, `worker-document`, `worker-entity`, `worker-extractor`, `worker-tip-triage`, `worker-score`, `worker-pattern`, `worker-anchor`, `worker-adapter-repair`, `worker-conac-sftp`, `worker-governance`, `worker-fabric-bridge`, `worker-federation-agent`, `worker-federation-receiver`, `audit-bridge`.

**Hardhat** (Solidity contracts): `/home/kali/Documents/vigil-apex/contracts/hardhat.config.ts`.

- Tasks: `hardhat test`, `hardhat coverage`, `REPORT_GAS=true hardhat test`.

**pytest** (Python): Worker-satellite, worker-image-forensics use pytest.

- Config: `/home/kali/Documents/vigil-apex/pytest.ini`.

### 3.2 Test Count

Total test files discovered: **159** (`.test.ts`, `.spec.ts`, `.test.js`, `test_*.py`).  
Top test-file locations (by count):

- `packages/patterns/test/category-a`: 9
- `packages/patterns/test/category-b`: 7
- `packages/db-neo4j/__tests__`: 7
- `packages/patterns/test/category-c`: 6
- `packages/audit-log/__tests__`: 6
- `apps/dashboard/__tests__`: 10

The patterns package holds the largest test load (43 patterns × multiple categories). Database and observability packages also well-tested.

### 3.3 Test Commands

Root `package.json` scripts (`/home/kali/Documents/vigil-apex/package.json`):

- `pnpm test` → `turbo run test` (all packages + apps).
- `pnpm test:watch` → `turbo run test -- --watch`.
- `pnpm test:coverage` → `turbo run test:coverage` (generates coverage per package).
- `pnpm test:integration` → `turbo run test:integration` (integration tests, non-cached).

Contracts:

- `pnpm contracts:test` → `pnpm --filter contracts run test`.

---

## 4. Runtime Topology

Per SRD §2.4 and §2.6, the operational stack comprises:

**Host-resident processes (N01 — MSI Titan workstation):**

1. `vigil-vault-unseal.service` — Unseals HashiCorp Vault before containers start.
2. `vigil-polygon-signer.service` — Unix-socket-based Polygon transaction signer (YubiKey-backed).
3. `vigil-time.service` — Master timekeeper; exported to containers via `/etc/localtime` bind mount.
4. `vigil-watchdog.service` + `vigil-watchdog.timer` — Monitors container health; raises P1 alerts on crashes.
5. `vigil-backup.service` + `vigil-backup.timer` — Nightly backup pipeline (Btrfs snapshots → encrypted archive → Synology).
6. `vigil-key-rotation.service` + `vigil-key-rotation.timer` — Automated key rotation.

**Docker containers (N03–N10, per `/home/kali/Documents/vigil-apex/infra/docker/docker-compose.yaml`):**

| Container | Service                    | Purpose                                                                                 | External Deps                                |
| --------- | -------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- |
| N03       | vigil-postgres             | PostgreSQL 15. Authoritative store (SRD §7). Hash chain, findings, entities, audit log. | none                                         |
| N04       | vigil-neo4j                | Neo4j Community Edition. Derived graph (entity relationships, PageRank, Louvain).       | PostgreSQL rehydration                       |
| N05       | vigil-redis                | Redis 7. Streams (worker queue), cache, session store.                                  | none                                         |
| N06       | vigil-ipfs                 | IPFS Kubo. Content-addressed evidence archival.                                         | none                                         |
| N07       | vigil-fabric               | Hyperledger Fabric orderer + peer. Audit-witness ledger (Phase G).                      | none                                         |
| N07a      | vigil-fabric-bootstrap     | Init container; genesis block setup.                                                    | vigil-fabric                                 |
| N08       | vigil-vault                | HashiCorp Vault. Secrets store (SRD §17.6).                                             | none                                         |
| N09       | vigil-keycloak             | Keycloak. FIDO2/WebAuthn identity provider.                                             | Postgres user DB                             |
| N10       | vigil-dashboard            | Next.js 14 dashboard + reverse proxy (Caddy). Public UI + council UI + tip portal.      | All workers + Postgres                       |
| --        | worker-pattern             | Pattern detection worker.                                                               | Postgres, Redis, Neo4j, LLM                  |
| --        | worker-entity              | Entity resolution (LLM-assisted).                                                       | Postgres, Redis, Neo4j                       |
| --        | worker-score               | Certainty engine aggregation.                                                           | Postgres, Redis                              |
| --        | worker-dossier             | PDF generation + signing.                                                               | Postgres, IPFS, Vault (YubiKey)              |
| --        | worker-anchor              | Audit chain anchoring to Polygon.                                                       | Postgres, Polygon RPC, Unix socket signer    |
| --        | worker-governance          | Polygon contract event watcher.                                                         | Postgres, Polygon RPC                        |
| --        | worker-extractor           | Field extraction (deterministic + LLM).                                                 | Postgres, Redis, LLM                         |
| --        | worker-conac-sftp          | CONAC delivery.                                                                         | Postgres, SFTP (CONAC)                       |
| --        | worker-counter-evidence    | Adversarial review.                                                                     | Postgres, LLM                                |
| --        | worker-adapter-repair      | Self-healing adapter selector repair.                                                   | Postgres, LLM                                |
| --        | worker-fabric-bridge       | Postgres → Fabric sync.                                                                 | Postgres, Fabric                             |
| --        | worker-federation-agent    | Regional federation push.                                                               | Postgres, gRPC (core federation)             |
| --        | worker-federation-receiver | Core-side federation receive.                                                           | Postgres, gRPC clients                       |
| --        | worker-audit-watch         | Audit anomaly detection.                                                                | Postgres, Redis                              |
| --        | worker-document            | Document fetch + OCR + IPFS.                                                            | HTTP (sources), IPFS, Postgres               |
| --        | worker-minfi-api           | HTTP API for MINFI pre-disbursement scoring.                                            | Postgres, Redis, LLM                         |
| --        | worker-tip-triage          | Tip triage via .onion portal.                                                           | Postgres, Redis, LLM                         |
| --        | worker-satellite           | Satellite imagery analysis (Python).                                                    | Postgres, Redis, STAC/Sentinel Hub, Rasterio |
| --        | worker-image-forensics     | Image forensics (Python).                                                               | Postgres                                     |

**Observability containers (SRD §4.12):**

- `vigil-prometheus` — Metrics scraper.
- `vigil-grafana` — Metrics dashboard.
- `vigil-alertmanager` — Alert routing (Slack, SMTP).
- `vigil-logstash` — Log aggregation.
- `vigil-filebeat` — Host log shipper.
- `vigil-falco` — Runtime security monitoring.
- `vigil-ipfs-cluster` — IPFS cluster coordination.

**Remote node (N02 — Hetzner CPX31 VPS):**

- `adapter-runner` container: Loads `infra/sources.json`, schedules 26+ adapters via node-cron, routes output to Redis stream `vigil:adapter:out` on the core (via WireGuard tunnel).

---

## 5. External Infrastructure Dependencies

Per `.env.example` and SRD §10:

| Service                               | Purpose                                                   | Code invocation                                                                                             | Config                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Polygon RPC (mainnet/testnet)**     | Anchor audit chain, query governance contracts.           | `@vigil/audit-chain` (ethers.js), `worker-governance`, `worker-anchor`.                                     | `POLYGON_RPC_URL`, `POLYGON_RPC_FALLBACK_URLS`, `POLYGON_CHAIN_ID=137`, `POLYGON_ANCHOR_CONTRACT`, `POLYGON_GOVERNANCE_CONTRACT`        |
| **Anthropic API**                     | LLM tier 0 (primary). Claude Opus/Sonnet/Haiku.           | `@vigil/llm` (tier router), `worker-entity`, `worker-extractor`, `worker-score`, `worker-counter-evidence`. | `ANTHROPIC_API_KEY_FILE`, `ANTHROPIC_MODEL_*`, `ANTHROPIC_MAX_RETRIES=3`                                                                |
| **AWS Bedrock**                       | LLM tier 1 (failover).                                    | `@vigil/llm`.                                                                                               | `AWS_BEDROCK_ENABLED`, `AWS_BEDROCK_REGION=eu-west-1`, `AWS_ACCESS_KEY_ID_FILE`, `AWS_SECRET_ACCESS_KEY_FILE`                           |
| **Local LLM (Ollama)**                | LLM tier 2 (degraded mode, held-for-review only).         | `@vigil/llm`.                                                                                               | `LOCAL_LLM_ENABLED=false`, `LOCAL_LLM_BASE_URL=http://host.docker.internal:11434`                                                       |
| **CONAC SFTP**                        | Delivery of escalated findings.                           | `worker-conac-sftp`.                                                                                        | `CONAC_SFTP_HOST` (PLACEHOLDER), `CONAC_SFTP_PORT=22`, `CONAC_SFTP_USER`, `CONAC_SFTP_PRIVATE_KEY_FILE`                                 |
| **MINFI API (pre-disbursement)**      | Risk scoring endpoint (SRD §26).                          | `worker-minfi-api` (exposes HTTP on port 4001).                                                             | `MINFI_API_PORT=4001`, `MINFI_API_RATE_LIMIT_PER_MINUTE=600`                                                                            |
| **MINFI SFTP**                        | Delivery of risk envelopes.                               | `worker-conac-sftp` variant.                                                                                | `MINFI_SFTP_HOST` (PLACEHOLDER)                                                                                                         |
| **Cour des Comptes SFTP**             | Fallback/primary delivery for audit reports.              | Configured in `.env.example`.                                                                               | `COUR_DES_COMPTES_SFTP_HOST` (PLACEHOLDER)                                                                                              |
| **ANIF SFTP**                         | AML/PEP suspicion declaration.                            | `worker-conac-sftp` variant.                                                                                | `ANIF_SFTP_HOST`, `ANIF_ENABLED`, `ANIF_MOU_ACK`                                                                                        |
| **ANIF API**                          | MOU-gated AML screen feed.                                | `adapters` (anif-amlscreen adapter).                                                                        | `ANIF_BASE_URL=https://anif.minfi.cm/api/v2`, `ANIF_API_KEY_FILE`, `ANIF_ENABLED=0`, `ANIF_MOU_ACK=0`                                   |
| **BEAC API**                          | MOU-gated payment feed.                                   | `adapters` (beac adapter).                                                                                  | `BEAC_BASE_URL=https://api.beac.int/payments/v1`, `BEAC_TOKEN_URL`, `BEAC_CLIENT_ID`, `BEAC_CLIENT_SECRET`                              |
| **MINFI BIS API**                     | Budget execution feed.                                    | `adapters` (minfi-bis adapter).                                                                             | `MINFI_BIS_BASE_URL=https://bis.minfi.cm/api/v3`, `MINFI_BIS_ENABLED=0`, `MINFI_BIS_MOU_ACK=0`                                          |
| **OCCRP Aleph**                       | OpenSanctions beneficial-ownership corroboration.         | `adapters` (occrp-aleph adapter).                                                                           | `ALEPH_API_KEY`                                                                                                                         |
| **OpenCorporates**                    | Company registry lookup.                                  | `adapters` (opencorporates adapter).                                                                        | `OPENCORPORATES_API_KEY`                                                                                                                |
| **Keycloak**                          | FIDO2/WebAuthn identity provider.                         | `dashboard` (Next.js middleware), `/packages/security` (verifier).                                          | `KEYCLOAK_URL=http://vigil-keycloak:8080`, `KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE=vigil-dashboard`                                       |
| **Planet NICFI**                      | Satellite imagery (tropical Cameroon, free under MOU).    | `worker-satellite` (Python).                                                                                | `PLANET_API_KEY`, `PLANET_NICFI_CATALOG_URL=https://api.planet.com/basemaps/v1/stac`                                                    |
| **Sentinel Hub**                      | Multi-spectral satellite imagery (Phase-2 scaffold only). | Not yet active.                                                                                             | `SENTINEL_HUB_CLIENT_ID`, `SENTINEL_HUB_CLIENT_SECRET` (commented in .env)                                                              |
| **Microsoft Planetary Computer STAC** | Free Sentinel-2 & Sentinel-1 catalog.                     | `worker-satellite`.                                                                                         | `STAC_CATALOG_URL=https://planetarycomputer.microsoft.com/api/stac/v1`                                                                  |
| **Tor network**                       | Proxy egress (adapter-runner).                            | `adapters` (W-13 proxy rotation).                                                                           | `PROXY_TOR_ENABLED`, `PROXY_TOR_SOCKS_HOST=vigil-tor`, `PROXY_TOR_SOCKS_PORT=9050`, `PROXY_TOR_CONTROL_PORT=9051`                       |
| **Bright Data (proxy)**               | Residential proxy provider.                               | `adapters` (W-13).                                                                                          | `PROXY_BRIGHT_DATA_ENABLED`, `PROXY_BRIGHT_DATA_USERNAME_FILE`, `PROXY_BRIGHT_DATA_PASSWORD_FILE`, `PROXY_BRIGHT_DATA_ZONE=residential` |
| **CapMonster/2Captcha**               | CAPTCHA solving.                                          | `adapters` (captcha interception).                                                                          | `CAPTCHA_PROVIDER=capmonster`, `CAPTCHA_API_KEY_FILE`, `CAPTCHA_MONTHLY_BUDGET_USD=500`                                                 |
| **Sentry**                            | Error & performance monitoring.                           | `dashboard`, workers (optional).                                                                            | `SENTRY_DSN`, `DEPLOY_ENV`, `NEXT_PUBLIC_SENTRY_DSN`                                                                                    |
| **Cloudflare Turnstile**              | CAPTCHA on `/tip` portal.                                 | `dashboard` (tip submission form).                                                                          | `NEXT_PUBLIC_TURNSTILE_SITEKEY`, `TURNSTILE_SECRET_KEY`                                                                                 |
| **Mapbox**                            | Optional tile layer for GIS dashboard.                    | `dashboard`.                                                                                                | `MAPBOX_ACCESS_TOKEN`                                                                                                                   |
| **OpenTelemetry Collector**           | Tracing backend.                                          | `@vigil/observability` (all services).                                                                      | `OTEL_EXPORTER_OTLP_ENDPOINT=http://vigil-otel-collector:4318`, `OTEL_SERVICE_NAME=vigil-apex`                                          |

---

## 6. Cryptographic Dependencies

### 6.1 Core Cryptographic Libraries

| Library                   | Version | Package                           | Purpose                                                           | Status                                     |
| ------------------------- | ------- | --------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| `libsodium-wrappers-sumo` | 0.7.13  | `@vigil/security`                 | Sodium.js bindings (signing, hashing, sealed boxes).              | Audited (AUDIT-089 baseline)               |
| `ethers`                  | 6.13.2  | `@vigil/audit-chain`, `contracts` | Ethereum/Polygon transaction signing, contract ABIs.              | External (OpenZeppelin audited)            |
| `@openzeppelin/contracts` | 5.0.2   | `contracts`                       | Solidity libraries (Governor, TimelockController, AccessControl). | Audited (OpenZeppelin security reports)    |
| `@simplewebauthn/server`  | 11.0.0  | `@vigil/security`                 | WebAuthn/FIDO2 credential verification.                           | Audited (W3C standard implementation)      |
| `@simplewebauthn/types`   | 10.0.0  | `@vigil/security`                 | TypeScript types for WebAuthn.                                    | —                                          |
| `node-vault`              | 0.10.2  | `@vigil/security`                 | HashiCorp Vault client (PKI, transit, KV).                        | Community-maintained; Vault server audited |

### 6.2 Signature & Hashing

Per SRD §20 (anti-hallucination) and §22 (smart contracts):

- **SHA-256:** Used throughout (`audit-chain` hash linkage, document fingerprints).
- **Ed25519:** Used for federation envelope signing (`federation-stream` package, regional agents).
- **ECDSA (secp256k1):** Polygon contract signing (via ethers.js).
- **GPG/OpenPGP:** Dossier signing (YubiKey-backed); see `@vigil/dossier` + `worker-dossier`.

### 6.3 Audited Status

Per `/home/kali/Documents/vigil-apex/AUDIT-REPORT.md` and `/home/kali/Documents/vigil-apex/AUDIT-REPORT-PHASE-1-CLOSEOUT.md`:

- **Libsodium:** External (NaCl/libsodium audited by third parties).
- **Ethers.js:** External (widely used, community-audited). See also `slither-baseline.md` for Solidity contract findings.
- **WebAuthn:** W3C standard; SimpleWebAuthn is reference implementation.

---

## 7. Documentation Index

### 7.1 Architecture & Specification

| File                       | Purpose                                                                                              | Freshness  | Location                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------- |
| `SRD-v3.md`                | Master specification: architecture, data model, governance, crawlers, deployment. **Authoritative**. | 2026-05-02 | `docs/source/SRD-v3.md`                |
| `BUILD-COMPANION-v2.md`    | Operational companion to SRD v3. Build checklists, testing, deployment.                              | 2026-04-28 | `docs/source/BUILD-COMPANION-v2.md`    |
| `AI-SAFETY-DOCTRINE-v1.md` | Anti-hallucination policy, certainty calibration, prompt registry.                                   | 2026-04-29 | `docs/source/AI-SAFETY-DOCTRINE-v1.md` |
| `TAL-PA-DOCTRINE-v1.md`    | Total Action Logging with Public Anchoring (audit-log package).                                      | 2026-04-29 | `docs/source/TAL-PA-DOCTRINE-v1.md`    |
| `HSK-v1.md`                | Hardware security module (YubiKey, Btrfs, LUKS, Vault Shamir).                                       | 2026-04-30 | `docs/source/HSK-v1.md`                |
| `EXEC-v1.md`               | Executive summary.                                                                                   | 2026-04-28 | `docs/source/EXEC-v1.md`               |

### 7.2 Patterns & Rules

| File                                            | Purpose                                                                                                                  | Freshness | Location                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------ |
| `docs/patterns/index.md`                        | 43-pattern catalogue with weights, priors, status. Auto-generated.                                                       | Current   | `docs/patterns/index.md` |
| `docs/patterns/P-A-001.md` through `P-H-003.md` | Individual pattern specs (8 categories: procurement, entity, pricing, GIS, sanctions, circularity, forensics, temporal). | Auto-gen  | `docs/patterns/P-*.md`   |

### 7.3 Decisions & Work Program

| File                                      | Purpose                                                      | Freshness                | Location                |
| ----------------------------------------- | ------------------------------------------------------------ | ------------------------ | ----------------------- |
| `docs/decisions/log.md`                   | Decision log (indexed by DECISION-NNN, AUDIT-NNN, MEMO-NNN). | Current                  | `docs/decisions/log.md` |
| `docs/decisions/DECISION-012-*.md`        | Phase-3 federation decisions.                                | 2026-05-01 to 2026-05-02 | `docs/decisions/`       |
| `docs/work-program/BLOCK-*.md`            | Build block plans (A–E) and completion summaries.            | 2026-04-28 to 2026-05-02 | `docs/work-program/`    |
| `docs/work-program/PHASE-1-COMPLETION.md` | Phase-1 closure sign-off.                                    | Current                  | `docs/work-program/`    |

### 7.4 Runbooks (Operational)

| File                                                                 | Purpose                                                                                                                                                                                                                                                                       | Freshness                | Location                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------- |
| `docs/runbooks/R4-council-rotation.md`                               | Council member rotation.                                                                                                                                                                                                                                                      | 2026-05-01               | `docs/runbooks/R4-council-rotation.md`         |
| `docs/runbooks/R6-dr-rehearsal.md`                                   | Disaster recovery rehearsal.                                                                                                                                                                                                                                                  | 2026-05-02               | `docs/runbooks/R6-dr-rehearsal.md`             |
| `docs/runbooks/R8-k8s-cutover.md`                                    | Kubernetes migration (Phase 2).                                                                                                                                                                                                                                               | 2026-04-28               | `docs/runbooks/R8-k8s-cutover.md`              |
| `docs/runbooks/R9-federation-cutover.md`                             | Federation cutover (Phase 3).                                                                                                                                                                                                                                                 | 2026-04-28               | `docs/runbooks/R9-federation-cutover.md`       |
| `docs/runbooks/R10-federation-key-rotation.md`                       | Federation key rotation.                                                                                                                                                                                                                                                      | 2026-04-28               | `docs/runbooks/R10-federation-key-rotation.md` |
| `docs/runbooks/worker-*.md`                                          | Per-worker operational guides (pattern, entity, score, dossier, anchor, governance, extractor, counter-evidence, adapter-repair, conac-sftp, fabric-bridge, federation-agent, federation-receiver, audit-watch, document, minfi-api, tip-triage, satellite, image-forensics). | 2026-05-01 to 2026-05-02 | `docs/runbooks/worker-*.md`                    |
| `docs/runbooks/{postgres,neo4j,redis,vault,keycloak,ipfs,fabric}.md` | Service operational guides.                                                                                                                                                                                                                                                   | 2026-05-01 to 2026-05-02 | `docs/runbooks/`                               |
| `docs/runbooks/backup.md`, `dependency-rotation.md`                  | Backup and key rotation.                                                                                                                                                                                                                                                      | 2026-05-02               | `docs/runbooks/`                               |

### 7.5 Institutional & Security

| File                                            | Purpose                                                  | Freshness | Location                                        |
| ----------------------------------------------- | -------------------------------------------------------- | --------- | ----------------------------------------------- |
| `docs/institutional/INDEX.md`                   | Governance, council, MOU references.                     | Current   | `docs/institutional/INDEX.md`                   |
| `docs/institutional/conac-engagement-letter.md` | CONAC engagement terms.                                  | Current   | `docs/institutional/conac-engagement-letter.md` |
| `docs/security/threat-coverage-matrix.md`       | Threat model vs. mitigations.                            | Current   | `docs/security/threat-coverage-matrix.md`       |
| `docs/security/slither-baseline.md`             | Slither static analysis baseline for Solidity contracts. | Current   | `docs/security/slither-baseline.md`             |
| `docs/SLOs.md`                                  | Service-level objectives.                                | Current   | `docs/SLOs.md`                                  |

### 7.6 Incident Response

| File                                                | Purpose               | Freshness | Location                                            |
| --------------------------------------------------- | --------------------- | --------- | --------------------------------------------------- |
| `docs/incident-response/architect-incapacitated.md` | Continuity plan.      | Current   | `docs/incident-response/architect-incapacitated.md` |
| `docs/incident-response/council-deadlock.md`        | Deadlock resolution.  | Current   | `docs/incident-response/council-deadlock.md`        |
| `docs/incident-response/finding-leak.md`            | Data breach response. | Current   | `docs/incident-response/finding-leak.md`            |
| `docs/incident-response/polygon-fork.md`            | Chain fork handling.  | Current   | `docs/incident-response/polygon-fork.md`            |
| `docs/incident-response/tip-spam-surge.md`          | Spam mitigation.      | Current   | `docs/incident-response/tip-spam-surge.md`          |

### 7.7 Weaknesses & Gaps

| File                                        | Purpose                                                                                                                                                                | Freshness | Location                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------- |
| `docs/weaknesses/INDEX.md`                  | Master index of 27 known weaknesses.                                                                                                                                   | Current   | `docs/weaknesses/INDEX.md` |
| `docs/weaknesses/W-01.md` through `W-27.md` | Individual weakness analysis (e.g., W-11: hash chain on Postgres, W-13: proxy rotation, W-14: hallucination, W-19: self-healing adapters, W-25: CONAC format adapter). | Current   | `docs/weaknesses/W-*.md`   |

### 7.8 Status Assessment

**Current (≥ 2026-04-29):** All source, SRD, doctrine, and major runbook documentation updated within the last week.  
**Stale (< 2026-04-01):** None identified in active ops docs.  
**Phase-2 Scaffold:** K8s charts, federation playbooks (marked as Phase 3 only).

---

## 8. Summary

VIGIL APEX is a **sovereign anti-corruption forensic platform** for Cameroon with:

- **21 TypeScript packages** + **1 Python package** (py-common).
- **23 TypeScript applications** (dashbdoard, API, audit-bridge, audit-verifier, workers) + **2 Python workers** (satellite, image-forensics).
- **1 smart contract suite** (Polygon mainnet) + **1 Hyperledger Fabric chaincode**.
- **8 infrastructure domains** (docker, systemd, Vault, Kubernetes scaffold, WireGuard, Ansible, observability, certification).
- **8 host-resident services** (Vault unseal, Polygon signer, timekeeper, watchdog, backup, key rotation) + **10+ Docker containers** (Postgres, Neo4j, Redis, IPFS, Fabric, Keycloak, dashboard, workers, observability).
- **26 public data adapters** + **6 fraud-detection pattern categories** (43 patterns total).
- **159 unit/integration tests**, executed by Turbo CI.

The platform is **fully documented**: SRD v3 (authoritative spec), 27 known weaknesses tracked, 43 patterns catalogued, runbooks for every operational service.
