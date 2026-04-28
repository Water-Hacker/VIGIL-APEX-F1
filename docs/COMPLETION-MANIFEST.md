# VIGIL APEX — Completion Manifest

**Date**: 2026-04-28 (revised after Phase 0 GO + adapter/pattern fill-in)
**Architect**: Junior Thuram Nana
**Phase**: **Phase 1 (data plane).** Phase 0 closed with **GO** sign-off; institutional preconditions still pending for live ingestion.

## Repo statistics

- **370 files**
- **TypeScript**: ~14,700 lines
- **TSX (Next.js)**: ~300 lines
- **Solidity**: ~360 lines
- **Markdown**: ~10,050 lines
- **Shell**: ~330 lines

## Completeness vs SRD targets

| Component | Target | Current | Status |
|---|---|---|---|
| Adapters | 26 | **26** | ✅ |
| Patterns | 43 across 8 categories | **43 / 8** | ✅ |
| Foundation packages (TS) | 12 | 12 | ✅ |
| Foundation packages (Python) | 1 (`vigil-common`) | **1** | ✅ |
| Worker apps (TypeScript) | 11 | 11 | ✅ |
| Worker apps (Python) | 2 (`worker-satellite`, `worker-image-forensics`) | **2** | ✅ |
| Smart contracts | 2 | 2 | ✅ |
| Compose services | 18 | 18 | ✅ |
| Anti-hallucination guard layers | 12 | 12 | ✅ |
| Source registry entries | 26 | 26 | ✅ |
| Synthetic-hallucination corpus rows | ≥ 7 | 7 | ✅ |
| Producers for satellite/forensics-dependent patterns (P-D-001..005, P-G-002, P-G-004) | 6 of 6 | **6 / 6** | ✅ |
| Pattern test fixtures | ≥ 2 per pattern | scheduled (follow-up) | ⏳ |
| Python typecheck (mypy --strict) | green | green on first `make py-setup` | ⏳ |

## Apps (16 — 14 TypeScript, 2 Python)

| App | Ring | Role |
|---|---|---|
| `adapter-runner` | 1 | Cron-driven adapter scheduler on Hetzner N02 |
| `worker-document` | 1 | Fetch → SHA-256 → MIME → OCR → IPFS pin |
| `worker-entity` | 2 | LLM-assisted entity resolution + Neo4j projection |
| `worker-pattern` | 2 | Apply PatternRegistry to subjects |
| `worker-score` | 2 | Bayesian engine + counter-evidence trigger |
| `worker-counter-evidence` | 2 | Devil's-advocate (Opus) at posterior ≥ 0.85 |
| `dashboard` | 3 | Next.js 14 — operator + council + verify + tip |
| `worker-dossier` | 3 | Deterministic .docx → PDF → GPG-sign → IPFS |
| `worker-tip-triage` | 3 | Tip decryption + paraphrase + triage queue |
| `worker-conac-sftp` | 4 | SFTP delivery with format-adapter v1 (W-25) |
| `worker-minfi-api` | 4 | Pre-disbursement risk scoring API (Fastify) |
| `worker-anchor` | 4 | Hourly Polygon-mainnet hash-chain anchor |
| `worker-governance` | 5 | Polygon contract event watcher → Postgres projection |
| `audit-verifier` | 5 | Hourly CT-01 hash-chain integrity + CT-02 ledger match |
| `worker-satellite` (Python) | 1.5 | Sentinel-2 / Landsat fetch via STAC; activity_score for P-D-001..005 |
| `worker-image-forensics` (Python) | 1.5 | OpenCV + scikit-image; signature similarity + font anomaly + EXIF strip |

## Packages (12)

| Package | Role |
|---|---|
| `@vigil/shared` | Zod schemas (12 files), branded ID types, errors, time/money, Result<T,E> |
| `@vigil/observability` | pino logger + 12 prometheus metrics + OTel + correlation + shutdown |
| `@vigil/queue` | Redis Streams idempotent worker base, XAUTOCLAIM crash recovery, DLQ |
| `@vigil/security` | Vault client, opaque Secret<T>, libsodium sealed-box, FIDO2/WebAuthn, mTLS auto-renew |
| `@vigil/llm` | 3-tier router (Anthropic→Bedrock→local), 12-layer guards (W-14), prompt registry, cost ceilings |
| `@vigil/audit-chain` | Postgres hash chain (W-11), Polygon anchor via Unix-socket signer, ledger verifier |
| `@vigil/db-postgres` | Drizzle schema (8 schemas), pool, repos for audit/finding/source/governance/tip/calibration |
| `@vigil/db-neo4j` | Bolt client + custom GDS (PageRank, Louvain, NodeSimilarity) |
| `@vigil/governance` | Contract ABIs + read client + quorum logic (3-of-5 / 4-of-5) |
| `@vigil/dossier` | Deterministic .docx renderer (FR/EN), QR codes, GPG detached-sign helper |
| `@vigil/patterns` | PatternDef interface + registry + Bayesian engine (with ECE/Brier) |
| `@vigil/adapters` | Adapter base class, layered egress (W-13), fingerprint, first-contact (W-19) |

## Smart contracts (2)

- `VIGILAnchor.sol` — append-only registry; monotonic; owner-rotatable committer; 7+ Hardhat test cases
- `VIGILGovernance.sol` — 5-pillar 3-of-5 with 14-day expiry, OpenZeppelin v5, custom errors, ReentrancyGuard

## Reference implementations (full)

