# TRUTH.md — Single Source of Truth for VIGIL APEX

This document is the **highest authority** in the documentation pack. It supersedes
any conflict in the original `.docx` files. Every architectural fact appears here
exactly once. The originating section is cited so a reader can reconstruct context
without re-reading 500+ pages.

When this document and a `docs/source/` markdown disagree, **TRUTH wins**. When
TRUTH and an original `.docx` disagree, the `.docx` is to be patched at the next
amendment cycle (per EXEC §43.4).

Last updated: **2026-04-29** by Junior Thuram Nana, Sovereign Architect.

---

## Section A — Mission & Scope

| Fact             | Value                                                                                           | Source                | Status    |
| ---------------- | ----------------------------------------------------------------------------------------------- | --------------------- | --------- |
| Mission          | Real-Time Public Finance Compliance, Governance Monitoring & Intelligence Platform for Cameroon | SRD §01               | committed |
| Phase 1 scope    | MVP pilot, 6 months, single architect, 29 sources                                               | SRD §01.2; MVP §13    | committed |
| Phase 1 budget   | USD $357,028 (excl. Phase-2 reservations of $76K)                                               | MVP §13               | committed |
| Build duration   | **26 weeks nominal / 30 stretch** (re-baselined)                                                | TRUTH (resolves W-18) | committed |
| Public-data-only | All 29 sources are mandated disclosure, open API, or licensed access to public data             | SRD §01.5; MVP §04    | committed |

## Section B — Architecture (Phase 1 MVP)

| Fact                   | Value                                                                                                                                                                                                                                                                                                                                                                             | Source                    | Status     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------- |
| Topology               | 1 host + 1 cloud VPS + 2 NAS (geographically separated)                                                                                                                                                                                                                                                                                                                           | SRD §02; MVP §03          | committed  |
| Host workstation       | MSI Titan 18 HX AI (24-core, 128 GB DDR5, RTX 5090 24 GB)                                                                                                                                                                                                                                                                                                                         | MVP §02.3                 | committed  |
| Host OS                | **Ubuntu Server 24.04 LTS** (resolves W-01)                                                                                                                                                                                                                                                                                                                                       | TRUTH                     | committed  |
| Disk encryption        | **LUKS2 + clevis (Tang on Synology + YubiKey FIDO2)** (resolves W-01)                                                                                                                                                                                                                                                                                                             | TRUTH                     | committed  |
| Cloud VPS              | Hetzner CPX31 (4 vCPU, 8 GB) in Falkenstein DE                                                                                                                                                                                                                                                                                                                                    | MVP §05.1                 | committed  |
| NAS — primary          | Synology DS1823xs+ at primary work site                                                                                                                                                                                                                                                                                                                                           | MVP §02.2 (resolves W-02) | committed  |
| NAS — replica          | Synology DS1823xs+ at remote site, WireGuard-replicated, RPO < 5 min                                                                                                                                                                                                                                                                                                              | MVP §02.2                 | committed  |
| NAS storage            | SHR-2 on 6× HAT5300-8T = ~32 TB usable per unit                                                                                                                                                                                                                                                                                                                                   | MVP §02.2                 | committed  |
| Sentinel monitors      | 3 VPS (Helsinki, Tokyo, NYC), 2-of-3 quorum for outage attestation                                                                                                                                                                                                                                                                                                                | MVP §05.1                 | committed  |
| Container fabric       | Docker Compose v2 on host; 16 containers (8 host + 8 workers/observability); 1 on Hetzner                                                                                                                                                                                                                                                                                         | SRD §03; SRD §04          | committed  |
| Inter-host VPN         | WireGuard mesh (host ↔ Hetzner ↔ NAS-replica)                                                                                                                                                                                                                                                                                                                                     | SRD §02.4; MVP §03        | committed  |
| Permissioned ledger    | **Phase-2 scaffolded** — Postgres `audit.actions` hash chain remains source of truth in MVP; Hyperledger Fabric 2.5 single-peer witness is in tree under `chaincode/audit-witness/` and `apps/worker-fabric-bridge` (Phase-G of the Phase-2 Tech Scaffold). CONAC + Cour des Comptes peers join at Phase-2 entry by extending `crypto-config.yaml` — no rewrite. See Section B.2. | TRUTH (resolves W-11)     | scaffolded |
| Public ledger / anchor | Polygon mainnet via Alchemy RPC                                                                                                                                                                                                                                                                                                                                                   | SRD §22                   | committed  |

