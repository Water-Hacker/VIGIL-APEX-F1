REPUBLIQUE DU CAMEROUN - REPUBLIC OF CAMEROON
Paix - Travail - Patrie
VIGIL APEX
SOLUTION REQUIREMENTS DOCUMENT
Master Edition v3.0
Single complete specification - all topics, no companion required
PHASE 1 PILOT - STATE PROCUREMENT INTEGRITY MONITORING

What this document is
The complete and binding specification for the VIGIL APEX MVP build.
Architecture, infrastructure, data, intelligence, governance,
authentication, smart contracts, frontend, integrations - all here.
v3.0 supersedes v1.0 and v2.0 in their entirety.

Junior Thuram Nana
Sovereign Architect - VIGIL APEX SAS
Version 3.0 | April 2026

### 0.1 Audience

This document is written for a development team building VIGIL APEX from zero to running pilot in 24 weeks. The reader is assumed to be a competent senior engineer fluent in Linux, Docker, TypeScript, PostgreSQL, and basic web scraping. The reader is NOT assumed to know the Cameroonian institutional landscape, the sovereign-tech rationale, or the prior versions of this design - those are explained where needed.

### 0.2 Companion documents

This Build Pack v2.0 supersedes the v1.0 SRD on every operational topic. Where a section here contradicts v1.0, this document wins. The v1.0 document remains authoritative for material not covered here: the LLM tier routing logic (v1.0 Section 12), the Bayesian certainty engine math (v1.0 Section 13), the smart contract interfaces (v1.0 Section 16), the Five-Pillar governance principle (v1.0 Section 15). The v5.1 Investment Proposal remains the binding commercial instrument.

### 0.3 Document structure

### 0.4 Notation

MUST and SHALL: mandatory. SHOULD: strong default; deviation requires architect approval. MAY: implementation choice. N01-N10: node IDs, where N01 is the host workstation (MSI Titan), N02 is the Hetzner CPX31 VPS, N03-N10 are Docker containers on the host. Filenames are absolute paths from the repo root. Code blocks show actual file contents to be checked into the repository.

### 0.5 How to use this document during the build

Open this document in a window beside your editor. Cross-reference section numbers in commit messages (e.g. 'feat(adapter-armp): implement scheduling per Section 11.3'). When you encounter a gap, file an amendment request with the architect rather than improvising; the gap is written down, reviewed, and added to v2.1. Treat the URLs in Section 10 as authoritative as of April 2026 - re-verify every URL on first contact and report changes.

### 1.1 In one paragraph

VIGIL APEX continuously crawls Cameroonian government websites that publish procurement and budget data, fuses scattered identity records into coherent entity graphs, applies fraud-detection patterns to those graphs, scores each finding for certainty, anchors the evidence chain to a permissioned ledger and the Polygon public blockchain, generates bilingual investigative dossiers, and routes them to CONAC and MINFI under a five-institution governance protocol that requires multi-party consent before escalation. All data ingested is publicly disclosed by the source institutions; no private data is touched.

### 1.2 The pilot vs the full system

This document specifies the Phase-1 PILOT. The pilot demonstrates the full pipeline end-to-end on a constrained set of 26 public sources, with one host workstation plus one cloud VPS, with the five-pillar council operating in a supervised mode, with manual escalation review. The full system (Phase 2) will scale to additional regional and continental sources, multi-org Hyperledger Fabric, automated MOU-gated escalation, and integration with court systems. This document does NOT specify Phase 2 work.

### 1.3 What we crawl, in plain terms

We crawl: ARMP (the procurement regulator), MINMAP (the procurement ministry itself), the COLEPS e-procurement platform, MINFI and its directorates (Budget DGB, Treasury DGTCFM, Tax DGI, Customs DGD), MINEPAT (investment budget BIP), the Journal Officiel, the Cour des Comptes audit reports, six sectoral ministries that hold the largest procurement budgets (MINTP, MINEE, MINSANTE, MINEDUB, MINESEC, MINHDU), the RCCM commercial registry, and a small set of international sources (OpenSanctions, Aleph, OpenCorporates, World Bank) that corroborate beneficial-ownership and PEP signals. Section 10 lists each source with URL, format, polling cadence, and owner.

### 1.4 What we produce, in plain terms

For every detected pattern instance, we produce: a Finding record in PostgreSQL, a hash-anchored evidence bundle in IPFS, a Fabric ledger entry, a Polygon mainnet transaction (for escalated findings only), and a bilingual French/English PDF dossier. Dossiers are routed to CONAC by SFTP (when a finding warrants investigation) and to MINFI by API (when a finding indicates a payment should be flagged for pre-disbursement review). The public dashboard at vigilapex.cm exposes anonymised aggregates and the verifiable ledger root.

### 1.5 What we do NOT do

We do not access private data. We do not intercept communications. We do not perform any action requiring a warrant. We do not issue legal findings - our outputs are evidence packets routed to authorities with lawful jurisdiction. We do not block payments - the MINFI scoring API advises, it does not block. We do not make autonomous decisions - every escalation requires documented human consent recorded on the ledger.

### 2.1 The principle, restated

In conventional architectures the operator's laptop is a control terminal that SSHes into a fully containerised system. In VIGIL APEX it is not. The MSI Titan workstation is itself Node 01, the primary node, running services that cannot be safely containerised: the Anthropic API session, the Polygon transaction signer (hardware-backed), the Vault unseal coordinator, and the master timekeeper. Nodes N03 through N10 are subordinate Docker containers running ON the host. N02 is a remote container on a cloud VPS used as a network DMZ. The boundary between 'the operator' and 'the system' is deliberately small.

### 2.2 The hardware inventory

### 2.3 Operating system layout

The host runs Ubuntu Server 24.04 LTS, kernel 6.8 or newer. Btrfs root filesystem with subvolume layout permits snapshot-based pre-deploy backups. LUKS2 full-disk encryption on both NVMe drives, with the master key escrowed across two of three YubiKeys (clevis-pin policy: tang server on Synology + YubiKey FIDO2). The host CANNOT boot without at least one YubiKey present and a valid PIN.

#### 2.3.1 Filesystem layout (Btrfs subvolumes)

### 2.4 Processes that run directly on the host (not in containers)

#### 2.4.1 systemd unit example - vigil-vault-unseal.service

#### 2.4.2 systemd unit example - vigil-polygon-signer.service

### 2.5 Why these services live on the host and not in containers

### 2.6 Boot sequence

On power-on, the boot sequence is: (1) BIOS, (2) GRUB, (3) initramfs prompts for LUKS unlock - architect inserts YubiKey and enters PIN, (4) kernel boots, (5) systemd starts; the dependency chain runs WireGuard before Docker, runs vigil-vault-unseal before any container starts (containers depend on Vault), runs vigil-polygon-signer in parallel with Docker, runs vigil-time before any container is allowed to start. Docker itself starts the 8 host-resident containers (N03-N10) using docker-compose. After all containers are healthy, vigil-claude-session is brought up by the architect's interactive login. Total boot time from power-on to fully operational: approximately 4 minutes including unlock prompts.

### 2.7 What the operator does at the host

Daily: review the dashboard alert channel. Weekly: review the dead-letter queue, review entity-resolution review-band cases (with the seconded analyst), review high-certainty findings before they enter quorum. Monthly: rotate API keys via Vault, run the DR drill, review cost report. Ad-hoc: respond to incident alerts, sign off on dossier escalations after quorum. The operator is the institutional voice of the system; their role is REVIEW and AUTHORITY, not data entry.

### 3.1 The simulation principle

Nodes N03 through N10 are logical service boundaries. In production-Phase-2 they may run on separate physical hosts. In Phase-1 pilot they run as Docker containers on the same host (N01). Each container gets its own network namespace, its own filesystem (read-only image + writable volumes), its own resource limits, and its own health probe. The containers do NOT share processes; they communicate ONLY through documented interfaces: PostgreSQL wire protocol, Redis RESP, Neo4j Bolt, Fabric gRPC, IPFS HTTP, Vault HTTPS, Keycloak OIDC.

### 3.2 Network model

Two Docker networks are defined: vigil-internal (the data plane, all 8 containers attached) and vigil-edge (only the dashboard reverse proxy attached, plus port forwarding from the host). vigil-internal has internal: true - it is not routable from the host or the public network. The dashboard container has interfaces on both networks; it is the only path between them. The Hetzner VPS (N02) connects to the data plane via the WireGuard tunnel terminated on the host, then bridged into vigil-internal via a dedicated route.

#### 3.2.1 Network IP plan

### 3.3 Why containers and not bare-metal services on N01?

Three reasons. (1) Resource isolation: PostgreSQL's page cache, Neo4j's heap, and Redis's RDB rewrite all want to grab as much memory as they can; containers enforce hard caps. (2) Lifecycle isolation: when we restart Neo4j we don't risk taking down PostgreSQL or unwanted side effects on the host. (3) Reproducibility: every developer can replicate the production environment on their own machine using the same compose file. The cost is negligible (Linux container overhead is under 1%).

### 3.4 Why not Kubernetes?

Kubernetes adds operational complexity inappropriate for a single-architect MVP. The control plane (API server, etcd, scheduler, controller-manager) consumes RAM and engineering attention better spent elsewhere. docker-compose meets every requirement of the Phase-1 pilot: declarative, reproducible, version-controlled, healthcheck-aware, restart-policy-aware. Phase-2 may revisit Kubernetes when we move to multi-host. Until then, this is YAGNI.

### 3.5 Resource caps on each container

Every container has a memory cap (deploy.resources.limits.memory) and a CPU cap (deploy.resources.limits.cpus). Caps are enforced by Docker via cgroups v2. The sum of caps is below the host's physical capacity to prevent the OOM killer from stalking critical containers.

### 3.6 Container restart policy

All long-running containers use restart: unless-stopped. On crash, Docker restarts up to 5 times within 60 seconds, then waits 30 seconds and tries again. If a container fails to recover after 3 restart cycles, the watchdog timer raises a P1 alert and pages the architect. One-shot init containers (described per-service in Section 6) use restart: no.

### 3.7 Container healthcheck contract

Every long-running container declares a healthcheck in compose. Healthchecks are deliberately conservative: they probe a service's primary dataplane endpoint (PostgreSQL: SELECT 1; Neo4j: MATCH (n) RETURN count(n) LIMIT 1; Redis: PING; IPFS: GET /api/v0/version) rather than just verifying the process is alive. A container with a TCP socket open but a deadlocked database is unhealthy, not healthy. Healthcheck intervals: 30s for stable services, 15s for workers (which we want to recover faster on consumer-group stalls).

### 3.8 Volume strategy

Bind mounts (NOT named volumes) are used for stateful services. Bind mount paths under /srv/vigil/ are explicitly versioned and Btrfs-snapshotted hourly. Named volumes are used ONLY for transient caches (npm cache, build caches). The reason for bind mounts: they are inspectable from the host, they are includable in snapshots without Docker cooperation, and they survive Docker daemon corruption.

### 3.9 Time synchronisation

Containers do NOT run their own NTP. Instead, the host's chronyd serves as authoritative time, and each container's /etc/localtime is bind-mounted from the host. This is critical for evidence-chain timestamps: a finding created on a container with skewed clock would have an evidence chain whose timestamps disagree with the audit log. By tying all containers to the host clock, we eliminate one class of reconciliation bug.

### 3.10 Security scoping

Containers run as a non-root user inside the container (UID 1000 typically) wherever the upstream image permits. Capabilities are dropped to the minimum required: cap_drop: ALL with a small cap_add list per service (e.g. NET_BIND_SERVICE for the dashboard if binding port 80 inside the container). seccomp uses the Docker default profile. AppArmor profile per container in Phase-2; in Phase-1 pilot we rely on the default Docker AppArmor profile.

### 4.1 File location

Lives at /infra/docker/docker-compose.yaml. Versioned with the rest of the repository. Per-environment overrides (development vs production) live in docker-compose.dev.yaml and docker-compose.prod.yaml respectively, applied with the -f flag.

### 4.2 Top of file: version, networks, volumes, secrets

### 4.3 Service block: vigil-postgres (N03)

### 4.4 Service block: vigil-neo4j (N04)

### 4.5 Service block: vigil-redis (N05)

### 4.6 Service block: vigil-ipfs (N06)

### 4.7 Service block: vigil-fabric (N07)

### 4.8 Service block: vigil-vault (N08)

### 4.9 Service block: vigil-keycloak (N09)

### 4.10 Service block: vigil-dashboard (N10)

### 4.11 Worker services

Each worker is a separate service in the compose file. They are nearly identical in shape, differing only in image name, environment variables, and resource caps. Below is one example (worker-pattern); the others (worker-entity, worker-score, worker-dossier, worker-anchor, worker-governance) follow the same template.

### 4.12 Observability services

### 5.1 Where they live

All Dockerfiles live under /infra/docker/dockerfiles/. They are referenced by build.dockerfile in compose. Base images are pinned to digest in the production compose override (development uses tag for ergonomics). All build images use a multi-stage build: a deps stage installs build-time dependencies, a builder stage compiles, and a runtime stage that takes only the compiled output and runtime dependencies.

### 5.2 Common base: Dashboard.Dockerfile

### 5.3 Worker.Dockerfile (template, used by all six workers)

### 5.4 AdapterRunner.Dockerfile (used on N02 Hetzner)

### 5.5 Why Playwright on the adapter image and not Puppeteer?

Playwright handles French government sites better in our experience: better Chromium auto-wait semantics, better network interception for capturing PDF links rendered after JS execution, and a richer record/replay tooling for debugging when ARMP changes its DOM. The trade is image size (around 350MB extra). Acceptable on a 80GB Hetzner disk.

### 5.6 Build and tag conventions

### 5.7 CI build (.github/workflows/build.yaml)

### 6.1 Pre-flight checklist

Before running anything, the architect confirms: the host workstation is on UPS power; the YubiKey is inserted and unlocked; the Synology NAS is reachable at 10.99.0.10 over the management VLAN; the Hetzner CPX31 instance is reachable; the WireGuard private keys are accessible from the YubiKey; the .env file exists at /infra/docker/.env (template provided in /infra/docker/.env.example); the LUKS volumes /srv/vigil and /var/lib/docker are unlocked and mounted.

### 6.2 First-time bring-up (M0c week 1)

### 6.3 Daily start (after a clean shutdown)

### 6.4 Stopping (planned shutdown for hardware maintenance)

### 6.5 N02 (Hetzner) bring-up

### 6.6 Health verification after bring-up

### 7.1 Where this DDL lives

All migrations are managed by Drizzle ORM. The TypeScript schema definitions in /packages/db-postgres/schema/ generate SQL via 'drizzle-kit generate'; the SQL is checked into /packages/db-postgres/migrations/. Below is the canonical DDL after all migrations through M2 are applied. Migrations are forward-only; we never edit a committed migration. To roll back: write a new migration that undoes.

### 7.2 Bootstrap (000-bootstrap.sql)

### 7.3 Schema source

### 7.4 Schema entity

### 7.5 Schema finding

### 7.6 Schema dossier and governance

### 7.7 Schema audit (hash-chained, tamper-evident)

### 8.1 Neo4j role

Neo4j is a derived view, not a system of record. PostgreSQL is authoritative; Neo4j is rebuilt from PostgreSQL by the rehydration runbook. Neo4j exists because graph traversals (director-sharing rings, beneficial-owner chains) are inefficient in SQL and natural in Cypher.

### 8.2 Constraints and indexes

### 8.3 Sample Cypher patterns workers run

### 8.4 Custom GDS implementations (substitute for Enterprise GDS)

v5.1 substituted Neo4j Community Edition for AuraDB Business Critical, removing access to the official GDS library. We implement what we need in TypeScript via Cypher calls. The three algorithms required: PageRank (entity centrality), Louvain (community detection), Node Similarity (fuzzy duplicate finding). All three live in /packages/db-neo4j/gds/. They are tested against synthetic graphs of 100k, 500k, 1M, and 2M nodes; the 2M target satisfies the MVP node-count budget.

### 8.5 Redis streams

### 8.6 Stream consumer group setup

### 8.7 Cross-store consistency rules

### 9.1 PostgreSQL: postgresql.conf (excerpt of non-default values)

### 9.2 PostgreSQL: pg_hba.conf

### 9.3 Vault: config.hcl

### 9.4 Caddy reverse proxy (on N02)

### 10.1 Why this matters

VIGIL APEX uses ONLY public data. Every source listed below publishes its data either by legal mandate (procurement disclosures, gazette publications) or by institutional choice (open registries, sectoral reports). No source requires authentication beyond standard captcha solving. We crawl on schedule, respect documented rate limits, identify ourselves clearly via User-Agent, and never bypass authentication that protects private data. The legal basis is Cameroon's procurement transparency obligations and the Open Government Data principle endorsed by the Republic.

### 10.2 Source catalogue (29 sources)

> **Erratum (AUDIT-072):** TRUTH.md §C records the canonical source count as **27** (14 Cameroonian + 13 international). The +1 vs the "26" stated here is `anif-amlscreen`, added per DECISION-008 (MOU-gated AML feed). Treat TRUTH.md §C as the authoritative count; this section is preserved at "26" for historical traceability of the original SRD draft. Future SRD revisions should use the TRUTH count.

#### 10.2.1 Procurement core (the heart of the pilot)

#### 10.2.2 Finance and budget core

#### 10.2.3 Sectoral ministries (largest procurement budgets)

#### 10.2.4 Registries and audit institutions

#### 10.2.5 International corroboration

### 10.3 Source ownership and contact

For each Cameroonian source, the adapter records the owning ministry, the human contact (where listed publicly), and any rate-limit signal published by the source. This is captured in /infra/sources.json and reviewed quarterly. When a source moves URL or changes format, the adapter raises an alert; the architect updates /infra/sources.json and the adapter resumes.

### 10.4 Robots.txt and terms-of-service

On first contact with each source, the adapter fetches /robots.txt and saves a copy to source.documents with a special doc_kind='robots'. We honour Disallow directives. Where a source's terms of service specify a User-Agent, we use it. We identify ourselves as 'VIGIL APEX (anti-corruption pilot, Cameroon) - vigilapex.cm/contact'. We do not impersonate other crawlers (no fake Googlebot).

### 10.5 When a source goes offline

Downtime is normal for some Cameroonian government sites. Our adapters tolerate it with exponential backoff. Persistent downtime (over 7 days for a critical source like MINMAP or ARMP) raises a P1 alert. The architect makes contact via official channels; while waiting, we fall back to: (a) cached data, (b) Internet Archive Wayback Machine snapshots (using the IA Save API to ensure we have a snapshot to refer to), (c) PDF mirrors held by partner institutions.

### 11.1 Where crawlers run

All 26 crawlers run on N02 (the Hetzner CPX31 VPS) inside the adapter-runner container. They do NOT run on the host workstation. Reason: crawlers make outbound HTTP to government sites, sometimes in volume. Routing that traffic through the host's WireGuard tunnel and out via the architect's home ISP would be slow, would expose the architect's residential IP to government access logs, and would compete for bandwidth with the architect's interactive work. Hetzner egress is fast, well-known, and isolated.

### 11.2 Adapter base class (TypeScript)

### 11.3 Scheduling

The adapter-runner reads /infra/sources.json on startup, loads the registered Adapter classes, and schedules each according to its cron expression. Cron is evaluated in Africa/Douala timezone. The runner uses node-cron for scheduling and BullMQ-style delayed jobs for retries. Schedule overlap protection: if a previous run is still in flight when the next slot fires, the new slot is skipped (logged) rather than queued.

### 11.4 Retry policy

### 11.5 Idempotency at the adapter level

Every event the adapter emits has a deterministic dedup_key. If the same source page is re-fetched (because of a retry, or because the cron tick fires earlier than expected), the resulting event must have the same dedup_key as before. The PostgreSQL constraint events_dedup_unique then prevents duplicate ingestion at the database level. This is belt-and-braces: dedup at emission, dedup at insert.

### 12.1 How to read these

Each entry below is a self-contained crawler specification. A developer reads the entry, checks the URL is still live, and writes the adapter class to match. If something on the live site contradicts the spec below, the developer files an amendment request, the architect updates this section, and only THEN does the developer code to the new spec.

### 12.2 minmap-portal (crawler #1)

### 12.3 armp-main (crawler #3)

### 12.4 coleps-tenders (crawler #4)

### 12.5 minfi-portal (crawler #6)

### 12.6 dgb-budget (crawler #7)

### 12.7 dgtcfm-treasury (crawler #8) and dgtcfm-bons (crawler #9)

### 12.8 minepat-bip (crawler #10)

### 12.9 Sectoral ministries (crawlers #11 through #16) - shared template

### 12.10 rccm-search (crawler #17)

### 12.11 courdescomptes-reports (crawler #18)

### 12.12 jo-gazette (crawler #19)

### 12.13 anif-pep (crawler #20)

### 12.14 International corroboration crawlers (#21-26)

### 13.1 The threat model

Cameroonian government sites generally have light bot protection (rate limits, occasional Cloudflare challenge). However, behaviour that overwhelms a small site OR that pattern-matches as 'foreign datacenter' can trigger temporary blocks. Some sites (RCCM regional portals, COLEPS during high-traffic periods) deploy more aggressive Cloudflare challenges including hCaptcha. International sources have stricter protection: OpenCorporates, OpenSanctions, and Aleph all have well-defined API rate limits which we always honour. Strategy: respect rate limits, identify ourselves clearly, rotate identity surface (IP, User-Agent, fingerprint) just enough to avoid stale-session blocks, and use captcha solvers when challenged.

### 13.2 Proxy provider stack

### 13.3 Rotation rules

### 13.4 User-Agent strategy

We do NOT impersonate browsers we are not. We use Playwright's actual Chromium User-Agent string (matching the version we ship). For non-browser direct requests (JSON APIs), we use a clear identifier: 'VIGIL-APEX/1.0 (anti-corruption pilot, +https://vigilapex.cm/contact)'. This is honest. It also gives sources a way to contact us if they want to discuss our crawling.

### 13.5 Browser fingerprint

Playwright's defaults give a consistent, real-looking browser fingerprint. We rotate three things: viewport size (desktop sizes only - we are not impersonating mobile users), timezone (Africa/Douala primarily), language (fr-CM primary, en-CM fallback). We do NOT rotate Canvas/WebGL fingerprints; sites that fingerprint at that depth will block us regardless. If we need to defeat such a site we route to ScraperAPI which handles fingerprinting in their managed product.

### 13.6 Captcha handling

### 13.7 Captcha budget

Total monthly captcha-solving budget is 500 USD (about 150,000 solves at average price). The budget is per-month and per-crawler. The runner refuses to spend beyond the budget; when budget is exhausted, the affected crawler pauses and raises an alert. The architect reviews; either uplifts budget for that month or accepts the source going temporarily dark.

### 13.8 Ethical guardrails

### 13.9 Proxy pool management table

The source.proxy_pool table (defined in Section 7.3) holds the active proxy inventory. The runner maintains this table: adds new proxies as they are provisioned, marks failures with cooldown_until, retires proxies that exceed a failure threshold. The architect reviews the table weekly and adjusts the provider mix based on cost vs success rate.

### 14.1 Why a separate pipeline

Adapters emit two kinds of artifact: structured events (tender notice, award, decree) and binary documents (PDFs, scanned reports, images). Structured events go straight into source.events. Documents go through a heavier pipeline because they need: deduplication by content hash (the same PDF appears on multiple sites), OCR for scanned PDFs (Cour des Comptes reports), language detection (FR vs EN), IPFS pinning for content-addressed retrieval, and storage of extracted text for full-text search.

### 14.2 The pipeline stages

### 14.3 OCR: Tesseract vs commercial services

MVP uses Tesseract 5 self-hosted on N01 (the host has plenty of CPU headroom). For documents where Tesseract confidence is below 0.65 or page count exceeds 100, we route to AWS Textract (per v5.1 Fix #4 - the multi-modal fallback). Textract is more accurate on tables and scanned forms but costs ~$1.50 per 1,000 pages. Daily Textract budget: 500 pages = 0.75 USD/day = 22.5 USD/month, well within the v5.1 multi-modal allocation.

### 14.4 Language detection edge cases

### 14.5 IPFS pinning policy

### 14.6 Mirror to Synology

rclone configured to mirror /srv/vigil/ipfs/data to /volume1/vigil-archive/ipfs/ hourly. The Synology snapshot policy retains the past 7 daily, 4 weekly, 12 monthly snapshots. This means a document accidentally unpinned (or a corrupted IPFS datastore) is recoverable from Synology for at least one year.

### 15.1 The worker contract

Every worker class follows the same external contract: it consumes from a single Redis stream (in a named consumer group), processes each event through a stateless handler function, persists results to PostgreSQL within a transaction, emits one or more downstream events to other streams after the transaction commits, and ACKs the input event last. This ordering (DB commit before stream emit before ACK) is essential for at-least-once semantics.

### 15.2 The base Worker class

### 15.3 Consumer naming convention

Each worker process registers a unique consumer name within its consumer group: '<worker-name>-<container-id>-<short-uuid>'. When a worker restarts (crash, redeploy), the new consumer takes over pending messages from the dead consumer via XCLAIM after a configurable idle timeout (default 5 minutes). This ensures messages are not stuck on a dead worker.

### 15.4 Backpressure mechanism

### 15.5 Per-worker handler skeletons

#### 15.5.1 worker-entity

#### 15.5.2 worker-pattern

### 15.6 Observability per worker

Each worker exposes /metrics on port 9100 (Prometheus format) and /health for the Docker healthcheck. Required metrics: events_consumed_total{worker, stream}, events_emitted_total{worker, stream}, processing_duration_seconds{worker} (histogram), errors_total{worker, error_class}, dedup_hits_total{worker}, db_transaction_duration_seconds{worker}, redis_ack_latency_seconds{worker}. Logs use pino in JSON mode with trace_id, span_id, event_id, worker propagated.

### 15.7 Error classes and handling

### 16.1 Reference

The 43 fraud patterns themselves (definitions, detection logic, default priors, signal strengths) are specified in the v1.0 SRD Section 11. That section remains canonical. This section describes how those patterns are integrated with the worker pipeline specified in Section 15 above.

### 16.2 Pattern registry

/packages/patterns/src/registry.ts builds a singleton PatternRegistry at startup from all PatternDef files in /packages/patterns/src/defs/. Each PatternDef declares which subject kinds it applies to (Tender, Company, Person, Project). The registry exposes registry.applicable(subject) which returns only the patterns relevant to that subject. This filters out e.g. P-D-001 (satellite-verified non-construction) when the subject is a person, not a project.

### 16.3 Subject loading

Before pattern detection, worker-pattern loads a 'subject' object that consolidates all the data each pattern might need: the canonical entity, related entities (one hop in Neo4j), recent events involving the subject, prior findings on the subject. This is loaded ONCE per event and reused across all pattern detection calls. Without this caching, naive pattern detection would re-fetch the same data from the database 40+ times per event.

### 16.4 Pattern testing

### 16.5 Adding a pattern after MVP

(1) Create file in /packages/patterns/src/defs/<pattern-id>.ts. (2) Add unit-test fixtures. (3) Run integration test locally; ensure no regressions in existing patterns. (4) Add 50 hand-labelled examples to the calibration set. (5) Submit PR; the architect reviews. (6) Pattern enters shadow mode at deploy. (7) After 30-day shadow review, the architect promotes by editing the pattern's status field to 'live'. No code change required for promotion.

### 17.1 Principle

Every consequential action in VIGIL APEX is authenticated by hardware-rooted cryptography. Disk decryption, secret unsealing, transaction signing, council voting, operator login - none of these can be performed by software alone. The private keys involved live on YubiKey 5C NFC tokens and never leave the hardware. This is not a security garnish; it is the foundation of the system's integrity claim. Without this, anyone with shell access could fabricate a finding, sign a fake escalation, and produce a Polygon transaction indistinguishable from a real one. With this, an attacker must physically possess a YubiKey AND know its PIN AND have the operator's session - three independent factors.

### 17.2 YubiKey inventory and roles

The MVP provisions five YubiKey 5C NFC devices. Each has a documented role, a documented holder, and a documented backup procedure. Physical custody is part of the security model: the YubiKey is at all times either inserted in a known machine, or in a sealed envelope in a documented physical safe.
YubiKeys for the MINFI pillar, academic pillar, and international observer pillar are provisioned at M3 onboarding (per Section 26.5) and added to this register at that time. The total YubiKey count at full pilot operation is therefore eight: five at M0c bring-up, three more added during M3.

### 17.3 PIV applet slot allocation

Each YubiKey 5C supports four standard PIV slots and 20 retired slots. We use the four standard slots for distinct purposes; we do NOT mix purposes within a slot, because a slot's certificate identifies its purpose to anything that introspects the YubiKey.

### 17.4 Provisioning a new YubiKey (one-time)

### 17.5 LUKS unlock at boot

The host workstation's two NVMe drives are LUKS2-encrypted. The master key for each volume is wrapped by a clevis policy that combines two factors: a Tang server pin (the Synology NAS, reachable on the management VLAN at boot) AND a YubiKey FIDO2 pin (the architect's YK-01). Both factors must be present to unwrap the master key. The host CANNOT boot without:
a) the Synology NAS being reachable (the Tang server runs there)
b) the architect's YubiKey being present
c) the architect entering the FIDO2 PIN at the unlock prompt

#### 17.5.1 LUKS clevis policy configuration

#### 17.5.2 What the operator sees at boot

Power on. BIOS POST. GRUB selects the encrypted Ubuntu entry. initramfs prints: 'VIGIL APEX - Insert YubiKey, then press Enter'. Architect inserts YK-01. Prompt: 'Enter FIDO2 PIN'. Architect types PIN. Tang fetch happens in parallel (transparent to the operator). LUKS unwraps both volumes. Boot continues. systemd brings up services per Section 6. Total time from POST to fully operational: about 4 minutes.

#### 17.5.3 Recovery from YubiKey loss at boot

If YK-01 is lost, the architect uses YK-02 (sealed safe). YK-02 has the same 9a key material as YK-01 (provisioned identically at M0). If both are lost, the LUKS volumes can be unlocked using the recovery passphrase held in a sealed envelope at the backup architect's location - this is the last-resort path and triggers a full re-provisioning of all YubiKeys.

### 17.6 Vault Shamir unseal flow

Vault is initialised with Shamir's Secret Sharing: 5 shares total, 3 required to unseal. The 5 shares are NOT distributed equally among holders; they are distributed by role: shares 1, 2, 3 go to the architect (encrypted to YK-01's slot 9d), share 4 to the backup architect (YK-03), share 5 to the architect's external escrow (encrypted to YK-02's slot 9d, sealed in safe). With this distribution, the architect alone can unseal Vault routinely (uses any 3 of shares 1, 2, 3); for disaster scenarios where the architect is unavailable, the backup architect plus the safe can unseal.

#### 17.6.1 Vault initialisation (one-time, M0c week 1)

#### 17.6.2 Routine unseal flow (every reboot)

#### 17.6.3 Disaster unseal (architect unavailable)

The backup architect retrieves YK-02 from the architect's sealed safe (the safe code is held by the backup architect under a separate envelope at the backup architect's location). The backup architect now has YK-02, YK-03, and the recovery passphrase. With YK-02 (decrypts share 5) and YK-03 (decrypts share 4) plus one of the architect's shares (decrypted from YK-02 if YK-01 is also accessible, OR from a written backup at the secondary safe), the backup architect reconstructs 3 shares and unseals Vault. This procedure is rehearsed quarterly; the rehearsal is documented in /docs/dr-exercises/.

### 17.7 Polygon transaction signing flow

Every Polygon mainnet transaction (anchor commit, governance vote) is signed by a YubiKey-held secp256k1 key. Signing happens via PKCS#11 mediated by libykcs11. The private key never leaves the YubiKey; the worker process sees only the signature output.

#### 17.7.1 Architecture of the signing path

#### 17.7.2 Why a separate signing process?

The YubiKey can be exposed to exactly one process at a time (its USB device file). The signing process holds that exclusive lock. Worker containers do NOT have direct USB access (would require privileged: true, which we refuse). Instead, the signer process exposes a narrow RPC surface (/run/vigil/polygon-signer.sock) that workers reach via a Unix socket bind-mounted into the container. The RPC accepts only one operation: 'sign_tx' with a transaction hash and an authorisation token (issued by Vault, scoped to the calling worker). The signer cannot be coerced into signing arbitrary data.

#### 17.7.3 Signing RPC contract

#### 17.7.4 Worker call site

### 17.8 Council member vote signing flow

When a council member casts a vote, the council portal does NOT have the member's private key. Instead, the portal constructs an unsigned transaction, displays it to the member with a clear summary ('You are about to vote YES on Proposal VA-2026-0034'), and asks the member to insert their YubiKey and authorise. The signing happens client-side via WebAuthn extensions (where supported) or via a lightweight desktop helper app the member runs locally.

#### 17.8.1 Two supported flows

#### 17.8.2 Vote signing sequence (WebAuthn flow)

#### 17.8.3 WebAuthn-to-secp256k1 translation

WebAuthn credentials use a FIDO2 algorithm identifier. For our purposes, council members are issued credentials specifically using the secp256k1 curve (algorithm -47 in COSE). The YubiKey 5 series supports secp256k1 in WebAuthn since firmware 5.4. The portal verifies the WebAuthn assertion (against the registered credential's public key, which IS the council member's eth_address-deriving key), then constructs a Polygon transaction signature from the (r, s) components of the WebAuthn assertion. The recovery byte (v) is computed by trial-recovery against the known eth_address.

### 17.9 Keycloak FIDO2 / WebAuthn enrolment