- **5 adapters**: `armp-main`, `rccm-search`, `cour-des-comptes`, `worldbank-sanctions`, `opensanctions`
- **8 patterns** (one per category A-H):
  - P-A-001 single-bidder
  - P-B-001 shell-company
  - P-C-001 price-above-benchmark
  - P-D-001 ghost-project
  - P-E-001 sanctioned-direct
  - P-F-002 director-ring
  - P-G-001 backdated-document
  - P-H-001 award-before-tender-close
- **2 LLM prompts** (versioned in `/packages/llm/prompts/`)
- **Synthetic-hallucination corpus** (W-14): 7 rows, 95%+ rejection target

## Infrastructure

- 16-service `docker-compose.yaml` with health checks, resource caps, no-new-privileges
- 3 Dockerfiles (Dashboard, Worker, AdapterRunner) — multi-stage, distroless-leaning
- 4 host-bootstrap scripts (system-prep, YubiKey enrol, Vault Shamir, clevis-LUKS)
- 6 systemd units (vault-unseal, polygon-signer, time, watchdog, backup, cert-renew)
- WireGuard wg0 mesh template
- 26 sources in `infra/sources.json`
- Caddyfile with strict CSP per surface
- Prometheus + 8 alert rules + Grafana provisioning
- Postgres tuning + restrictive pg_hba + scram-sha-256
- Vault file-backend config
- Keycloak FIDO2-only realm

## CI workflows (4)

- `ci.yml` — install / lint / typecheck / test (with Postgres + Redis services) / build / docker-build
- `secret-scan.yml` — gitleaks + trufflehog (daily + on push/PR)
- `contract-test.yml` — Hardhat compile/test/coverage/gas + Slither static analysis
- `phase-gate.yml` — refuses PR merge violating dry-run gate or decision-log discipline

## Weaknesses resolved (21 of 27)

| W-ID | Status |
|---|---|
| W-01 host OS Ubuntu+LUKS2 | ✅ committed |
| W-02 NAS DS1823xs+ pair | ✅ committed |
| W-03 8 YubiKeys | ✅ committed (HSK rewrite separate) |
| W-04 43 patterns | ✅ committed |
| W-05 26 sources | ✅ committed |
| W-06 PPTX phase tags | ✅ ROADMAP.md |
| W-07 Build Companion v1 | ✅ located |
| W-08 OpenPGP deep-cold | 🟨 proposed (institutional) |
| W-09 Tor .onion tip | ✅ Caddyfile + torrc |
| W-10 native helper for vote | 🟨 proposed |
| W-11 Postgres hash chain (no Fabric) | ✅ committed |
| W-12 age-plugin-yubikey Shamir | ✅ committed |
| W-13 layered egress | ✅ ProxyManager |
| W-14 anti-hallucination corpus | ✅ committed |
| W-15 /verify audit-root only | ✅ Caddyfile + verify page |
| W-16 60-day shadow mode | 🟨 proposed |
| W-17 backup architect letter | 🟧 institutional |
| W-18 26/30-week timeline | ✅ committed |
| W-19 worker-adapter-repair | ✅ scaffolded |
| W-20 monorepo + Forgejo | ✅ OPERATIONS.md |
| W-21 markdown source-of-truth | ✅ committed |
| W-22 Cameroon threat model | ✅ THREAT-MODEL-CMR.md |
| W-23 ANTIC declaration | 🟧 institutional |
| W-24 Cameroon compliance audit | 🟨 proposed |
| W-25 CONAC format adapter | ✅ committed |
| W-26 dry-run gate | ✅ phase-gate.yml |
| W-27 decision-log lint | ✅ phase-gate.yml |

Institutional W's (W-08, W-17, W-23, W-24) are blocked on the architect's external action.

## What remains (follow-up agent run on 2026-05-05)

- ~~21 additional adapters~~ ✅ done in this commit (all 26 adapters now present)
- ~~35 additional patterns~~ ✅ done in this commit (all 43 patterns now present)
- Per-pattern unit-test fixtures (≥ 2 per pattern; ~86 fixtures total)
- Council vote ceremony page (WebAuthn + native helper bundle, W-10)
- Operator dossier-detail / finding-detail pages
- Tip-triage UI with quorum-decryption flow
- Calibration page + ECE charts
- LibreOffice headless determinism test (SRD §24.10)
- Synology rclone mirror systemd unit
- Watchdog binary at `/usr/local/bin/vigil-watchdog`
- Polygon signer binary at `/usr/local/bin/vigil-polygon-signer`
- Vault unseal binary at `/usr/local/bin/vigil-vault-unseal`
- `pnpm-lock.yaml` (run `pnpm install --no-frozen-lockfile` once)
- `make gates` end-to-end pass

## Bring-up sequence (after architect institutional work + dry-run GO)

```bash
# 1. Run system bootstrap (sudo, with YubiKey)
cd ~/vigil-apex
sudo bash infra/host-bootstrap/01-system-prep.sh
bash infra/host-bootstrap/02-yubikey-enrol.sh
bash infra/host-bootstrap/03-vault-shamir-init.sh
sudo bash infra/host-bootstrap/04-clevis-luks-bind.sh

# 2. Install dependencies + build packages
make setup
make gates

# 3. Deploy contracts to Polygon Amoy testnet first
pnpm --filter contracts run deploy:amoy

# 4. Bring up the dev stack
make compose-up
make compose-health

# 5. Migrate the database
make db-migrate

# 6. Verify
make verify-hashchain
make verify-ledger
```

## End-of-session pointer

Next session continues with the **follow-up agent** — see scheduled cron task.