### Section B.2 — Audit witness state (Phase-2 scaffold note)

Three independent witnesses now record every audit row:

1. **Postgres `audit.actions`** — application source of truth, hash-linked
   per row. CT-01 walks it hourly via `audit-verifier`.
2. **Polygon mainnet anchors** — Merkle root over a seq range,
   committed by `worker-anchor` every hour. CT-02 reads the latest
   commitment back and matches it to the local chain.
3. **Hyperledger Fabric `audit-witness` chaincode** — commitment-only
   record `(seq, bodyHash, recordedAt)`. Postgres → Fabric replication
   runs through `worker-fabric-bridge`; CT-03 (`make
verify-cross-witness`) compares Postgres ↔ Fabric and reports
   divergence. Single-peer Org1 today; multi-org rollout (CONAC, Cour
   des Comptes) happens at Phase-2 entry by adding peer/org stanzas.
   `audit-witness` does not store the audit-row payload — only the
   commitment — so multi-org peers can endorse without read access to
   operator-only finding text.

The architect commitment that **Postgres remains the source of truth**
is unchanged. Fabric is a parallel cryptographic witness, not a
replacement.

### Section B.3 — Phase-3 federation scaffold (committed 2026-04-28)

The Phase-3 federation architecture is _scaffolded_ in tree but not
_executed_. The following claims are now true at the scaffold level
— meaning the artefacts exist and are reviewable — and become true
at the runtime level on a per-region basis as each cutover ceremony
completes (gated on council 4-of-5 vote + CEMAC funding):

1. **Federated Vault PKI hierarchy.** A Yaoundé root PKI mount
   (`pki/`, ttl=10y) and 10 region-scoped subordinate mounts
   (`pki-region-<lowercase code>/`, ttl=2y) are bootstrapped by
   `infra/host-bootstrap/13-vault-pki-federation.sh`. Cross-region
   issuance is denied at the policy layer
   (`architect-region-pki`).
2. **Signed-envelope federation stream.** The
   `@vigil/federation-stream` package provides an ed25519-signed
   gRPC stream service (`PushEvents`, `HealthBeacon`) defined by
   `proto/federation.proto`. Receiver-side verification enforces
   region-prefix match on the signing-key id, a configurable
   replay window (default forward 60 s, backward 7 d), and a
   per-envelope payload cap (256 KiB).
3. **Multi-site NAS failover chain.** The Yaoundé core pulls each
   regional NAS over WireGuard nightly via
   `infra/host-bootstrap/13-multi-site-replication.sh` into
   `/srv/vigil/region-archive/<CODE>/`, before the existing
   nightly Hetzner archive (10-vigil-backup.sh) sweeps it
   offsite. Pull-based, not push-based, so a compromised regional
   NAS cannot inject blobs into the core archive.
4. **Per-region adapter allocation.** Ten per-region values files
   under `infra/k8s/charts/regional-node/values-<CODE>.yaml`
   pin each region's enabled adapters, signing-key id, NAS host,
   and WireGuard endpoint. The architect's source-coverage
   decision is documented in `docs/PHASE-3-FEDERATION.md` §3 and
   reviewed once a year.
5. **Council architectural-review gate.** The council 4-of-5
   architectural-review brief at
   `docs/institutional/council-phase-3-review.md` documents the
   architecture, cost envelope, rollout order, failure modes,
   rotation cadence, and the explicit "do not approve" criteria
   the council should check before voting.

The architect commitment that **the Yaoundé core remains the
single point of authoritative trust** is unchanged. Phase-3
distributes ingestion, not authority.