The vigil-apex realm in Keycloak is configured to require FIDO2 as the sole authentication factor (no passwords). Each user's enrolment ceremony is conducted in person by the architect or backup architect.

#### 17.9.1 Enrolment script (per user)

#### 17.9.2 Realm policy

### 17.10 SSH access via PIV

All SSH access to the host workstation and to N02 uses the YubiKey's slot 9a (authentication keypair) - no SSH password, no agent-stored private key. The OpenSSH client on the architect's laptop is configured with PKCS#11Provider pointing to libykcs11. Inserting the YubiKey + entering PIN authenticates the SSH session. The corresponding public key is written to /root/.ssh/authorized_keys on N01 and N02.

### 17.11 Service-to-service authentication (mTLS)

Within the Docker network, services authenticate to each other via mutual TLS using certificates issued by Vault's PKI engine. Each container's startup script fetches a fresh certificate (24-hour TTL) before serving traffic. PostgreSQL, Neo4j, Redis, and the workers all enforce client-cert verification.

#### 17.11.1 Vault PKI hierarchy

#### 17.11.2 Certificate issuance (worker startup)

### 17.12 Vault token scoping

Workers do NOT use the Vault root token. Each worker has a Vault policy that grants the minimum permissions it needs. The boot-time secret on the container's filesystem (/run/secrets/vault_token_worker) is itself a renewable token with a 1-hour TTL; the worker auto-renews it. If the worker is breached, the token can be revoked centrally and the worker is locked out within 1 hour without restarting other services.

#### 17.12.1 Example policy: worker-pattern

### 17.13 Audit trail of authentication events

Every authentication event - LUKS unlock, Vault unseal, YubiKey insertion detected, Keycloak login, certificate issued, vote signed, mTLS handshake completed - is written to audit.actions in PostgreSQL with the actor, the action, the outcome, and the source (IP / process / YubiKey serial). The hash-chain trigger ensures tamper evidence. Vault's own audit log is also enabled (writes to /vault/logs/audit.log) and shipped to PostgreSQL via Filebeat as a defence-in-depth duplicate.

### 17.14 Recovery procedures summary

### 17.15 Threat model summary

### 18.1 Routing principle

LLM cost varies by orders of magnitude across the Anthropic tiers. A naive 'use Opus for everything' approach burns the budget in week one. Routing principle: use the cheapest model that meets the quality bar; reserve Opus for tasks where its reasoning depth materially improves outcomes. The Bedrock failover path mirrors the same routing against AWS-hosted Claude variants when the primary Anthropic API is degraded.

### 18.2 Tier assignments

### 18.3 Failover circuit breaker

/packages/llm/circuit.ts monitors the primary Anthropic API. After 3 consecutive failures within 60 seconds, OR a single response with latency > 30 seconds, the breaker trips. While tripped, all LLM traffic routes to AWS Bedrock. The breaker auto-resets after a probationary success: every 60 seconds, a trial request goes to Anthropic; on success, traffic returns. All failover events are logged to audit.actions and surfaced on the operator dashboard.

### 18.4 Token accounting and cost ceilings

Every LLM call is wrapped by /packages/llm/track.ts which records: model, input tokens, output tokens, USD cost, latency, correlation ID, calling worker. Aggregated daily reports go to a Prometheus gauge and to /docs/cost-reports/ as CSV. Hard daily ceiling: 30 USD soft alert; 100 USD hard cutoff (lower-priority calls throttled). Monthly budget per v5.1 is 2,503 USD; over-burn requires architect authorisation.

### 18.5 Prompt template registry

All prompts live in /packages/llm/prompts/ as versioned files (e.g. dossier-narrative-fr-v3.txt). Each prompt has a stable ID, version, description, input schema, output schema, and test cases. Prompts are NEVER inlined in worker code. Worker code references prompts by ID; the LLM client loads the file at call time. This separation lets the architect tune prompts without code deploys.

### 19.1 Why Bayesian

A finding rarely rests on a single piece of evidence. Pattern P-A-001 (single-bidder award) might fire on tender X with signal_strength 0.7. The same tender may also trigger P-B-001 (shell-company indicator) at 0.6, P-C-001 (benchmark inflation) at 0.5, and P-F-002 (director-sharing ring) at 0.8. These signals are not independent (shell companies often involve director sharing) but they are also not perfectly correlated. The Bayesian engine combines them honestly: each new signal updates the posterior probability that the finding represents real fraud, accounting for prior probability and signal independence.

### 19.2 The model

For each finding F, we compute P(fraud | signals). Naive Bayes-style independence is the baseline; correlation corrections dampen known-correlated signal pairs. The prior P(fraud) is set per pattern category from the calibration set. Each signal contributes a likelihood ratio P(signal|fraud) / P(signal|not fraud). Posterior is updated multiplicatively in log-odds space for numerical stability.

#### 19.2.1 Computation

### 19.3 Priors per pattern category

### 19.4 Calibration

The certainty engine is calibrated against a hand-labelled set of 200 historical Cameroonian procurement records. Each is labelled by the architect AND the seconded CONAC analyst as 'genuine fraud / strong indicator', 'ambiguous', or 'benign'. Target: reported certainty matches observed frequency within 5 percentage points across decile buckets. Of all findings reported as 0.7-0.8 certainty, between 65% and 75% should be true positives.

### 19.5 Calibration error metric (ECE)

Expected Calibration Error: weighted average across deciles of |predicted_freq - observed_freq|. Acceptance criterion: ECE < 5%. Recalibrated monthly during MVP, or whenever a new pattern is added. Results in /docs/calibration-reports/.

### 19.6 Devil's-advocate counter-evidence

Before a finding with certainty > 0.85 enters a dossier, a counter-evidence pass runs: an Opus 4.6 prompt is given the evidence chain and asked to identify reasons the finding might be wrong, missing context, or have a benign alternative. The assessment is included in the dossier as an explicit 'Caveats / Alternative Explanations' section. Counter-evidence findings can downgrade certainty (operator decides; not auto-dismissed).

### 19.7 Worked example

Tender VA-2026-0134 awarded to Bouygues Cameroun BTP for 4.2B XAF. Pipeline produces three signals: P-A-001 single-bidder strength 0.85; P-C-001 benchmark inflation strength 0.55; P-D-001 satellite no-construction strength 0.92. Priors: 0.18, 0.12, 0.45 respectively. Combined log-odds yields posterior approximately 0.91. Counter-evidence pass identifies: 'verify imagery coordinates against project plan'. Coordinates confirmed correct. Finding proceeds at 0.91 with caveat noting verification step.

VIGIL APEX uses Large Language Models at multiple stages of the pipeline. LLMs hallucinate. A finding generated from a hallucination - a fabricated entity, an invented amount, a misquoted document - is worse than no finding: it damages a real person and burns institutional credibility. This section enumerates the twelve concrete anti-hallucination controls built into the system. They are layered: any single layer can fail without the system producing a fabricated finding.

### 20.1 Defence in depth: the twelve controls

### 20.2 What an LLM is allowed to do versus not allowed

### 20.3 Prompt engineering rules (binding for all workers)

Every prompt explicitly instructs the model: if you cannot answer from the provided sources, return {"status": "insufficient_evidence"}. Do not infer, guess, or generalise.
Every prompt provides the source documents as inline text or as IPFS-fetched content; the model never has live web access from inside a worker.
Every prompt requires the model to return citations in the form {document_cid: "...", page: N, char_span: [start, end]} for each extracted field.
Every prompt includes negative examples: do not infer the existence of a contract from a press release alone; require the original document or ARMP record.
Temperature is set to 0.0 for extraction tasks, 0.2 for classification, 0.4 for translation, 0.6 for devil's-advocate (where divergent thinking is the goal). Higher temperatures are never used.
System prompts include the date of the prompt template version; templates are versioned in /infra/prompts/ and changes go through code review.

### 20.4 Hallucination-specific telemetry

The dashboard exposes four metrics that specifically track hallucination risk:
ECE (Expected Calibration Error) - rolling 30-day, target < 5%, alarm > 10%.
Quote-match rejection rate - share of LLM extractions rejected by L7. Target < 8%; sustained higher rate indicates a model upgrade has shifted behaviour and prompts need revision.
Numerical-disagreement rate - share rejected by L8. Target < 5%.
Schema-violation rate - share rejected by L6. Target < 2%; higher indicates degraded model output quality and triggers Bedrock failover review.

### 21.1 Pattern definition format

Every pattern is a typed PatternDef in /packages/patterns. A pattern declares: stable identifier (e.g. 'P-A-001'); category; input signals consumed; detection function; expected base hit rate (for calibration); default certainty contribution per signal (for the Bayesian engine). Patterns are pure functions of their inputs; they read from Neo4j and PostgreSQL but never query external sources directly.

#### 21.1.1 PatternDef interface

### 21.2 Categories

### 21.3 Procurement integrity (Category A)

### 21.4 Beneficial-ownership concealment (Category B)

### 21.5 Price-reasonableness (Category C)

### 21.6 Performance verification (Category D)

### 21.7 Sanctioned-entity exposure (Category E)

### 21.8 Network anomalies (Category F)

### 21.9 Document integrity (Category G)

### 21.10 Temporal anomalies (Category H)

### 21.11 Adding a pattern after MVP

(1) New file in /packages/patterns/. (2) Registration in patterns index. (3) Test fixtures (positive + negative cases). (4) Calibration: 50 hand-labelled examples to estimate base hit rate. (5) Bayesian prior tuning. New patterns enter 'shadow mode' (recorded, not surfaced) for 30 days while the architect reviews. The architect promotes by editing the pattern's status field from 'shadow' to 'live'.

### 22.1 Why Polygon mainnet

Polygon mainnet was chosen over: Ethereum mainnet (transaction cost prohibitive at MVP scale), Arbitrum/Optimism (acceptable Phase-2 alternatives but lower institutional recognition in francophone Africa), private Quorum (defeats public verifiability). Polygon offers EVM compatibility, low cost (under 0.01 USD per anchor at typical gas), strong RPC ecosystem (Alchemy + public RPCs), broad explorer support (PolygonScan). Anchor transactions use < 50,000 gas; at MVP rate of ~200/month, gas cost is < 5 USD/month.

### 22.2 Two contracts, two purposes

VIGILAnchor.sol: minimal append-only registry of evidence-chain hashes. One transaction per finding. Public, queryable. VIGILGovernance.sol: multi-pillar voting contract enforcing 3-of-5 quorum. Manages pillar memberships, opens proposals, accepts votes, emits escalation events. Both deployed once at MVP launch and upgraded only through documented governance.

### 22.3 VIGILAnchor.sol (full contract)

### 22.4 VIGILGovernance.sol (full contract)

### 22.5 Hardhat test suite (excerpt)

### 22.6 Hardhat config

### 22.7 Deployment script

### 22.8 Deployment ceremony

### 22.9 Upgrade path

MVP contracts are NOT upgradeable. Deliberate choice: an upgradeable contract has a privileged admin that can rewrite logic, undermining public-verifiability. If a contract bug or governance change is needed, a new contract version is deployed with a clean address; the old contract becomes read-only history. The dashboard tracks both addresses. Pillar memberships do not migrate automatically; holders re-enrol on the new contract, audit-logged.

### 23.1 The governance principle

VIGIL APEX produces findings. Findings only become escalations - referrals to CONAC, alerts to MINFI - when the Five-Pillar Council reaches quorum. This is a deliberate constraint. A unilateral algorithm flagging a contractor as fraudulent is a political weapon. A multi-party council whose consent is recorded on a public ledger is a governance instrument. The MVP enforces this distinction at the smart-contract level: no escalation can occur without on-chain quorum.

### 23.2 The five pillars

### 23.3 Quorum rule

The MVP quorum is 3-of-5: any three pillars carry a vote. Enforced by VIGILGovernance.sol. Choices: YES (escalate), NO (dismiss), ABSTAIN, RECUSE. Abstentions count toward quorum (preventing a vote being blocked by absences) but do not count toward the YES side. To escalate, at least 3 YES. To dismiss, 3 NO. If neither side reaches 3 within the 14-day window, the proposal is auto-archived as 'inconclusive' and the finding remains as 'detected, no quorum'.

### 23.4 Vote lifecycle

### 23.5 Conflict of interest and recusal

A pillar holder MUST recuse if they have a personal or institutional conflict with the implicated entity. Recusal is recorded on-chain by casting RECUSE, which is treated as ABSTAIN for quorum purposes but logged with a recusal reason. Recusal is voluntary in MVP; Phase-2 adds automated conflict screening using public PEP and corporate-affiliation data.

### 23.6 Public visibility

Vote events (ProposalOpened, vote casts, ProposalEscalated/Dismissed/Archived) are public on Polygon mainnet. Pillar identities (eth_addresses + role) are public on the dashboard at vigilapex.cm/council. Vote choices are public per holder per proposal. Vote rationales are NOT made public by default in MVP (privacy + deliberation protection); a future amendment may publish them after a redaction window.

### 23.7 Pillar holder removal and replacement

A pillar holder can be replaced by: (a) institutional rotation (e.g. CONAC reassigns), (b) misconduct removal (architect, with documented reason, removes via removeMember gated by admin multisig), (c) voluntary resignation. Replacements appointed by the originating institution per its own process. The MVP does not govern the institutional process; it only records the on-chain transition.

### 24.1 Visual identity

Every dossier carries the same visual identity. Republican wordmark and motto in the header. Classification banner in colour code. Monochrome body type for legibility on print and screen. The dossier is designed to be readable as a printed document (CONAC analyst at desk) AND as a screen artifact (verifier at vigilapex.cm). Both views must work.

### 24.2 Page setup

### 24.3 Colour palette

### 24.4 Cover page (page 1)

### 24.5 Section structure (pages 2-N)

### 24.6 Header and footer (every page except cover)

### 24.7 Pattern card visual

### 24.8 Caveat / counter-evidence box visual

### 24.9 Implementation

PDFs are generated by /packages/dossier/build.ts using docx-js (the same library used to generate this SRD) followed by LibreOffice headless conversion to PDF. docx-js produces deterministic output given identical inputs. The .docx intermediate is human-editable for late corrections. LibreOffice produces archival-quality PDFs. The PDF is signed with OpenSSL using the architect's YubiKey-protected key (Section 17.7), then the signed PDF is pinned to IPFS. The cover-page QR code is generated by /packages/dossier/qr.ts (qrcode npm) and inlined as PNG.

### 24.10 Reproducibility test

A dossier reproducibility test is part of the acceptance suite (Section 28 T-09). Given a finding with frozen evidence, regenerate the dossier 5 times in succession; the generated PDFs MUST be byte-identical except for the digital-signature timestamp. The test prevents regressions where future code change introduces non-determinism (e.g. Map iteration order).

### 24.11 Public verification page

Every dossier exposes vigilapex.cm/verify/{dossier_number}. The page displays: dossier number, IPFS CID, Polygon anchor tx (linked to PolygonScan), Fabric tx ID (linked to public Fabric explorer), and a 'verify hash' utility where a visitor uploads the PDF and confirms its hash matches the on-chain anchor. This is the system's transparency contract: any citizen can independently verify a published dossier is authentic.

### 25.1 Channel choice

CONAC receives escalated dossiers via SFTP. SFTP was chosen over: HTTP API (CONAC has no public API surface for ingestion), email (cannot prove receipt non-repudiably), shared filesystem (institutional boundary). SFTP provides: standard institutional tooling, server-side ACK directory pattern, audit trail at both ends, easy to rotate credentials, easy to test.

### 25.2 Server endpoint

### 25.3 Delivery package format

One escalated dossier produces a delivery package consisting of: the FR PDF, the EN PDF, an evidence archive (tar.gz of evidence-chain documents), and a manifest file. All four are uploaded to /inbox/vigil-apex/ in a single transaction (manifest written last).

#### 25.3.1 File naming

#### 25.3.2 Manifest schema

### 25.4 ACK protocol

After a complete package upload, VIGIL APEX waits for CONAC to write an ACK file to /ack/vigil-apex/<dossier_number>.ack. The ACK content schema is below. VIGIL APEX polls the ACK directory every 5 minutes for up to 7 days. If no ACK arrives within 7 days, the delivery is escalated to P2 incident; the architect contacts CONAC IT.

### 25.5 Retry policy

### 25.6 Credentials lifecycle

VIGIL APEX's SFTP authentication private key is on YK-01 slot 9a (the same slot used for SSH access to N01/N02). Public key rotation: every 6 months, architect generates a new SSH key on YK-01 (slot 9a is reserved for routine auth; rotation happens by replacing the certificate, not regenerating the key, since YK-01 keys are per-slot persistent). The new public key is hand-delivered (USB drive at in-person CONAC visit) and installed in CONAC's authorized_keys. Old key revoked 7 days later.

### 25.7 Audit trail

Every delivery attempt and every ACK is recorded in audit.actions and dossier.referrals. The audit log captures: delivery_attempt_at, delivery_completed_at, ack_received_at, manifest_hash, file_hashes, CONAC case_reference. The integrity of this trail is part of the v3.0 acceptance test T-11.

### 26.1 Purpose

MINFI's payment systems query VIGIL APEX before releasing a disbursement. The query asks: 'For this transaction (contract reference + amount + recipient + payment date), is there a known finding affecting any party in this transaction?' VIGIL APEX returns a risk score and the finding identifiers. MINFI uses the score to advise the disbursing officer; the API does NOT block payments. The disbursing officer makes the final call - the API informs that decision.

### 26.2 Endpoint

### 26.3 Request schema

### 26.4 Response schema

### 26.5 Score bands

### 26.6 Idempotency

Same request_id submitted twice returns the same response (cached for 24 hours). This protects against double-counting in MINFI's payment workflow when their system retries. Idempotency cache is keyed on request_id ONLY; if MINFI changes any other field but reuses request_id, that's a MINFI bug; we honour the cached response and surface a warning.

### 26.7 Caching policy on the VIGIL APEX side

Score computation is fast (P95 ~30ms): we look up the payee RCCM in entity.canonical, find findings where the entity is primary_entity_id or in related_entity_ids, filter by recency and state (escalated > detected), aggregate certainty into a band-mapped score. Result is cached in Redis for 1 minute (cache:minfi:score:<request_id>). Cache invalidates on new finding insertion involving the queried entity.

### 26.8 Failure modes

### 26.9 Auditability

Every score request is logged with the full request, full response, and the finding-ids that informed the score. MINFI also logs every request on their side. In the event of a dispute (e.g. 'why was payment X held?'), both sides can produce matching records, and the response itself is signed - non-repudiable.

### 26.10 Bilingual delivery

The advisory text fields (explanation_fr, explanation_en, title_fr, title_en) are always populated in both languages. MINFI's UI may render either depending on the disbursing officer's preference. Both languages are required because Cameroon's administrative reality runs in both, and a unilingual response would be politely but firmly rejected.

### 27.1 Three surfaces, three audiences

All three are served by the same Next.js application (apps/dashboard) but route to different sections gated by Keycloak roles (operator, council_member, auditor, public).

### 27.2 Tech and design tokens

### 27.3 Operator dashboard layout

### 27.4 Operator: finding detail page

### 27.5 Operator: dead-letter queue page

Lists every dead-letter row with: adapter, error class, retry count, first seen, last attempt. Per row actions: 'View raw payload' (modal with JSON), 'Retry now', 'Mark resolved' (with reason). Filter by adapter and error class. Bulk-retry button (with confirmation) for bulk transient failures (e.g. all entries from a single adapter during an outage period).

### 27.6 Operator: calibration page

Shows current ECE per pattern category (table), current pattern hit-rate vs declared baseline (sparklines), entity-resolution precision/recall against the validation set (latest run). Two action buttons: 'Run calibration now' (kicks off a job; estimated 4 minutes) and 'Open ER review queue' (lists the 0.70-0.92 score-band pairs awaiting human review).

### 27.7 Council portal layout (members-only)

### 27.8 Council portal: proposal detail and vote ceremony

On click [INSERT YUBIKEY AND CAST VOTE]: a modal walks the council member through the WebAuthn ceremony described in Section 17.8.2. The browser asks for the YubiKey, the member taps + enters PIN, signature is produced, transaction is broadcast. On success, the page refreshes to show 'Vote cast - tx 0x... [view on PolygonScan]'.

### 27.9 Public verification page

### 27.10 Public verification: ledger view

Secondary public page at vigilapex.cm/ledger displays the audit-log root over time (one row per daily checkpoint), the count of escalated dossiers per month, and the aggregate pattern-distribution (anonymised: how many findings per category per quarter). No specific findings or entities are surfaced on this page; only aggregates.

### 27.11 Mobile responsiveness

All three surfaces are responsive. The operator dashboard collapses gracefully to a tablet view (the architect occasionally checks alerts on the road). The council portal works on mobile but the vote ceremony requires a USB-C YubiKey (NFC works on Android with caveats); members are encouraged to vote from their workstation, with mobile as fallback. The public verification page works on every device.

### 27.12 Dark mode

All three surfaces support dark mode (toggle in user menu; system preference respected by default). The colour palette has been chosen so dossier classification banners remain legible in both modes. The dossier PDF itself is light-mode only - it is a print-archival artifact.

VIGIL APEX is built around three principles regarding public participation:
Read access for the public is anonymised and read-only - the verification page (Section 27.9) and the ledger view (Section 27.10). Citizens can verify any escalated dossier; they cannot browse working data.
Write access for the public is exactly one channel: the Tip-In Portal at https://vigilapex.cm/tip. This is the only way data flows from the public into the system. There is no email, no WhatsApp, no Twitter DM, no contact form. One channel, hardened.
Every tip is treated as one signal among many. A tip alone does not produce a dossier. A tip joins the Bayesian engine as a low-prior input that must be corroborated by independent evidence (procurement records, financial flows, satellite imagery) before crossing the 0.85 threshold.

### 28.1 Why a tip-in portal exists

Corruption is observed by people on the ground long before it appears in any document. A junior accountant notices an inflated invoice. A villager photographs a road that was paid for but never built. A whistle-blower inside a ministry sees what the audit will not show. Without a safe channel for these observations, the system is blind to the most direct form of evidence available: human testimony from inside the institutions themselves.
The Tip-In Portal exists to capture this evidence, give the submitter genuine protection, and feed the signal into the same pipeline that processes ARMP records and satellite imagery. The portal is the only mechanism by which citizens influence what VIGIL APEX investigates.

### 28.2 Surface and route

### 28.3 The form

Deliberately short. Tips are processed; tips are not interrogations. The form has six fields, three required:

### 28.4 Anonymity guarantees

The portal makes specific, technically enforced privacy promises:
Submitter IP is NOT logged in the application database. Caddy logs IPs for 7 days for abuse mitigation only and is auto-purged. The operator dashboard never displays IPs of tip submitters.
Browser fingerprinting is NOT used. No third-party analytics, no Google Tag Manager, no Facebook pixel. The only third-party network call is Cloudflare Turnstile.
File metadata is stripped before storage. EXIF from images, author/created-by from PDFs/DOCX, GPS coordinates from photos and videos. The processing pipeline writes a sanitised copy to IPFS and discards the original.
Attached photos and videos are not displayed publicly. They are evidence available only to the operator team and council members reviewing a dossier; they never appear on /verify or in the published PDF unless the submitter explicitly authorised release in a separate signed consent form (out of scope for MVP).
The optional contact field is encrypted with a libsodium sealed-box using the operator team's public key, persisted in PostgreSQL as a binary blob, and never logged. Decryption requires a secret only available inside the dashboard service after Vault unseal. A casual database compromise does not expose contact details.
If the submitter provides contact and the operator team chooses to follow up, all communication happens through Signal or ProtonMail; no plaintext SMS, no unencrypted email.

### 28.5 Tip-ingestion pipeline

A submitted tip flows through these stages, in this order. The tip never reaches the finding pipeline directly; it is triaged first.

### 28.6 Tip schema (PostgreSQL)

### 28.7 Backend handler (Next.js route)

### 28.8 Triage UI for operators

The dashboard exposes /triage/tips - operator-only route gated by Keycloak role tip_triage. Layout:

### 28.9 Promote-to-finding flow

When an operator clicks PROMOTE, the tip is bound to a finding. The flow:
If the operator selects an existing finding (search by entity, project, or VA-ref), the tip becomes an additional signal on that finding. The signal carries pattern_id = TIP-CORROBORATION, prior 0.05-0.20 depending on the operator's confidence rating.
If the operator creates a new finding from the tip, a finding is created with seed entities/projects extracted from the tip text. The tip-derived signal is added with prior 0.10. The finding is in OBSERVATION tier (posterior likely below 0.55) until corroborating signals arrive from procurement, financial, or other adapters.
In neither case does a tip alone push a finding above 0.85. By construction. Tips can prompt investigation; tips do not prove findings.

### 28.10 Abuse and adversarial submissions

Adversaries will use the tip portal. Three classes of adversarial behaviour are anticipated and addressed:

### 28.11 Submitter-facing receipt and lookup

After successful submission, the submitter is shown a TIP-YYYY-NNNN reference (the same ref stored in the database). They may visit https://vigilapex.cm/tip/status?ref=TIP-2026-0042 to see the disposition status (NEW / IN_TRIAGE / DISMISSED / ARCHIVED / PROMOTED). The status page does NOT show:
The triage operator's name.
The triage note text.
Which finding (if any) the tip was promoted to.
Any other tips.
It shows ONLY the disposition and the date of the most recent action. This balances transparency to the submitter with operational confidentiality.

### 28.12 Acceptance criteria for the Tip-In Portal

AT-28-01: Submission flow completes in under 5 seconds at P95 over a 1Mbps connection from Yaoundé.
AT-28-02: Anonymous submission produces zero IP entries in the application database (verified by automated scan against tip schema).
AT-28-03: All five accepted attachment types pass through the EXIF-strip pipeline; verified by re-extracting metadata from the IPFS-pinned copy and confirming GPS / author / created-by are absent.
AT-28-04: A submitted contact field is unreadable in PostgreSQL without the operator-team private key (verified by attempting decryption with a different key; expected libsodium failure).
AT-28-05: Five submissions from the same IP within 60 minutes triggers rate-limit response on the sixth (verified end-to-end including Cloudflare layer).
AT-28-06: A tip with malformed JSON, missing required fields, or oversize attachments returns 400 / 413 and is not persisted.
AT-28-07: A promoted tip increases the bound finding's signal count by exactly one and shifts its posterior by an amount consistent with prior 0.10 +/- 0.05; verified against the Bayesian engine's deterministic output.
AT-28-08: The submitter status-lookup page never reveals operator identity, triage notes, or finding linkage; verified by inspecting the response body of /tip/status.

This section consolidates the strategic build plan from v1.0 with the operational refinements from v2.0. Six milestones over 24 weeks. Each milestone has explicit entry criteria, deliverables, and exit criteria. No milestone exits until its acceptance tests (Section 30) pass.

### 29.1 Schedule overview

### 29.2 M0c - Cold-start (weeks 1-2)