The per-region environment keys (`VIGIL_REGION_CODE`,
`VIGIL_SIGNING_KEY_ID`, `FEDERATION_CORE_ENDPOINT`,
`FEDERATION_TLS_*`) live in the Helm values files at
`infra/k8s/charts/regional-node/values-<CODE>.yaml`, not in the
core node's `.env`. Empty values in `.env.example` signal "this
node is acting as the Yaoundé core" (AUDIT-077).

## Section C — Data, Patterns, Intelligence

| Fact                             | Value                                                                                                                                                                                                                                                        | Source                                                     | Status    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------- |
| Source count                     | **29** (20 Cameroonian + 8 international + 1 CEMAC; +3 vs original 26 — `anif-amlscreen` per DECISION-008, plus `minfi-bis` and `beac-payments`. Authoritative list lives in `infra/sources.json`; `scripts/check-source-count.ts` enforces coherence)       | SRD §10 (resolves W-05)                                    | committed |
| Pattern count                    | **43**                                                                                                                                                                                                                                                       | SRD §21; BUILD-V2 §45-52 (resolves W-04)                   | committed |
| Pattern categories               | 8 (A=procurement, B=BO, C=price, D=performance, E=sanctions, F=network, G=document, H=temporal)                                                                                                                                                              | SRD §21.2                                                  | committed |
| Database — authoritative         | PostgreSQL 16 + TimescaleDB + pgvector                                                                                                                                                                                                                       | SRD §07                                                    | committed |
| Database — derived graph         | Neo4j Community 5.18 + custom GDS (PageRank, Louvain, NodeSimilarity)                                                                                                                                                                                        | SRD §08                                                    | committed |
| Cache / streams                  | Redis 7 (RESP + Streams with consumer groups)                                                                                                                                                                                                                | SRD §08.5                                                  | committed |
| Document store                   | IPFS (Kubo 0.27) + Synology rclone mirror hourly                                                                                                                                                                                                             | SRD §14                                                    | committed |
| LLM tier 0                       | Anthropic Claude direct (Opus 4.7 / Sonnet 4.6 / Haiku 4.5). Pricing keyed by exact `model_id` in `infra/llm/pricing.json` (Block-A §2.A.4 / commit `9b4b274`); CI lint `scripts/check-llm-pricing.ts` enforces every default has an entry                   | SRD §18; MVP §06                                           | committed |
| LLM tier 1 failover              | Amazon Bedrock — Claude on AWS. Cost accounting via `aws_bedrock_premium_multiplier` per model in `infra/llm/pricing.json` (Block-A §2.A.5 / commit `2db2271`)                                                                                               | MVP §03.4; SRD §18.3                                       | committed |
| LLM doctrine chokepoint          | All 5 worker LLM call-sites route through `SafeLlmRouter` per DECISION-011 (Block-B A2 / commit `10dac28`). 12-layer AI-SAFETY-DOCTRINE-v1 defences apply uniformly: prompt-version pin, daily canary, call-record audit, schema validation, model_id pinned | DECISION-011                                               | committed |
| Neo4j mirror state               | `entity.canonical.neo4j_mirror_state` column tracks per-row mirror health. Prometheus gauge `vigil_neo4j_mirror_state_total{state}` + alerts `Neo4jMirrorFailedRows` / `Neo4jMirrorPendingBacklog` (Block-A §5.b / commit `3bc1250`)                         | TRUTH                                                      | committed |
| Audit-export salt custody        | `AUDIT_PUBLIC_EXPORT_SALT` per-quarter rotation; Vault path `tal-pa/public-export-salt-q{N}`; architect-only write, adapter-runner read-only. Salt-collision detection via `audit.public_export.salt_fingerprint` view (Block-E follow-up: CI alert)         | DECISION-012 / TAL-PA-DOCTRINE-v1 §5; HSK-v1 §6.3          | committed |
| LLM tier 2 sovereign             | Local Qwen 3.5 / DeepSeek R1 on RTX 5090, "DEGRADED" mode                                                                                                                                                                                                    | MVP §03.4                                                  | committed |
| Posterior threshold (escalation) | 0.85                                                                                                                                                                                                                                                         | SRD §28                                                    | committed |
| ECE target                       | < 5%                                                                                                                                                                                                                                                         | SRD §19.5                                                  | committed |
| Calibration seed minimum         | 30 ground-truth-labelled cases (floor, not ceiling)                                                                                                                                                                                                          | EXEC §20.3 (resolves W-16: 60-day shadow mode supplements) | committed |

## Section D — Governance

| Fact             | Value                                                                         | Source                | Status    |
| ---------------- | ----------------------------------------------------------------------------- | --------------------- | --------- |
| Council size     | 5 pillars                                                                     | SRD §23.2; EXEC §08   | committed |
| Pillars          | governance, judicial, civil-society, audit, technical                         | SRD §23.2; EXEC §08.2 | committed |
| Quorum           | 3-of-5 affirmative (4-of-5 for public release)                                | SRD §23.3; EXEC §17.2 | committed |
| Vote window      | 14 days; auto-archive as inconclusive on expiry                               | SRD §23.4             | committed |
| Vote choices     | YES / NO / ABSTAIN / RECUSE; recusal = abstain for quorum, with reason logged | SRD §23.5             | committed |
| Pillar holders   | 5 named individuals identified before M0c per EXEC §08-14                     | EXEC §08-14           | pending   |
| Backup architect | Named individual with paid retainer, signed letter before M0c                 | TRUTH (resolves W-17) | pending   |

## Section E — Hardware Security Keys

| Fact                    | Value                                                                                                                                 | Source                     | Status                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------- |
| YubiKey count           | **8**                                                                                                                                 | EXEC §04.1 (resolves W-03) | committed                                             |
| Allocation              | 5 council pillars + 1 architect primary + 1 polygon-signer + 1 spare                                                                  | EXEC §04.1                 | committed                                             |
| Model                   | YubiKey 5 NFC (council, architect, spare); 5C NFC (polygon-signer)                                                                    | EXEC §04.2                 | committed                                             |
| Deep-cold backup        | **9th YubiKey holding identical OpenPGP master key, sealed in off-jurisdiction safe deposit box**                                     | TRUTH (resolves W-08)      | institutional gate (city + box selection — architect) |
| Vault unseal            | Shamir 3-of-5; shares stored via `age-plugin-yubikey` to PIV slot 9d (NOT challenge-response)                                         | TRUTH (resolves W-12)      | committed                                             |
| Polygon wallet recovery | Shamir 3-of-5 of seed phrase, identical share distribution to Vault                                                                   | HSK §4.7; SRD §17.6        | committed                                             |
| Boot unlock             | LUKS2 master key wrapped by clevis (Tang + YubiKey FIDO2 dual factor)                                                                 | SRD §17.5                  | committed                                             |
| Council vote signing    | Native desktop helper (libykcs11 + secp256k1) deferred to M3-M4; WebAuthn fallback live + assertion verifier wired (DECISION-008 C5b) | TRUTH (resolves W-10)      | partial — fallback shipped; native helper M3-M4       |
| OpenPGP key for CONAC   | Generated on-card; subkey transferred between primary YubiKey + spare + deep-cold                                                     | HSK §5.6                   | committed                                             |

## Section F — Hosting / Network / Domains

| Fact                         | Value                                                                                                               | Source                | Status    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------- | --------- |
| Operational domain           | `vigilapex.cm` (or fallback `vigilapex.org` if .cm unobtainable)                                                    | EXEC §06.1; MVP §05.2 | committed |
| Subdomains                   | `verify.`, `tip.`, `kc.`, `api.`                                                                                    | EXEC §06.1            | committed |
| Tip portal Tor presence      | **`.onion` v3 hidden service** (`infra/docker/tor/torrc`, `infra/docker/adapter-runner/torrc`); PoW + obfs4 enabled | TRUTH (resolves W-09) | committed |
| Registrar                    | Gandi (France) — strong privacy track record                                                                        | EXEC §06.2            | committed |
| DNS hosting                  | Cloudflare free tier with DNSSEC                                                                                    | EXEC §06.3            | committed |
| CAA records                  | `0 issue "letsencrypt.org"` only                                                                                    | EXEC §06.4            | committed |
| Operational email            | ProtonMail or self-hosted Postfix on N02; never Gmail                                                               | EXEC §06.5            | committed |
| MFA on all critical accounts | Hardware-key only; no SMS, no telephone reset                                                                       | EXEC §06.4            | committed |