Entry: hardware delivered, architect alone, no developers yet. Goal: a running container fabric on a sovereign host.
Day 1-2: BIOS hardening, Ubuntu 24.04 LTS install, LUKS+Tang+YubiKey unlock chain configured, SSH PIV-only access. Reference Section 17.
Day 3-4: Btrfs subvolume layout under /srv/vigil/, host systemd units installed (vigil-vault-unseal, vigil-polygon-signer, vigil-time, vigil-watchdog, wireguard-wg0). Reference Section 02-03.
Day 5-6: Docker Engine + Docker Compose v2 installed, vigil-internal and vigil-edge networks created, Vault container deployed and Shamir-unsealed via 3-of-5 YubiKey ceremony.
Day 7-8: PostgreSQL container up with all 6 schemas deployed, Neo4j container up, Redis container up, IPFS container up, ledger root snapshot tested.
Day 9-10: Caddy reverse-proxy with public TLS certs, Keycloak with FIDO2 WebAuthn enrolled (architect's YK-01), dashboard skeleton serving placeholder content at vigilapex.cm.
Exit: AT-M0c-01 through AT-M0c-04 pass (Section 30). Cold-start time from power-on to all containers healthy: under 30 minutes.

### 29.3 M1 - Data plane (weeks 3-6)

Entry: M0c green. First two developers onboarded. Goal: data flowing into the database.
Week 3: Adapter framework code complete (AdapterRunner Dockerfile, Playwright + Tor + proxy rotation library). First three crawlers (MINMAP categorisation, ARMP, COLEPS) running and producing events.
Week 4: Crawlers 4-13 deployed (MINFI/DGB/DGTCFM/MINEPAT/RCCM/Cour des Comptes/Journal Officiel/ANIF/six sectoral ministries). All scheduled in cron. Dead-letter queue tested.
Week 5: Crawlers 14-26 deployed (international corroboration: World Bank Sanctions, AfDB Sanctions, EU Sanctions, OFAC, UN Sanctions, EITI). Document pipeline (fetch -> hash -> MIME -> OCR -> IPFS pin -> store) operational.
Week 6: Worker framework complete with idempotent-consumer pattern; entity-resolution worker running; deduplication functional; the operator dashboard shows pipeline-at-a-glance with live event counts.
Exit: AT-M1-01 through AT-M1-04 pass. 26-of-26 adapter coverage; proxy diversity green; captcha budget compliance under $500/month projected; IPFS-Synology consistency verified.

### 29.4 M2 - Intelligence plane (weeks 7-12)

Entry: M1 green. Two more developers (now 4 total). Goal: signals becoming findings becoming candidate dossiers.
Week 7-8: All 43 patterns implemented in /apps/patterns/, each with PatternDef interface (Section 21.1.1), unit tests with synthetic positives and negatives. Pattern firing visible in operator dashboard.
Week 9: LLM tier routing implemented (Haiku/Sonnet/Opus per Section 18). Bedrock failover wired in. Cost ceiling enforcement ($30/day soft, $100/day hard) live.
Week 10: Bayesian engine implemented with priors per category (Section 19.3). First findings produced. Counter-evidence devil's-advocate pass operational.
Week 11: Anti-hallucination controls L1-L10 all active and emitting telemetry (Section 20). ECE measured nightly; quote-match rejection rate tracked; numerical-disagreement rate tracked.
Week 12: First calibration sweep with 200-finding labelled set; ECE measured; weights adjusted if needed; calibration report archived in /docs/calibration-reports/.
Exit: AT-M2-01 through AT-M2-07 pass. 43-of-43 patterns implemented; ECE under 5%; >= 50 findings produced over 7 days; counter-evidence runs on every finding above 0.85; tier-routing cost stays under daily ceiling.

### 29.5 M3 - Delivery plane (weeks 13-18)

Entry: M2 green. Frontend developer onboarded (5 total). Goal: dossiers reaching humans.
Week 13-14: VIGILAnchor.sol and VIGILGovernance.sol deployed to Polygon Mumbai (testnet) via deployment ceremony (Section 22.7). Hardhat test suite green. Migration to Polygon mainnet at end of week 14.
Week 15: Dossier PDF template implemented (Section 24). docx-js + LibreOffice render pipeline operational. Reproducibility test (same input -> bit-identical PDF) green.
Week 16: CONAC SFTP integration live with manifest schema and ACK protocol (Section 25). MINFI scoring API live with idempotency and fail-soft (Section 26).
Week 17: Frontend dashboards complete - operator dashboard, finding-detail page, dead-letter queue, calibration page (Section 27.3-27.6).
Week 18: Council portal complete (Section 27.7-27.8). Public verification page (Section 27.9-27.10). Tip-In Portal complete (Section 28). Triage UI for tips (Section 28.8).
Exit: AT-M3-01 through AT-M3-06 pass plus all eight Tip-In tests AT-28-01 through AT-28-08.

### 29.6 M4 - Council standup (weeks 19-21)

Entry: M3 green. Goal: real humans, real keys, real votes (test mode).
Week 19: Five YubiKeys provisioned (architect, backup architect, CONAC representative, civil society representative, additional architect-secondary). MINFI / Academic / International Observer keys deferred to post-MVP if required.
Week 20: Council training delivered: dossier review protocol, recusal rules, vote ceremony walkthrough, recovery procedures. Each pillar holder enrols WebAuthn FIDO2 in Keycloak.
Week 21: First end-to-end dry run: pipeline produces a candidate dossier, council convenes, three pillars vote ESCALATE on Polygon Mumbai (still test mode), dossier renders to PDF, SFTP upload to a test CONAC endpoint, ACK received.
Exit: AT-M4-01 and AT-M4-02 pass.

### 29.7 M5 - Hardening (weeks 22-23)

Week 22: External red-team engagement (a reputable firm; budget allocated in v5.1). Targets: tip portal, public verification page, council portal, MINFI API. Findings remediated.
Week 23: DR rehearsal: full restore from latest S3 + Synology backup to a clean host. Time-to-restore measured (target: under 6 hours). Final calibration sweep (full 500-finding labelled set if available; minimum 200). Launch readiness review with funder.
Exit: AT-M5-01 (pentest critical findings: zero) and AT-M5-02 (DR restore time: under 6 hours).

### 29.8 M6 - Public launch (week 24)

Polygon mainnet final cutover (if not already done at end of M3). Council operational on mainnet.
vigilapex.cm DNS published, public TLS certs valid, all four surfaces (operator, council, public verification, tip portal) reachable from public internet.
First real escalated dossier published. Tip-In Portal opened. Press conference held.
First 30 days of operation monitored intensively; calibration measured weekly; cost ceilings monitored daily; council vote cadence reviewed.

Each test below is binding: a milestone does not exit until all tests for that milestone pass. Tests are automated where possible (CI runs them on every PR); manual where automation is impractical (recovery drills, council ceremonies).

### 30.1 M0c - Cold-start tests

### 30.2 M1 - Data plane tests

### 30.3 M2 - Intelligence plane tests

### 30.4 M3 - Delivery plane tests

### 30.5 Tip-In Portal tests (also M3 exit gate)

### 30.6 M4 - Council standup tests

### 30.7 M5 - Hardening tests

### 30.8 Continuous tests (run forever)

CT-01: Audit log hash chain unbroken (verified hourly by audit_verify.py).
CT-02: Polygon ledger root computed locally matches the latest VIGILAnchor commitment (verified daily).
CT-03: All host services running (vigil-vault-unseal, vigil-polygon-signer, vigil-time, vigil-watchdog) - Prometheus alert if any down >5 minutes.
CT-04: All container services healthy per Docker healthcheck - Prometheus alert if any unhealthy >2 minutes.
CT-05: Daily cost report (LLM + proxies + captcha + S3) emitted to operator email.
CT-06: Monthly calibration report (ECE, rejection rates, finding counts, escalation counts) emitted to council.

Each runbook is a script for the operator on duty. They assume the operator has SSH PIV access to the host and a YubiKey. They are linear: do step N before step N+1.

### 31.1 R1 - Routine deploy (a code change to a worker)

### 31.2 R2 - Restore from backup (DR)

### 31.3 R3 - Rotate operator YubiKey (planned)

### 31.4 R4 - Pillar holder change

### 31.5 R5 - Incident response (P0 / P1 / P2 / P3)

P0 incident response procedure (the only severity that requires a documented playbook):

### 31.6 R6 - Monthly DR exercise

VIGIL APEX Solution Requirements Document v3.0 - Master Edition - is the single source of truth for the build of the MVP. It supersedes v1.0 and v2.0 in their entirety. A developer onboarding to the project after this date is given v3.0 and only v3.0; v1 and v2 are archived for historical reference.

### 32.1 What this document IS

A complete specification of the system at the level of detail a developer needs to begin building tomorrow morning. Every section that prior versions covered abstractly is now concrete.
A binding contract between the architect, the funder, the build team, and the council. The acceptance tests in Section 30 are the criteria for milestone payments and council confidence in the system.
A living document, but with discipline. Changes to v3.0 require a versioned amendment (v3.1, v3.2, ...) reviewed by the architect and the build lead. Verbal changes do not exist.
Honest about its limits. Where the spec is uncertain (some ministry URLs, some calibration thresholds, some council member identities), the document says so explicitly and points to the moment when the uncertainty resolves.

### 32.2 What this document is NOT

It is not a research paper. There are no novel claims about anti-corruption AI; this system is engineered from known components arranged carefully.
It is not a marketing document. It contains no promises this system cannot keep. It will not detect every fraud. It will not work without operator engagement. It will not eliminate corruption in Cameroon. It will surface, anchor, and dignify findings that human investigators can act on.
It is not the property of any single party. The intellectual property rights are with the Republic of Cameroon per the v5.1 commercial agreement. Anthropic's role is provider of LLM capabilities, not owner of the resulting system.
It is not the final word. After M6, lessons learned will produce v4.0. After Phase 2, v5.0. The MVP is a beginning, not an end.

### 32.3 Reading order for new developers

New team members are asked to read sections in this order, over the course of one or two days, before writing any code:
Day 1 morning: Sections 00-03 (purpose, host as N01, container fabric).
Day 1 afternoon: Sections 04-09 (compose, dockerfiles, configs, schemas).
Day 2 morning: Sections 10-13 (sources, crawlers, IP rotation), 14-16 (pipeline, workers, patterns integration).
Day 2 afternoon: Section 17 (authentication; this is unusual and must be understood before touching any key) and Section 20 (anti-hallucination; this is the operating doctrine).
Days 3-4: Sections 18-19, 21-22 (intelligence, contracts) and Sections 23-26 (delivery).
Day 5: Sections 27-28 (frontend and tip portal), 29-31 (build sequence, tests, runbooks).

### 32.4 Sign-off

This document is issued by the architect, Junior Thuram Nana, on the date of v3.0 publication, acting under the authority granted by the v5.1 commercial agreement with the Republic of Cameroon. It is countersigned, when implementation funds release, by the funder representative and the CONAC liaison.

The MVP is not built by reading this document. The MVP is built by people who have read this document and now write code, configure systems, train operators, and accept responsibility for what they ship. This document gives them no excuses; it gives them the means.

End of v3.0 Master Edition.

### Table 0

| 00  | HOW TO READ THIS DOCUMENT Orientation for the build team |
| --- | -------------------------------------------------------- |

### Table 1

| Part               | Coverage                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Part A (Sec 1-3)   | What VIGIL APEX is. The 10-node topology. How the host PC functions as Node 01 in implementation detail (processes, systemd units, KMS shim, paths).                                             |
| Part B (Sec 4-6)   | Docker simulation: how the other 9 nodes are containerised on the host. Complete docker-compose.yaml. Per-service Dockerfile for every service. Network namespaces, volume mounts, healthchecks. |
| Part C (Sec 7-9)   | Database schemas as actual DDL. Every CREATE TABLE, every CONSTRAINT, every INDEX. PostgreSQL, Neo4j Cypher migrations, Redis stream definitions.                                                |
| Part D (Sec 10-13) | Cameroonian source catalogue with real URLs. Crawler architecture. Per-crawler specifications for all 29 sources. IP rotation, proxy management, anti-bot strategy.                              |
| Part E (Sec 14-16) | Document pipeline (fetch, hash, OCR, store, dedupe). Pattern catalogue cross-reference. Worker pipeline implementation detail.                                                                   |
| Part F (Sec 17-19) | Build sequence (week-by-week). Acceptance tests. Runbooks (deploy, restore, key rotation).                                                                                                       |

### Table 2

| 01  | SYSTEM PURPOSE AND SCOPE What we are building, in one tight description |
| --- | ----------------------------------------------------------------------- |

### Table 3

| 02  | THE HOST AS NODE 01 How the operator's workstation IS the primary node |
| --- | ---------------------------------------------------------------------- |

### Table 4

| Component                    | Spec                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Workstation                  | MSI Titan 18 HX AI A2XW or equivalent                                                                        |
| CPU                          | Intel Core Ultra 9 285HX, 24 cores (8P + 16E), 5.5 GHz boost                                                 |
| RAM                          | 192 GB DDR5-5600 (configurable to 256 GB)                                                                    |
| GPU                          | NVIDIA RTX 5090 mobile, 24 GB GDDR7 VRAM                                                                     |
| Storage (boot)               | 2 TB NVMe Gen5 (system + Docker volumes)                                                                     |
| Storage (data)               | 2 TB NVMe Gen5 secondary (PostgreSQL + Neo4j data)                                                           |
| NAS                          | Synology RS3621XS+ (or equivalent), 24 TB usable in RAID-6 (backup tier)                                     |
| UPS                          | APC Smart-UPS SRT 3000VA, 30+ minute runtime at full load                                                    |
| Network                      | 10 GbE to NAS; 1 GbE WAN through ISP fibre; 4G LTE failover via mobile router                                |
| Hardware tokens              | 3 x YubiKey 5C NFC: primary (architect), secondary (architect, sealed), backup (backup architect, escrowed)  |
| Backup architect workstation | ASUS ProArt P16 or equivalent; encrypted, kept offline at backup architect's location, used only on disaster |

### Table 5

| / # @rootfs subvolume /home # @home subvolume /var # @var subvolume /var/lib/docker # @docker subvolume (Docker volumes) /srv/vigil # @vigil subvolume (VIGIL data, snapshotted hourly) /srv/vigil/postgres # PostgreSQL bind mount target /srv/vigil/neo4j # Neo4j bind mount target /srv/vigil/redis # Redis AOF /srv/vigil/ipfs # IPFS data store /srv/vigil/fabric # Fabric peer + orderer state /srv/vigil/vault # Vault encrypted store /srv/vigil/ledger # Polygon signing log /mnt/synology # Mounted Synology NAS (NFSv4) |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 6

| Service                      | Run as            | What it does                                                                                                                                                         |
| ---------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| wireguard@wg0                | systemd unit      | Mesh VPN to N02. Brought up at boot from /etc/wireguard/wg0.conf.                                                                                                    |
| wireguard@wg-admin           | systemd unit      | Admin tunnel to architect's laptop. Activated only during maintenance.                                                                                               |
| vigil-vault-unseal.service   | systemd unit      | Unseals Vault by reading shamir shares from YubiKey via libykcs11. Required before any container starts.                                                             |
| vigil-time.service           | systemd unit      | Pinned NTP to pool.ntp.org with chrony in client mode; serves authoritative time to all containers via the Docker bridge.                                            |
| vigil-polygon-signer.service | systemd unit      | Listens on a Unix socket /run/vigil/polygon-signer.sock; receives transaction-signing requests from worker-anchor; signs using YubiKey secp256k1; returns signed tx. |
| vigil-claude-session.service | systemd user unit | User-level session daemon. Holds the architect's authenticated session for the Anthropic API. Renews tokens; routes worker LLM calls through this daemon.            |
| vigil-watchdog.timer         | systemd timer     | Every 5 minutes, hits each container's healthcheck endpoint, computes a system health gauge, alerts on degradation.                                                  |
| docker.service               | systemd unit      | Runs the Docker engine that hosts N03 through N10.                                                                                                                   |
| fail2ban.service             | systemd unit      | Watches auth logs. Bans IPs that brute-force SSH or WireGuard.                                                                                                       |
| ufw.service                  | systemd unit      | Host firewall. Default deny; only WireGuard, Docker bridge, and outbound HTTPS allowed.                                                                              |

### Table 7

| # /etc/systemd/system/vigil-vault-unseal.service [Unit] Description=VIGIL APEX Vault Unseal Coordinator After=network-online.target docker.service Wants=network-online.target Requires=docker.service [Service] Type=oneshot ExecStart=/usr/local/bin/vigil-vault-unseal EnvironmentFile=/etc/vigil/unseal.env TimeoutStartSec=120 RemainAfterExit=yes # Read 3 of 5 Shamir shares from YubiKey via libykcs11 # (the architect must be present and have entered the YubiKey PIN) [Install] WantedBy=multi-user.target |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 8

| # /etc/systemd/system/vigil-polygon-signer.service [Unit] Description=VIGIL APEX Polygon Transaction Signer (YubiKey-backed) After=network-online.target [Service] Type=notify User=vigil Group=vigil ExecStart=/usr/local/bin/vigil-polygon-signer \ --socket /run/vigil/polygon-signer.sock \ --yubikey-slot 9c \ --pin-cache-seconds 600 Restart=on-failure RestartSec=5 # This daemon never has the private key in memory. # It uses libykcs11 to call the YubiKey for every signing operation. # A 10-minute PIN cache permits batched signing during quorum events. [Install] WantedBy=multi-user.target |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 9

| Service        | Reason it cannot move into a container                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| vault-unseal   | Reads YubiKey-held Shamir shares. Cannot expose YubiKey to a container without breaking the security model. The whole point of YubiKey is that the secret never leaves the hardware. |
| polygon-signer | Same as vault-unseal: signs with secp256k1 key on YubiKey. Cannot expose YubiKey to container.                                                                                       |
| claude-session | Holds the architect's interactive Anthropic API session. Must be tied to the architect's user identity, not a service account, by design.                                            |
| wireguard      | Kernel-level networking. Containerising adds NAT layers and breaks the keepalive timing for NAT traversal.                                                                           |
| chrony (time)  | Wants to set the system clock; this requires CAP_SYS_TIME. Containers should not have CAP_SYS_TIME.                                                                                  |
| docker engine  | Obviously.                                                                                                                                                                           |
| ufw firewall   | Host-level netfilter rules. By definition not containerisable.                                                                                                                       |

### Table 10

| 03  | DOCKER SIMULATION OF N03-N10 How nine logical nodes run as eight containers on one host |
| --- | --------------------------------------------------------------------------------------- |

### Table 11

| # vigil-internal (172.20.0.0/16) 172.20.0.1 gateway (Docker bridge) 172.20.0.10 vigil-postgres (N03) 172.20.0.11 vigil-neo4j (N04) 172.20.0.12 vigil-redis (N05) 172.20.0.13 vigil-ipfs (N06) 172.20.0.14 vigil-fabric (N07) 172.20.0.15 vigil-vault (N08) 172.20.0.16 vigil-keycloak (N09) 172.20.0.17 vigil-dashboard (N10, internal-side) 172.20.0.20 worker-entity 172.20.0.21 worker-pattern 172.20.0.22 worker-score 172.20.0.23 worker-dossier 172.20.0.24 worker-anchor 172.20.0.25 worker-governance 172.20.0.30 vigil-prometheus 172.20.0.31 vigil-grafana 172.20.0.50 reverse-proxy bridge to N02 via WireGuard (10.66.0.2) # vigil-edge (172.21.0.0/24) 172.21.0.1 gateway 172.21.0.10 vigil-dashboard (edge-side, port 443 published) |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 12

| Container         | Memory cap | CPU cap | Notes                                                                               |
| ----------------- | ---------- | ------- | ----------------------------------------------------------------------------------- |
| vigil-postgres    | 16 GB      | 4.0     | shared_buffers=4GB; effective_cache_size=12GB                                       |
| vigil-neo4j       | 32 GB      | 4.0     | heap=16GB; pagecache=14GB; APOC enabled                                             |
| vigil-redis       | 8 GB       | 2.0     | maxmemory=6GB; maxmemory-policy=allkeys-lru for cache keys, no-eviction for streams |
| vigil-ipfs        | 8 GB       | 2.0     | Datastore type=badgerds for performance                                             |
| vigil-fabric      | 12 GB      | 4.0     | Single peer + orderer; raft consensus single-node in MVP                            |
| vigil-vault       | 2 GB       | 1.0     | Lightweight - few in-memory secrets at any time                                     |
| vigil-keycloak    | 4 GB       | 1.0     | Quarkus distribution, JVM heap=2GB                                                  |
| vigil-dashboard   | 4 GB       | 2.0     | Next.js standalone; static where possible                                           |
| worker-entity     | 6 GB       | 2.0     | Loads ER blocking index in memory                                                   |
| worker-pattern    | 8 GB       | 3.0     | Slowest worker - Cypher traversal heavy                                             |
| worker-score      | 4 GB       | 2.0     | LLM-bound; CPU light                                                                |
| worker-dossier    | 3 GB       | 2.0     | PDF render via LibreOffice subprocess                                               |
| worker-anchor     | 1 GB       | 1.0     | Network-bound to Polygon RPC and Fabric                                             |
| worker-governance | 1 GB       | 1.0     | Watches Polygon contract events                                                     |
| vigil-prometheus  | 2 GB       | 1.0     | 30-day retention default                                                            |
| vigil-grafana     | 1 GB       | 1.0     | Static dashboards                                                                   |
| TOTAL allocated   | 112 GB     | 33.0    | Out of 192 GB / 24 cores. Headroom for the host services and operator activities.   |

### Table 13

| 04  | docker-compose.yaml The complete file. Copy, edit env, run. |
| --- | ----------------------------------------------------------- |

### Table 14

| # /infra/docker/docker-compose.yaml # VIGIL APEX - Phase 1 Pilot Stack # Run from /infra/docker with: # docker compose --env-file=../../.env up -d # Stop with: # docker compose down # Pre-start checklist: # 1. Vault must be unsealed (vigil-vault-unseal.service) # 2. WireGuard wg0 must be up (host -> N02) # 3. Btrfs subvolume /srv/vigil must be mounted name: vigil-apex networks: vigil-internal: driver: bridge internal: true ipam: driver: default config: - subnet: 172.20.0.0/16 gateway: 172.20.0.1 vigil-edge: driver: bridge ipam: driver: default config: - subnet: 172.21.0.0/24 gateway: 172.21.0.1 volumes: pg-cache: driver: local npm-cache: driver: local secrets: pg_password: file: /run/vigil/secrets/pg_password redis_password: file: /run/vigil/secrets/redis_password neo4j_password: file: /run/vigil/secrets/neo4j_password keycloak_admin: file: /run/vigil/secrets/keycloak_admin vault_token_worker: file: /run/vigil/secrets/vault_token_worker x-common-env: &common-env TZ: Africa/Douala LANG: en_US.UTF-8 x-restart-policy: &restart restart: unless-stopped |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 15

| vigil-postgres: image: postgres:16.2-alpine container_name: vigil-postgres hostname: vigil-postgres <<: *restart networks: vigil-internal: ipv4_address: 172.20.0.10 volumes: - /srv/vigil/postgres/data:/var/lib/postgresql/data - ./postgres/postgresql.conf:/etc/postgresql/postgresql.conf:ro - ./postgres/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro - ./postgres/init:/docker-entrypoint-initdb.d:ro - /srv/vigil/postgres/wal-archive:/var/lib/postgresql/wal-archive - /etc/localtime:/etc/localtime:ro environment: <<: *common-env POSTGRES_DB: vigil POSTGRES_USER: vigil POSTGRES_PASSWORD_FILE: /run/secrets/pg_password POSTGRES_INITDB_ARGS: "--encoding=UTF-8 --locale=en_US.UTF-8" secrets: - pg_password command: - postgres - -c - config_file=/etc/postgresql/postgresql.conf deploy: resources: limits: memory: 16g cpus: "4.0" healthcheck: test: ["CMD-SHELL", "pg_isready -U vigil -d vigil"] interval: 30s timeout: 10s retries: 3 start_period: 60s logging: driver: json-file options: max-size: "100m" max-file: "5" |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

### Table 16

| vigil-neo4j: image: neo4j:5.18-community container*name: vigil-neo4j hostname: vigil-neo4j <<: *restart networks: vigil-internal: ipv4_address: 172.20.0.11 volumes: - /srv/vigil/neo4j/data:/data - /srv/vigil/neo4j/logs:/logs - /srv/vigil/neo4j/import:/var/lib/neo4j/import - /srv/vigil/neo4j/plugins:/plugins - ./neo4j/neo4j.conf:/conf/neo4j.conf:ro - /etc/localtime:/etc/localtime:ro environment: <<: *common-env NEO4J_AUTH_FILE: /run/secrets/neo4j_password NEO4J_PLUGINS: '["apoc"]' NEO4J_server_memory_heap_initial**size: 16G NEO4J_server_memory_heap_max**size: 16G NEO4J_server_memory_pagecache_size: 14G NEO4J_dbms_security_procedures_unrestricted: "apoc.*,gds.\_" secrets: - neo4j_password deploy: resources: limits: memory: 32g cpus: "4.0" healthcheck: test: ["CMD-SHELL", "wget -qO- http://localhost:7474 \|\| exit 1"] interval: 30s timeout: 10s retries: 3 start_period: 90s |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

### Table 17

| vigil-redis: image: redis:7.2-alpine container_name: vigil-redis hostname: vigil-redis <<: *restart networks: vigil-internal: ipv4_address: 172.20.0.12 volumes: - /srv/vigil/redis/data:/data - ./redis/redis.conf:/usr/local/etc/redis/redis.conf:ro - /etc/localtime:/etc/localtime:ro command: ["redis-server", "/usr/local/etc/redis/redis.conf"] environment: <<: *common-env secrets: - redis_password deploy: resources: limits: memory: 8g cpus: "2.0" healthcheck: test: ["CMD-SHELL", "redis-cli -a $$(cat /run/secrets/redis_password) ping \|\| exit 1"] interval: 30s timeout: 5s retries: 3 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 18

| vigil-ipfs: image: ipfs/kubo:v0.27.0 container_name: vigil-ipfs hostname: vigil-ipfs <<: *restart networks: vigil-internal: ipv4_address: 172.20.0.13 volumes: - /srv/vigil/ipfs/data:/data/ipfs - /srv/vigil/ipfs/staging:/export - ./ipfs/init.sh:/container-init.d/001-init.sh:ro - /etc/localtime:/etc/localtime:ro environment: <<: *common-env IPFS_PROFILE: server deploy: resources: limits: memory: 8g cpus: "2.0" healthcheck: test: ["CMD-SHELL", "ipfs swarm peers > /dev/null 2>&1 \|\| exit 1"] interval: 60s timeout: 10s retries: 3 start_period: 60s |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 19

| vigil-fabric: image: hyperledger/fabric-peer:2.5.5 container_name: vigil-fabric hostname: vigil-fabric <<: *restart networks: vigil-internal: ipv4_address: 172.20.0.14 volumes: - /srv/vigil/fabric/peer:/var/hyperledger/production - ./fabric/core.yaml:/etc/hyperledger/fabric/core.yaml:ro - ./fabric/crypto-config:/etc/hyperledger/fabric/crypto-config:ro - /etc/localtime:/etc/localtime:ro environment: <<: *common-env CORE_PEER_ID: peer0.vigil.local CORE_PEER_ADDRESS: vigil-fabric:7051 CORE_PEER_LISTENADDRESS: 0.0.0.0:7051 CORE_PEER_LOCALMSPID: VigilOrgMSP CORE_PEER_MSPCONFIGPATH: /etc/hyperledger/fabric/crypto-config/msp CORE_PEER_TLS_ENABLED: "true" CORE_LEDGER_STATE_STATEDATABASE: CouchDB CORE_LEDGER_STATE_COUCHDBCONFIG_COUCHDBADDRESS: vigil-fabric-couchdb:5984 deploy: resources: limits: memory: 12g cpus: "4.0" healthcheck: test: ["CMD", "/bin/sh", "-c", "peer node status \|\| exit 1"] interval: 30s timeout: 15s retries: 3 start_period: 120s |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

### Table 20

| vigil-vault: image: hashicorp/vault:1.16 container_name: vigil-vault hostname: vigil-vault <<: *restart cap_add: - IPC_LOCK networks: vigil-internal: ipv4_address: 172.20.0.15 volumes: - /srv/vigil/vault/data:/vault/data - /srv/vigil/vault/logs:/vault/logs - ./vault/config.hcl:/vault/config/config.hcl:ro - /etc/localtime:/etc/localtime:ro environment: <<: *common-env VAULT_ADDR: http://0.0.0.0:8200 VAULT_API_ADDR: http://vigil-vault:8200 command: ["vault", "server", "-config=/vault/config/config.hcl"] deploy: resources: limits: memory: 2g cpus: "1.0" healthcheck: test: ["CMD-SHELL", "wget -qO- http://localhost:8200/v1/sys/health?standbyok=true \| grep -q 'initialized'"] interval: 30s timeout: 5s retries: 3 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 21

| vigil-keycloak: image: quay.io/keycloak/keycloak:24.0 container_name: vigil-keycloak hostname: vigil-keycloak <<: *restart networks: vigil-internal: ipv4_address: 172.20.0.16 volumes: - ./keycloak/realm-export.json:/opt/keycloak/data/import/realm.json:ro - /etc/localtime:/etc/localtime:ro environment: <<: *common-env KEYCLOAK_ADMIN: admin KEYCLOAK_ADMIN_PASSWORD_FILE: /run/secrets/keycloak_admin KC_DB: postgres KC_DB_URL: jdbc:postgresql://vigil-postgres:5432/keycloak KC_DB_USERNAME: keycloak KC_DB_PASSWORD_FILE: /run/secrets/pg_password KC_HOSTNAME: vigil-keycloak KC_HTTP_ENABLED: "true" KC_PROXY: edge KC_FEATURES: webauthn,token-exchange secrets: - keycloak_admin - pg_password command: ["start", "--optimized", "--import-realm"] depends_on: vigil-postgres: condition: service_healthy deploy: resources: limits: memory: 4g cpus: "1.0" healthcheck: test: ["CMD-SHELL", "curl -fsS http://localhost:8080/health/ready \|\| exit 1"] interval: 30s timeout: 10s retries: 5 start_period: 120s |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 22

| vigil-dashboard: build: context: ../../ dockerfile: infra/docker/dockerfiles/Dashboard.Dockerfile image: vigil/dashboard:0.1.0 container_name: vigil-dashboard hostname: vigil-dashboard <<: *restart networks: vigil-internal: ipv4_address: 172.20.0.17 vigil-edge: ipv4_address: 172.21.0.10 volumes: - /etc/localtime:/etc/localtime:ro environment: <<: *common-env NODE_ENV: production DATABASE_URL: postgres://vigil_ro:${PG_RO_PASSWORD}@vigil-postgres:5432/vigil       REDIS_URL: redis://:${REDIS_PASSWORD}@vigil-redis:6379 KEYCLOAK_URL: http://vigil-keycloak:8080 KEYCLOAK_REALM: vigil-apex NEXT_PUBLIC_BASE_URL: https://vigilapex.cm depends_on: vigil-postgres: { condition: service_healthy } vigil-keycloak: { condition: service_healthy } deploy: resources: limits: memory: 4g cpus: "2.0" healthcheck: test: ["CMD-SHELL", "wget -qO- http://localhost:3000/healthz \|\| exit 1"] interval: 30s timeout: 5s retries: 3 start_period: 60s |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

### Table 23

| worker-pattern: build: context: ../../ dockerfile: infra/docker/dockerfiles/WorkerPattern.Dockerfile image: vigil/worker-pattern:0.1.0 container_name: worker-pattern hostname: worker-pattern <<: *restart networks: vigil-internal: ipv4_address: 172.20.0.21 volumes: - /etc/localtime:/etc/localtime:ro environment: <<: *common-env NODE_ENV: production WORKER_NAME: pattern DATABASE_URL: postgres://vigil:${PG_PASSWORD}@vigil-postgres:5432/vigil       NEO4J_URL: bolt://vigil-neo4j:7687       NEO4J_USER: neo4j       REDIS_URL: redis://:${REDIS_PASSWORD}@vigil-redis:6379 VAULT_ADDR: http://vigil-vault:8200 VAULT_TOKEN_FILE: /run/secrets/vault_token_worker LOG_LEVEL: info OTEL_EXPORTER_OTLP_ENDPOINT: http://vigil-prometheus:4317 secrets: - vault_token_worker depends_on: vigil-postgres: { condition: service_healthy } vigil-neo4j: { condition: service_healthy } vigil-redis: { condition: service_healthy } vigil-vault: { condition: service_healthy } deploy: resources: limits: memory: 8g cpus: "3.0" healthcheck: test: ["CMD-SHELL", "wget -qO- http://localhost:9100/health \|\| exit 1"] interval: 15s timeout: 5s retries: 3 start_period: 30s |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 24

| vigil-prometheus: image: prom/prometheus:v2.51.0 container_name: vigil-prometheus networks: [vigil-internal] volumes: - /srv/vigil/prometheus:/prometheus - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro command: - --config.file=/etc/prometheus/prometheus.yml - --storage.tsdb.retention.time=30d <<: *restart deploy: resources: limits: { memory: 2g, cpus: "1.0" } vigil-grafana: image: grafana/grafana:10.4.2 container_name: vigil-grafana networks: [vigil-internal] volumes: - /srv/vigil/grafana:/var/lib/grafana - ./grafana/provisioning:/etc/grafana/provisioning:ro environment: <<: *common-env GF_SECURITY_ADMIN_PASSWORD\_\_FILE: /run/secrets/keycloak_admin GF_AUTH_GENERIC_OAUTH_ENABLED: "true" GF_AUTH_GENERIC_OAUTH_AUTH_URL: http://vigil-keycloak:8080/realms/vigil-apex/protocol/openid-connect/auth secrets: [keycloak_admin] <<: \*restart deploy: resources: limits: { memory: 1g, cpus: "1.0" } |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

### Table 25

| 05  | DOCKERFILES One file per service we build ourselves |
| --- | --------------------------------------------------- |

### Table 26

| # /infra/docker/dockerfiles/Dashboard.Dockerfile FROM node:22-alpine AS deps WORKDIR /app RUN corepack enable COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./ COPY apps/dashboard/package.json apps/dashboard/ COPY packages/auth/package.json packages/auth/ COPY packages/db-postgres/package.json packages/db-postgres/ COPY packages/observability/package.json packages/observability/ RUN pnpm install --frozen-lockfile FROM node:22-alpine AS builder WORKDIR /app COPY --from=deps /app/node_modules ./node_modules COPY . . RUN corepack enable && pnpm --filter dashboard build FROM node:22-alpine AS runtime RUN addgroup --system --gid 1001 vigil && \ adduser --system --uid 1001 --ingroup vigil vigil WORKDIR /app ENV NODE_ENV=production COPY --from=builder --chown=vigil:vigil /app/apps/dashboard/.next/standalone ./ COPY --from=builder --chown=vigil:vigil /app/apps/dashboard/.next/static ./apps/dashboard/.next/static COPY --from=builder --chown=vigil:vigil /app/apps/dashboard/public ./apps/dashboard/public USER vigil EXPOSE 3000 HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \ CMD wget -qO- http://localhost:3000/healthz \|\| exit 1 CMD ["node", "apps/dashboard/server.js"] |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 27

| # /infra/docker/dockerfiles/Worker.Dockerfile # Build-arg WORKER_NAME selects which app to build (entity, pattern, score, dossier, anchor, governance) ARG NODE_VERSION=22-alpine FROM node:${NODE_VERSION} AS deps ARG WORKER_NAME WORKDIR /app RUN corepack enable COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./ COPY apps/worker-${WORKER_NAME}/package.json apps/worker-${WORKER_NAME}/ COPY packages/ ./packages/ RUN pnpm install --frozen-lockfile --filter=worker-${WORKER_NAME}... FROM node:${NODE_VERSION} AS builder ARG WORKER_NAME WORKDIR /app COPY --from=deps /app/node_modules ./node_modules COPY . . RUN corepack enable && pnpm --filter worker-${WORKER_NAME} build FROM node:${NODE_VERSION} AS runtime ARG WORKER_NAME ENV WORKER_NAME=${WORKER_NAME} RUN apk add --no-cache curl tini && \ addgroup --system --gid 1001 vigil && \ adduser --system --uid 1001 --ingroup vigil vigil WORKDIR /app COPY --from=builder --chown=vigil:vigil /app/apps/worker-${WORKER_NAME}/dist ./dist COPY --from=builder --chown=vigil:vigil /app/node_modules ./node_modules COPY --from=builder --chown=vigil:vigil /app/packages ./packages USER vigil EXPOSE 9100 HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \ CMD curl -fsS http://localhost:9100/health \|\| exit 1 ENTRYPOINT ["/sbin/tini", "--"] CMD ["node", "dist/main.js"] |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 28

| # /infra/docker/dockerfiles/AdapterRunner.Dockerfile # This image runs on N02 (Hetzner CPX31). It hosts the 26 crawlers. FROM node:22-bullseye-slim AS deps WORKDIR /app RUN corepack enable COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./ COPY apps/adapter-runner/package.json apps/adapter-runner/ COPY packages/ ./packages/ RUN pnpm install --frozen-lockfile --filter=adapter-runner... FROM node:22-bullseye-slim AS builder WORKDIR /app COPY --from=deps /app/node_modules ./node_modules COPY . . RUN corepack enable && pnpm --filter adapter-runner build FROM node:22-bullseye-slim AS runtime # Playwright + Chromium for JS-heavy government sites RUN apt-get update && apt-get install -y --no-install-recommends \ chromium fonts-liberation libnss3 libxss1 libasound2 \ poppler-utils ghostscript ca-certificates curl tini tor \ && rm -rf /var/lib/apt/lists/\* \ && groupadd --system --gid 1001 vigil \ && useradd --system --uid 1001 --gid 1001 --shell /usr/sbin/nologin vigil ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 WORKDIR /app COPY --from=builder --chown=vigil:vigil /app/apps/adapter-runner/dist ./dist COPY --from=builder --chown=vigil:vigil /app/node_modules ./node_modules COPY --from=builder --chown=vigil:vigil /app/packages ./packages USER vigil EXPOSE 9200 HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \ CMD curl -fsS http://localhost:9200/health \|\| exit 1 ENTRYPOINT ["/sbin/tini", "--"] CMD ["node", "dist/main.js"] |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 29

| Convention | Rule                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Tag        | vigil/<service>:<semver>; e.g. vigil/worker-pattern:0.3.1. Tags are immutable; we never repush a tag.                               |
| Latest tag | We do not use 'latest' in production compose files. Development compose files may, for ergonomics.                                  |
| Multi-arch | amd64 only in pilot. arm64 is a Phase-2 concern.                                                                                    |
| Registry   | Self-hosted Gitea registry at registry.vigilapex.local (internal only). Phase-2 may publish a subset to GHCR for partner mirroring. |
| Provenance | Every image built in CI gets a SLSA provenance attestation. Stored alongside the image. Verified by the deploy script.              |
| SBOM       | Every image build emits a CycloneDX SBOM (syft). SBOMs archived in Synology backup tier.                                            |

### Table 30

| name: build on: [push, pull_request] jobs: build: runs-on: ubuntu-latest strategy: matrix: service: [dashboard, adapter-runner, worker-entity, worker-pattern, worker-score, worker-dossier, worker-anchor, worker-governance] steps: - uses: actions/checkout@v4 - uses: pnpm/action-setup@v3 with: { version: 9 } - uses: actions/setup-node@v4 with: { node-version: 22 } - run: pnpm install --frozen-lockfile - run: pnpm --filter ${{ matrix.service }} test       - run: pnpm --filter ${{ matrix.service }} build       - name: Set up Docker Buildx         uses: docker/setup-buildx-action@v3       - name: Build image         uses: docker/build-push-action@v5         with:           context: .           file: infra/docker/dockerfiles/${{ matrix.service }}.Dockerfile tags: vigil/${{ matrix.service }}:${{ github.sha }} cache-from: type=gha cache-to: type=gha,mode=max - name: SBOM uses: anchore/sbom-action@v0 with: image: vigil/${{ matrix.service }}:${{ github.sha }} format: cyclonedx-json - name: Trivy scan uses: aquasecurity/trivy-action@master with: image-ref: vigil/${{ matrix.service }}:${{ github.sha }} severity: CRITICAL,HIGH exit-code: 1 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 31

| 06  | BRING-UP SEQUENCE What you actually type to start the system |
| --- | ------------------------------------------------------------ |

### Table 32

| # Run as root or with sudo # 0. Verify system state sudo systemctl status wg-quick@wg0 sudo systemctl status vigil-vault-unseal sudo systemctl status vigil-polygon-signer # 1. Pull all third-party images (so first 'up' is fast) cd /opt/vigil/infra/docker docker compose --env-file=../../.env pull # 2. Build first-party images docker compose --env-file=../../.env build --pull # 3. Initialise PostgreSQL (creates databases for vigil + keycloak) docker compose --env-file=../../.env up -d vigil-postgres docker compose --env-file=../../.env exec vigil-postgres \ psql -U vigil -d vigil -f /docker-entrypoint-initdb.d/000-bootstrap.sql # 4. Bring up Vault and seed secrets (one-shot: requires 3-of-5 unseal) docker compose --env-file=../../.env up -d vigil-vault sudo /usr/local/bin/vigil-vault-unseal # Will prompt for YubiKey PIN /usr/local/bin/vigil-vault-seed # Loads /infra/vault/seed.hcl # 5. Run Drizzle migrations docker compose --env-file=../../.env run --rm migrator # 6. Bring up data plane (Neo4j, Redis, IPFS, Fabric) docker compose --env-file=../../.env up -d \ vigil-neo4j vigil-redis vigil-ipfs vigil-fabric # 7. Bring up Keycloak; import realm docker compose --env-file=../../.env up -d vigil-keycloak # 8. Bring up workers docker compose --env-file=../../.env up -d \ worker-entity worker-pattern worker-score \ worker-dossier worker-anchor worker-governance # 9. Bring up dashboard docker compose --env-file=../../.env up -d vigil-dashboard # 10. Verify docker compose --env-file=../../.env ps curl -fsS http://172.20.0.17:3000/healthz curl -fsS http://172.20.0.10:5432 # Connection refused is expected (it's TLS) # 11. Bring up N02 (separate machine) ssh root@vigil-ingest.hetzner.example cd /opt/vigil/infra/docker docker compose --env-file=/etc/vigil/.env up -d adapter-runner |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 33

| # All systemd services have restart=always policies, so this rarely runs. # But for after a power-fail recovery: cd /opt/vigil/infra/docker docker compose --env-file=../../.env up -d sudo /usr/local/bin/vigil-vault-unseal # YubiKey PIN required # Verify all containers report healthy within 3 minutes: watch -n 5 'docker compose ps' |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 34

| # Quiesce workers first (lets in-flight events drain) docker compose stop worker-entity worker-pattern worker-score \ worker-dossier worker-anchor worker-governance # Wait 60s for drain sleep 60 # Stop adapters on N02 (no new events arriving) ssh root@vigil-ingest.hetzner.example "cd /opt/vigil/infra/docker && docker compose stop adapter-runner" # Stop data plane docker compose stop vigil-fabric vigil-ipfs # PostgreSQL last (other things still want to log into it briefly) docker compose stop vigil-keycloak vigil-dashboard vigil-neo4j vigil-redis docker compose stop vigil-postgres # Vault last docker compose stop vigil-vault # Now safe to power off sudo systemctl poweroff |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 35

| # One-time provisioning on a fresh Hetzner CPX31 (Ubuntu 24.04) # Run from architect's laptop: ansible-playbook -i hosts.yml infra/ansible/n02-bootstrap.yml \ --vault-password-file ~/.vigil-vault-pass # What the playbook does: # 1. Installs: docker.io, docker-compose-plugin, wireguard, ufw, fail2ban, certbot, tor # 2. Configures ufw: deny all in, allow 443/tcp + 51820/udp + outbound 443 # 3. Imports WireGuard keys (private to N02, public of N01) via ansible-vault # 4. Brings up wg0 tunnel # 5. Pulls vigil/adapter-runner image # 6. Drops .env file (with API keys read from architect's local Vault) # 7. docker compose up -d adapter-runner # 8. Configures certbot for vigilapex.cm via DNS-01 challenge (Cloudflare API) # 9. Configures caddy as reverse proxy: vigilapex.cm -> 10.66.0.1:3000 (dashboard on N01) # 10. Sets up fail2ban for caddy access logs |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 36

| Check                            | Command                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All containers healthy           | docker compose ps \| grep -v healthy && echo 'ISSUES' \|\| echo 'OK'                                                                                      |
| PostgreSQL accepting connections | docker compose exec vigil-postgres pg_isready -U vigil                                                                                                    |
| Neo4j responding                 | docker compose exec vigil-neo4j cypher-shell -u neo4j -p $(cat /run/vigil/secrets/neo4j_password) 'RETURN 1'                                              |
| Redis responding                 | docker compose exec vigil-redis redis-cli -a $(cat /run/vigil/secrets/redis_password) PING                                                                |
| IPFS up                          | docker compose exec vigil-ipfs ipfs id                                                                                                                    |
| Fabric peer up                   | docker compose exec vigil-fabric peer node status                                                                                                         |
| Vault unsealed                   | curl -s http://172.20.0.15:8200/v1/sys/health \| jq .sealed                                                                                               |
| Keycloak realm imported          | curl -s http://172.20.0.16:8080/realms/vigil-apex/.well-known/openid-configuration \| jq .issuer                                                          |
| Dashboard responding             | curl -s http://172.20.0.17:3000/healthz                                                                                                                   |
| WireGuard to N02                 | wg show wg0 # verify peer 10.66.0.2 has recent handshake                                                                                                  |
| Adapter runner on N02            | ssh root@vigil-ingest.hetzner.example 'docker compose ps'                                                                                                 |
| First adapter polled             | docker compose exec vigil-postgres psql -U vigil -d vigil -c 'SELECT count(\*) FROM source.adapter_runs WHERE finished_at > now() - interval $$1 hour$$;' |

### Table 37

| 07  | PostgreSQL DDL Every CREATE TABLE in the system. Copy and run. |
| --- | -------------------------------------------------------------- |

### Table 38

| -- /packages/db-postgres/migrations/000-bootstrap.sql -- Run by Postgres as superuser on first init (mounted at /docker-entrypoint-initdb.d/) CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS btree_gin; -- Roles CREATE ROLE vigil_ro; -- read-only role for the dashboard CREATE ROLE vigil_rw; -- read-write role for workers CREATE ROLE vigil_admin; -- migrations + ad-hoc -- Application user lineup GRANT vigil_rw TO vigil; -- vigil is the default app user CREATE USER worker WITH LOGIN PASSWORD :'worker_pw' IN ROLE vigil_rw; CREATE USER dashboard WITH LOGIN PASSWORD :'dashboard_pw' IN ROLE vigil_ro; CREATE USER keycloak WITH LOGIN PASSWORD :'keycloak_pw'; CREATE DATABASE keycloak OWNER keycloak; -- Schemas CREATE SCHEMA source AUTHORIZATION vigil; CREATE SCHEMA entity AUTHORIZATION vigil; CREATE SCHEMA finding AUTHORIZATION vigil; CREATE SCHEMA dossier AUTHORIZATION vigil; CREATE SCHEMA governance AUTHORIZATION vigil; CREATE SCHEMA audit AUTHORIZATION vigil; CREATE SCHEMA bus AUTHORIZATION vigil; -- Default privileges ALTER DEFAULT PRIVILEGES IN SCHEMA source, entity, finding, dossier, governance, audit, bus GRANT SELECT ON TABLES TO vigil_ro; ALTER DEFAULT PRIVILEGES IN SCHEMA source, entity, finding, dossier, governance, audit, bus GRANT SELECT, INSERT, UPDATE ON TABLES TO vigil_rw; |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 39

| -- /packages/db-postgres/migrations/001-source.sql CREATE TYPE source.adapter_status AS ENUM ( 'queued', 'running', 'success', 'partial', 'failure', 'rate_limited' ); CREATE TABLE source.adapters ( name text PRIMARY KEY, display_name text NOT NULL, source_kind text NOT NULL CHECK (source_kind IN ('government','regulator','ministry','registry','satellite','open_dataset','commercial')), base_url text NOT NULL, poll_cron text NOT NULL, rate_limit_per_hr int NOT NULL CHECK (rate_limit_per_hr > 0), enabled bool NOT NULL DEFAULT false, config_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() ); CREATE TABLE source.adapter_runs ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), adapter_name text NOT NULL REFERENCES source.adapters(name) ON DELETE RESTRICT, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, status source.adapter_status NOT NULL, items_seen int NOT NULL DEFAULT 0, items_new int NOT NULL DEFAULT 0, items_dupe int NOT NULL DEFAULT 0, bytes_fetched bigint NOT NULL DEFAULT 0, proxy_used text, error_message text ); CREATE INDEX adapter_runs_adapter_started_idx ON source.adapter_runs (adapter_name, started_at DESC); CREATE INDEX adapter_runs_status_idx ON source.adapter_runs (status) WHERE status IN ('failure','partial','rate_limited'); CREATE TABLE source.documents ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), adapter_name text NOT NULL REFERENCES source.adapters(name) ON DELETE RESTRICT, source_url text NOT NULL, ipfs_cid text NOT NULL UNIQUE, sha256 text NOT NULL UNIQUE, raw_mime text NOT NULL, raw_size_bytes bigint NOT NULL, language_iso text, ocr_applied bool NOT NULL DEFAULT false, fetched_at timestamptz NOT NULL DEFAULT now(), fetched_via text NOT NULL DEFAULT 'direct' CHECK (fetched_via IN ('direct','proxy_dc','proxy_residential','tor','playwright')), metadata jsonb NOT NULL DEFAULT '{}'::jsonb ); CREATE INDEX documents_adapter_fetched_idx ON source.documents (adapter_name, fetched_at DESC); CREATE INDEX documents_metadata_gin ON source.documents USING GIN (metadata); CREATE TABLE source.events ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), document_id uuid REFERENCES source.documents(id) ON DELETE RESTRICT, adapter_name text NOT NULL REFERENCES source.adapters(name) ON DELETE RESTRICT, event_type text NOT NULL, payload jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(), dedup_key text NOT NULL, CONSTRAINT events_dedup_unique UNIQUE (adapter_name, dedup_key) ); CREATE INDEX events_type_observed_idx ON source.events (event_type, observed_at DESC); CREATE INDEX events_payload_gin ON source.events USING GIN (payload); CREATE TABLE source.dead_letter ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), adapter_name text NOT NULL, raw_payload jsonb NOT NULL, error text NOT NULL, retry_count int NOT NULL DEFAULT 0, first_seen_at timestamptz NOT NULL DEFAULT now(), last_attempt_at timestamptz NOT NULL DEFAULT now(), resolved bool NOT NULL DEFAULT false, resolved_at timestamptz, resolution text ); CREATE TABLE source.proxy_pool ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), provider text NOT NULL CHECK (provider IN ('brightdata_dc','brightdata_resi','scraperapi','smartproxy','tor','direct')), endpoint text NOT NULL, country_iso2 text, username text, password_enc bytea, active bool NOT NULL DEFAULT true, failure_count int NOT NULL DEFAULT 0, last_used_at timestamptz, cooldown_until timestamptz, created_at timestamptz NOT NULL DEFAULT now() ); CREATE INDEX proxy_pool_active_idx ON source.proxy_pool (provider, active, cooldown_until NULLS FIRST); |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 40

| -- /packages/db-postgres/migrations/002-entity.sql CREATE TYPE entity.entity_type AS ENUM ('company','person','gov_org','project','address'); CREATE TABLE entity.canonical ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), entity_type entity.entity_type NOT NULL, display_name text NOT NULL, display_name_normalised text NOT NULL, country_iso2 text, jurisdiction text, risk_flags text[] NOT NULL DEFAULT ARRAY[]::text[], attributes jsonb NOT NULL DEFAULT '{}'::jsonb, version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT canonical_normalised_jurisdiction_idx UNIQUE NULLS NOT DISTINCT (entity_type, display_name_normalised, jurisdiction) ); CREATE INDEX canonical_display_name_trgm ON entity.canonical USING GIN (display_name gin_trgm_ops); CREATE INDEX canonical_attributes_gin ON entity.canonical USING GIN (attributes); CREATE TABLE entity.aliases ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), canonical_id uuid NOT NULL REFERENCES entity.canonical(id) ON DELETE RESTRICT, alias_text text NOT NULL, alias_normalised text NOT NULL, alias_source text NOT NULL, confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1), observed_at timestamptz NOT NULL DEFAULT now() ); CREATE INDEX aliases_canonical_idx ON entity.aliases (canonical_id); CREATE INDEX aliases_normalised_trgm ON entity.aliases USING GIN (alias_normalised gin_trgm_ops); CREATE TABLE entity.identifiers ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), canonical_id uuid NOT NULL REFERENCES entity.canonical(id) ON DELETE RESTRICT, id_kind text NOT NULL CHECK (id_kind IN ('rccm','tax','open_corporates','open_sanctions','aleph','customs','minmap','minfi_pid')), id_value text NOT NULL, asserted_at timestamptz NOT NULL DEFAULT now(), verified bool NOT NULL DEFAULT false, source_event_id uuid REFERENCES source.events(id), CONSTRAINT identifiers_kind_value_unique UNIQUE (id_kind, id_value) ); CREATE TABLE entity.fusion_events ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), primary_canonical_id uuid NOT NULL REFERENCES entity.canonical(id), merged_canonical_id uuid NOT NULL REFERENCES entity.canonical(id), fusion_method text NOT NULL CHECK (fusion_method IN ('auto','human','rolled_back')), fusion_score numeric(4,3) NOT NULL, feature_breakdown jsonb NOT NULL, decided_at timestamptz NOT NULL DEFAULT now(), decided_by text NOT NULL, CONSTRAINT fusion_no_self CHECK (primary_canonical_id <> merged_canonical_id) ); CREATE INDEX fusion_events_primary_idx ON entity.fusion_events (primary_canonical_id); CREATE TABLE entity.relationships ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), from_id uuid NOT NULL REFERENCES entity.canonical(id), to_id uuid NOT NULL REFERENCES entity.canonical(id), rel_type text NOT NULL CHECK (rel_type IN ('OWNS','DIRECTOR_OF','CONTRACTED_BY','WON_PROJECT', 'LOCATED_AT','SHARES_DIRECTOR_WITH','HISTORICAL_ALIAS')), attributes jsonb NOT NULL DEFAULT '{}'::jsonb, source_event_id uuid REFERENCES source.events(id), observed_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT relationships_from_to_type_unique UNIQUE NULLS NOT DISTINCT (from_id, to_id, rel_type, source_event_id) ); CREATE INDEX relationships_from_idx ON entity.relationships (from_id, rel_type); CREATE INDEX relationships_to_idx ON entity.relationships (to_id, rel_type); |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 41

| -- /packages/db-postgres/migrations/003-finding.sql CREATE TYPE finding.state AS ENUM ( 'detected','reviewed','quorum_pending','escalated','dismissed','superseded' ); CREATE TABLE finding.findings ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), pattern_id text NOT NULL, state finding.state NOT NULL DEFAULT 'detected', certainty numeric(4,3) NOT NULL CHECK (certainty BETWEEN 0 AND 1), detected_at timestamptz NOT NULL DEFAULT now(), primary_entity_id uuid REFERENCES entity.canonical(id), related_entity_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[], transaction_ref text, evidence_root_cid text, bayes_breakdown jsonb, counter_evidence jsonb, updated_at timestamptz NOT NULL DEFAULT now() ); CREATE INDEX findings_state_certainty_idx ON finding.findings (state, certainty DESC); CREATE INDEX findings_pattern_detected_idx ON finding.findings (pattern_id, detected_at DESC); CREATE INDEX findings_primary_entity_idx ON finding.findings (primary_entity_id); CREATE TABLE finding.evidence_links ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), finding_id uuid NOT NULL REFERENCES finding.findings(id) ON DELETE RESTRICT, evidence_kind text NOT NULL CHECK (evidence_kind IN ('document','satellite','registry','llm_assessment','cross_source')), source_event_id uuid REFERENCES source.events(id), source_document_id uuid REFERENCES source.documents(id), weight numeric(4,3) NOT NULL, polarity text NOT NULL CHECK (polarity IN ('corroborating','contradicting','neutral')), payload jsonb NOT NULL DEFAULT '{}'::jsonb ); CREATE INDEX evidence_links_finding_idx ON finding.evidence_links (finding_id); CREATE TABLE finding.state_history ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), finding_id uuid NOT NULL REFERENCES finding.findings(id) ON DELETE RESTRICT, from_state finding.state, to_state finding.state NOT NULL, transitioned_at timestamptz NOT NULL DEFAULT now(), transitioned_by text NOT NULL, reason text ); CREATE TABLE finding.scores_history ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), finding_id uuid NOT NULL REFERENCES finding.findings(id) ON DELETE RESTRICT, certainty numeric(4,3) NOT NULL, method_version text NOT NULL, computed_at timestamptz NOT NULL DEFAULT now(), inputs_hash text NOT NULL ); |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 42

| -- /packages/db-postgres/migrations/004-dossier-governance.sql CREATE TABLE dossier.dossiers ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), dossier_number text NOT NULL UNIQUE, classification text NOT NULL CHECK (classification IN ('PUBLIC','RESTRICTED','CONFIDENTIAL')), title_fr text NOT NULL, title_en text NOT NULL, generated_at timestamptz NOT NULL DEFAULT now(), generator_version text NOT NULL, pdf_cid_fr text, pdf_cid_en text, fabric_tx_id text, polygon_anchor_tx text ); CREATE TABLE dossier.dossier_findings ( dossier_id uuid NOT NULL REFERENCES dossier.dossiers(id) ON DELETE RESTRICT, finding_id uuid NOT NULL REFERENCES finding.findings(id) ON DELETE RESTRICT, inclusion_order int NOT NULL, PRIMARY KEY (dossier_id, finding_id) ); CREATE TABLE dossier.referrals ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), dossier_id uuid NOT NULL REFERENCES dossier.dossiers(id), recipient text NOT NULL CHECK (recipient IN ('conac','minfi')), delivery_method text NOT NULL CHECK (delivery_method IN ('sftp','api')), attempted_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz, delivery_receipt jsonb, status text NOT NULL CHECK (status IN ('queued','sent','ack','failed')) ); CREATE TYPE governance.pillar AS ENUM ('conac','minfi','civil_society','academic','intl_observer'); CREATE TABLE governance.council_members ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), pillar governance.pillar NOT NULL, display_name text NOT NULL, email text NOT NULL UNIQUE, public_key text, eth_address text NOT NULL UNIQUE, active_from date NOT NULL, active_to date ); CREATE TABLE governance.proposals ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), finding_id uuid NOT NULL REFERENCES finding.findings(id), proposal_kind text NOT NULL CHECK (proposal_kind IN ('escalate','dismiss','request_more_evidence')), opened_at timestamptz NOT NULL DEFAULT now(), closes_at timestamptz NOT NULL, state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','escalated','dismissed','archived')), on_chain_proposal_id bytea, on_chain_open_tx text ); CREATE TABLE governance.votes ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), proposal_id uuid NOT NULL REFERENCES governance.proposals(id), council_member_id uuid NOT NULL REFERENCES governance.council_members(id), choice text NOT NULL CHECK (choice IN ('yes','no','abstain','recuse')), cast_at timestamptz NOT NULL DEFAULT now(), on_chain_tx text NOT NULL, signature text, CONSTRAINT votes_unique_per_member UNIQUE (proposal_id, council_member_id) ); |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 43

| -- /packages/db-postgres/migrations/005-audit.sql CREATE TABLE audit.actions ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), occurred_at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL, actor_kind text NOT NULL CHECK (actor_kind IN ('human','worker','contract','system')), action text NOT NULL, resource_kind text, resource_id text, payload jsonb NOT NULL DEFAULT '{}'::jsonb, prev_hash text, this_hash text NOT NULL UNIQUE ); CREATE INDEX actions_occurred_idx ON audit.actions (occurred_at DESC); CREATE INDEX actions_actor_idx ON audit.actions (actor, occurred_at DESC); CREATE TABLE audit.checkpoints ( id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), checkpointed_at timestamptz NOT NULL DEFAULT now(), last_action_id uuid NOT NULL REFERENCES audit.actions(id), root_hash text NOT NULL, fabric_tx_id text NOT NULL, polygon_tx text ); -- Trigger to compute hash chain on insert CREATE OR REPLACE FUNCTION audit.compute_hash() RETURNS trigger AS $$ DECLARE prev_h text; canonical text; BEGIN SELECT this_hash INTO prev_h FROM audit.actions ORDER BY occurred_at DESC, id DESC LIMIT 1; NEW.prev_hash = prev_h; canonical = COALESCE(prev_h,'') \|\| '\|' \|\| NEW.occurred_at::text \|\| '\|' \|\| NEW.actor \|\| '\|' \|\| NEW.action \|\| '\|' \|\| COALESCE(NEW.resource_id,'') \|\| '\|' \|\| NEW.payload::text; NEW.this_hash = encode(digest(canonical, 'sha256'), 'hex'); RETURN NEW; END; $$ LANGUAGE plpgsql; CREATE TRIGGER audit_actions_hash_trigger BEFORE INSERT ON audit.actions FOR EACH ROW EXECUTE FUNCTION audit.compute_hash(); |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 44

| 08  | NEO4J + REDIS Graph constraints + message bus schema |
| --- | ---------------------------------------------------- |

### Table 45

| // /packages/db-neo4j/migrations/001-schema.cypher // Uniqueness constraints CREATE CONSTRAINT company_id IF NOT EXISTS FOR (c:Company) REQUIRE c.id IS UNIQUE; CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE; CREATE CONSTRAINT govorg_id IF NOT EXISTS FOR (g:GovOrg) REQUIRE g.id IS UNIQUE; CREATE CONSTRAINT project_id IF NOT EXISTS FOR (pr:Project) REQUIRE pr.id IS UNIQUE; CREATE CONSTRAINT document_cid IF NOT EXISTS FOR (d:Document) REQUIRE d.cid IS UNIQUE; CREATE CONSTRAINT finding_id IF NOT EXISTS FOR (f:Finding) REQUIRE f.id IS UNIQUE; CREATE CONSTRAINT address_geohash IF NOT EXISTS FOR (a:Address) REQUIRE a.geohash IS UNIQUE; // Existence constraints (Community Edition supports these via APOC triggers) CALL apoc.periodic.repeat('check-company-name', ' MATCH (c:Company) WHERE c.display_name IS NULL RETURN count(c) AS bad ', 3600); // Indexes for query performance CREATE INDEX company_display_name IF NOT EXISTS FOR (c:Company) ON (c.display_name); CREATE INDEX person_display_name IF NOT EXISTS FOR (p:Person) ON (p.display_name); CREATE INDEX project_authority IF NOT EXISTS FOR (pr:Project) ON (pr.contracting_authority); CREATE INDEX finding_pattern IF NOT EXISTS FOR (f:Finding) ON (f.pattern_id, f.detected_at); // Full-text indexes for fuzzy entity matching CREATE FULLTEXT INDEX entity_names_fts IF NOT EXISTS FOR (n:Company\|Person\|GovOrg) ON EACH [n.display_name]; // Composite range indexes CREATE INDEX company_country_state_owned IF NOT EXISTS FOR (c:Company) ON (c.country_iso2, c.is_state_owned); |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 46

| // Find companies sharing 2+ directors with another company MATCH (a:Company)<-[:DIRECTOR_OF]-(p:Person)-[:DIRECTOR_OF]->(b:Company) WHERE a.id <> b.id WITH a, b, count(p) AS shared_directors WHERE shared_directors >= 2 RETURN a.display_name, b.display_name, shared_directors ORDER BY shared_directors DESC LIMIT 100; // Beneficial owner chain up to 4 hops MATCH path = (target:Company {id: $target_id})<-[:OWNS*1..4]-(beneficiary) RETURN path, [r IN relationships(path) \| r.percent] AS percentages; // Address-sharing cluster (P-F-003) MATCH (a:Address)<-[:LOCATED_AT]-(c:Company) WITH a, collect(c) AS companies WHERE size(companies) >= 4 RETURN a.normalised_form, [c IN companies \| c.display_name] AS company_names; |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

### Table 47

| # Redis configuration (/infra/docker/redis/redis.conf) maxmemory 6gb maxmemory-policy noeviction # streams must not be evicted; LRU for cache keys via prefix policy appendonly yes appendfsync everysec save "" # no RDB by default; AOF is enough requirepass <from secret file> notify-keyspace-events KEA # Stream namespacing # bus:source:raw - raw events from adapters # bus:entity:canon - canonicalised entity events # bus:finding:detected - pattern matches # bus:finding:scored - certainty-scored findings # bus:dossier:ready - dossiers ready to anchor # bus:anchor:committed - findings anchored on chain # bus:gov:quorum - quorum reached events # Cache namespaces (with TTL) # cache:llm:<hash> - LLM call results (1 day TTL) # cache:adapter:<name>:lastpoll - last-poll cursor per adapter # cache:rate:<adapter> - rate-limit token buckets (Lua atomic) |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 48

| // /packages/bus/setup.ts (run once on first deploy) const streams = [ 'bus:source:raw', 'bus:entity:canon', 'bus:finding:detected', 'bus:finding:scored', 'bus:dossier:ready', 'bus:anchor:committed', 'bus:gov:quorum', ]; const groups = { 'bus:source:raw' : 'g-entity', 'bus:entity:canon' : 'g-pattern', 'bus:finding:detected' : 'g-score', 'bus:finding:scored' : 'g-dossier', 'bus:dossier:ready' : 'g-anchor', 'bus:anchor:committed' : 'g-gov', 'bus:gov:quorum' : 'g-release', }; for (const s of streams) { await redis.xgroupCreate(s, groups[s], '$', { mkStream: true }) .catch(e => { if (!e.message.includes('BUSYGROUP')) throw e; }); } |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 49

| Rule                           | Implementation                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL is authoritative    | Every Neo4j node and every Redis stream message must derive from a PostgreSQL row that committed first. Workers write to PostgreSQL inside a transaction, then emit to Redis after commit, then write to Neo4j on consume.                  |
| Neo4j is reproducible from PG  | /infra/scripts/rehydrate-neo4j.ts walks all rows in entity.canonical, entity.relationships, finding.findings and reconstructs the graph from scratch. Tested monthly. The full rehydration takes about 4 minutes for the MVP-sized dataset. |
| Redis loss is recoverable      | AOF persistence + per-event idempotency keys. If Redis loses recent stream entries, replaying from PostgreSQL covers the loss. Workers carry a 're-emit' command that walks PostgreSQL within a window and re-publishes.                    |
| IPFS pin failure is detectable | Every CID written to PostgreSQL is later read back via IPFS GET; failures are queued for re-pin. Hourly rclone mirror to Synology provides defence in depth.                                                                                |

### Table 50

| 09  | SUPPORTING CONFIGS Postgres, Redis, Neo4j, Vault, Caddy |
| --- | ------------------------------------------------------- |

### Table 51

| # /infra/docker/postgres/postgresql.conf listen_addresses = '\*' max_connections = 200 # Memory shared_buffers = 4GB effective_cache_size = 12GB work_mem = 32MB maintenance_work_mem = 1GB # WAL wal_level = replica max_wal_size = 4GB min_wal_size = 1GB archive_mode = on archive_command = 'cp %p /var/lib/postgresql/wal-archive/%f' checkpoint_timeout = 15min checkpoint_completion_target = 0.9 # Logging log_destination = 'stderr,csvlog' logging_collector = on log_directory = 'log' log_filename = 'postgresql-%Y-%m-%d.log' log_min_duration_statement = 250 # log slow queries log_lock_waits = on log_connections = on log_disconnections = on # Stats shared_preload_libraries = 'pg_stat_statements' pg_stat_statements.max = 10000 pg_stat_statements.track = all # Locale timezone = 'Africa/Douala' lc_messages = 'en_US.UTF-8' |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 52

| # /infra/docker/postgres/pg_hba.conf # TYPE DATABASE USER ADDRESS METHOD local all all trust host all vigil 172.20.0.0/16 scram-sha-256 host all worker 172.20.0.0/16 scram-sha-256 host all dashboard 172.20.0.0/16 scram-sha-256 host keycloak keycloak 172.20.0.0/16 scram-sha-256 host replication replicator 172.20.0.0/16 scram-sha-256 # Reject everything else host all all 0.0.0.0/0 reject |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 53

| # /infra/docker/vault/config.hcl ui = true disable_mlock = false api_addr = "http://vigil-vault:8200" cluster_addr = "http://vigil-vault:8201" storage "file" { path = "/vault/data" } listener "tcp" { address = "0.0.0.0:8200" tls_disable = "true" # Inside vigil-internal only; mTLS to be enabled in M3 } audit { device "file" { file_path = "/vault/logs/audit.log" mode = "0640" log_raw = "false" } } # Auto-unseal NOT used in MVP. Manual unseal via vigil-vault-unseal.service which # reads 3-of-5 Shamir shares from the architect's YubiKey. |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 54

| # /etc/caddy/Caddyfile (on N02 Hetzner) { email architect@vigilapex.cm servers { trusted_proxies static private_ranges } } vigilapex.cm { encode gzip zstd reverse_proxy 10.66.0.1:3000 { header_up Host {host} header_up X-Real-IP {remote_host} header_up X-Forwarded-For {remote_host} } log { output file /var/log/caddy/access.log { roll_size 100mb roll_keep 14 } format json } header { Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" X-Content-Type-Options "nosniff" X-Frame-Options "DENY" Referrer-Policy "strict-origin-when-cross-origin" Permissions-Policy "geolocation=(), microphone=(), camera=()" Content-Security-Policy "default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'" } } # council subdomain (council portal - same backend, different SPA route) council.vigilapex.cm { reverse_proxy 10.66.0.1:3000 { header_up Host council.vigilapex.cm } } # Verify endpoint (public anchor verification) verify.vigilapex.cm { reverse_proxy 10.66.0.1:3000 { header_up Host verify.vigilapex.cm } } |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 55

| 10  | CAMEROON PUBLIC DATA SOURCES Every URL we crawl. Real, verified April 2026. |
| --- | --------------------------------------------------------------------------- |

### Table 56

| #   | Source                                 | URL (April 2026)                                                    | Format      | Adapter ID     |
| --- | -------------------------------------- | ------------------------------------------------------------------- | ----------- | -------------- |
| 1   | MINMAP - Ministry of Public Contracts  | https://minmap.cm/                                                  | HTML + PDF  | minmap-portal  |
| 2   | MINMAP Categorisation portal           | https://categorisation.minmap.cm/                                   | HTML        | minmap-cat     |
| 3   | ARMP - Procurement Regulatory Agency   | https://armp.cm/                                                    | HTML + PDF  | armp-main      |
| 4   | COLEPS - National e-procurement system | https://www.marchespublics.cm/                                      | HTML + JSON | coleps-tenders |
| 5   | COLEPS - Project Programming list      | https://www.marchespublics.cm:8081/ep/plan/moveToEpPlanTotalList.do | HTML        | coleps-plan    |

### Table 57

| #   | Source                              | URL                     | Format     | Adapter ID      |
| --- | ----------------------------------- | ----------------------- | ---------- | --------------- |
| 6   | MINFI - Ministry of Finance         | https://minfi.gov.cm/   | HTML + PDF | minfi-portal    |
| 7   | DGB - Direction Generale du Budget  | https://www.dgb.cm/     | HTML + PDF | dgb-budget      |
| 8   | DGTCFM - Treasury and Monetary Coop | https://dgtcfm.cm/      | HTML + PDF | dgtcfm-treasury |
| 9   | DGTCFM - Voucher inquiry            | https://bons.dgtcfm.cm/ | HTML form  | dgtcfm-bons     |
| 10  | MINEPAT - Economy and Planning      | https://minepat.gov.cm/ | HTML + PDF | minepat-bip     |

### Table 58

| #   | Source                         | URL (verify on first contact) | Format     | Adapter ID       |
| --- | ------------------------------ | ----------------------------- | ---------- | ---------------- |
| 11  | MINTP - Public Works           | https://www.mintp.cm/         | HTML + PDF | mintp-tenders    |
| 12  | MINEE - Water and Energy       | https://www.minee.cm/         | HTML + PDF | minee-tenders    |
| 13  | MINSANTE - Health              | https://www.minsante.cm/      | HTML + PDF | minsante-tenders |
| 14  | MINEDUB - Basic Education      | https://www.minedub.cm/       | HTML + PDF | minedub-tenders  |
| 15  | MINESEC - Secondary Education  | https://www.minesec.cm/       | HTML + PDF | minesec-tenders  |
| 16  | MINHDU - Housing and Urban Dev | https://www.minhdu.gov.cm/    | HTML + PDF | minhdu-tenders   |

### Table 59

| #   | Source                        | URL                                                                                           | Format           | Adapter ID             |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------- | ---------------- | ---------------------- |
| 17  | RCCM - Commercial Registry    | https://www.rccm-cameroun.cm/ (verify; OHADA portal alternative: https://www.rccm-ohada.org/) | HTML form        | rccm-search            |
| 18  | Cour des Comptes              | https://www.consupe.cm/ (Supreme Court audit reports)                                         | PDF              | courdescomptes-reports |
| 19  | Journal Officiel (Gazette)    | https://www.spm.gov.cm/ (Services du Premier Ministre)                                        | PDF + HTML index | jo-gazette             |
| 20  | ANIF - Financial Intelligence | https://anif.cm/ (PEP and AML signals)                                                        | HTML + PDF       | anif-pep               |