## Section G — Delivery & Integration

| Fact                | Value                                                                                                                                                                                                                                                           | Source                | Status                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------- |
| CONAC delivery      | SFTP with manifest schema; **format adapter layer** to allow post-engagement schema change                                                                                                                                                                      | TRUTH (resolves W-25) | committed                                          |
| Plan B recipient    | Cour des Comptes (if CONAC declines or non-responds); per-finding routing via `recipient_body_name` lands per DECISION-010                                                                                                                                      | TRUTH (resolves W-25) | committed (code) — engagement-letter institutional |
| MINFI integration   | Pre-disbursement risk-scoring API; informs not blocks; idempotent on `request_id`                                                                                                                                                                               | SRD §26               | committed                                          |
| Bilingual outputs   | FR + EN PDFs; FR primary, EN automatic                                                                                                                                                                                                                          | SRD §24; SRD §26.10   | committed                                          |
| Public verification | `/verify` publishes audit-chain root + escalation metadata only; **never entity names without 4-of-5 council vote** (entity-name-free verified in `apps/dashboard/src/lib/verify.server.ts`; operator-only `/api/findings/[id]` has belt-and-braces role check) | TRUTH (resolves W-15) | committed                                          |
| Tip ingestion       | Single channel only — `/tip` (clearnet + .onion); rate-limited; client-side encrypted; council-quorum decryption                                                                                                                                                | SRD §28               | committed                                          |

## Section H — Compliance & Legal

| Fact                              | Value                                                                                      | Source                | Status    |
| --------------------------------- | ------------------------------------------------------------------------------------------ | --------------------- | --------- |
| Corporate entity                  | VIGIL APEX SAS, registered under Cameroon Startup Act                                      | MVP §09; EXEC §16.4   | committed |
| Cameroonian regulator declaration | **ANTIC declaration under Loi N° 2010/021** before Phase 1 ingestion of personal data      | TRUTH (resolves W-23) | pending   |
| GDPR scope                        | EU-aid-tracking sub-pipeline only — NOT general system                                     | TRUTH (resolves W-24) | committed |
| Cameroon compliance audit         | Loi 2010/012 + OHADA UBO disclosure rights review (replaces blanket "GDPR audit")          | TRUTH (resolves W-24) | committed |
| Defamation discipline             | No public publication of allegations against named individuals without 4-of-5 council vote | EXEC §16.3; SRD §28.3 | committed |
| Whistleblower content rule        | Tip text paraphrased before delivery; raw text never transmitted to recipient              | EXEC §18.2            | committed |

## Section I — Tech Stack

| Layer                                              | Choice                                                   | Source         | Status    |
| -------------------------------------------------- | -------------------------------------------------------- | -------------- | --------- |
| Runtime                                            | Node 20 LTS                                              | BUILD-V1 §02   | committed |
| Package manager                                    | pnpm 9.7+                                                | BUILD-V1 §02   | committed |
| Build orchestration                                | Turborepo (turbo.json)                                   | BUILD-V1 §01.2 | committed |
| Language                                           | TypeScript strict + Zod schemas                          | BUILD-V1 §01.2 | committed |
| ORM                                                | Drizzle (TypeScript-first; SQL generated)                | BUILD-V1 §01.2 | committed |
| Frontend                                           | Next.js 14 + Socket.io + D3 + Mapbox GL                  | MVP §03.2      | committed |
| Crawler                                            | Playwright Chromium (FR site compatibility)              | SRD §05.5      | committed |
| API gateway                                        | Kong Gateway 3.x                                         | MVP §03.2      | committed |
| Auth                                               | Keycloak 23 (FIDO2/WebAuthn only — no passwords)         | SRD §17.9      | committed |
| Secrets                                            | HashiCorp Vault 1.16 (Shamir 3-of-5)                     | SRD §17.6      | committed |
| Observability                                      | Prometheus + Grafana + Falco                             | SRD §03        | committed |
| Container repo                                     | Docker Compose v2; Kubernetes deferred to Phase 2        | SRD §03.4      | committed |
| Smart contracts                                    | Solidity ^0.8.x via Hardhat; deployed to Polygon mainnet | SRD §22        | committed |
| EV signing for Windows binaries delivered to CONAC | DigiCert / Sectigo                                       | MVP §08        | committed |
| Document conversion                                | docx-js + LibreOffice headless (deterministic PDF)       | SRD §24.9      | committed |