### Table 60

| #   | Source               | URL                                         | Format         | Adapter ID         |
| --- | -------------------- | ------------------------------------------- | -------------- | ------------------ |
| 21  | OpenSanctions        | https://www.opensanctions.org/ (API)        | JSON API       | opensanctions-diff |
| 22  | OCCRP Aleph          | https://aleph.occrp.org/api/2/              | JSON API       | aleph-search       |
| 23  | OpenCorporates       | https://api.opencorporates.com/             | JSON API       | opencorporates     |
| 24  | World Bank Open Data | https://api.worldbank.org/v2/               | JSON API       | wb-benchmarks      |
| 25  | AfDB Disclosure      | https://projectsportal.afdb.org/dataportal/ | HTML + JSON    | afdb-disclosure    |
| 26  | GDELT Project        | https://www.gdeltproject.org/data.html      | BigQuery + CSV | gdelt-events       |

### Table 61

| 11  | CRAWLER ARCHITECTURE How a crawler is built, scheduled, retried |
| --- | --------------------------------------------------------------- |

### Table 62

| // /packages/adapter-core/src/Adapter.ts import { z } from 'zod'; export type SourceKind = 'government' \| 'regulator' \| 'ministry' \| 'registry' \| 'satellite' \| 'open*dataset' \| 'commercial'; export interface PollContext { cursor: unknown; // last successful poll cursor (per-adapter shape) proxy: ProxyHandle \| null; logger: Logger; signal: AbortSignal; http: HttpClient; browser: BrowserPool; } export interface RawItem { url: string; fetchedAt: Date; body: Buffer \| string; mime: string; metadata: Record<string, unknown>; } export interface NormalisedEvent { eventType: string; payload: unknown; dedupKey: string; observedAt: Date; language?: string; } export abstract class Adapter { abstract readonly name: string; abstract readonly displayName: string; abstract readonly sourceKind: SourceKind; abstract readonly baseUrl: string; abstract readonly schedule: string; // cron expression abstract readonly rateLimitPerHour: number; abstract readonly proxyClass: 'datacenter' \| 'residential' \| 'tor' \| 'direct'; abstract readonly outputSchema: z.ZodSchema; abstract pollOnce(ctx: PollContext): Promise<RawItem[]>; abstract normalise(item: RawItem): NormalisedEvent \| NormalisedEvent[]; computeDedupKey(item: RawItem): string { return sha256(item.url + '\|' + (item.metadata.lastModified ?? '')); } async shutdown(): Promise<void> { /* default no-op \_/ } } |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 63

| Error class                | Policy                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP 5xx                   | Exponential backoff. Initial 30s, doubles, max 60min, jitter +/-20%, up to 5 attempts. After exhaustion: dead-letter.                             |
| HTTP 429 (rate limit)      | Read Retry-After header if present, else 60min. Pause adapter (entire adapter, not just one request) for the duration. Resume after the cooldown. |
| Connection timeout         | Same as 5xx.                                                                                                                                      |
| DNS resolution failure     | Pause adapter for 1 hour, raise P2 alert. (Indicates source domain change or our DNS broken.)                                                     |
| Schema parse failure       | Dead-letter immediately. Source structure change requires manual review.                                                                          |
| Captcha challenge detected | Pause adapter; raise P2 alert; architect addresses manually (rotate proxy, switch to residential, escalate to source).                            |
| TLS handshake failure      | Same as 5xx, but if persistent over 3 hours raise P1 alert.                                                                                       |
| Authentication failure     | Should never happen on public sources. Immediate P1 alert.                                                                                        |

### Table 64

| 12  | PER-CRAWLER SPECIFICATIONS All 26 crawlers, one entry each |
| --- | ---------------------------------------------------------- |

### Table 65

| Property         | Value                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source           | MINMAP - Ministry of Public Contracts                                                                                                                     |
| Base URL         | https://minmap.cm/                                                                                                                                        |
| What we want     | Tender notices, ministerial decisions, programming announcements, regional archives                                                                       |
| Method           | Playwright headless Chromium (the site uses Joomla with JS-rendered menus)                                                                                |
| Pages crawled    | /index.php?cat=1 (programming), /index.php?option=com_content (announcements), /textes (legal texts), regional pages /region/{adamaoua\|centre\|est\|...} |
| Schedule         | Every 60 minutes                                                                                                                                          |
| Rate limit       | 10 req/hr (we go gentle on a Joomla site)                                                                                                                 |
| Proxy class      | datacenter (Bright Data DC pool)                                                                                                                          |
| Dedup key        | sha256(url + last-modified-header \|\| page hash)                                                                                                         |
| Output events    | minmap.tender_notice, minmap.decision, minmap.programming, minmap.regional_news                                                                           |
| Pagination       | Joomla page=N parameter; we walk from 0 to first empty page                                                                                               |
| PDFs encountered | Pinned to IPFS, OCR'd if scanned, language-detected, stored as source.documents with adapter_name='minmap-portal'                                         |
| Failure budget   | 98% successful polls per 30 days                                                                                                                          |

### Table 66

| Property            | Value                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source              | ARMP - Procurement Regulatory Agency                                                                                                                                                                                    |
| Base URL            | https://armp.cm/                                                                                                                                                                                                        |
| What we want        | Tender announcements, addenda, awards, addendums to fee deadlines, debarment decisions, regulatory communiques                                                                                                          |
| Method              | Playwright (the site loads announcement HTML via a CMS that benefits from headless rendering for consistent DOM)                                                                                                        |
| Pages crawled       | / (front), /actualites/, /communiques/, /textes-reglementaires/, /publications/                                                                                                                                         |
| Schedule            | Every 30 minutes (more aggressive - this is the regulator)                                                                                                                                                              |
| Rate limit          | 20 req/hr                                                                                                                                                                                                               |
| Proxy class         | datacenter rotating                                                                                                                                                                                                     |
| Dedup key           | Composite (announcement-id, version-date, page-checksum)                                                                                                                                                                |
| Output events       | armp.tender_announcement, armp.addendum, armp.award, armp.debarment, armp.communique                                                                                                                                    |
| Critical extraction | Tender announcements include AONO/AONR codes (national/regional open tender), AONIF/AONI (international/restricted). Extract reference number, contracting authority, sector, deadline, estimated amount where present. |
| Failure budget      | 99% (this is critical path)                                                                                                                                                                                             |

### Table 67

| Property            | Value                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source              | COLEPS - Cameroon Online E-Procurement System                                                                                                                                                                      |
| Base URL            | https://www.marchespublics.cm/                                                                                                                                                                                     |
| What we want        | All tenders published nationally - this is the e-procurement consolidation platform. Highest-value source.                                                                                                         |
| Method              | Playwright + targeted JSON capture. The portal is built on a JEUS or similar Java EE stack (the .do URLs are a giveaway). We intercept network traffic during navigation to capture JSON payloads where available. |
| Pages crawled       | /ep/plan/moveToEpPlanTotalList.do (project programming), /ep/notice/moveToEpNoticeList.do (notices), /ep/award/moveToEpAwardList.do (awards), per-region drill-down pages.                                         |
| Schedule            | Every 30 minutes                                                                                                                                                                                                   |
| Rate limit          | 30 req/hr (highest rate of any crawler)                                                                                                                                                                            |
| Proxy class         | datacenter rotating, with cookie pool (the platform uses sessions)                                                                                                                                                 |
| Dedup key           | (notice_reference_number, version_timestamp)                                                                                                                                                                       |
| Output events       | coleps.programming, coleps.notice_published, coleps.notice_amended, coleps.award_published                                                                                                                         |
| Session handling    | Acquire JSESSIONID via initial load; reuse for paginated requests until 401/403 or 30min idle, then re-acquire.                                                                                                    |
| Critical extraction | Project ID, AONO/AONR/AONIF code, ministry, region, NACE category, estimated amount in XAF, opening date, planned start, contractor (post-award).                                                                  |
| Failure budget      | 99%                                                                                                                                                                                                                |

### Table 68

| Property       | Value                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source         | MINFI - Ministry of Finance                                                                                                                                                                          |
| Base URL       | https://minfi.gov.cm/                                                                                                                                                                                |
| What we want   | Finance laws (loi de finances), execution reports, circulaires (operational instructions), MTEF documents, public debt summaries                                                                     |
| Method         | Playwright. WordPress backend with custom theme; some content is in PDF /wp-content/uploads/.                                                                                                        |
| Pages crawled  | / (front - news), /publications/, /lois-de-finances/, /budget-2026/ (year rotates), /circulaires/, /economie/.                                                                                       |
| Schedule       | Every 60 minutes                                                                                                                                                                                     |
| Rate limit     | 15 req/hr                                                                                                                                                                                            |
| Proxy class    | datacenter                                                                                                                                                                                           |
| PDFs           | MINFI publishes most substantive documents as PDF. We capture the link, fetch, IPFS-pin, OCR if scanned, and emit a minfi.publication event with extracted text + structured fields where available. |
| Output events  | minfi.news, minfi.law_published, minfi.circulaire, minfi.execution_report, minfi.publication                                                                                                         |
| Failure budget | 98%                                                                                                                                                                                                  |

### Table 69

| Property      | Value                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Source        | DGB - Direction Generale du Budget                                                                          |
| Base URL      | https://www.dgb.cm/                                                                                         |
| What we want  | Budget documents per ministry, programming, allocation tables, transfer letters to local authorities (RLAs) |
| Method        | Playwright                                                                                                  |
| Schedule      | Every 4 hours                                                                                               |
| Rate limit    | 10 req/hr                                                                                                   |
| Proxy class   | datacenter                                                                                                  |
| Output events | dgb.budget_doc, dgb.transfer_letter, dgb.allocation_table                                                   |

### Table 70

| Property      | Value                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sources       | DGTCFM main + voucher inquiry                                                                                                                                                        |
| URLs          | https://dgtcfm.cm/ and https://bons.dgtcfm.cm/                                                                                                                                       |
| What we want  | Treasury bills (BTA), Treasury bonds (OTA) issuance announcements; voucher data for traceability of state payments                                                                   |
| Method        | Playwright. The bons.dgtcfm.cm interface is a form lookup; we crawl only PUBLIC voucher data (status of issued vouchers) NOT private-side details.                                   |
| Schedule      | Daily                                                                                                                                                                                |
| Rate limit    | 10 req/hr                                                                                                                                                                            |
| Proxy class   | datacenter                                                                                                                                                                           |
| Critical note | We do NOT submit voucher inquiries with private numbers. We crawl only the public listings of issuances and the published voucher status pages. Private-data access is out of scope. |
| Output events | dgtcfm.bta_issuance, dgtcfm.ota_issuance, dgtcfm.voucher_public                                                                                                                      |

### Table 71

| Property            | Value                                                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source              | MINEPAT - Economy, Planning, Regional Development                                                                                                                                                                                                                                         |
| Base URL            | https://minepat.gov.cm/                                                                                                                                                                                                                                                                   |
| What we want        | BIP (Public Investment Budget) execution reports, project journals, development strategy documents (SND30), execution rate releases per region/quarter                                                                                                                                    |
| Method              | Playwright. WordPress; PDFs at /ova_doc/ paths.                                                                                                                                                                                                                                           |
| Schedule            | Daily                                                                                                                                                                                                                                                                                     |
| Rate limit          | 10 req/hr                                                                                                                                                                                                                                                                                 |
| Proxy class         | datacenter                                                                                                                                                                                                                                                                                |
| Critical extraction | BIP execution rates by region, by quarter, by ministry. These are the headline performance metrics that matter for cross-checking pattern P-D-001 (satellite-verified non-construction). When MINEPAT reports a 90%+ execution rate in a region, our satellite checks should corroborate. |
| Output events       | minepat.bip_execution, minepat.project_journal, minepat.strategy_doc                                                                                                                                                                                                                      |

### Table 72

| Property               | Value                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sources                | MINTP, MINEE, MINSANTE, MINEDUB, MINESEC, MINHDU                                                                                                                                   |
| What we want           | Sector-specific tender announcements posted on the ministry website (in addition to MINMAP/COLEPS), execution reports, project visit press releases, ministerial decisions         |
| Method                 | Playwright with shared crawler logic in /packages/adapters/sectoral/. Each ministry has overrides for: site root, tender list selector, PDF link patterns, dating conventions.     |
| Schedule               | Every 4 hours                                                                                                                                                                      |
| Rate limit             | 5 req/hr per ministry (gentle)                                                                                                                                                     |
| Proxy class            | datacenter                                                                                                                                                                         |
| Output events          | {ministry}.tender_notice, {ministry}.execution_report, {ministry}.press_release                                                                                                    |
| First-contact protocol | On first crawl: fetch /robots.txt, fetch home page, save site map to /infra/sites/{ministry}.yaml so the developer / architect can verify selectors are correct before going live. |

### Table 73

| Property         | Value                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source           | RCCM - Commercial Registry                                                                                                                                                             |
| Base URL         | Verify on first contact (national portal vs OHADA federated portal)                                                                                                                    |
| What we want     | Company registrations: company name, RCCM ID, NACE category, registered address, directors, beneficial owners (where declared)                                                         |
| Method           | Form-based scraping; some RCCM regional portals require captcha                                                                                                                        |
| Schedule         | Driven by entity-resolution events. When entity resolver encounters an RCCM ID it has not seen, it triggers a targeted lookup. Plus a daily delta scan for newly registered companies. |
| Rate limit       | 20 req/hr (very gentle)                                                                                                                                                                |
| Proxy class      | residential (Bright Data residential pool, CM-routed)                                                                                                                                  |
| Captcha handling | If captcha appears, route to 2Captcha solver service. Cost about 0.001 USD per solve. Cap at 100 solves/day.                                                                           |
| Output events    | rccm.company_registered, rccm.statutory_filing, rccm.beneficial_owner_change                                                                                                           |

### Table 74

| Property          | Value                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source            | Cour des Comptes (under Supreme Court)                                                                                                                                           |
| Base URL          | https://www.consupe.cm/ (verify; alternative: dedicated Cour des Comptes site if launched)                                                                                       |
| What we want      | Annual public-audit reports - 200+ page PDFs documenting irregularities found by the auditor                                                                                     |
| Method            | Direct fetch of the publications page; PDF download; Textract OCR (the older reports are scanned)                                                                                |
| Schedule          | Daily check; full re-OCR happens on first ingestion only                                                                                                                         |
| Rate limit        | 5 req/day                                                                                                                                                                        |
| Proxy class       | direct (no proxy needed for this site)                                                                                                                                           |
| Critical handling | These reports are gold for calibration. We extract every named entity, every irregularity-type tag, every monetary amount. The text extracted feeds the pattern calibration set. |
| Output events     | courdescomptes.report_published, courdescomptes.entity_mention, courdescomptes.irregularity                                                                                      |

### Table 75

| Property      | Value                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Source        | Journal Officiel de la Republique du Cameroun                                                                                     |
| Base URL      | https://www.spm.gov.cm/ (Services du Premier Ministre - JO publication)                                                           |
| What we want  | Decrees, ministerial appointments, public-entity creations, presidential ordinances. The legal record of who is in what position. |
| Method        | Playwright + PDF extraction                                                                                                       |
| Schedule      | Every 4 hours (Friday burst handling)                                                                                             |
| Rate limit    | 20 req/hr                                                                                                                         |
| Proxy class   | datacenter                                                                                                                        |
| Output events | jo.decree, jo.appointment, jo.entity_creation, jo.ordinance                                                                       |

### Table 76

| Property      | Value                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| Source        | ANIF - Agence Nationale d'Investigation Financiere                                          |
| Base URL      | https://anif.cm/ (verify URL on first contact)                                              |
| What we want  | PEP guidance, AML alerts, public sanctions communiques (where ANIF chooses to publish them) |
| Method        | Playwright                                                                                  |
| Schedule      | Daily                                                                                       |
| Rate limit    | 5 req/hr                                                                                    |
| Proxy class   | datacenter                                                                                  |
| Output events | anif.pep_alert, anif.communique                                                             |

### Table 77

| Property           | Value                                                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| opensanctions-diff | Polls the OpenSanctions diff API every 6 hours. Pulls only deltas. JSON-native; no scraping. Free tier sufficient for MVP. Contract: GET https://api.opensanctions.org/datasets/peps/diff?since=<timestamp>                 |
| aleph-search       | Polls Aleph search for any entity name our resolver newly canonicalised. Free API key required. https://aleph.occrp.org/api/2/entities?q={name}                                                                             |
| opencorporates     | Triggered by entity-resolution: when we have an OpenCorporates jurisdiction code + company number candidate, we look up the canonical record. Paid API; cost-managed via budget cap.                                        |
| wb-benchmarks      | Pulls World Bank development indicators relevant to procurement-price reasonableness. Weekly. Free.                                                                                                                         |
| afdb-disclosure    | AfDB project portal. Daily. Free. We extract project codes for cross-reference (a project with both Cameroon government AND AfDB co-financing should appear in both sources).                                               |
| gdelt-events       | GDELT 2.0 events feed. Pulled every 15 minutes via BigQuery free tier (capped). Used for news-corroboration of major procurement events (e.g., 'Bouygues wins Cameroon contract' news article corroborates a COLEPS award). |

### Table 78

| 13  | IP ROTATION AND ANTI-BOT How we crawl without being blocked |
| --- | ----------------------------------------------------------- |

### Table 79

| Provider                | Class       | Cost (~)   | When we use it                                                                                                                                          |
| ----------------------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bright Data Datacenter  | datacenter  | $0.65/GB   | Default for all government-site crawling. Plenty of available IPs across geographies. Our default is CM-egressing IPs where available, otherwise FR/EU. |
| Bright Data Residential | residential | $8/GB      | When datacenter is detected and challenged. RCCM regional portals often need this. Routed through CM residential when available.                        |
| ScraperAPI              | api-managed | $0.001/req | Backup for sites that are easier with their managed scraping (handles JS, captcha solving, IP rotation behind one API). Used for 1-2 stubborn sources.  |
| Tor                     | tor         | free       | Last resort only. NOT used for daily crawling - some government sites block Tor exit nodes. Used when investigating an attempted block.                 |
| Direct (no proxy)       | direct      | free       | International APIs (OpenSanctions, Aleph, OpenCorporates, World Bank, GDELT). They authenticate by API key; proxying would only obscure attribution.    |

### Table 80

| Rule                 | Implementation                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Per-request rotation | Default: each request gets a new IP from the active pool. Implemented at the HTTP client layer (custom undici dispatcher). Adapter code does not see proxy details.                                                            |
| Sticky sessions      | When a site uses session cookies (COLEPS), the same IP is held for the lifetime of that session (max 30 min idle). The session and the IP rotate together.                                                                     |
| Cooldown on failure  | If a request to a given site fails (block, captcha, timeout) on proxy IP X, that IP is parked in cooldown for 6 hours for THAT site. Same IP is fine for other sites.                                                          |
| Diurnal rhythm       | Crawlers do NOT poll uniformly 24/7. Polling is biased to Cameroonian business hours (08:00-17:00 WAT) for sectoral ministries. Background polling continues for tier-1 sources (ARMP, MINMAP, COLEPS) but at reduced cadence. |
| Country biasing      | Where Bright Data offers CM-routed IPs, we prefer them - reduces 'foreign datacenter' fingerprint matches. Fallback chain: CM -> FR -> SN -> CI -> Generic-EU.                                                                 |
| Health checks        | A separate goroutine pings each provider's known-good test endpoint every 5 minutes; failed providers are marked unavailable until recovery.                                                                                   |

### Table 81

| Captcha kind               | Approach                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare 'Just a moment' | Playwright with stealth plugin handles transparently in most cases. Wait up to 30s; if not cleared, switch to residential proxy and retry. |
| hCaptcha                   | Route to 2Captcha solver via their HTTP API. Cost ~$0.003. Cap: 50 solves/day per crawler.                                                 |
| reCAPTCHA v2               | Same as hCaptcha; 2Captcha handles. Cost ~$0.003.                                                                                          |
| reCAPTCHA v3               | Token-based, no UI. We pre-warm sessions by browsing harmlessly before targeted requests. If still blocked, switch to ScraperAPI.          |
| Custom image captcha       | 2Captcha visual solver. Cap aggressively.                                                                                                  |
| Audio captcha              | Out of scope; we do not currently use audio solvers.                                                                                       |

### Table 82

| Principle                  | Implementation                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public data only           | We crawl pages a citizen can fetch with a browser. We do NOT submit forms with private identifiers we did not lawfully obtain. We do NOT bypass authentication that protects private data. The line between 'public site we are being polite to' and 'private system we are circumventing' is bright; this document treats it as bright. |
| No DDoS-adjacent behaviour | Our rate-limit caps are conservative. If a site appears strained, we reduce further. We never run more than 3 concurrent requests against any single source domain.                                                                                                                                                                      |
| Identification             | Our User-Agent identifies us. Our requests come from known proxy IPs, not residential botnets. A site administrator who wants to talk to us can find a contact email at vigilapex.cm/contact.                                                                                                                                            |
| Transparency               | We publish, at vigilapex.cm/sources, the list of sources we crawl, the cadence, and the legal basis. This is an active transparency posture, not just a defensive one.                                                                                                                                                                   |

### Table 83

| 14  | DOCUMENT PIPELINE Fetch, hash, OCR, language-detect, pin, store |
| --- | --------------------------------------------------------------- |

### Table 84

| Step | Stage           | What happens                                                                                                                                                                                            |
| ---- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Fetch           | Adapter requests the document URL. HTTP client respects If-Modified-Since headers from prior fetches. Body is buffered to memory (cap 100MB; larger triggers streaming-to-disk fallback).               |
| 2    | Hash            | sha256 of the raw bytes. If hash already exists in source.documents, the new fetch is recorded as a re-observation (updated_at bumped) but no new document row is created.                              |
| 3    | MIME detection  | libmagic (file --mime-type). Trust the result, not the Content-Type header.                                                                                                                             |
| 4    | PDF inspection  | If MIME is application/pdf, run pdfinfo to get page count, encryption status, embedded-text indicator. If embedded text exists and is non-trivial, skip OCR.                                            |
| 5    | OCR (if needed) | Tesseract 5 with -l fra+eng for scanned PDFs and images. Output to extracted_text. Cost: about 0.4s per page on the host CPU; we run OCR async in a worker pool.                                        |
| 6    | Language detect | fastText langdetect on extracted_text. Threshold 0.85 confidence; below that, we flag 'language=undetermined' and ask the LLM tier (Haiku) to classify.                                                 |
| 7    | IPFS pin        | ipfs add via the kubo HTTP API on N06. Result is a CIDv1 (base32) - canonical content address. Pin policy: pin all documents indefinitely in MVP; storage budget is 1TB on Synology with rclone mirror. |
| 8    | Store           | Insert into source.documents with all metadata. Insert provenance row in source.events with event_type='document.fetched'.                                                                              |
| 9    | Emit            | Publish to bus:source:raw stream so downstream workers (entity, pattern) can react.                                                                                                                     |

### Table 85

| Case                                             | Handling                                                                                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mixed FR + EN within one document                | Run fastText per paragraph; document language is the majority. Both languages indexed for search.                                                                                                                               |
| Pidgin / mixed-code text                         | Best-effort. Often classified as 'en' with low confidence. Tag as language='en-cm' for downstream awareness.                                                                                                                    |
| Local language excerpts (Fula, Ewondo, Bamileke) | Out of scope for MVP NLP. Preserved as raw text; not indexed; flagged for human review if pattern detection finds it relevant.                                                                                                  |
| No extractable text (image-only PDF, OCR failed) | Document still pinned and stored. Metadata: language='unknown', extracted_text=null. Not surfaced to text-based pattern matching, but available for image-based pattern matching (scoped to satellite-imagery patterns in MVP). |

### Table 86

| Document class                   | Pin policy                                                         |
| -------------------------------- | ------------------------------------------------------------------ |
| Tender notices, awards, decrees  | Pin permanently. These are the evidence-chain primary documents.   |
| Cour des Comptes audit reports   | Pin permanently. Calibration set.                                  |
| Sectoral ministry press releases | Pin for 3 years. Re-pin if referenced by a finding.                |
| GDELT corroboration items        | Reference only; not pinned (GDELT itself is the durable source).   |
| Images (satellite, photos)       | Pin permanently if referenced in a finding; else pin for 6 months. |

### Table 87

| 15  | WORKER IMPLEMENTATION Idempotent consumers, backpressure, observability |
| --- | ----------------------------------------------------------------------- |

### Table 88

| // /packages/worker-core/src/Worker.ts export interface WorkerConfig { name: string; consumeFrom: { stream: string; group: string; consumer: string }; emitTo?: string[]; handler: EventHandler; concurrency?: number; ackTimeoutMs?: number; prometheusPort?: number; } export type EventHandler = ( event: ParsedEvent, ctx: HandlerContext ) => Promise<void>; export interface HandlerContext { pg: PgTransaction; neo4j: Neo4jSession; emit: (stream: string, payload: object, dedupKey: string) => void; logger: Logger; } export class Worker { constructor(private config: WorkerConfig) {} async run(signal: AbortSignal): Promise<void> { await this.ensureConsumerGroup(); while (!signal.aborted) { const messages = await this.read(signal); for (const msg of messages) { try { await this.processOne(msg); } catch (err) { await this.handleError(msg, err); } } } } private async processOne(msg: StreamMessage): Promise<void> { const event = this.parse(msg); const dedupKey = computeDedupKey(this.config.name, event); // Check if already processed (idempotency) const exists = await this.pg.checkProcessed(dedupKey); if (exists) { await this.redis.xack(this.config.consumeFrom.stream, this.config.consumeFrom.group, msg.id); this.metrics.duplicateSkipped.inc(); return; } // Run handler in a transaction; collect emissions const emissions: Emission[] = []; await this.pg.tx(async (tx) => { const ctx: HandlerContext = { pg: tx, neo4j: this.neo4j, emit: (stream, payload, key) => emissions.push({stream, payload, key}), logger: this.logger.child({ event_id: event.id }), }; await this.config.handler(event, ctx); await tx.markProcessed(dedupKey); }); // After commit: emit to downstream streams for (const e of emissions) { await this.redis.xadd(e.stream, '\*', 'payload', JSON.stringify(e.payload), 'dedup_key', e.key); } // ACK the input await this.redis.xack( this.config.consumeFrom.stream, this.config.consumeFrom.group, msg.id); } } |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 89

| Signal                               | Response                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Stream lag > 10,000 events           | Pause upstream emitters via Redis SET 'paused:<adapter>' = '1'. Adapters check this key before emitting.                  |
| Stream lag drops < 5,000             | Clear pause keys; emitters resume.                                                                                        |
| PostgreSQL connection pool exhausted | Worker pauses consumption for 30 seconds; Prometheus alert fires.                                                         |
| Worker handler latency P99 > 5s      | Prometheus alert; if sustained over 15min, raise to P2.                                                                   |
| LLM call rate exceeds budget         | /packages/llm token tracker throttles further calls; affected workers slow down.                                          |
| Redis memory > 80%                   | P1 alert; architect investigates immediately. Redis is sized for headroom but a stuck consumer can balloon stream length. |

### Table 90

| // /apps/worker-entity/src/handler.ts export const handleEntityEvent: EventHandler = async (event, ctx) => { const mention = extractMention(event); const candidates = await blockingFind(ctx.pg, mention); const scored = await Promise.all(candidates.map(c => pairwiseScore(mention, c) )); const best = scored.sort((a,b) => b.score - a.score)[0]; if (best && best.score >= 0.92) { await ctx.pg.fuseInto(best.canonical_id, mention); ctx.emit('bus:entity:canon', { canonical_id: best.canonical_id, mention_id: mention.id, method: 'auto' }, mention.dedup_key); } else if (best && best.score >= 0.70) { await ctx.pg.queueForReview(mention, best, scored); // do not emit; awaits human review } else { const newId = await ctx.pg.createCanonical(mention); ctx.emit('bus:entity:canon', { canonical_id: newId, mention_id: mention.id, method: 'new' }, mention.dedup_key); } }; |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 91

| // /apps/worker-pattern/src/handler.ts export const handlePatternDetection: EventHandler = async (event, ctx) => { const subject = await loadSubject(ctx.pg, ctx.neo4j, event); const matches: PatternMatch[] = []; for (const pattern of patternRegistry.applicable(subject)) { const result = await pattern.detect({ subject, pg: ctx.pg, neo4j: ctx.neo4j, logger: ctx.logger }); if (result.matched) matches.push(result); } for (const m of matches) { const id = await ctx.pg.insertFinding({ pattern_id: m.pattern.id, primary_entity_id: subject.primary_id, related_entity_ids: subject.related_ids, transaction_ref: subject.transaction_ref, }); ctx.emit('bus:finding:detected', { finding_id: id, pattern_id: m.pattern.id, signal_strength: m.signal_strength, }, id); } }; |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 92

| Error class                 | Handling                                                                     |
| --------------------------- | ---------------------------------------------------------------------------- |
| TransientDatabaseError      | Retry with exponential backoff. After 5 attempts, dead-letter and alert.     |
| DataValidationError         | Dead-letter immediately. Indicates upstream data shape changed.              |
| LLMError (rate limit)       | Hold the event; circuit-breaker trips for the LLM call; retry after backoff. |
| LLMError (auth, quota)      | Page the architect immediately; affected events queue.                       |
| UnexpectedError (unhandled) | Log full stack with trace context, dead-letter, alert.                       |

### Table 93

| 16  | PATTERN CATALOGUE INTEGRATION How patterns plug into workers |
| --- | ------------------------------------------------------------ |

### Table 94

| Test layer        | What it covers                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests        | Each PatternDef has positive and negative fixtures. Run on every commit. Path: /packages/patterns/**tests**/<pattern-id>.test.ts                                                                                                                         |
| Integration tests | /tests/patterns/integration/ runs each pattern against a seeded PostgreSQL + Neo4j with realistic data. Slow (about 2 min total); runs on PRs to main.                                                                                                   |
| Calibration tests | /tests/patterns/calibration/ measures hit rate and precision against the 200-record calibration set. Runs nightly. Failure threshold: any pattern whose precision drops below its declared baseline by more than 10 percentage points triggers an alert. |
| Shadow mode       | Newly-added patterns run in shadow mode for 30 days: they detect and record findings, but their findings do not enter dossiers. The architect reviews shadow findings to validate the pattern before promoting it.                                       |

### Table 95

| 17  | AUTHENTICATION ARCHITECTURE Hardware-rooted identity for every actor and every action |
| --- | ------------------------------------------------------------------------------------- |

### Table 96

| YK-ID | Holder                | Custody                                  | Purpose                                                                      |
| ----- | --------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| YK-01 | Architect (primary)   | On-person                                | LUKS unlock, Vault unseal share #1, Polygon signing, SSH PIV, Keycloak FIDO2 |
| YK-02 | Architect (secondary) | Sealed safe at architect's office        | Backup of YK-01 (same key material). Used only on YK-01 loss or PIN-lockout. |
| YK-03 | Backup architect      | On-person at backup architect's location | Vault unseal share #2, Polygon signing (delegate role), Keycloak FIDO2 admin |
| YK-04 | CONAC pillar          | On-person CONAC representative           | Council vote signing for the CONAC pillar                                    |
| YK-05 | Civil society pillar  | On-person CSO representative             | Council vote signing for the civil-society pillar                            |

### Table 97

| Slot | PIV designation     | What lives here                                                                                                                             |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 9a   | Authentication      | secp256r1 keypair used for SSH PIV authentication, Keycloak WebAuthn, and host login. PIN-protected.                                        |
| 9c   | Digital Signature   | secp256k1 keypair used for Polygon transaction signing AND for council vote signing. PIN-protected; PIN required on every use (no caching). |
| 9d   | Key Management      | RSA-2048 keypair used for Vault Shamir-share encryption and decryption. PIN-protected; cached for 5 minutes during unseal ceremony.         |
| 9e   | Card Authentication | secp256r1 keypair used for cgroup-level service identification (ad-hoc; not yet used in MVP - reserved for Phase 2).                        |

### Table 98

| # /scripts/yk-provision.sh - run by architect on a hardened laptop # Pre: YubiKey is fresh from sealed packaging; serial number recorded. # Step 1: Reset the YubiKey to factory state ykman piv reset # Step 2: Set a strong PIN (8 digits) and PUK (8 digits) # PIN goes to the holder. PUK goes to a sealed envelope. ykman piv access change-pin --pin 123456 --new-pin "<8-digit>" ykman piv access change-puk --puk 12345678 --new-puk "<8-digit>" # Step 3: Set management key (32-byte hex; held by architect) ykman piv access change-management-key --generate \ --protect --pin "<PIN>" # Step 4: Generate keypair for slot 9a (authentication, secp256r1) ykman piv keys generate -a ECCP256 9a /tmp/9a-pubkey.pem ykman piv certificates generate -s "CN=vigil-yk-<id>-auth" \ 9a /tmp/9a-pubkey.pem # Step 5: Generate keypair for slot 9c (signing, secp256k1) # secp256k1 requires firmware >= 5.4 and special algorithm flag ykman piv keys generate -a ECCSECP256K1 9c /tmp/9c-pubkey.pem ykman piv certificates generate -s "CN=vigil-yk-<id>-sign" \ 9c /tmp/9c-pubkey.pem # Step 6: Generate keypair for slot 9d (encryption, RSA-2048) ykman piv keys generate -a RSA2048 9d /tmp/9d-pubkey.pem ykman piv certificates generate -s "CN=vigil-yk-<id>-enc" \ 9d /tmp/9d-pubkey.pem # Step 7: Register in the YubiKey inventory (Vault kv-v2) vault kv put secret/yubikeys/<id> \ serial=<serial> \ holder=<name> \ role=<role> \ pubkey_9a=@/tmp/9a-pubkey.pem \ pubkey_9c=@/tmp/9c-pubkey.pem \ pubkey_9d=@/tmp/9d-pubkey.pem \ provisioned_at=$(date -Iseconds) # Step 8: Print the eth_address derived from the 9c secp256k1 pubkey node /scripts/derive-eth-address.js /tmp/9c-pubkey.pem # Holder records this address; it is their on-chain identity. # Step 9: Securely wipe the laptop's working directory shred -u /tmp/9a-pubkey.pem /tmp/9c-pubkey.pem /tmp/9d-pubkey.pem |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 99