## Section J — Build Phases (re-baselined per W-18)

| Milestone                                  | Weeks (nominal) | Weeks (stretch) | Gate                                                                                |
| ------------------------------------------ | --------------- | --------------- | ----------------------------------------------------------------------------------- |
| M0a — Mobilisation Tranche 1 (signature)   | 0               | 0               | Contract signed                                                                     |
| M0b — Mobilisation Tranche 2 (M0 verified) | 0–2             | 0–2             | All M0 deliverables verified by reviewer                                            |
| **M0c — Cold start**                       | 1–3             | 1–4             | YubiKeys delivered; 8 containers + host services healthy                            |
| **M1 — Data plane**                        | 4–8             | 5–9             | 26 adapters live; ER ≥ 90% on validation set                                        |
| **M2 — Intelligence plane**                | 9–14            | 10–15           | 43 patterns, ECE < 5%, 50 findings in 7 days                                        |
| **M3 — Delivery plane**                    | 15–20           | 16–21           | Polygon contracts deployed; CONAC SFTP live; Tor /tip live; council portal complete |
| **M4 — Council standup**                   | 21–23           | 22–24           | 5 YubiKeys provisioned to pillars; first dry-run vote on testnet                    |
| **M5 — Hardening**                         | 24–25           | 25–26           | Pentest critical findings = 0; DR restore < 6h                                      |
| **M6 — Public launch**                     | 26              | 27–30           | Polygon mainnet cutover; first real escalation                                      |

(Original SRD §29 timeline was 24 weeks; re-baselined +2 nominal / +6 stretch to absorb
YubiKey customs delay and ~50% council-candidate decline rate.)

## Section K — Document Archive Integrity

SHA-256 of binding documents (recorded 2026-04-28):

```
70d1a86a... CORE_BUILD_COMPANION_v1.docx
7e9e5cbe... CORE_BUILD_COMPANION_v2.docx
22c260f8... CORE_EXEC_v1.docx
58868ff1... CORE_HSK_v1.docx
105f90a9... CORE_SRD_v3.docx
73c23315... MVP_SERVER.docx
25c19ac4... RTPFC_Governance_Intelligence_Platform.pptx
```

Any change to these files MUST trigger a new SHA-256 entry plus a decision-log
entry. The audit chain (once Phase 1 ships) anchors each cut to Polygon.

## Section L — Open Questions (non-architectural; tracked in decisions)

These are questions the architect has not yet answered. They are tracked here so
no agent or future-self forgets them:

1. **Council pillar names** — none of the 5 are named yet (per EXEC §38 first-20-decisions, items #11-15).
2. **Backup architect identity** — required before M0c per W-17 fix.
3. **Hosting choice between Hetzner Falkenstein vs OVH Strasbourg** — both EU; pick one in [`docs/decisions/log.md`](docs/decisions/log.md) DECISION-001.
4. **Operational domain** — `vigil.gov.cm` (requires CONAC liaison, slow) vs `vigilapex.cm` (fast). MVP §05.2 chose `vigilapex.cm`; SRD §06.1 chose `vigil.gov.cm`. **TRUTH currently assumes `vigilapex.cm`** until a CONAC subdomain commitment exists.
5. **Off-jurisdiction safe-deposit box for deep-cold OpenPGP** — Geneva, Lisbon, or Zurich? Decide before M0c.
6. **Format-adapter Plan B target** — Cour des Comptes is the recommended fallback; SOW counter-signature pending.