| # /etc/crypttab (Ubuntu 24.04) nvme0n1p3_crypt UUID=<root-uuid> none luks,discard,initramfs nvme1n1p1_crypt UUID=<data-uuid> none luks,discard # Clevis policy: bind LUKS keyslot 1 to (Tang AND FIDO2) sudo clevis luks bind -d /dev/nvme0n1p3 sss '{"t":2,"pins":{ "tang":[{"url":"http://10.99.0.10:8888"}], "yubikey":[{"slot":"9a"}] }}' sudo clevis luks bind -d /dev/nvme1n1p1 sss '{"t":2,"pins":{ "tang":[{"url":"http://10.99.0.10:8888"}], "yubikey":[{"slot":"9a"}] }}' # Update initramfs to include clevis-luks-unlocker sudo update-initramfs -u -k all |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 100

| # Architect runs from the host, with YK-01 and YK-03 both inserted # (YK-03 is brought temporarily for this ceremony, then returned to backup architect) # 1. Initialise Vault with 5 shares, threshold 3 vault operator init -key-shares=5 -key-threshold=3 \ -format=json > /tmp/vault-init.json # 2. Extract the 5 unseal keys + root token jq -r '.unseal_keys_b64[0]' /tmp/vault-init.json > /tmp/share1.b64 jq -r '.unseal_keys_b64[1]' /tmp/vault-init.json > /tmp/share2.b64 jq -r '.unseal_keys_b64[2]' /tmp/vault-init.json > /tmp/share3.b64 jq -r '.unseal_keys_b64[3]' /tmp/vault-init.json > /tmp/share4.b64 jq -r '.unseal_keys_b64[4]' /tmp/vault-init.json > /tmp/share5.b64 jq -r '.root_token' /tmp/vault-init.json > /tmp/root-token # 3. Encrypt shares 1, 2, 3 to YK-01's slot 9d (RSA-2048) for n in 1 2 3; do yk-encrypt --slot 9d --serial ${YK01_SERIAL} \     --in /tmp/share${n}.b64 --out /etc/vigil/vault/share${n}.enc done # 4. Encrypt share 4 to YK-03's slot 9d yk-encrypt --slot 9d --serial ${YK03_SERIAL} \ --in /tmp/share4.b64 --out /etc/vigil/vault/share4.enc # 5. Encrypt share 5 to YK-02's slot 9d (laptop with YK-02 attached briefly) yk-encrypt --slot 9d --serial ${YK02_SERIAL} \ --in /tmp/share5.b64 --out /etc/vigil/vault/share5.enc # 6. Encrypt root token to YK-01 + YK-03 (both required to use) # This is for emergency-only use; routine operations use scoped tokens. multi-yk-encrypt --slots YK01:9d,YK03:9d --required 2 \ --in /tmp/root-token --out /etc/vigil/vault/root-token.enc # 7. Securely wipe plaintext shred -u /tmp/share\*.b64 /tmp/root-token /tmp/vault-init.json # 8. Verify by performing first unseal: sudo systemctl start vigil-vault-unseal.service |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

### Table 101

| # /usr/local/bin/vigil-vault-unseal (called by vigil-vault-unseal.service) # Decrypts shares 1, 2, 3 from YK-01, then submits to Vault. #!/bin/bash set -euo pipefail # Wait for Vault to be reachable until curl -sf http://172.20.0.15:8200/v1/sys/health -o /dev/null; do sleep 1; done # Verify YK-01 is present if ! ykman info \| grep -q "Serial number: ${YK01_SERIAL}"; then   echo "ERROR: YK-01 not detected. Cannot unseal."   exit 1 fi   # Decrypt share 1, 2, 3 (PIN required once; cached for the ceremony) echo "Enter YK-01 PIN:" read -s YK_PIN   for n in 1 2 3; do   SHARE=$(yk-decrypt --slot 9d --pin "$YK_PIN" \     --in /etc/vigil/vault/share${n}.enc) vault operator unseal "$SHARE" done # Verify Vault is unsealed if vault status \| grep -q "Sealed:.\*false"; then echo "Vault unsealed successfully." # Audit log curl -X POST http://172.20.0.10:5432/audit/log \ -d '{"actor":"architect","action":"vault_unseal","outcome":"success"}' else echo "ERROR: Vault still sealed after unseal attempt." exit 1 fi |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 102

| Worker (worker-anchor or council portal) \| \| (1) RPC over Unix domain socket /run/vigil/polygon-signer.sock v vigil-polygon-signer service (host process, not container) \| \| (2) PKCS#11 call via libykcs11 v YubiKey (slot 9c, secp256k1) \| \| (3) Signature returned via PKCS#11 v vigil-polygon-signer \| \| (4) Signed tx returned over Unix socket v Worker \| \| (5) Submits signed tx to Polygon RPC (Alchemy) v Polygon mainnet |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 103

| // /packages/polygon/signer-rpc.proto (Protobuf for the local socket) syntax = "proto3"; package vigil.polygon; service Signer { rpc SignTransaction(SignRequest) returns (SignResponse); rpc GetAddress(GetAddressRequest) returns (GetAddressResponse); } message SignRequest { bytes tx_hash = 1; // 32-byte keccak256 of the RLP-encoded tx string scope_token = 2; // Vault-issued JWT proving caller authorisation string requesting_worker = 3; uint64 nonce = 4; // monotonic; signer rejects out-of-order nonces } message SignResponse { bytes r = 1; // 32-byte bytes s = 2; // 32-byte uint32 v = 3; // 0 or 1 (recovery id) bytes signed_at = 4; // ISO-8601 timestamp string } message GetAddressRequest { string scope_token = 1; } message GetAddressResponse { bytes address = 1; } // 20-byte eth address |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 104

| // /packages/polygon/yk-client.ts import { connect } from 'net'; export async function signTx(txHash: Buffer, vaultToken: string): Promise<Sig> { const client = createSignerClient('/run/vigil/polygon-signer.sock'); const resp = await client.signTransaction({ tx_hash: txHash, scope_token: vaultToken, requesting_worker: process.env.WORKER_NAME!, nonce: nextNonce(), }); return { r: resp.r, s: resp.s, v: resp.v }; } // Anchor worker example async function anchor(dossierIdHash: Buffer, evidenceCid: string) { const tx = await contract.commitAnchor.populateTransaction( dossierIdHash, evidenceCid ); const txHash = keccak256(rlpEncode(tx)); const vaultToken = await getScopedToken('polygon:sign:anchor'); const sig = await signTx(txHash, vaultToken); const signedTx = serializeTx(tx, sig); return await polygonProvider.broadcastTransaction(signedTx); } |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 105

| Flow                 | When used                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebAuthn / WebCrypto | Modern browsers (Chrome, Edge, Safari) on the council portal. Member taps YubiKey, enters PIN. Browser produces a signature via the FIDO2 credential. We translate the FIDO2 signature into a Polygon-compatible secp256k1 signature server-side using a relayer pattern. |
| Local helper app     | Older browsers, or members who prefer a desktop flow. Member runs vigil-vote.exe or vigil-vote.app on their workstation. The portal renders a QR code containing the unsigned tx; helper app scans, prompts for YubiKey + PIN, returns signed tx via HTTP callback.       |

### Table 106

| Council member's browser council.vigilapex.cm Polygon mainnet \| \| \| \| (1) GET /proposals/<id> \| \| \|--------------------------------->\| \| \| (2) Render proposal + YES/NO/ABSTAIN buttons \| \|<---------------------------------\| \| \| (3) Click YES \| \| \| (4) POST /proposals/<id>/cast \| \| \| {choice: YES} \| \| \|--------------------------------->\| \| \| \| (5) Build unsigned tx \| \| \| (6) Generate WebAuthn challenge\| \| (7) WebAuthn challenge response \| \| \|<---------------------------------\| \| \| (8) Member: insert YubiKey, PIN \| \| \| Browser invokes navigator.credentials.get(...) \| \| (9) Signed assertion returned \| \| \|--------------------------------->\| \| \| \| (10) Verify assertion \| \| \| (11) Translate to ECDSA sig \| \| \| (12) Build signed tx \| \| \| (13) Broadcast to Polygon \| \| \|------------------------------->\| \| \| (14) Tx hash returned \| \| \|<-------------------------------\| \| (15) UI shows: "Vote cast - tx 0x... \| \|<---------------------------------\| \| |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 107

| # Pre: Keycloak admin token in Vault. User created in realm with email + role. # 1. Architect generates a one-time enrolment URL (valid 24 hours) kcadm.sh create users/<user_id>/execute-actions-email \ -r vigil-apex -s 'requiredActions=["webauthn-register-passwordless"]' \ -q lifespan=86400 # 2. User receives the email; opens link in their browser; logs in once with # a temporary password (sent separately via Signal). # 3. Browser walks user through: # - Insert YubiKey # - Enter YubiKey PIN # - Touch YubiKey (presence proof) # - Confirm credential nickname (e.g. "yk-alice-cosc-primary") # - Confirm enrolment # 4. Keycloak stores the WebAuthn credential public key in the user's profile. # The temporary password is invalidated. # 5. From now on, the user's only login factor is the YubiKey (FIDO2). # No password is ever requested again. |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 108

| Setting                         | Value                                                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication flow             | browser-flow with required = webauthn-passwordless                                                                                                       |
| Required actions on first login | webauthn-register-passwordless                                                                                                                           |
| Password policy                 | Disabled (no passwords are persisted)                                                                                                                    |
| WebAuthn allowed algorithms     | ES256 (secp256r1, default), and ES256K (secp256k1, for council members so the same YK is used both for portal login AND for vote signing)                |
| WebAuthn user verification      | Required (PIN must be entered)                                                                                                                           |
| WebAuthn attestation            | Direct (we verify YubiKey is genuine via Yubico's attestation root certificate)                                                                          |
| Session lifespan                | 8 hours (matches a working day)                                                                                                                          |
| Idle timeout                    | 30 minutes                                                                                                                                               |
| Backup credential               | Each user MUST register a second YubiKey at enrolment time (their personal backup); credential lifecycle managed by the user under architect supervision |

### Table 109

| # Architect's laptop ~/.ssh/config Host vigil-host HostName 192.168.1.100 # via wg-admin tunnel User architect PKCS11Provider /usr/local/lib/libykcs11.dylib PreferredAuthentications publickey IdentitiesOnly yes Host vigil-ingest.hetzner.example User root PKCS11Provider /usr/local/lib/libykcs11.dylib PreferredAuthentications publickey # To extract the public key from YK-01 slot 9a (one-time): ssh-keygen -D /usr/local/lib/libykcs11.dylib \| head -1 \ > ~/.ssh/yk-01-9a.pub # Then copy to N01 and N02 authorized_keys via the recovery passphrase login |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 110

| vigil-root-ca (offline; root key escrowed to YK-01 slot 9d) \| +-- vigil-int-ca (intermediate; signed by root; held in Vault) \| \| \| +-- vigil-postgres-server (cert + key) \| +-- vigil-neo4j-server \| +-- vigil-redis-server \| +-- vigil-vault-server \| +-- vigil-keycloak-server \| +-- vigil-fabric-peer \| +-- vigil-clients-int-ca (separate intermediate for client certs) \| +-- worker-entity-client +-- worker-pattern-client +-- ... (one per worker) +-- adapter-runner-client (lives on N02) +-- vigil-dashboard-client |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 111

| # Inside worker container at startup VAULT_TOKEN=$(cat /run/secrets/vault_token_worker) # Request a 24-hour client cert curl -s --cert-type pem \ -H "X-Vault-Token: ${VAULT_TOKEN}" \ -X POST \ -d '{"common_name":"worker-pattern","ttl":"24h"}' \ http://vigil-vault:8200/v1/vigil-clients-int-ca/issue/worker \ \| jq -r '.data \| "\(.certificate)\n\(.issuing_ca)"' > /tmp/client.pem curl -s -H "X-Vault-Token: ${VAULT_TOKEN}" \ -X POST \ -d '{"common_name":"worker-pattern","ttl":"24h"}' \ http://vigil-vault:8200/v1/vigil-clients-int-ca/issue/worker \ \| jq -r '.data.private_key' > /tmp/client.key # Use cert + key for outbound connections to other services exec node dist/main.js # main.js reads /tmp/client.{pem,key} # Cron job re-issues every 12 hours; certs rotate continuously |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

### Table 112

| # /infra/vault/policies/worker-pattern.hcl # Read DB connection password path "secret/data/postgres/worker-pattern" { capabilities = ["read"] } # Read Neo4j connection password path "secret/data/neo4j/worker" { capabilities = ["read"] } # Issue mTLS client cert path "vigil-clients-int-ca/issue/worker" { capabilities = ["update"] } # Use transit engine for finding-evidence encryption path "transit/encrypt/finding-evidence" { capabilities = ["update"] } path "transit/decrypt/finding-evidence" { capabilities = ["update"] } # NOT permitted: polygon signing key reference, root token, # admin endpoints, other workers' secrets |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 113

| Loss scenario                       | Recovery                                                                                                                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YK-01 lost (architect)              | Use YK-02 from sealed safe. Re-provision YK-01 replacement at next physical visit. Same key material restored from YK-02 backup. Audit-log the event.                                                                   |
| YK-01 + YK-02 both lost             | Use LUKS recovery passphrase (sealed at backup architect's location). Reset all 5 YubiKeys. Re-issue Vault Shamir shares (re-init Vault using current root token, recovered via YK-03 + safe). Estimate: 4-hour outage. |
| YK-03 lost (backup architect)       | Backup architect provisions replacement at architect's office under architect supervision. New share #4 issued by Vault rekey operation.                                                                                |
| Council pillar YK lost              | Pillar holder reports loss. Architect calls smart contract removeMember(<old_addr>); new YubiKey provisioned at next CONAC office visit; appointMember(<new_addr>). Audit-logged on-chain.                              |
| YK PIN forgotten (3 wrong attempts) | YK is PIN-locked. Use PUK from sealed envelope to reset PIN. Document the event.                                                                                                                                        |
| YK PIN + PUK both forgotten         | YK is bricked. Reset to factory; reprovision. Same key material is gone permanently. For LUKS-binding keys, fall back to recovery passphrase. For council vote keys, re-issue eth_address via on-chain admin.           |
| YubiKey hardware failure            | Use backup YK; replace failed unit; reprovision.                                                                                                                                                                        |
| Suspected YubiKey compromise        | Treat as 'lost'. Revoke immediately on every system: smart contract removeMember, Keycloak credential delete, mTLS cert revoke, LUKS keyslot remove, Vault Shamir share rotate.                                         |

### Table 114

| Threat                                  | Defence                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Remote attacker reaches Vault API       | Vault is on vigil-internal (no host route). Even if reached, every operation requires a token; tokens are short-lived; high-privilege ops require a YubiKey-held key the attacker doesn't have.                                                                                                                                                                    |
| Remote attacker breaches a worker       | Worker token revocable in 1 hour. Worker's Vault policy is least-privilege. Worker cannot reach the Polygon signer except via the Unix socket (which requires a Vault scope token the worker can't escalate).                                                                                                                                                      |
| Insider with shell on host              | Cannot read LUKS keys (in YubiKey). Cannot unseal Vault (Shamir shares encrypted to YubiKey). Cannot sign Polygon tx (private key in YubiKey, signing requires PIN entry). Cannot bypass Keycloak (FIDO2 hardware required).                                                                                                                                       |
| YubiKey theft + PIN extortion           | Architect dual-control: any consequential operation that affects governance (voting, appointMember, etc.) requires multi-party consent on-chain. A coerced architect cannot single-handedly alter governance. For LUKS/Vault, coercion is a real risk; mitigation is operational (architect maintains physical security; duress code in protocol pending Phase-2). |
| Supply-chain attack on YubiKey firmware | We use stable firmware versions; we attest YubiKey authenticity via Yubico's attestation roots during enrolment. Mass replacement triggered by Yubico advisories.                                                                                                                                                                                                  |
| Quantum future                          | secp256k1 is not quantum-resistant. The MVP is built knowing the system has a usable lifetime against current threats; quantum migration is a Phase-3 concern, with on-chain governance transition planned via dual-key smart contract pattern.                                                                                                                    |

### Table 115

| 18  | LLM TIER ROUTING Which model handles which task, with what budget |
| --- | ----------------------------------------------------------------- |

### Table 116

| Task                                                  | Primary model | Failover       | Why this tier                                                        |
| ----------------------------------------------------- | ------------- | -------------- | -------------------------------------------------------------------- |
| Adapter content classification (PDF: tender vs award) | Haiku 4.5     | Bedrock Haiku  | High volume, simple. Haiku is sufficient and ~30x cheaper than Opus. |
| Document language detection                           | Haiku 4.5     | Local fastText | Simple high-volume; offline fallback safe.                           |
| Entity-name normalisation                             | Haiku 4.5     | Bedrock Haiku  | Deterministic enough for Haiku.                                      |
| Pattern-match evidence extraction                     | Sonnet 4.6    | Bedrock Sonnet | Reads documents and identifies clauses supporting a pattern.         |
| Cross-source corroboration assessment                 | Sonnet 4.6    | Bedrock Sonnet | Compares 2-5 source records and reasons about consistency.           |
| Dossier narrative drafting (FR + EN)                  | Sonnet 4.6    | Bedrock Sonnet | Quality matters; volume moderate (one per finding cluster).          |
| Bayesian-engine evidence weighting                    | Opus 4.6      | Bedrock Opus   | Hard reasoning across heterogeneous evidence; depth matters.         |
| ER borderline (review band)                           | Opus 4.6      | Bedrock Opus   | Genuinely ambiguous cases requiring documented reasoning.            |
| Pattern detection - novel cases                       | Opus 4.6      | Bedrock Opus   | When canonical detect() returns ambiguous, Opus reviews.             |
| Satellite-imagery interpretation                      | Opus 4.6      | Bedrock Opus   | Vision + reasoning. Opus is the only acceptable tier.                |
| Counter-evidence devil's-advocate review              | Opus 4.6      | Bedrock Opus   | Critical checkpoint before escalation; worth the cost.               |

### Table 117

| 19  | BAYESIAN CERTAINTY ENGINE How signals combine into a defensible certainty score |
| --- | ------------------------------------------------------------------------------- |

### Table 118

| // /packages/certainty/engine.ts function computeCertainty(finding: Finding, signals: Signal[]): number { let logOdds = Math.log(finding.prior / (1 - finding.prior)); for (const s of signals) { const lr = signalLikelihoodRatio(s); const correlation = correlationDampen(s, signals); logOdds += Math.log(lr) \* correlation; } const odds = Math.exp(logOdds); return odds / (1 + odds); } |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 119

| Pattern category                    | Prior P(fraud) | Source                                                                                 |
| ----------------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| A. Procurement integrity            | 0.18           | Calibrated against historical Cour des Comptes findings.                               |
| B. Beneficial-ownership concealment | 0.32           | Higher prior; concealment is rarely innocent.                                          |
| C. Price-reasonableness             | 0.12           | Lower prior; many price anomalies have legitimate explanations.                        |
| D. Performance verification         | 0.45           | Highest prior; satellite-verified non-construction is rarely measurement error.        |
| E. Sanctioned-entity exposure       | 0.55           | Very high; sanction matches above 0.92 similarity are almost always genuine.           |
| F. Network anomalies                | 0.22           | Network signals require corroboration; alone they are weak.                            |
| G. Document integrity               | 0.20           | Backdating and signature mismatches sometimes have benign causes (retroactive filing). |
| H. Temporal anomalies               | 0.10           | Lowest prior; many temporal patterns reflect legitimate budget cycles.                 |

### Table 120

| 20  | ANTI-HALLUCINATION CONTROLS Twelve layered defences against AI fabrication |
| --- | -------------------------------------------------------------------------- |

### Table 121

| #   | Control                         | Mechanism                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L1  | Evidence-anchored extraction    | Every claim made by an LLM must cite a specific source: document IPFS CID + page number, or web URL + DOM selector + capture timestamp. LLM output containing a claim with no citation is dropped by the worker before persistence.                                                                          |
| L2  | Hash-checked source attribution | Before an extraction enters the database, the worker verifies the cited document hash matches the IPFS pin. If hash mismatches (document was modified), the extraction is quarantined and the source is re-fetched.                                                                                          |
| L3  | Bayesian certainty floors       | Findings below 0.55 posterior are observation-tier - never escalated, never published. Findings 0.55-0.85 are reviewable. Only findings above 0.85 reach a dossier. The threshold is a hallucination filter: a single fabricated signal cannot push a finding past 0.85 if other signals do not corroborate. |
| L4  | Multi-signal corroboration      | No finding rests on a single LLM extraction. The Bayesian engine requires at least two independent signals (different patterns, different documents, different sources) before posterior crosses 0.85. A hallucination produces one bad signal; corroborating signals must independently exist.              |
| L5  | Devil's-advocate counter-pass   | Before escalation, an Opus model is prompted to argue the finding is wrong. Its objections become the dossier Caveats section. This is an adversarial use of the same technology - an LLM checking another LLM's work with a different prompt and a different goal.                                          |
| L6  | Schema-bounded outputs          | All LLM calls return JSON conforming to a published schema (Zod schemas in /infra/schemas/llm/). Output that does not parse is rejected. Output that parses but contains values outside enumerated ranges is rejected.                                                                                       |
| L7  | Quote verification              | When an LLM extracts a quotation from a document, the worker performs a substring match on the document text (after OCR normalisation). If the quoted text does not appear verbatim in the source, the extraction is rejected. Paraphrases are not accepted as evidence.                                     |
| L8  | Numerical reconciliation        | When an LLM extracts a monetary amount, the worker re-extracts the same field via a deterministic regex and reconciles. If the LLM amount and regex amount disagree by more than 0.5%, both are rejected and the field is flagged for human review.                                                          |
| L9  | Calibration monitoring          | The system measures Expected Calibration Error monthly. If ECE drifts above 7% (warning) or 10% (alarm), a senior operator is paged and pattern weights are recalibrated. Sustained calibration drift is the operational signature of latent hallucination.                                                  |
| L10 | Source-diversity rule           | A finding cannot rest exclusively on signals derived from a single source domain. At least one corroborating signal must come from a different source class. This blocks scenarios where a single compromised or hallucinated document distorts an entire dossier.                                           |
| L11 | Council human review            | Even after L1-L10, no dossier becomes consequential without three of five council members voting ESCALATE on Polygon. Council members read the dossier; they catch what the system did not. The five-pillar quorum is the final hallucination filter.                                                        |
| L12 | Public verifiability            | Every escalated dossier's content hash is anchored on Polygon. Anyone can recompute the hash from the published PDF and verify. A dossier whose hash does not verify is automatically discredited. This makes silent post-publication tampering or fabrication impossible.                                   |

### Table 122

| LLM may                                                                                                   | LLM may NOT                                                                                                |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Extract structured fields from documents (entity names, amounts, dates) - subject to L1, L6, L7, L8 above | Make claims about reality without citing a specific source                                                 |
| Classify a document by language, type, or topic                                                           | Generate factual content not present in any provided document                                              |
| Summarise a document's contents in operator-facing UI                                                     | Decide whether a finding is escalated; that requires Bayesian threshold + council vote                     |
| Translate text between FR and EN for dossier presentation                                                 | Produce certainty scores; certainty is computed mathematically from priors + signals, not asked of the LLM |
| Answer operator questions about findings already in the database                                          | Sign cryptographic transactions or write to the audit log                                                  |
| Argue against a finding (devil's-advocate role)                                                           | Originate dossiers without source documents; a dossier with zero attached evidence cannot be created       |
| Suggest patterns or relationships for human review                                                        | Have direct access to Polygon signing, SFTP delivery, or email                                             |

### Table 123

| OPERATIONAL DOCTRINE When in doubt, prefer false negatives over false positives. A real instance of corruption that the system fails to surface is recoverable: another investigator, another year, another tip will eventually catch it. A fabricated finding that names an innocent person is not recoverable; the harm is done at publication. The Bayesian thresholds, council quorum, and twelve controls in this section are deliberately tuned to the side of caution. |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 124

| 21  | PATTERN CATALOGUE All 43 fraud patterns. Every detection rule, written down. |
| --- | ---------------------------------------------------------------------------- |

### Table 125

| export interface PatternDef { id: string; category: PatternCategory; display_name_fr: string; display_name_en: string; severity_baseline: number; inputs: SignalSpec[]; detect: (ctx: DetectContext) => Promise<PatternMatch[]>; expected_hit_rate: number; bayesian_priors: PriorSpec; } |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 126

| Category                            | Count | What this category detects                                                                           |
| ----------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| A. Procurement integrity            | 9     | Single-bidder, split-tender, no-bid emergencies, late amendments, sole-source gaps.                  |
| B. Beneficial-ownership concealment | 7     | Shell companies, nominee directors, address sharing, recent-incorp winners, jurisdiction shopping.   |
| C. Price-reasonableness             | 6     | Inflation vs benchmark, unit-price anomalies, escalation without trigger, currency arbitrage.        |
| D. Performance verification         | 5     | Satellite-verified non-construction, partial completion certified full, ghost projects.              |
| E. Sanctioned-entity exposure       | 4     | Direct sanctioned counterparty, indirect exposure, PEP-linked award, debarment match.                |
| F. Network anomalies                | 5     | Round-trip transactions, director rings, address clusters, co-bidding rotation, ownership transfers. |
| G. Document integrity               | 4     | Backdated documents, signature mismatch, template recycling, missing attachments.                    |
| H. Temporal anomalies               | 3     | Award-to-payment latency, off-cycle disbursements, fiscal-year-end clustering.                       |

### Table 127

| ID      | Pattern                       | Detection logic                                                                                                                                                         |
| ------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-A-001 | Single-bidder award           | ARMP/COLEPS award where only one bid received AND value exceeds single-bidder threshold (default 50M XAF). Confirmed by counting bid_records on tender_id.              |
| P-A-002 | Split-tender avoidance        | 2+ awards to same entity within 14 days, each just below a procurement threshold, total exceeding threshold by 1.5x. Same authority, similar scope.                     |
| P-A-003 | No-bid emergency              | Emergency procurement justification used >3 times by same authority in 12 months, where urgency claim cannot be cross-validated against a public emergency declaration. |
| P-A-004 | Late amendment inflation      | Contract amendment increasing value by >25% within 90 days of original award. Particular weight if during execution rather than at completion.                          |
| P-A-005 | Sole-source justification gap | Contract awarded sole-source citing 'unique capability' where competing entities exist in RCCM with overlapping NACE within 200 km of project.                          |
| P-A-006 | Bid-rigging signal            | 3+ tenders won by entities sharing director/address, with losing bids consistently within 2% of winning bid (rotation indicator).                                       |
| P-A-007 | Pre-qualification narrowing   | Pre-qual criteria added between announcement and bid opening that exclude all but a small set of pre-known suppliers.                                                   |
| P-A-008 | Award-to-shell within 30 days | Winning entity registered in RCCM <30 days before award AND value above 10M XAF.                                                                                        |
| P-A-009 | Repeat winner concentration   | Same supplier wins >60% of contracts by single authority over 24 months, controlling for market share in NACE category.                                                 |

### Table 128

| ID      | Pattern                     | Detection logic                                                                                                                       |
| ------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| P-B-001 | Shell-company indicator     | Entity meets 3+ of: <1yr old, no employees, address shared with 5+ companies, no track record in NACE, beneficial owner not declared. |
| P-B-002 | Nominee-director pattern    | Same individual director of >8 unrelated companies (different NACE/industries) within Cameroon, indicating possible nominee role.     |
| P-B-003 | Address sharing cluster     | >4 companies registered at same address over 36 months, where address is residential or low-occupancy commercial.                     |
| P-B-004 | Recent-incorporation winner | Winning bidder incorporated <90 days before tender announcement, where tender required prior experience but waived it.                |
| P-B-005 | Jurisdiction shopping       | Beneficial-ownership chain crosses 2+ secrecy jurisdictions (per FATF) without obvious commercial rationale.                          |
| P-B-006 | Director-share ring         | Cluster of 3+ companies mutually sharing directors AND collectively winning >5 government contracts in 24 months.                     |
| P-B-007 | PEP undisclosed             | Beneficial owner is PEP per OpenSanctions but entity did not declare PEP status in supplier registration. Strong signal.              |

### Table 129

| ID      | Pattern                    | Detection logic                                                                                                            |
| ------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| P-C-001 | Benchmark inflation        | Unit price exceeds World Bank reference for same item/region by >30% with no documented justification.                     |
| P-C-002 | Unit-price anomaly         | Unit price >2 stdev above historical mean of same authority's purchases of same item over 36 months.                       |
| P-C-003 | Escalation without trigger | Escalation clause invoked where the index (currency, materials, fuel) did not move sufficiently to justify it.             |
| P-C-004 | Currency-arbitrage pricing | Foreign-currency contract where supplier is local AND historical equivalents priced in XAF, in period of XAF appreciation. |
| P-C-005 | Quantity inflation         | Quantity exceeds documented operational need (independently estimable, e.g. classroom desks vs school enrolment).          |
| P-C-006 | Suspicious round numbers   | Total is a suspiciously round number (e.g. exactly 100M XAF) and unit prices have been adjusted to hit that round total.   |

### Table 130

| ID      | Pattern                             | Detection logic                                                                                                                                |
| ------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| P-D-001 | Satellite-verified non-construction | Sentinel-2 + Planet imagery comparison shows no built-up index change at declared coordinates between contract start and certified completion. |
| P-D-002 | Partial completion certified full   | Imagery shows construction at <60% of declared scope (footprint, building count, road km) but completion certificate issued.                   |
| P-D-003 | Ghost project                       | Coordinates resolve to: water body, protected area, existing structure unrelated to project, or coordinates outside declared region.           |
| P-D-004 | Re-tendered same scope              | New tender for scope geographically and functionally overlapping a project declared complete within 24 months by same authority.               |
| P-D-005 | Equipment delivery unverifiable     | Equipment-delivery contracts where declared installation site shows no infrastructure capable of housing the equipment (per imagery).          |

### Table 131

| ID      | Pattern                        | Detection logic                                                                                                                         |
| ------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| P-E-001 | Direct sanctioned counterparty | Awarded entity matches OpenSanctions, UN, OFAC, EU, or AfDB-debarred lists by name + jurisdiction with similarity >= 0.92.              |
| P-E-002 | Indirect sanctioned exposure   | Beneficial owner (direct or up to 3 hops) is sanctioned per any list in P-E-001.                                                        |
| P-E-003 | PEP-linked award               | Beneficial owner is PEP (per OpenSanctions PEP dataset) AND award is from a contracting authority within the PEP's sphere of influence. |
| P-E-004 | Debarment list match           | Entity matches AfDB, World Bank, or UN debarment list. Fuzzy threshold same as P-E-001.                                                 |

### Table 132

| ID      | Pattern                       | Detection logic                                                                                                                                                            |
| ------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-F-001 | Round-trip transaction        | Funds traced (via cross-source corroboration) flowing from authority to supplier and back through intermediaries to a beneficial owner connected to the authority.         |
| P-F-002 | Director-sharing ring (large) | Connected component in director-graph contains >6 companies, collectively holding >3 government contracts.                                                                 |
| P-F-003 | Address-sharing cluster       | Connected component in address-graph contains >4 companies that have collectively bid on >2 contracts where they did not all disclose their relationship.                  |
| P-F-004 | Co-bidding rotation           | 3+ entities always appearing together as bidders on same tenders, with winning rotation across awards (statistical signature of collusion).                                |
| P-F-005 | Abrupt ownership transfer     | Entity ownership transferred within 30 days before/after a major contract event (award, payment, completion certificate), particularly to a recently-incorporated holding. |

### Table 133

| ID      | Pattern                      | Detection logic                                                                                                                                    |
| ------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-G-001 | Backdated document           | Document metadata (PDF creation date, EXIF) inconsistent with declared signing date by >30 days.                                                   |
| P-G-002 | Signature mismatch           | Signatures on amendments differ visually from signatures on original (perceptual hash distance above threshold).                                   |
| P-G-003 | Template recycling           | Same document template (text shingle similarity >0.85) used by 3+ unrelated awards, suggesting boilerplate fraud rather than independent drafting. |
| P-G-004 | Missing required attachments | Tender-publication checklist requires attachments A, B, C; published includes only A and B; persistent across multiple tenders by same authority.  |

### Table 134

| ID      | Pattern                          | Detection logic                                                                                                                                     |
| ------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-H-001 | Award-to-payment latency outlier | Time between contract signature and first payment is in bottom 5th percentile for the authority's history (suspiciously fast), and exceeds 50M XAF. |
| P-H-002 | Off-cycle disbursement           | Disbursement occurs outside authority's declared budget cycle (e.g. December emergency releases) without corresponding emergency declaration.       |
| P-H-003 | Fiscal-year-end clustering       | >35% of authority's annual disbursements in last 30 days of fiscal year, suggesting use-it-or-lose-it spending with reduced scrutiny.               |

### Table 135

| 22  | SMART CONTRACTS Full Solidity for VIGILAnchor and VIGILGovernance |
| --- | ----------------------------------------------------------------- |

### Table 136

| // SPDX-License-Identifier: AGPL-3.0 pragma solidity ^0.8.24; import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol"; /// @title VIGILAnchor - Append-only registry of evidence-chain anchors /// @author VIGIL APEX SAS /// @notice Each anchor binds a dossier identifier hash to an evidence root /// hash and an IPFS content identifier. Anchors are immutable. contract VIGILAnchor is AccessControl { bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE"); bytes32 public constant COMMITTER_ROLE = keccak256("COMMITTER_ROLE"); struct Anchor { bytes32 evidenceRootHash; string ipfsCid; uint64 timestamp; address committer; } /// dossierIdHash -> Anchor (one-write semantics enforced) mapping(bytes32 => Anchor) private \_anchors; /// Append-only event log event AnchorCommitted( bytes32 indexed dossierIdHash, bytes32 evidenceRootHash, string ipfsCid, uint64 timestamp, address indexed committer ); event CommitterAuthorised(address indexed who, address indexed by); event CommitterRevoked (address indexed who, address indexed by); error AlreadyCommitted(bytes32 dossierIdHash); error EmptyCid(); error EmptyHash(); /// @param adminMultisig The Gnosis Safe (or equivalent) multisig that /// holds ADMIN_ROLE. The deployer renounces admin /// after grant. constructor(address adminMultisig) { require(adminMultisig != address(0), "Admin zero"); \_grantRole(DEFAULT_ADMIN_ROLE, adminMultisig); \_grantRole(ADMIN_ROLE, adminMultisig); // Deployer does not retain admin } /// @notice Authorise a committer (typically the worker-anchor service /// account). Only ADMIN_ROLE may call. function authoriseCommitter(address who) external onlyRole(ADMIN_ROLE) { \_grantRole(COMMITTER_ROLE, who); emit CommitterAuthorised(who, msg.sender); } /// @notice Revoke a committer. function revokeCommitter(address who) external onlyRole(ADMIN_ROLE) { \_revokeRole(COMMITTER_ROLE, who); emit CommitterRevoked(who, msg.sender); } /// @notice Commit an anchor. Reverts if dossierIdHash already committed. /// @dev Anchors are immutable; there is no update or delete function /// in this contract by design. function commitAnchor( bytes32 dossierIdHash, bytes32 evidenceRootHash, string calldata ipfsCid ) external onlyRole(COMMITTER_ROLE) { if (dossierIdHash == bytes32(0)) revert EmptyHash(); if (evidenceRootHash == bytes32(0)) revert EmptyHash(); if (bytes(ipfsCid).length == 0) revert EmptyCid(); if (\_anchors[dossierIdHash].timestamp != 0) { revert AlreadyCommitted(dossierIdHash); } \_anchors[dossierIdHash] = Anchor({ evidenceRootHash: evidenceRootHash, ipfsCid: ipfsCid, timestamp: uint64(block.timestamp), committer: msg.sender }); emit AnchorCommitted( dossierIdHash, evidenceRootHash, ipfsCid, uint64(block.timestamp), msg.sender ); } /// @notice Read an anchor. function getAnchor(bytes32 dossierIdHash) external view returns (Anchor memory) { return \_anchors[dossierIdHash]; } /// @notice Test whether a dossierIdHash has been anchored. function isAnchored(bytes32 dossierIdHash) external view returns (bool) { return \_anchors[dossierIdHash].timestamp != 0; } } |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 137

| // SPDX-License-Identifier: AGPL-3.0 pragma solidity ^0.8.24; import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol"; /// @title VIGILGovernance - Five-pillar council voting on dossier escalation /// @author VIGIL APEX SAS contract VIGILGovernance is AccessControl { bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE"); bytes32 public constant OPENER_ROLE = keccak256("OPENER_ROLE"); enum Pillar { NONE, CONAC, MINFI, CIVIL_SOCIETY, ACADEMIC, INTL_OBSERVER } enum Choice { NONE, YES, NO, ABSTAIN, RECUSE } enum State { OPEN, ESCALATED, DISMISSED, ARCHIVED } /// Smaller fields are packed into a single storage slot for gas efficiency. struct Proposal { bytes32 dossierIdHash; uint64 openedAt; uint64 closesAt; State state; uint8 yesCount; uint8 noCount; uint8 recuseCount; } /// Address -> Pillar membership. None means "not a member". mapping(address => Pillar) public memberOf; /// proposalId -> Proposal. mapping(bytes32 => Proposal) private \_proposals; /// proposalId -> address -> Choice cast (NONE means not yet voted). mapping(bytes32 => mapping(address => Choice)) private \_choices; /// Total members appointed per pillar (helps validate role uniqueness). mapping(Pillar => uint8) public memberCount; /// Required quorum: number of YES (or NO) votes needed to decide. uint8 public constant QUORUM = 3; /// Maximum voting window length (in seconds) the opener may request. uint64 public constant MAX_WINDOW = 30 days; uint64 public constant MIN_WINDOW = 3 days; event ProposalOpened( bytes32 indexed proposalId, bytes32 indexed dossierIdHash, uint64 openedAt, uint64 closesAt ); event VoteCast( bytes32 indexed proposalId, address indexed voter, Pillar pillar, Choice choice ); event ProposalEscalated(bytes32 indexed proposalId); event ProposalDismissed (bytes32 indexed proposalId); event ProposalArchived (bytes32 indexed proposalId); event MemberAppointed(address indexed who, Pillar pillar, address indexed by); event MemberRemoved (address indexed who, Pillar pillar, address indexed by); error NotAMember(); error NotOpener(); error AlreadyVoted(); error ProposalClosed(); error ProposalUnknown(); error ProposalAlreadyOpen(); error WindowOutOfRange(); error PillarHasNoMember(); error AlreadyMember(); constructor(address adminMultisig) { require(adminMultisig != address(0), "Admin zero"); \_grantRole(DEFAULT_ADMIN_ROLE, adminMultisig); \_grantRole(ADMIN_ROLE, adminMultisig); } // ----------------- Membership management (admin only) ------------------- function appointMember(address who, Pillar pillar) external onlyRole(ADMIN_ROLE) { require(pillar != Pillar.NONE, "Pillar required"); if (memberOf[who] != Pillar.NONE) revert AlreadyMember(); memberOf[who] = pillar; unchecked { memberCount[pillar] += 1; } emit MemberAppointed(who, pillar, msg.sender); } function removeMember(address who) external onlyRole(ADMIN_ROLE) { Pillar p = memberOf[who]; if (p == Pillar.NONE) revert NotAMember(); memberOf[who] = Pillar.NONE; unchecked { memberCount[p] -= 1; } emit MemberRemoved(who, p, msg.sender); } function authoriseOpener(address who) external onlyRole(ADMIN_ROLE) { \_grantRole(OPENER_ROLE, who); } // ----------------- Proposal lifecycle ------------------------------------ function openProposal( bytes32 dossierIdHash, uint64 windowSeconds ) external onlyRole(OPENER_ROLE) returns (bytes32 proposalId) { if (windowSeconds < MIN_WINDOW \|\| windowSeconds > MAX_WINDOW) { revert WindowOutOfRange(); } proposalId = keccak256( abi.encodePacked(dossierIdHash, block.timestamp, block.number) ); if (\_proposals[proposalId].openedAt != 0) revert ProposalAlreadyOpen(); \_proposals[proposalId] = Proposal({ dossierIdHash: dossierIdHash, openedAt: uint64(block.timestamp), closesAt: uint64(block.timestamp) + windowSeconds, state: State.OPEN, yesCount: 0, noCount: 0, recuseCount: 0 }); emit ProposalOpened( proposalId, dossierIdHash, uint64(block.timestamp), uint64(block.timestamp) + windowSeconds ); } function castVote(bytes32 proposalId, Choice choice) external { Proposal storage p = \_proposals[proposalId]; if (p.openedAt == 0) revert ProposalUnknown(); if (p.state != State.OPEN) revert ProposalClosed(); if (block.timestamp >= p.closesAt) { // Auto-archive an unresolved proposal whose window expired p.state = State.ARCHIVED; emit ProposalArchived(proposalId); revert ProposalClosed(); } Pillar pillar = memberOf[msg.sender]; if (pillar == Pillar.NONE) revert NotAMember(); if (\_choices[proposalId][msg.sender] != Choice.NONE) revert AlreadyVoted(); require(choice != Choice.NONE, "Choice NONE not allowed"); \_choices[proposalId][msg.sender] = choice; if (choice == Choice.YES) { unchecked { p.yesCount += 1; } } else if (choice == Choice.NO) { unchecked { p.noCount += 1; } } else if (choice == Choice.RECUSE) { unchecked { p.recuseCount += 1; } } // ABSTAIN counts toward neither YES nor NO; recorded for transparency. emit VoteCast(proposalId, msg.sender, pillar, choice); // Quorum check if (p.yesCount >= QUORUM) { p.state = State.ESCALATED; emit ProposalEscalated(proposalId); } else if (p.noCount >= QUORUM) { p.state = State.DISMISSED; emit ProposalDismissed(proposalId); } } function archiveExpired(bytes32 proposalId) external { Proposal storage p = \_proposals[proposalId]; if (p.openedAt == 0) revert ProposalUnknown(); if (p.state != State.OPEN) return; if (block.timestamp < p.closesAt) return; p.state = State.ARCHIVED; emit ProposalArchived(proposalId); } // ----------------- Read views ----------------------------------------- function getProposal(bytes32 proposalId) external view returns ( bytes32 dossierIdHash, uint64 openedAt, uint64 closesAt, State state, uint8 yesCount, uint8 noCount, uint8 recuseCount ) { Proposal storage p = \_proposals[proposalId]; return (p.dossierIdHash, p.openedAt, p.closesAt, p.state, p.yesCount, p.noCount, p.recuseCount); } function getVote(bytes32 proposalId, address voter) external view returns (Choice) { return \_choices[proposalId][voter]; } } |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 138

| // /packages/polygon/test/VIGILGovernance.test.ts import { expect } from "chai"; import { ethers } from "hardhat"; import { VIGILGovernance } from "../typechain-types"; describe("VIGILGovernance", () => { const Pillar = { NONE:0, CONAC:1, MINFI:2, CIVIL*SOCIETY:3, ACADEMIC:4, INTL_OBSERVER:5 }; const Choice = { NONE:0, YES:1, NO:2, ABSTAIN:3, RECUSE:4 }; let gov: VIGILGovernance; let admin: any, opener: any; let conac: any, minfi: any, csoc: any, acad: any, intl: any; beforeEach(async () => { [admin, opener, conac, minfi, csoc, acad, intl] = await ethers.getSigners(); const F = await ethers.getContractFactory("VIGILGovernance"); gov = await F.deploy(admin.address); await gov.connect(admin).authoriseOpener(opener.address); await gov.connect(admin).appointMember(conac.address, Pillar.CONAC); await gov.connect(admin).appointMember(minfi.address, Pillar.MINFI); await gov.connect(admin).appointMember(csoc.address, Pillar.CIVIL_SOCIETY); await gov.connect(admin).appointMember(acad.address, Pillar.ACADEMIC); await gov.connect(admin).appointMember(intl.address, Pillar.INTL_OBSERVER); }); it("escalates on 3 YES", async () => { const dossierHash = ethers.id("dossier-123"); const tx = await gov.connect(opener).openProposal(dossierHash, 7 * 24 _ 3600); const r = await tx.wait(); const proposalId = r!.logs[0].topics[1] as string; await gov.connect(conac).castVote(proposalId, Choice.YES); await gov.connect(minfi).castVote(proposalId, Choice.YES); await expect(gov.connect(csoc).castVote(proposalId, Choice.YES)) .to.emit(gov, "ProposalEscalated").withArgs(proposalId); const p = await gov.getProposal(proposalId); expect(p.state).to.equal(1); // ESCALATED }); it("dismisses on 3 NO", async () => { /_ similar _/ }); it("rejects vote from non-member", async () => { /_ ... _/ }); it("rejects double-vote by same member", async () => { /_ ... _/ }); it("auto-archives expired proposal", async () => { /_ ... _/ }); it("RECUSE counts but neither escalates nor dismisses", async () => { /_ ... \_/ }); }); |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 139

| // /packages/polygon/hardhat.config.ts import { HardhatUserConfig } from "hardhat/config"; import "@nomicfoundation/hardhat-toolbox"; import "@openzeppelin/hardhat-upgrades"; const config: HardhatUserConfig = { solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, }, }, networks: { hardhat: { chainId: 31337 }, mumbai: { url: process.env.MUMBAI_RPC ?? "https://rpc-mumbai.maticvigil.com", accounts: process.env.MUMBAI_PK ? [process.env.MUMBAI_PK] : [], }, polygon: { url: process.env.POLYGON_RPC!, // Alchemy accounts: { mnemonic: "" }, // signing via YubiKey relayer; see below chainId: 137, }, }, etherscan: { apiKey: { polygon: process.env.POLYGONSCAN_API_KEY ?? "" }, }, gasReporter: { enabled: true, currency: "USD" }, }; export default config; |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 140

| // /packages/polygon/scripts/deploy.ts import { ethers, run } from "hardhat"; async function main() { // Multisig address (Gnosis Safe on Polygon held by architect+CONAC official) const ADMIN_MULTISIG = process.env.ADMIN_MULTISIG!; console.log("Deploying VIGILAnchor..."); const Anchor = await ethers.getContractFactory("VIGILAnchor"); const anchor = await Anchor.deploy(ADMIN_MULTISIG); await anchor.waitForDeployment(); console.log("VIGILAnchor:", await anchor.getAddress()); console.log("Deploying VIGILGovernance..."); const Gov = await ethers.getContractFactory("VIGILGovernance"); const gov = await Gov.deploy(ADMIN_MULTISIG); await gov.waitForDeployment(); console.log("VIGILGovernance:", await gov.getAddress()); // Wait some confirmations before verifying await new Promise(r => setTimeout(r, 30_000)); // Verify on PolygonScan await run("verify:verify", { address: await anchor.getAddress(), constructorArguments: [ADMIN_MULTISIG], }); await run("verify:verify", { address: await gov.getAddress(), constructorArguments: [ADMIN_MULTISIG], }); // Write deployment record const fs = await import("fs"); fs.writeFileSync("/infra/polygon-deploy.json", JSON.stringify({ network: "polygon", deployedAt: new Date().toISOString(), contracts: { VIGILAnchor: await anchor.getAddress(), VIGILGovernance: await gov.getAddress(), }, admin: ADMIN_MULTISIG, }, null, 2)); } main().catch((e) => { console.error(e); process.exit(1); }); |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

### Table 141

| Step                     | Action                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Test on Mumbai        | Full test suite at 100% coverage. Slither static analysis clean. MythX deep analysis clean. Deploy to Mumbai testnet using a low-value private key. |
| 2. Pillar acceptance     | Each of the 5 pillars casts a test vote on a sample Mumbai proposal. Confirms YubiKey signing flow works for every holder.                          |
| 3. Independent audit     | An external audit firm (regional, e.g. Hexens or smaller Africa-focused) reviews both contracts. Audit report received and findings remediated.     |
| 4. Deploy to Polygon     | Architect signs the deploy tx via the admin multisig (Gnosis Safe). Records contract addresses in /infra/polygon-deploy.json.                       |
| 5. Authorise committer   | Multisig calls anchor.authoriseCommitter(<worker-anchor eth_address>); gov.authoriseOpener(<worker-anchor>).                                        |
| 6. Appoint members       | Multisig calls gov.appointMember for each pillar holder's eth_address.                                                                              |
| 7. Verify on PolygonScan | Submit source for verification. Public source code linkable from the dashboard.                                                                     |
| 8. Fund worker-anchor    | Send 0.5 MATIC to the worker-anchor service account for initial gas. Top up as the gas tracker indicates.                                           |

### Table 142

| 23  | FIVE-PILLAR GOVERNANCE Multi-party institutional consent for every escalation |
| --- | ----------------------------------------------------------------------------- |

### Table 143

| Pillar                 | Holder                                   | Mandate                                                                                                                |
| ---------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| CONAC                  | Designated CONAC representative          | Anti-corruption institutional voice. Reviews findings for prosecutorial viability.                                     |
| MINFI                  | Designated MINFI representative          | Public-finance institutional voice. Reviews findings for fiscal materiality and pre-payment implications.              |
| Civil Society          | Rotating representative from a CSO panel | Independent civil oversight. Reviews findings for public-interest weight and fairness to implicated entities.          |
| Academic               | University-appointed senior researcher   | Methodological and evidentiary review. Validates findings are well-founded by the evidence chain.                      |
| International Observer | Rotating observer from an MOU partner    | International credibility and cross-border perspective. In MVP, position held in placeholder mode pending Phase-2 MOU. |

### Table 144

| #   | Transition          | What happens                                                                                                                                                                                                                                                    |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Finding -> Proposal | When certainty > 0.65 AND pattern category in {A, B, D, E, F}, worker-anchor opens a governance proposal. proposal.opened_at recorded.                                                                                                                          |
| 2   | Proposal opened     | Contract emits ProposalOpened. Dashboard surfaces to all 5 pillar holders. Each receives email + portal notification.                                                                                                                                           |
| 3   | Pillar reviews      | Each holder logs into council.vigilapex.cm (Keycloak + YubiKey FIDO2), reads the dossier, casts vote. Vote signed with YubiKey-held secp256k1 key (Section 17.8) and submitted to Polygon.                                                                      |
| 4   | Quorum check        | Contract checks after every vote. On 3 YES, ProposalEscalated fires. On 3 NO, ProposalDismissed. On 14-day timeout, ProposalArchived.                                                                                                                           |
| 5   | Downstream action   | On ProposalEscalated: governance worker delivers dossier via SFTP to CONAC (Section 24) and exposes score to MINFI pre-payment API (Section 25). On ProposalDismissed: dossier annotated 'dismissed', archived. On ProposalArchived: 'inconclusive' annotation. |

### Table 145

| 24  | DOSSIER PDF VISUAL TEMPLATE What a dossier looks like, page by page |
| --- | ------------------------------------------------------------------- |

### Table 146

| Property                 | Value                                                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page size                | A4 (210mm x 297mm). NOT US Letter - this is for Cameroonian state use.                                                                                                                        |
| Margins                  | Top 22mm, Bottom 22mm, Left 25mm, Right 22mm                                                                                                                                                  |
| Body text font           | Inter Regular 10.5pt. (Inter is open-source; ships with the build.)                                                                                                                           |
| Heading font             | Inter Bold (semantic heading hierarchy: H1 18pt, H2 14pt, H3 12pt)                                                                                                                            |
| Monospace (evidence IDs) | JetBrains Mono Regular 9.5pt                                                                                                                                                                  |
| Line height              | Body 1.45; headings 1.2                                                                                                                                                                       |
| Paragraph spacing        | 6pt before, 0pt after                                                                                                                                                                         |
| Bilingual layout         | FR-primary edition: French body, English summary boxes inline. EN-secondary edition: English body, French summary boxes inline. Both editions ship as separate PDFs (pdf_cid_fr, pdf_cid_en). |

### Table 147

| Role                    | Hex     | Usage                                                               |
| ----------------------- | ------- | ------------------------------------------------------------------- |
| Primary (Republic Navy) | #1F3864 | Headings, frames, signature block                                   |
| Accent (Republic Red)   | #C00000 | Classification banner CONFIDENTIAL, finding-id pills, callout boxes |
| Public (Forest Green)   | #548235 | Classification banner PUBLIC                                        |
| Restricted (Amber)      | #BF8F00 | Classification banner RESTRICTED                                    |
| Body text               | #202020 | Default text colour (not pure black, easier on the eye)             |
| Secondary text          | #595959 | Captions, footnotes, metadata                                       |
| Section divider         | #BFBFBF | Hairline rules between sections                                     |
| Caveat box background   | #FFF2CC | Counter-evidence and limitations sections                           |

### Table 148

| Zone | Element                | Specification                                                                                                                                                                  |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A    | Header band (top 25mm) | Coat of arms 18mm tall left-aligned. Centered: 'REPUBLIQUE DU CAMEROUN \| REPUBLIC OF CAMEROON' in Inter Bold 11pt, navy. Sub-line: 'Paix - Travail - Patrie' italic 9pt grey. |
| B    | Classification strip   | Full-width colour bar (matches classification): height 8mm, white text 14pt centered: PUBLIC \| RESTRICTED \| CONFIDENTIAL                                                     |
| C    | Title block            | Centered. Line 1: 'VIGIL APEX' navy 36pt bold. Line 2: 'INVESTIGATIVE DOSSIER' navy 18pt. Line 3: dossier number 'VA-YYYY-NNNN' red 28pt monospace bold.                       |
| D    | Title (FR + EN)        | Two stacked lines. FR title 14pt bold. EN title 12pt italic grey.                                                                                                              |
| E    | Metadata block         | 4-row mini-table: 'Generated', 'Generator version', 'Pages', 'Word count'. Right-aligned values. 9.5pt.                                                                        |
| F    | Subjects summary       | Up to 3 lines listing primary entities by name (with RCCM where available). 11pt.                                                                                              |
| G    | QR code                | 30mm x 30mm bottom-right. Encodes: 'https://vigilapex.cm/verify/VA-YYYY-NNNN'. Includes a 7mm logo overlay.                                                                    |
| H    | Anchor footer          | Bottom band: dossier sha256 (first 16 chars), Polygon tx hash (first 16 chars), Fabric tx ID (first 16 chars). Monospace 8pt grey.                                             |

### Table 149

| #   | Section                    | Visual notes                                                                                                                                                               |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Executive summary          | 200-400 word narrative. Sonnet 4.6 drafted. Top of page 2. FR primary; EN summary in side-box on right margin.                                                             |
| 2   | Classification & handling  | Dossier classification (PUBLIC/RESTRICTED/CONFIDENTIAL) with handling instructions. Half-page.                                                                             |
| 3   | Identification of subjects | Table: Entity Name \| Type \| RCCM \| Role in finding \| Beneficial owner chain. Alternating row shading. Up to 3 pages.                                                   |
| 4   | Triggering events          | Chronology table: Date \| Event \| Source \| Evidence ID. Left-aligned timeline marker bar.                                                                                |
| 5   | Patterns detected          | One sub-section per pattern. Pattern card: pattern_id pill (red), display name (FR + EN), signal strength bar (visual gauge 0-1.0), supporting evidence summary.           |
| 6   | Evidence chain             | Hash-linked evidence record. Each item: source, fetch date, IPFS CID, sha256, role (corroborating/contradicting). Monospace IDs. Footnote markers tie back to text claims. |
| 7   | Certainty assessment       | Bayesian engine output: prior, signals, log-odds steps, posterior. Visual log-odds bar. Counter-evidence (devil's-advocate) section in caveat box (peach background).      |
| 8   | Recommended action         | Recommendation with severity icon. Text on left; checkbox-style 'next steps' callout on right.                                                                             |
| 9   | Appendices                 | Verbatim document excerpts (translated where needed); satellite imagery comparisons (before/after side by side); network graph rendering from Neo4j (PNG or SVG).          |
| 10  | Anchor and verification    | Half-page final block. Fabric tx ID, Polygon anchor tx, IPFS evidence root CID, public verification URL, instructions for third-party verification.                        |

### Table 150

| HEADER (top 12mm) +---------------------------------------------------------------+ \| VIGIL APEX - Dossier VA-2026-0134 - CONFIDENTIAL \| +---------------------------------------------------------------+ (hairline rule navy 0.5pt) FOOTER (bottom 12mm) (hairline rule navy 0.5pt) +---------------------------------------------------------------+ \| sha256:a3f2...c891 Page 7 of 32 vigilapex.cm/verify \| +---------------------------------------------------------------+ |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 151

| +-----------------------------------------------------------+ \| [P-A-001] ATTRIBUTION A SOUMISSIONNAIRE UNIQUE \| \| Single-bidder award \| \| \| \| Force du signal: [############## ] 0.85 \| \| \| \| Evidence supporting this match: \| \| - COLEPS notice ref. AONO-23/MINMAP/CIPM/2026 [E-12] \| \| - Bid record count: 1 [E-13] \| \| - Awarded value: 4.2 milliards XAF [E-14] \| +-----------------------------------------------------------+ |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 152

| \|\|+---------------------------------------------------------+ \|\|\| ALTERNATIVES ET LIMITES / CAVEATS \| \|\|\| \| \|\|\| The following alternative explanations were assessed \| \|\|\| during devil's-advocate review: \| \|\|\| \| \|\|\| - Single-bidder may reflect emergency procurement \| \|\|\| procedure (verified: no emergency declaration \| \|\|\| filed for the period). \| \|\|\| - Bouygues Cameroun BTP holds prequalification \| \|\|\| monopoly for category III road works in this region \| \|\|\| (verified: 7 other prequalified contractors). \| +---------------------------------------------------------+ (red left border 1.5pt; peach #FFF2CC fill) |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

### Table 153

| 25  | CONAC SFTP INTEGRATION How escalated dossiers reach the National Anti-Corruption Commission |
| --- | ------------------------------------------------------------------------------------------- |

### Table 154

| Property        | Value                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Hostname        | sftp.conac.cm (provided by CONAC IT during M3 W16; placeholder until then)                            |
| Port            | 22 (TCP, SSH)                                                                                         |
| Auth method     | SSH public key. VIGIL APEX side: SSH key on YK-01 slot 9a. CONAC side: their administrator's keypair. |
| VIGIL APEX user | vigil-apex                                                                                            |
| Inbox path      | /inbox/vigil-apex/ (write-only for vigil-apex)                                                        |
| ACK path        | /ack/vigil-apex/ (read-only for vigil-apex)                                                           |
| Quarantine path | /quarantine/vigil-apex/ (CONAC writes here when a delivery has issues)                                |

### Table 155

| File             | Naming pattern                                                         |
| ---------------- | ---------------------------------------------------------------------- |
| FR PDF           | VA-YYYY-NNNN-fr.pdf                                                    |
| EN PDF           | VA-YYYY-NNNN-en.pdf                                                    |
| Evidence archive | VA-YYYY-NNNN-evidence.tar.gz                                           |
| Manifest         | VA-YYYY-NNNN.manifest.json (uploaded LAST; signals 'package complete') |

### Table 156

| { "$schema": "https://vigilapex.cm/schemas/conac-manifest-v1.json", "manifest_version": 1, "dossier_number": "VA-2026-0134", "classification": "CONFIDENTIAL", "generated_at": "2026-04-15T13:45:22Z", "delivered_at": "2026-04-15T13:46:11Z", "title_fr": "Marche unique - Travaux de route Yagoua-Bongor", "title_en": "Single-bidder award - Yagoua-Bongor road works", "primary_subjects": [ {"name": "Bouygues Cameroun BTP SA", "rccm": "RC/YDE/2018/B/12345"} ], "patterns_detected": ["P-A-001", "P-C-001", "P-D-001"], "certainty": 0.91, "files": { "fr_pdf": {"name": "VA-2026-0134-fr.pdf", "sha256": "a3f2..."}, "en_pdf": {"name": "VA-2026-0134-en.pdf", "sha256": "9b7c..."}, "evidence": {"name": "VA-2026-0134-evidence.tar.gz","sha256": "c481..."} }, "anchors": { "ipfs_evidence_root": "bafybeig...", "polygon_anchor_tx": "0x2a1...", "fabric_tx_id": "f3e9..." }, "verification_url": "https://vigilapex.cm/verify/VA-2026-0134", "governance": { "proposal_id": "0x9c3...", "yes_votes": 3, "no_votes": 0, "vote_window": {"opened_at": "2026-04-08T10:00:00Z", "closed_at": "2026-04-15T13:42:50Z"} }, "signature": { "algorithm": "ECDSA-secp256k1", "signer": "0x4a2...", // architect's eth_address "value": "0x..." // signature over canonicalised manifest minus signature field } } |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 157

| { "ack_version": 1, "dossier_number": "VA-2026-0134", "received_at": "2026-04-15T14:02:11Z", "received_by": "conac-ingest-system", "outcome": "accepted", // accepted \| rejected_format \| rejected_signature \| quarantined "case_reference": "CONAC-CASE-2026-0734", "comments": "Routed to Direction des Investigations.", "signature": { "algorithm": "RSA-SHA256", "signer_cert_sha256": "...", // CONAC's public-key cert hash "value": "..." } } |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 158

| Failure                               | Action                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| SSH connection refused                | Retry: 30s, 2m, 5m, 15m, 60m. Then P2 alert; pause delivery worker; notify architect.           |
| Authentication rejected               | Pause; P1 alert immediately. Architect verifies key not rotated by CONAC without notice.        |
| Disk full on CONAC side               | Wait for ACK queue to drain; retry every 60min. Do NOT bypass; CONAC must clear.                |
| Delivered but no ACK in 7 days        | Escalate to P2 incident. Architect calls CONAC liaison. Re-upload only after explicit go-ahead. |
| ACK signature invalid                 | Quarantine ACK; P1 alert. Until validated, dossier is in 'delivered, ack-pending' state.        |
| CONAC writes to /quarantine/<dossier> | Read CONAC quarantine reason; route to architect for review; do NOT re-upload until rectified.  |

### Table 159

| 26  | MINFI SCORING API Pre-payment risk score for state disbursements |
| --- | ---------------------------------------------------------------- |

### Table 160

| Property            | Value                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Base URL            | https://api.vigilapex.cm/v1/score                                                |
| Method              | POST                                                                             |
| Authentication      | Mutual TLS (MINFI presents client cert issued by VIGIL Vault PKI) + bearer token |
| Request size limit  | 8 KB                                                                             |
| Response size limit | 32 KB                                                                            |
| Latency SLA         | P95 under 200ms; P99 under 500ms                                                 |
| Rate limit          | 2,000 req/minute per MINFI client (sliding window)                               |

### Table 161

| { "$schema": "https://vigilapex.cm/schemas/minfi-score-request-v1.json", "request_id": "minfi-tx-2026-04-15-09182", // MINFI-side identifier; idempotency key "transaction": { "contract_reference": "MIN-2025/ROUTE-NS/0017", "amount_xaf": 412000000, "currency": "XAF", "scheduled_date": "2026-04-18", "payer": { "kind": "ministry", "id": "MINTP", "vote_code": "65-50-12-0034" }, "payee": { "kind": "company", "rccm": "RC/YDE/2018/B/12345", "name": "BOUYGUES CAMEROUN BTP SA", "iban": "CM21 1000 0000 0xxx xxxx xxxx", "bank_bic": "SGCMCMCX" } }, "context": { "requesting_officer_id": "MINFI-USR-3829", "request_source": "DGTCFM-pre-payment-control" } } |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 162

| { "$schema": "https://vigilapex.cm/schemas/minfi-score-response-v1.json", "request_id": "minfi-tx-2026-04-15-09182", "responded_at": "2026-04-15T09:18:42.117Z", "score": 0.78, // 0..1; higher = more risk "score_band": "high", // none\|low\|moderate\|high\|critical "advisory": "review_recommended", // none\|note\|review_recommended\|hold_recommended "findings": [ { "finding_id": "F-2026-0488", "pattern_id": "P-A-001", "certainty": 0.91, "title_fr": "Marche unique - travaux de route...", "title_en": "Single-bidder award - road works...", "subjects": ["BOUYGUES CAMEROUN BTP SA"], "dossier_url": "https://vigilapex.cm/verify/VA-2026-0134", "anchored": true } ], "explanation_fr": "Une attribution recente a ce fournisseur presente des indicateurs...", "explanation_en": "A recent award to this supplier presents indicators of single-bidder...", "verification": { "polygon_tx": "0x2a1...", "ipfs_root": "bafybeig...", "fabric_tx_id": "f3e9..." }, "signature": { "algorithm": "ECDSA-secp256k1", "signer": "0x4a2...", "value": "0x..." } } |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

### Table 163

| Band     | Score range | Meaning + suggested MINFI workflow action                                                                    |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| none     | 0.00-0.20   | No finding affecting this transaction. Payment proceeds normally.                                            |
| low      | 0.20-0.40   | Weak signal; informational only. Officer notes; payment proceeds.                                            |
| moderate | 0.40-0.65   | Moderate signal. Officer reviews dossier link before disbursing.                                             |
| high     | 0.65-0.85   | Strong signal. Officer escalates to supervisor before disbursing.                                            |
| critical | 0.85-1.00   | Very strong signal. Officer holds the payment pending CONAC investigation update; documents the hold reason. |

### Table 164

| Failure                | Behaviour                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| VIGIL APEX unreachable | MINFI defaults to 'unknown' score; payment proceeds per their own controls. NOT a hard dependency.                |
| Slow response (>1s)    | MINFI client times out; logs warning; defaults to 'unknown'.                                                      |
| Auth rejected          | MINFI alerts our team via support email; we investigate. MINFI proceeds with normal controls.                     |
| Rate limit hit         | We return 429 with Retry-After header. MINFI client backs off; defaults to 'unknown' for the lapsed transactions. |

### Table 165

| 27  | FRONTEND WIREFRAMES Operator dashboard, council portal, public verification |
| --- | --------------------------------------------------------------------------- |

### Table 166

| Surface             | Audience                          | Primary capability                                              |
| ------------------- | --------------------------------- | --------------------------------------------------------------- |
| Operator dashboard  | Architect + 1-2 trusted operators | System health, finding triage, dead-letter, calibration, alerts |
| Council portal      | 5 pillar holders                  | Read dossiers, cast votes, view voting history                  |
| Public verification | Citizens, journalists, observers  | Verify a published dossier; view ledger root                    |

### Table 167

| Property          | Value                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Framework         | Next.js 14 (App Router) + React 18 + TypeScript 5.4                                                    |
| Styling           | Tailwind CSS 3 + shadcn/ui component primitives                                                        |
| Design tokens     | CSS custom properties matching the SRD palette (--vigil-primary #1F3864, --vigil-accent #C00000, etc.) |
| Typography        | Inter 4xx variable font for body; JetBrains Mono for IDs and hashes                                    |
| i18n              | next-intl. FR primary, EN secondary. Language toggle in header.                                        |
| Auth              | next-auth with Keycloak provider (FIDO2 only, no password)                                             |
| Data fetching     | Server Components for static-or-cached views; React Query for live-updating pages                      |
| Real-time updates | Server-Sent Events (SSE) on a /events stream for findings/proposals updates                            |
| Accessibility     | WCAG 2.1 AA. Keyboard navigation throughout. Screen-reader labels on all interactive elements.         |

### Table 168

| +----------------------------------------------------------------------+ \| LOGO VIGIL APEX [SEARCH...] FR \| EN [USER] \| <- header (height 56px) +----------------------------------------------------------------------+ \| HOME \| FINDINGS \| DOSSIERS \| DEAD-LETTER \| CALIBRATION \| ALERTS \| $$ \| <- nav (44px) +----------------------------------------------------------------------+ \| Active alerts (3) \| \| +----------------------------------------------------------------+ \| \| \| P1 worker-pattern lag > 10k events started 14:22 [ack] \| \| \| \| P2 RCCM crawler captcha-blocked started 13:11 [ack] \| \| \| \| P3 Daily LLM spend at 78% of cap started 09:00 [ack] \| \| \| +----------------------------------------------------------------+ \| \| \| \| Pipeline at a glance \| \| +-------------------+ +-------------------+ +-------------------+ \| \| \| INGEST \| \| INTELLIGENCE \| \| DELIVERY \| \| \| \| 26 adapters live \| \| ER queue: 47 \| \| Dossiers: 3 ready \| \| \| \| last 24h: 12,419 \| \| Patterns/h: 184 \| \| Awaiting ACK: 1 \| \| \| \| DLQ: 7 \| \| Calib ECE: 4.2% \| \| Escalated: 14 \| \| \| +-------------------+ +-------------------+ +-------------------+ \| \| \| \| Findings - last 7 days [filter] [export] \| \| +----------------------------------------------------------------+ \| \| \| F-2026-0488 \| P-A-001+P-D-001 \| 0.91 \| Bouygues Cameroun ... \| \| \| \| F-2026-0487 \| P-B-001 \| 0.42 \| Sodecoton suppliers \| \| \| \| F-2026-0486 \| P-A-002 \| 0.66 \| MINEDUB / Adamaoua \| \| \| \| ... \| \| +----------------------------------------------------------------+ \| \| \| \| Adapter health (mini-strip) \| \| ARMP[OK] MINMAP[OK] COLEPS[OK] MINFI[OK] DGB[OK] DGTCFM[OK] ... \| +----------------------------------------------------------------------+ |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 169

| +----------------------------------------------------------------------+ \| <- back F-2026-0488 [Detected] [escalate to council] \| +----------------------------------------------------------------------+ \| Patterns Bayesian Evidence (12) State history \| +----------------------------------------------------------------------+ \| \| \| Subject: BOUYGUES CAMEROUN BTP SA (RCCM: RC/YDE/2018/B/12345) \| \| Transaction: MIN-2025/ROUTE-NS/0017 Amount: 4.2 milliards XAF \| \| \| \| Patterns detected (3): \| \| +------+--------------------------------+----------+--------------+ \| \| \| ID \| Pattern \| Strength \| Source \| \| \| \| P-A-001 Single-bidder award \| 0.85 \| COLEPS \| \| \| \| P-C-001 Benchmark inflation \| 0.55 \| WB ref \| \| \| \| P-D-001 Satellite no-construction \| 0.92 \| Sentinel-2 \| \| \| +------+--------------------------------+----------+--------------+ \| \| \| \| Bayesian breakdown Counter-evidence \| \| +-------------------------+ +----------------+ \| \| \| prior 0.18 \| \| (peach box) \| \| \| \| + P-A-001 +1.6 LR \| \| Imagery offset \| \| \| \| + P-C-001 +0.8 LR \| \| verified. \| \| \| \| + P-D-001 +2.1 LR \| \| Coords correct \| \| \| \| posterior 0.91 \| \| per project \| \| \| +-------------------------+ \| plan. \| \| \| +----------------+ \| \| \| \| Evidence chain (12 items) Network graph (Neo4j render) \| \| ... \| +----------------------------------------------------------------------+ |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 170

| +----------------------------------------------------------------------+ \| VIGIL APEX - COUNCIL PORTAL FR \| EN [Mme. K] \| <- header +----------------------------------------------------------------------+ \| Open proposals (2) My voting history Council members \| +----------------------------------------------------------------------+ \| \| \| Open proposals awaiting your vote \| \| \| \| +----------------------------------------------------------------+ \| \| \| VA-2026-0134 [REVIEW >>] \| \| \| \| Single-bidder award - Bouygues - 4.2B XAF \| \| \| \| Patterns: P-A-001, P-C-001, P-D-001 Certainty: 0.91 \| \| \| \| Opened: 2026-04-08 Closes: 2026-04-22 (7 days remaining) \| \| \| \| Other pillars: CONAC[YES] MINFI[--] CSO[--] ACADEMIC[YES] \| \| \| +----------------------------------------------------------------+ \| \| \| \| +----------------------------------------------------------------+ \| \| \| VA-2026-0131 [REVIEW >>] \| \| \| \| ... another proposal ... \| \| \| +----------------------------------------------------------------+ \| \| \| \| Recent decisions (last 30 days) \| \| - VA-2026-0128 ESCALATED (your vote: YES) delivered to CONAC \| \| - VA-2026-0125 DISMISSED (your vote: NO) \| \| - VA-2026-0122 ARCHIVED (your vote: ABSTAIN; quorum not reached) \| +----------------------------------------------------------------------+ |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 171

| +----------------------------------------------------------------------+ \| <- back VA-2026-0134 - Single-bidder award - Bouygues 4.2B XAF \| +----------------------------------------------------------------------+ \| \| \| [DOSSIER PDF EMBEDDED HERE - PDF.js renderer, scrollable] \| \| (FR by default; toggle EN at top) \| \| \| \| Other pillars \| \| +----------------+ \| \| \| CONAC YES \| \| \| \| MINFI -- \| \| \| \| CSO -- \| \| \| \| ACAD YES \| \| \| \| INTL RECUSE\| \| \| +----------------+ \| \| \| \| -------------- YOUR VOTE -------------- \| \| \| \| Choose: [O YES, escalate to CONAC] \| \| [O NO, dismiss as unfounded] \| \| [O ABSTAIN] \| \| [O RECUSE - conflict of interest] \| \| \| \| Comment (private, for council audit; not made public yet): \| \| +------------------------------------------------------------+ \| \| \| \| \| \| +------------------------------------------------------------+ \| \| \| \| [INSERT YUBIKEY AND CAST VOTE] \| +----------------------------------------------------------------------+ |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 172

| +----------------------------------------------------------------------+ \| VIGIL APEX - Public Verification FR \| EN \| +----------------------------------------------------------------------+ \| \| \| Verify a dossier \| \| \| \| Enter dossier number: [VA-YYYY-NNNN ] [VERIFY] \| \| OR drop a PDF here: [ DROP ZONE ] \| \| \| \| Dossier VA-2026-0134 \| \| +----------------------------------------------------------------+ \| \| \| Status: ESCALATED \| \| \| \| Escalated on: 2026-04-15 \| \| \| \| Quorum: 3 of 5 pillars voted YES \| \| \| \| IPFS evidence root: bafybeig... [open in IPFS gateway] \| \| \| \| Polygon anchor tx: 0x2a1... [view on PolygonScan] \| \| \| \| Fabric tx ID: f3e9... \| \| \| \| Public PDF (FR): [download] \| \| \| \| Public PDF (EN): [download] \| \| \| +----------------------------------------------------------------+ \| \| \| \| If you uploaded a PDF: hash matches anchored hash. AUTHENTIC. \| \| \| \| Council members (read-only public list) \| \| - CONAC pillar: 0x... (since 2026-03-10) \| \| - MINFI pillar: 0x... (since 2026-03-10) \| \| - Civil Society pillar: 0x... (since 2026-03-10) \| \| - Academic pillar: 0x... (since 2026-03-10) \| \| - International Observer: 0x... (since 2026-03-15) \| +----------------------------------------------------------------------+ |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 173

| 28  | PUBLIC TIP-IN PORTAL The only public write surface; how citizens submit corruption tips |
| --- | --------------------------------------------------------------------------------------- |

### Table 174

| Property                | Value                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL                     | https://vigilapex.cm/tip                                                                                                                                               |
| Locale support          | Default: French. Toggle FR \| EN. Future: Pidgin English (community-translated, M3+)                                                                                   |
| Authentication          | None required. Anonymous submission is the default and recommended path                                                                                                |
| Optional identification | Submitter may optionally provide an email or phone for follow-up. This is encrypted at rest with a key only the operator team can use, and never displayed in dossiers |
| Hosted at               | Caddy reverse-proxy on the host (N01); served by the same Next.js app as /verify but with a separate route group                                                       |
| Backend endpoint        | POST /api/v1/tips - lives inside the dashboard service container (N16) but exposed via Caddy at the public path                                                        |
| Storage                 | PostgreSQL schema tip (separate from finding to enforce isolation); IPFS for attachments                                                                               |
| Rate limit at edge      | Cloudflare: 5 submissions per IP per hour, 50 per /24 subnet per hour. Stricter than the rest of the site                                                              |
| Captcha                 | Cloudflare Turnstile (privacy-respecting; no Google reCAPTCHA). Falls back to hCaptcha if Turnstile fails                                                              |

### Table 175

| Field               | Required | Description / placeholder                                                                                                                              |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Subject             | Yes      | Short title (max 200 chars). 'Inflated road contract in Centre region'                                                                                 |
| Description         | Yes      | Free text (max 5000 chars). 'What happened? When? Who is involved? How do you know?' Markdown not rendered (input is escaped)                          |
| Region              | Yes      | Select from 10 Cameroon regions OR 'Several / nationwide'. Used for geographic routing                                                                 |
| Sector              | No       | Optional select: Public Works, Health, Education, Energy, Defence, Other. Helps prioritise                                                             |
| Attachments         | No       | Up to 5 files, max 25MB total. Accepted: PDF, JPG, PNG, MP4 (capped 60s), DOCX. Auto-stripped of EXIF/metadata before storage. Virus-scanned by ClamAV |
| Contact (encrypted) | No       | Optional email or phone. If provided, encrypted with operator team's public key (libsodium sealed box). Operators decide if and when to reach out      |

### Table 176

| CONTROL vigilapex.cm/tip explicitly shows the user, BEFORE they fill the form, what is logged and what is not. The privacy notice is in plain language (FR/EN), short, and verifiable: the entire frontend is open-source and the source map is published. There is no dark pattern. |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

### Table 177

| POST /api/v1/tips \| v [1] Validate Form schema (Zod). Reject malformed; never persist. \| [2] Captcha verify Cloudflare Turnstile token check. \| [3] Edge rate-check Caddy rate-limit module + middleware tip-cooldown. \| [4] Sanitise Markdown stripped from description; attachment EXIF scrubbed via exiftool -all=; ClamAV scan. \| [5] Encrypt contact Sealed-box (libsodium) over operator team pubkey. \| [6] Persist INSERT INTO tip.submission (...); Attachments uploaded to IPFS, CIDs pinned, recorded in tip.attachment. \| [7] Initial classify Haiku 4.5 classifies: language, suspected sector, possible patterns. NEVER decides credibility. \| [8] Triage queue Redis stream tip.triage. Human operator reviews within SLA (next business day for normal, 4 hours for emergency-flagged tips). \| [9] Operator action One of: (a) DISMISS - clearly not credible (spam, defamation, off-topic). Recorded with reason; never erased; auto-deleted after 90 days if no further action. (b) ARCHIVE - credible but unactionable today (not enough info, not within MVP scope). Kept indefinitely; may be revisited. (c) PROMOTE - credible and actionable. Tip becomes a SIGNAL attached to a new or existing FINDING. The Bayesian engine recalculates posterior with the tip-derived signal at low prior (0.05-0.20 depending on tip evidence quality). \| [10] Audit-log entry Every action above is written to audit.event with hash-chained signature. The submitter's IP is NOT in the audit log; only operator action and tip ID. |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 178

| CREATE SCHEMA IF NOT EXISTS tip; CREATE TYPE tip.disposition AS ENUM ('NEW', 'IN_TRIAGE', 'DISMISSED', 'ARCHIVED', 'PROMOTED'); CREATE TABLE tip.submission ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ref TEXT UNIQUE NOT NULL, -- TIP-2026-0042 subject TEXT NOT NULL CHECK (length(subject) <= 200), description TEXT NOT NULL CHECK (length(description) <= 5000), region TEXT NOT NULL, sector TEXT, language CHAR(2) NOT NULL, -- 'fr' \| 'en' contact_sealed BYTEA, -- libsodium sealed box; NULL if anonymous disposition tip.disposition NOT NULL DEFAULT 'NEW', triage_user TEXT, -- Keycloak username; NULL until triaged triage_at TIMESTAMPTZ, triage_note TEXT, promoted_finding_id UUID REFERENCES finding.finding(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now() ); CREATE INDEX idx_tip_disposition ON tip.submission (disposition, created_at DESC); CREATE INDEX idx_tip_promoted ON tip.submission (promoted_finding_id) WHERE promoted_finding_id IS NOT NULL; CREATE TABLE tip.attachment ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), submission_id UUID NOT NULL REFERENCES tip.submission(id) ON DELETE CASCADE, filename_safe TEXT NOT NULL, -- sanitised filename mime TEXT NOT NULL, size_bytes BIGINT NOT NULL, ipfs_cid TEXT NOT NULL, scrubbed_metadata JSONB, -- what we removed (for transparency) clamav_clean BOOLEAN NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now() ); CREATE INDEX idx_tip_att_sub ON tip.attachment (submission_id); CREATE TABLE tip.action_log ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), submission_id UUID NOT NULL REFERENCES tip.submission(id), action TEXT NOT NULL, -- 'TRIAGED','DISMISSED','ARCHIVED','PROMOTED' by_user TEXT NOT NULL, note TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now() ); |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 179

| // apps/dashboard/app/api/v1/tips/route.ts import { NextRequest, NextResponse } from 'next/server'; import { z } from 'zod'; import { sealedBoxEncrypt } from '@/lib/crypto'; import { ingestAttachment } from '@/lib/ipfs'; import { db } from '@/lib/db'; import { verifyTurnstile } from '@/lib/captcha'; import { rateLimit } from '@/lib/rate-limit'; import { nextTipRef } from '@/lib/refs'; const TipSchema = z.object({ subject: z.string().trim().min(5).max(200), description: z.string().trim().min(20).max(5000), region: z.enum([ 'Adamaoua','Centre','Est','Extreme-Nord','Littoral', 'Nord','Nord-Ouest','Ouest','Sud','Sud-Ouest','Nationwide' ]), sector: z.string().max(60).optional(), language: z.enum(['fr','en']), contact: z.string().max(200).optional(), turnstile_token: z.string() }); export async function POST(req: NextRequest) { const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'; if (!await rateLimit.check('tip', ip, { perHour: 5 })) { return NextResponse.json({ error: 'rate_limited' }, { status: 429 }); } let body; try { body = TipSchema.parse(await req.json()); } catch (e) { return NextResponse.json({ error: 'invalid_input' }, { status: 400 }); } if (!await verifyTurnstile(body.turnstile_token, ip)) { return NextResponse.json({ error: 'captcha_failed' }, { status: 403 }); } const ref = await nextTipRef(); // TIP-2026-NNNN const contact_sealed = body.contact ? sealedBoxEncrypt(body.contact, process.env.OPERATOR_TEAM_PUBKEY!) : null; const sub = await db.tip.submission.create({ data: { ref, subject: body.subject, description: body.description, region: body.region, sector: body.sector, language: body.language, contact_sealed } }); // Attachments are uploaded via separate /api/v1/tips/[id]/attachment // calls after this initial POST returns, in a multipart flow that // streams to ClamAV then IPFS. See lib/ipfs/ingestAttachment. return NextResponse.json({ ref: sub.ref }, { status: 201 }); } |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 180

| +------------------------------------------------------------------------+ \| VIGIL APEX - Tip Triage [Filter: NEW ▼] [Export ▼] \| +------------------------------------------------------------------------+ \| \| \| Queue (12 NEW, 3 IN_TRIAGE) \| \| \| \| TIP-2026-0042 \| Centre \| Public Works \| 2026-04-26 09:14 [Open] \| \| TIP-2026-0041 \| Nord \| Health \| 2026-04-26 08:32 [Open] \| \| TIP-2026-0040 \| Nat'wide \| Defence \| 2026-04-25 22:11 [Open] \| \| ... \| \| \| +------------------------------------------------------------------------+ Tip detail page (when [Open] clicked): +------------------------------------------------------------------------+ \| TIP-2026-0042 Submitted: 2026-04-26 09:14 \| +------------------------------------------------------------------------+ \| Subject: Inflated road contract in Centre region \| \| Region: Centre Sector: Public Works Lang: fr \| \| \| \| Description: \| \| [submitter free text - rendered as plain text, never HTML] \| \| \| \| Attachments (3): \| \| - photo_road.jpg QmXa... [Preview] Metadata stripped: GPS \| \| - invoice.pdf QmYb... [Preview] Metadata stripped: author \| \| - witness.mp4 (38s) QmZc... [Preview] Metadata stripped: GPS \| \| \| \| Initial classification (Haiku): \| \| Language confirmed: fr \| \| Likely patterns: P-A-001 (single bidder), P-D-001 (no construct.) \| \| Confidence: medium (NOTE: this is a hint, not a verdict) \| \| \| \| Actions: \| \| [DISMISS] [ARCHIVE] [PROMOTE -> Finding] \| \| \| \| Triage note (required): \| \| [_________________________________________________________________] \| \| \| \| Optional contact decryption: \| \| [Decrypt contact] (logs the operator who decrypted; rate-limited) \| +------------------------------------------------------------------------+ |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

### Table 181

| Adversary type              | Behaviour                                                                | Mitigation                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spam / promotional          | Mass-submitted off-topic content                                         | Cloudflare Turnstile + rate limits + automated triage flags pure-promotional patterns; auto-DISMISS rule                                                                                                  |
| Defamation injection        | Crafted submissions designed to smear a named person                     | Tip-only signals never escalate; council quorum required for any naming; named-person dossiers require corroboration from at least two non-tip source classes (rule L10)                                  |
| State or political pressure | Volume submissions targeting a political adversary                       | Tip volume against any single named entity is monitored; spikes trigger operator review and may temporarily disable tip-derived signals against that entity until corroboration is independently verified |
| Doxxing / private grievance | Submitter uses portal to publish a private dispute                       | Triage screens; private disputes between non-officials are out of scope and DISMISSED with logged reason                                                                                                  |
| Foreign interference        | Coordinated submissions from outside Cameroon timed for political effect | Country-of-origin (from Cloudflare WAF, not application logging) is monitored as aggregate metric; sustained foreign-origin spikes referenced in monthly council report                                   |

### Table 182

| 29  | BUILD SEQUENCE 24-week schedule from M0 to M6 with milestone gates |
| --- | ------------------------------------------------------------------ |

### Table 183

| Milestone | Weeks   | Theme                                                                                                                                                                                    |
| --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0        | 0 (pre) | Funding closed, contracts signed, hardware on order. NOT included in 24 weeks.                                                                                                           |
| M0c       | 1 - 2   | Cold-start: bare-metal install, host services, container fabric, Vault unsealed. Architect alone, sovereign environment.                                                                 |
| M1        | 3 - 6   | Data plane: PostgreSQL DDL deployed, Neo4j up, IPFS up, all 26 crawlers running on schedule, dead-letter queues functional.                                                              |
| M2        | 7 - 12  | Intelligence plane: pattern catalogue (43 patterns) firing, Bayesian engine producing posteriors, anti-hallucination controls (L1-L10) all active, calibration dashboards green.         |
| M3        | 13 - 18 | Delivery plane: Polygon contracts deployed, dossier PDF template renders, CONAC SFTP integration live, MINFI scoring API live, frontend dashboards (operator/council/public/tip) usable. |
| M4        | 19 - 21 | Council standup: five pillar holders provisioned with YubiKeys, training delivered, first dossiers generated and presented to council for vote (test mode, no real publication).         |
| M5        | 22 - 23 | Hardening: red-team exercise (external pentest of public surfaces), DR rehearsal (full restore from S3 backup to a clean host), final calibration sweep, public-launch readiness review. |
| M6        | 24      | Public launch: first real escalated dossier published; vigilapex.cm goes live; Tip-In Portal opens; council goes operational; press conference.                                          |

### Table 184

| HONEST WARNING M4 through M6 are the highest-risk milestones. The technology is the easy part by then; the human, political, and institutional dynamics dominate. Build buffer time into the schedule. If the council is not ready at week 21, do not rush week 22-23. A delayed launch with a sound council is infinitely better than a punctual launch with a fragile one. |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 185

| 30  | ACCEPTANCE TESTS 28 binding tests across all milestones |
| --- | ------------------------------------------------------- |

### Table 186

| ID        | Acceptance criterion                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| AT-M0c-01 | Cold-start time from host power-on to all containers healthy is under 30 minutes (measured end-to-end on a clean install).                 |
| AT-M0c-02 | LUKS unlock requires both Tang server reachable AND a YubiKey present; either alone fails. Verified by removing one and attempting unlock. |
| AT-M0c-03 | Vault Shamir unseal requires 3 of 5 YubiKey-encrypted shares; 2 of 5 fails. Verified manually during M0c week 1.                           |
| AT-M0c-04 | Caddy serves vigilapex.cm/health over public TLS (Let's Encrypt) and the certificate chain validates from a clean Firefox / Chrome client. |

### Table 187

| ID       | Acceptance criterion                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-M1-01 | Adapter coverage 26 of 26: every adapter named in Section 12 is deployed, scheduled, and producing at least one event in a 24-hour window.                           |
| AT-M1-02 | Proxy diversity: no single proxy provider accounts for more than 60% of total egress GB over a 7-day window.                                                         |
| AT-M1-03 | Captcha budget compliance: monthly captcha solve cost under $500 (extrapolated from 7-day window).                                                                   |
| AT-M1-04 | IPFS-Synology consistency: every document pinned in local IPFS is also present in Synology backup within 1 hour of pin; verified by automated reconciliation script. |

### Table 188

| ID       | Acceptance criterion                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-M2-01 | Pattern coverage 43 of 43: every pattern in Section 21 is implemented and unit-tested with at least one synthetic positive and one synthetic negative.                  |
| AT-M2-02 | Expected Calibration Error (ECE) under 5% measured on the 200-finding labelled set.                                                                                     |
| AT-M2-03 | At least 50 findings produced over a 7-day window in steady state, of which at least 5 cross the 0.85 escalation threshold.                                             |
| AT-M2-04 | Devil's-advocate counter-evidence pass runs on every finding above 0.85 and produces a non-empty Caveats object; verified over 7-day window.                            |
| AT-M2-05 | LLM tier routing daily cost stays under $30 soft ceiling on all 7 days of a typical week; never breaches $100 hard ceiling.                                             |
| AT-M2-06 | Anti-hallucination quote-match rejection rate is between 1% and 8% over a 7-day window (above 8% triggers prompt review; below 1% suggests the check is not exercised). |
| AT-M2-07 | Numerical-disagreement rate (L8) is under 5% over a 7-day window.                                                                                                       |

### Table 189

| ID       | Acceptance criterion                                                                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-M3-01 | VIGILAnchor and VIGILGovernance contracts deployed to Polygon mainnet, source verified on PolygonScan, deployment record in /infra/polygon-deploy.json.                                                                     |
| AT-M3-02 | Dossier PDF reproducibility: rendering the same finding twice produces a bit-identical PDF (sha256 match). Verified across 10 test findings.                                                                                |
| AT-M3-03 | CONAC SFTP round-trip: a test dossier upload generates an ACK file within 7 days (in M3 testing, the ACK is from a test endpoint operated by the architect; in production from CONAC).                                      |
| AT-M3-04 | MINFI scoring API meets P95 latency under 200ms across 1000 representative requests.                                                                                                                                        |
| AT-M3-05 | MINFI API fail-soft verified: when VIGIL is intentionally taken offline, the documented client behaviour (default to unknown, payment proceeds) is achievable from a test client.                                           |
| AT-M3-06 | Frontend surfaces functional: operator dashboard loads under 2s, finding-detail loads under 3s, council vote ceremony completes within 30s including WebAuthn signature, public verification renders for any sample VA-ref. |

### Table 190

| ID       | Acceptance criterion                                                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-28-01 | Submission flow completes in under 5 seconds at P95 over a 1Mbps connection from Yaounde.                                                                                                           |
| AT-28-02 | Anonymous submission produces zero IP entries in the application database (verified by automated scan against tip schema).                                                                          |
| AT-28-03 | All five accepted attachment types pass through the EXIF-strip pipeline; verified by re-extracting metadata from the IPFS-pinned copy and confirming GPS / author / created-by are absent.          |
| AT-28-04 | A submitted contact field is unreadable in PostgreSQL without the operator-team private key (verified by attempting decryption with a different key; expected libsodium failure).                   |
| AT-28-05 | Five submissions from the same IP within 60 minutes triggers rate-limit response on the sixth (verified end-to-end including Cloudflare layer).                                                     |
| AT-28-06 | A tip with malformed JSON, missing required fields, or oversize attachments returns 400 / 413 and is not persisted.                                                                                 |
| AT-28-07 | A promoted tip increases the bound finding's signal count by exactly one and shifts its posterior consistent with prior 0.10 +/- 0.05; verified against the Bayesian engine's deterministic output. |
| AT-28-08 | The submitter status-lookup page never reveals operator identity, triage notes, or finding linkage; verified by inspecting the response body of /tip/status.                                        |

### Table 191

| ID       | Acceptance criterion                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AT-M4-01 | All five (5) council pillar holders successfully cast at least one signed vote on Polygon Mumbai testnet during M4. Vote signatures verify on-chain.                           |
| AT-M4-02 | Recovery drill: simulating loss of one pillar holder's YubiKey, the recovery procedure (Section 17.16) is executed and the holder is replaced and re-enrolled within 24 hours. |

### Table 192

| ID       | Acceptance criterion                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-M5-01 | External penetration test: zero CRITICAL findings remain unresolved at end of week 23 (HIGH findings may remain only with explicit risk-acceptance signed by architect and CONAC pillar). |
| AT-M5-02 | Disaster recovery: full restore from latest off-site backup to a clean host completes in under 6 hours, end-to-end including container bring-up and integrity verification.               |

### Table 193

| 31  | RUNBOOKS Step-by-step operational procedures |
| --- | -------------------------------------------- |

### Table 194

| # Operator: architect or developer with deploy_worker role # Channel: SSH PIV from operator workstation to N01 # 1. Verify code change is on main, CI green ssh n01.vigilapex.cm cd /srv/vigil/code git fetch origin git log origin/main -1 git checkout main && git pull # 2. Build the affected image docker compose -f docker-compose.yaml build worker-patterns # 3. Roll the worker (zero-downtime since work is queue-driven) docker compose -f docker-compose.yaml up -d --no-deps worker-patterns # 4. Verify docker compose ps worker-patterns docker compose logs --tail 50 worker-patterns # 5. Tag the deploy git tag deploy/$(date +%Y%m%d-%H%M)-worker-patterns git push origin --tags   # 6. Update changelog echo "$(date -Iseconds) worker-patterns -> $(git rev-parse --short HEAD)" \ >> /srv/vigil/ops/changelog.txt |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 195

| # Operator: architect (cannot be delegated during DR) # Trigger: host catastrophic failure, hardware loss, ransomware # 1. Stand up replacement host (same Ubuntu version) # Bare-metal install per M0c day 1-2 procedure (Section 29.2) # 2. Restore Btrfs subvolumes from off-site (S3) and on-site (Synology) restic -r sftp:synology:/srv/vigil-backup restore latest --target /srv/vigil/ # 3. Restore Vault state (encrypted backup) # Requires 3-of-5 Shamir keys to unseal after restore sudo systemctl start vigil-vault-unseal # 4. Restart container fabric docker compose -f /srv/vigil/code/docker-compose.yaml up -d # 5. Verify hash-chain continuity of audit log python3 /srv/vigil/code/scripts/audit_verify.py # 6. Verify Polygon ledger root matches local node /srv/vigil/code/scripts/verify-anchor-tip.js # 7. Resume crawlers (cron is part of host so should auto-resume) systemctl status cron # Target end-to-end: under 6 hours per AT-M5-02 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 196

| # Operator: architect with YK-01 + YK-02 in safe accessible # Trigger: 12-month rotation schedule OR suspected compromise # 1. Provision new YubiKey YK-XX with same PIV slot layout as YK-01 ykman piv reset ykman piv keys generate -a ECCP256 9a - ykman piv keys generate -a ECCP256 9c - ykman piv keys generate -a RSA2048 9d - # 2. Re-encrypt the architect's Vault share to YK-XX's slot 9d pubkey python3 ops/reencrypt_share.py --from YK-01 --to YK-XX --share 1 # 3. Update Keycloak FIDO2 enrolment: add YK-XX, remove YK-01 # 4. Update SSH authorized_keys: add YK-XX pubkey, remove YK-01 pubkey ssh-copy-id -i yk-xx.pub n01.vigilapex.cm ssh n01 'sed -i "/yk-01/d" ~/.ssh/authorized_keys' # 5. Test new key end-to-end before destroying old: # SSH, Vault unseal contribution, Keycloak, Council vote on Mumbai # 6. Securely destroy YK-01 (physical destruction; do not resell) # Document chain of custody in /srv/vigil/ops/key-disposal.log |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 197

| # Trigger: a pillar holder resigns, becomes incapacitated, or is removed # Operator: architect coordinates; admin multisig executes the on-chain change # 1. Council passes a removal proposal (if removal; otherwise voluntary) # 2. After quorum, the admin multisig calls: cast send $GOVERNANCE_ADDRESS \ "removeMember(uint8,address)" $PILLAR_X $OLD_ADDR \ --account admin-multisig cast send $GOVERNANCE_ADDRESS \ "appointMember(uint8,address)" $PILLAR_X $NEW_ADDR \ --account admin-multisig # 3. Provision new YubiKey for new holder per R3 procedure (steps 1-5) # 4. Enrol new holder in Keycloak (architect operator role) # 5. Update /infra/council/holders.json with new holder identity # (publicly visible at vigilapex.cm/about/council) # 6. New holder casts a test vote on a no-op proposal to verify chain works |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 198

| Severity | SLA to Ack        | Definition / examples                                                                                                                    |
| -------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | 5 min             | Public-facing breach, key compromise, fabricated finding published. Architect paged 24/7. Pillar council convened within 1 hour.         |
| P1       | 30 min            | Pipeline halted, all crawlers down, ECE >10%, dashboard unreachable. Architect or on-call developer acknowledges.                        |
| P2       | 4 hours           | Single crawler down >24h, single worker DLQ overflowing, single anomalous metric. On-call developer triages next business day at latest. |
| P3       | Next business day | Calibration drift in single pattern, single dossier render anomaly, low-severity log warnings.                                           |

### Table 199

| # Step 1: Contain # - If a fabricated finding was published: invoke emergency dossier withdrawal # (still requires 3 council votes on a withdrawal proposal; documented as # exception in audit log) # - If a key was compromised: rotate per R3 immediately; revoke compromised # key from Keycloak, Vault, SSH, Polygon admin role # Step 2: Communicate # - Architect drafts initial public statement within 2 hours (FR/EN) # - Statement is reviewed by CONAC pillar before publication # - Update vigilapex.cm/incident with timestamped log # Step 3: Investigate # - Pillar council convenes; minutes are kept; eventually published # - Forensic capture of relevant logs (audit, container, host, Polygon tx) # - External investigator (independent) engaged if root cause is internal # Step 4: Remediate # - Fix the technical or procedural root cause # - Update this runbook with the lessons learned # - Schedule a council retrospective at the next regular meeting # Step 5: Disclose # - Full incident post-mortem published at vigilapex.cm/incident/<id> within # 30 days, in FR and EN, signed by architect and CONAC pillar |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 200

| # Frequency: first Saturday of every month, 09:00 WAT # Operator: rotates between architect and on-call developer # Light exercise (months 1, 2, 4, 5, 7, 8, 10, 11): # - Spin up a clean VM # - Restore the latest restic snapshot # - Verify audit log hash continuity # - Verify last anchor matches Polygon # - Tear down VM # - Log result in /srv/vigil/ops/dr-log.txt # Heavy exercise (months 3, 6, 9, 12): # - All of the above PLUS # - Bring up the full container fabric # - Run a synthetic finding through the pipeline end-to-end # - Render a test dossier # - SFTP-upload to a test endpoint # - Confirm ACK # - Total time logged; target <6 hours # - Council notified of result via the next regular agenda |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

### Table 201

| 32  | CLOSING What this document is, what it is not |
| --- | --------------------------------------------- |
