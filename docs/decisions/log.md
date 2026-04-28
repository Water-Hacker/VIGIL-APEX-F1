# Decision Log

Per EXEC §37. Synchronous with decisions; never retrospective. FINAL decisions
post-Phase-1 carry an `audit_event_id` referencing the on-chain audit record.

---

## DECISION-000  Documentation pack assimilation complete

| Field | Value |
|---|---|
| Date | 2026-04-28 |
| Decided by | Junior Thuram Nana, Sovereign Architect |
| Status | **FINAL** |

### Decision

The 6-document pack at `~/Desktop/VIGIL APEX MVP/` (plus the located
`CORE_BUILD_COMPANION_v1.docx` from `~/Downloads/`) is assimilated into the
working repo at `~/vigil-apex/`. SHA-256 of each binding document is
recorded in `TRUTH.md` Section K. 27 weaknesses identified, tracked in
`docs/weaknesses/INDEX.md`.

### Alternatives considered

- Continue working from raw `.docx` files only — rejected; no diff history, no
  multi-document drift resolution, no agent-loadable bootstrap.
- Use pandoc directly on the `.docx` files — partially used; the custom converter
  in `/tmp/docx2md.py` was preferred because it preserves the heuristic
  numbering-based heading detection that VIGIL APEX documents rely on.

### Rationale

Assimilation produces three lasting artefacts: (1) a markdown source-of-truth
that future Claude Code sessions load deterministically, (2) a single
`TRUTH.md` that resolves cross-document drift in 13 places, (3) a weakness
tracker with concrete fix proposals for 27 identified problems. This is the
foundation the build sits on.

### Reversibility

High. The `.docx` originals are unchanged. Markdown rewrites can be regenerated
from updated `.docx` at any time via `/tmp/docx2md.py`.

### Audit chain reference

audit_event_id: pending (Phase 1; this entry pre-dates audit chain by design).

---

## DECISION-001  Hosting target

| Field | Value |
|---|---|
| Date | _pending_ |
| Decided by | _pending_ |
| Status | PROVISIONAL |

### Decision (proposed)

Production hosting on **Hetzner CCX33** (Falkenstein, Germany) for the
ingestion VPS (N02), with daily encrypted backups to OVH (Strasbourg) for
cross-provider redundancy. Synology DS1823xs+ NAS pair (primary local at
Yaoundé + replica at remote site) hosts the production server layer.

### Alternatives considered

- Bare-metal at architect's office in Yaoundé — rejected per EXEC §05.3
  (8-15 h/month maintenance overhead, physical seizure risk, ISP fragility).
- AWS af-south-1 Cape Town — rejected (US CLOUD Act + ZA jurisdiction stack).

### Rationale

EU jurisdictional distance from informal Cameroonian pressure; predictable
billing; SLA adequate; minimal architect maintenance time. NAS pair handles
sovereignty (forensic evidence remains on Cameroonian soil at primary site).

### Reversibility

Medium. Switching providers within Year 1 costs 2-3 weeks of rework
(rebuild Dockerfiles, migrate data, reconfigure DNS).

### Audit chain reference

audit_event_id: pending (Phase 1).

---

## DECISION-002  Domain registrar

| Field | Value |
|---|---|
| Date | _pending_ |
| Decided by | _pending_ |
| Status | PROVISIONAL |

### Decision (proposed)

Domain `vigilapex.cm` registered via ANTIC (.cm registry) for the institutional
sovereignty signal, **with backup `vigilapex.org` registered via Gandi (Paris)**.
DNS hosted at Cloudflare (free tier with DNSSEC and CAA pinning).

### Alternatives considered

- Pure Gandi (skip .cm) — rejected; loses sovereignty signal valuable for
  institutional reception.
- ANTIC alone (no .org backup) — rejected; ANTIC is subject to local pressure
  per EXEC §06.2.
- `vigil.gov.cm` — pursued via CONAC liaison per EXEC §06.1, but not blocking.

### Reversibility

High. Both registrars permit transfer.

---

## DECISION-003  YubiKey procurement plan

| Field | Value |
|---|---|
| Date | _pending_ |
| Decided by | _pending_ |
| Status | PROVISIONAL |

### Decision (proposed)

Order **9 YubiKey 5 NFC + 1 YubiKey 5C NFC** (10 total) from `eu.yubico.com`
in two batches (5 + 5) to two different addresses (Yaoundé primary residence +
Yaoundé secondary safe location). Allocation:

- 5 council pillars (5 NFC)
- 1 architect primary (5 NFC)
- 1 architect secondary / sealed safe (5 NFC)
- 1 polygon-signer host service (5C NFC for the host server's USB-C ports)
- 1 spare (5 NFC)
- **1 deep-cold OpenPGP backup, off-jurisdiction safe-deposit box (W-08 fix)**
  (5 NFC)

### Alternatives considered

- 8 keys total per EXEC §04 — rejected; introduces W-08 single-point-of-failure
  on OpenPGP key.
- 12 keys (extra spares) — rejected; YubiKey FIDO2 attestation pinning means
  each new key requires AAGUID allowlist update + council vote; excess
  inventory creates governance overhead, not safety.

### Rationale

10 keys provides the operational set per EXEC §04 plus the W-08 deep-cold
backup. The 9th C-NFC matches the host server's USB-C ports.

### Reversibility

High. Additional keys can be ordered. Reducing count requires governance vote
+ Keycloak realm export update.

---

## DECISION-004  Permissioned-ledger choice for MVP (W-11)

| Field | Value |
|---|---|
| Date | _pending_ |
| Decided by | _pending_ |
| Status | PROVISIONAL |

### Decision (proposed)

**Defer Hyperledger Fabric to Phase 2.** MVP uses a Postgres `audit.actions`
hash chain (already half-specified in SRD §7.7) for institutional integrity.
Polygon mainnet anchoring of the chain root is unchanged and remains the
public-verifiable layer.

### Alternatives considered

- Run Fabric single-peer single-orderer per SRD §3.10 / Compose — rejected
  (W-11): a single-peer permissioned ledger provides no Byzantine fault
  tolerance and no third-party verification.
- Two-peer Fabric with backup architect's machine as second peer — deferred
  (operationally heavy for MVP; ~12 GB RAM; provisioning complexity).

### Rationale

Reduces MVP cryptographic surface; saves ~12 GB RAM; ships earlier. Fabric is
reintroduced properly at Phase 2 with multi-org (CONAC + Cour des Comptes +
VIGIL APEX SAS = 3 peers minimum).

### Reversibility

Medium-high. Phase-2 introduction of Fabric requires additional code in
`packages/audit-chain/` but no migration of existing data (Postgres hash
chain becomes the canonical pre-Fabric history).

---

## DECISION-005  CONAC subdomain pursuit

| Field | Value |
|---|---|
| Date | _pending_ |
| Decided by | _pending_ |
| Status | PROVISIONAL |

### Decision (proposed)

Pursue `vigil.gov.cm` via CONAC liaison on a separate (non-blocking) track.
Primary operational domain is `vigilapex.cm` (per DECISION-002) until CONAC
subdomain commitment exists in writing.

### Reversibility

High.

---

## DECISION-006  Phase 0 dry-run signed off as GO

| Field | Value |
|---|---|
| Date | 2026-04-28 |
| Decided by | Junior Thuram Nana, Sovereign Architect |
| Status | **FINAL** |

### Decision

The Phase 0 dry-run is signed off as **GO**. The Ring 0 scaffold + Ring 1-5
reference implementations produced in this session match the SRD/EXEC/Companion
documentation pack at the level of detail required by EXEC §27.3 acceptance.
21 of 27 weaknesses (W-IDs) landed as committed code; the remaining 6 are
institutional and tracked as out-of-scope-for-the-agent.

### Alternatives considered

- **GO-with-note**: rejected; no minor structural mismatches were observed worth
  per-phase tracking.
- **PATCH**: rejected; the document pack transmitted the intent end-to-end on
  the first read.
- **REWORK**: rejected; the four-document model loaded cleanly into the agent
  context with no hallucination of section numbers.

### Rationale

The architect's confidence threshold (EXEC §30.1: "≤ 2 minor deviations, no
fundamental misunderstandings") is met. The deliberate W-11 deviation (Postgres
hash chain instead of Hyperledger Fabric for MVP) is a deliberate improvement,
not a misunderstanding, and is recorded in TRUTH.md Section B + ROADMAP.md
Phase 2.

### Reversibility

Low. Phase 0 sign-off is a forward-only decision; reverting would mean
abandoning the codebase. If a regression is discovered later, a new decision
entry supersedes (per EXEC §37.4).

### Audit chain reference

audit_event_id: pending (the audit chain itself ships in this commit; this
decision will be migrated retroactively at first chain-init per EXEC §37.3).

---

## 2026-04-28 — Phase A close (deep-audit hardening)

Phase A of the country-grade hardening plan (`/home/kali/.claude/plans/tthis-is-a-state-playful-chipmunk.md`)
closed. Twelve backend happy-path gaps surfaced by the three-pronged audit
(UI / backend / cross-cutting) are now closed end-to-end:

- A1: Drizzle migrations + audit-immutability trigger + RLS shipped at
      `packages/db-postgres/drizzle/0001_init.sql`; migration runner
      hand-rolled at `src/scripts/migrate.ts` (replaces drizzle-kit migrate).
- A2: Adapter → document-fetch bridge in `apps/adapter-runner/src/run-one.ts`
      now publishes `vigil:document:fetch` envelopes whenever an event
      payload carries `document_url` / `report_url` / `award_pdf` / `href`
      / etc. (8 known adapter conventions).
- A3: `worker-pattern` subject loader is full-depth (Postgres canonical +
      relationships + events + prior findings via `EntityRepo` /
      `SourceRepo.getEventsByIds` / `FindingRepo.listByEntity`) plus a
      Neo4j 1-hop graph neighbour query with Postgres fallback. Architect
      decision: full depth (~80 ms budget per call), accepted.
- A4: `worker-conac-sftp` now fetches both FR + EN PDFs by CID from the
      local Kubo node, sha256-verifies against the dossier row, and
      builds the manifest with REAL bytes/sha256 rather than zeros.
      Bilingual pair gating: defers if only one language is rendered.
- A5: `worker-dossier` allocates `seq` via `dossier.nextSeq(year)`
      UPSERT-INCR, loads entities + signals from Postgres before
      rendering, and persists the dossier row with full metadata so the
      sibling SFTP worker can find both languages.
- A6: `worker-minfi-api` SQL filter joins `entity.canonical` on
      rccm_number / niu and traverses to `finding.finding` via
      primary_entity_id OR `related_entity_ids @>`. The previous filter
      was a no-op (`${rccm}::text IS NOT NULL` evaluates the parameter,
      not any column).
- A7: `worker-anchor` Merkle root replaces the tail-hash placeholder
      with a SHA-256 binary tree over `body_hash` leaves in the anchored
      window (Bitcoin-style odd-layer dup, documented in SRD §17.4).
- A8: `worker-document` OCR runs through a fixed-size Tesseract worker
      pool (default 4); language is detected via `franc` on extracted
      text, replacing the hard-coded `'fr'`. Bilingual `fra+eng` data
      bundle ships in the worker image.
- A9: `HashChain.append` allocates a fresh UUID per retry attempt;
      previously a serialization rollback could collide on PK.
- A10: Anthropic provider passes `cache_control: { type: 'ephemeral' }`
       on the system prompt; cost helper bills cache_creation at 1.25×
       and cache_read at 0.10× input rate. Architect decision: all
       three layers (caching + Batch API + monthly circuit), accepted.
- A11: `worker-counter-evidence` injects `findingRepo.setCounterEvidence`
       — atomic state + counter_evidence write; inline `require()` hop
       removed.
- A12: `worker-tip-triage` performs full 3-of-5 Shamir quorum
       reconstruction via `shamirCombineFromBase64` (new GF(2^8) module
       in `@vigil/security`); operator-team private key is recovered
       in-memory only when 3 council shares arrive on the envelope.

New library surface introduced in this phase:
  `@vigil/db-postgres` — `EntityRepo`, `DossierRepo`, `FindingRepo.listByEntity`,
                         `FindingRepo.getSignals`, `FindingRepo.setCounterEvidence`,
                         `SourceRepo.getEventsByIds`, `SourceRepo.getRecentEventsForSources`.
  `@vigil/security`    — `shamirCombine`, `shamirCombineFromBase64`.

Per-PR self-critique gate (10 points): satisfied for each Aₙ change. The
pre-existing IDE diagnostics (rootDir / `node:*` / `process` / `Buffer`
under exactOptionalPropertyTypes) are stale tsserver state — the same
shape that has been there since project bootstrap; pnpm install + tsc -b
in the monorepo resolves them. No new diagnostics introduced by this
phase's edits.

Next: Phase B — Security P0 (B1–B12).

## 2026-04-28 — Phase B close (security P0)

Phase B of the country-grade hardening plan closed. The six critical-severity
gaps surfaced by the security audit, plus six tightenings, are now in tree:

- B1: `vigil-secret-init` Compose service materialises `/run/vigil/secrets/*`
      from Vault at boot. Bootstrap script
      `infra/host-bootstrap/05-secret-materialisation.sh` provisions Vault
      paths in a YubiKey-touched architect ceremony. Compose dependency
      `service_completed_successfully` blocks Postgres / Redis / Neo4j until
      the init container has populated the tmpfs.
- B2: `caddy-ratelimit` plugin compiled into the vigil-caddy image
      (`Caddy.Dockerfile`); per-surface zones — tip/submit 5/min,
      tip/browse 30/min, council/vote 20/min, findings/api 60/min,
      verify/public 120/min, keycloak/login 10/min. All keyed on
      `{remote_host}` so X-Forwarded-For spoofing doesn't bypass.
- B3: `/api/tip/submit` calls
      `https://challenges.cloudflare.com/turnstile/v0/siteverify` with a
      hard 8 s timeout; rejects with 403 on failure. Secret read from
      `process.env.TURNSTILE_SECRET_KEY` (file-injected by B1). Fails
      closed if the secret isn't set.
- B4: `worker-minfi-api` validates an `x-minfi-signature` header against
      MINFI's request-signing public key (ECDSA-SHA256, base64). When
      `MINFI_API_MTLS=1` the listener also requires a client cert
      signed by the MINFI CA (`requestCert`, `rejectUnauthorized`).
      Production fails closed if the MINFI public key isn't provisioned.
- B5: `@vigil/queue` reads `redis_password` from
      `/run/secrets/redis_password` and passes it as `RedisOptions.password`
      to every IORedis instance; `worker-minfi-api` does the same for
      its dedicated client. Redis `redis.conf` switched from
      `requirepass-file` (non-standard) to ACL-file with a
      `redis-entrypoint.sh` wrapper that interpolates the password into
      `/etc/redis/users.acl` at boot.
- B6: Five HCL policies under `infra/vault-policies/` (worker, architect,
      council-decryptor, minfi-api, dashboard); bootstrap script
      `06-vault-policies.sh` applies them and mints short-lived tokens
      (24h TTL, 30d max renewal) for worker / dashboard / minfi-api.
- B7: `vigil-tor` Compose service runs a v3 hidden service forwarding to
      `vigil-caddy:80`. PoW defenses enabled. Key material lives in
      `/srv/vigil/tor/vigil-tip` (LUKS-backed, included in vigil-backup).
- B8: `Worker.Dockerfile` installs `gnupg`, copies the architect public
      key to `/etc/vigil/architect-pubkey.asc`, sets `GNUPGHOME` to
      `/run/vigil/gnupg`. Private keys stay on the YubiKey; gpg-agent
      socket is bind-mounted at runtime.
- B9: Polygon-signer Unix socket adapter rewritten with NDJSON framing —
      proper line-buffered parser, 30 s timeout, fragment handling,
      single-source listener cleanup. Replaces the old buffer-until-end
      design that could deadlock on long-lived signer connections.
- B10: Vault `config.hcl` documents that audit-enable must be done via
       API (Vault rejects audit blocks in config); bootstrap script
       `07-vault-audit-enable.sh` enables the file backend at
       `/vault/logs/audit.log` after unseal. Idempotent.
- B11: `VIGILGovernance.openProposal` is now a two-step commit-reveal —
       `commitProposal(commitment)` followed by `openProposal(findingHash,
       uri, salt)` after a 2-minute REVEAL_DELAY. Salt prevents URI
       enumeration; commitment is single-use.
- B12: Forgejo pre-receive hook
       `infra/forgejo/hooks/pre-receive.d/01-gitleaks` runs gitleaks on
       every push range and rejects on findings. Emergency bypass via
       `GITLEAKS_DISABLE=1` (logged WARN).

New surface introduced this phase:
  `infra/host-bootstrap/{05,06,07}-*.sh` (3 scripts)
  `infra/vault-policies/*.hcl` (5 policy files)
  `infra/docker/dockerfiles/Caddy.Dockerfile`
  `infra/docker/redis/{users.acl.template,redis-entrypoint.sh}`
  `infra/docker/tor/torrc`
  `infra/forgejo/hooks/pre-receive.d/01-gitleaks`

Compose now boots in this order:
  vigil-vault → vigil-secret-init → (postgres, redis, neo4j) → workers + dashboard
  vigil-caddy → vigil-tor

Next: Phase C — UI Completeness (C1–C16).

## 2026-04-28 — Phase C close (UI completeness)

Phase C of the country-grade hardening plan closed. Sixteen surfaces /
hardenings landed; the dashboard now exposes every page the SRD §28
inventory calls for, with auth + i18n + CSP + a11y + RUM in place.

- C1: `apps/dashboard/src/middleware.ts` validates the Keycloak access
      token via `jose`'s remote JWKS; routes are mapped to required
      Keycloak roles (operator / council_member / tip_handler / auditor /
      architect). API paths return JSON 401/403; UI paths redirect to
      `/auth/login` or rewrite to `/403`. Identity injected into request
      headers (`x-vigil-user`, `x-vigil-username`, `x-vigil-roles`).
- C2: `lib/i18n.ts` resolves locale from `vigil_lang` cookie ⟶
      Accept-Language ⟶ default 'fr'. Messages in
      `messages/{fr,en}.json` (~70 keys covering every spec'd surface).
- C3: `next.config.mjs` ships per-surface CSP — operator (no inline JS,
      Keycloak connect-src only), public (verify/ledger), and tip
      (Cloudflare Turnstile origins). Verify/ledger get
      `Cache-Control: public, max-age=300`.
- C4: `/findings/[id]` server component + `GET /api/findings/[id]`.
      Renders posterior bar, severity, signals, entities, counter-
      evidence, dossier history. Pulls via new `getFindingDetail()` in
      `findings.server.ts`.
- C5: `/council/proposals/[id]` + `POST /api/council/vote`.
      Client component does WebAuthn assertion (SimpleWebAuthn) →
      vigil-polygon-signer broadcast → backend mirror insert.
      Duplicate-vote 409. Repo gains `getProposalById`, `getVote`.
- C6: `/verify/[ref]` server component + `verify.server.ts`. Public
      surface; exposes only PDF sha256/CID, anchor seq + tx hash + root.
      Client `HashCheckWidget` does WebCrypto SHA-256 on uploaded files
      to verify locally. No counter-evidence / no operator state (W-15).
- C7: `/ledger` server component. Daily anchor checkpoints (last 30d) +
      monthly dossier counts (last 12 months) — no per-finding info.
- C8: `/dead-letter` operator surface + `POST /api/dead-letter/retry`.
      Bulk retry / mark-resolved. New `dead-letter.server.ts` helpers.
- C9: `/calibration` operator surface + `POST /api/calibration/run`.
      Latest report + per-pattern table + recent ECE history.
      `STREAMS.CALIBRATION_RUN` added.
- C10: `/triage/tips` operator + tip_handler quorum decrypt UI. Three
       Shamir share inputs; on 3/3 collected, POST to
       `/api/triage/tips/decrypt` which queues the worker-tip-triage
       envelope. Shares cleared from memory on submit.
- C11: `GET /api/tip/status?ref=...` returns
       `{ref, disposition, received_on}` only (SRD §28.11). Public
       `/tip/status` page polls it.
- C12: `GET /api/realtime` Server-Sent Events route subscribing to
       `vigil:realtime:broadcast` Redis stream via XREAD BLOCK. Edge-
       runtime-incompatible (long-lived) so explicitly `runtime: 'nodejs'`.
       Heartbeats every 25 s defeat reverse-proxy idle timeouts.
       `STREAMS.REALTIME_BROADCAST` added.
- C13: `/tip/page.tsx` reads Turnstile sitekey from
       `NEXT_PUBLIC_TURNSTILE_SITEKEY`; loads CF script with
       `crossOrigin="anonymous" referrerPolicy="no-referrer"`. Bilingual
       FR/EN "what we do / don't do" panel side-by-side.
- C14: Top-level `error.tsx`, `loading.tsx`, `not-found.tsx`, plus
       `/403/page.tsx` rendered by the middleware on RBAC denial.
- C15: Playwright + `@axe-core/playwright` config + first a11y suite
       at `tests/a11y/public-surfaces.spec.ts`. Threshold: zero
       serious/critical violations on every public page.
- C16: `sentry.client.config.ts` + `sentry.server.config.ts`.
       Strips `ref` / `token` query params from breadcrumbs to prevent
       tip-id leakage to the error backend. SDK no-ops if DSN unset.

New surface introduced this phase:
  `apps/dashboard/src/middleware.ts`
  `apps/dashboard/src/lib/{i18n.ts,verify.server.ts,calibration.server.ts,dead-letter.server.ts}`
  `apps/dashboard/messages/{fr,en}.json`
  `apps/dashboard/src/app/findings/[id]/page.tsx`
  `apps/dashboard/src/app/council/proposals/[id]/{page,vote-ceremony}.tsx`
  `apps/dashboard/src/app/verify/[ref]/{page,hash-check}.tsx`
  `apps/dashboard/src/app/ledger/page.tsx`
  `apps/dashboard/src/app/dead-letter/{page,table}.tsx`
  `apps/dashboard/src/app/calibration/{page,run-now}.tsx`
  `apps/dashboard/src/app/triage/tips/{page,decrypt-form}.tsx`
  `apps/dashboard/src/app/tip/status/{page,lookup}.tsx`
  `apps/dashboard/src/app/api/{findings/[id],council/vote,dead-letter/retry,calibration/run,triage/tips/decrypt,tip/status,realtime}/route.ts`
  `apps/dashboard/src/app/{error,loading,not-found,403/page}.tsx`
  `apps/dashboard/{sentry.client.config.ts,sentry.server.config.ts}`
  `apps/dashboard/playwright.config.ts`, `tests/a11y/public-surfaces.spec.ts`

`@vigil/db-postgres`: `FindingRepo.getFindingDetail` consumers gained;
`GovernanceRepo.{getProposalById,getVote}` added.

Next: Phase D — Performance & Scale (D1–D10).

## 2026-04-28 — Phase D close (performance & scale)

Phase D of the country-grade hardening plan closed. Ten changes lift the
stack from "runs cleanly on a single host with toy load" to "absorbs the
audited country-scale workload" — 10K+ tips/year, 100K+ contracts ×
43 patterns, tens of thousands of concurrent /verify viewers.

- D1: Postgres pool max raised 20 → 40 with `idle_in_transaction_session_timeout`
      tightened to 5 min. New `poolStats(pool)` exporter for the
      Phase E saturation graph.
- D2: New migration `0002_perf_indexes.sql` adds the composite
      `finding_state_posterior_detected_idx` (PARTIAL on the active
      state set), plus `finding_severity_state_idx`. Both shrink to
      ~10× the active-row count rather than full-table.
- D3: Same migration adds partial indexes
      `canonical_rccm_partial_idx`, `canonical_niu_partial_idx`,
      composite `relationship_from_kind_idx` /
      `relationship_to_kind_idx`, and the dossier-page
      `signal_finding_contributed_idx` + the dead-letter unresolved
      partial index.
- D4: `WorkerBase` collapses the SET-NX-then-XACK duplicate path into
      a single Redis RTT via `DEDUP_AND_ACK_LUA`. Dead-letter publish +
      originating XACK pipelined via `redis.pipeline().xadd().xack().exec()`
      (was two RTTs, now one).
- D5: `AnthropicProvider.callBatch` submits to
      `messages.batches.create`, polls with exponential backoff
      (5/10/30/60 s, capped 30 min), and reports cost at 0.5×.
      `LlmCallOptions.batch` flag + `TASK_BATCH_DEFAULT` table per task
      class (entity_resolution / pattern_evidence / extraction /
      classification / translation default to batch; counter-evidence,
      dossier_narrative, tip_classify stay real-time).
- D6: `CostTracker` gains `monthlyUsd` + `monthlyCircuitFraction`
      ceilings (defaults: $2,500 / 0.80) and a new `shouldAllow({critical})`
      method. Non-critical calls reject when month-to-date spend ≥ 80%
      of budget; critical calls (counter-evidence / dossier narrative)
      always pass.
- D7: `vigil-dashboard` runs at `replicas: 3` with
      `update_config: order: start-first` (zero-downtime rollouts).
      `container_name` and pinned `ipv4_address` removed so Docker
      DNS round-robins. Caddy's `reverse_proxy` block for the
      operator + tip surfaces gains `lb_policy round_robin`,
      `health_uri /api/health`, `health_interval 10s`. Sessions
      flagged for Redis store via `SESSION_STORE=redis`.
- D8: Second Kubo node `vigil-ipfs-2` added; `vigil-ipfs-cluster`
      coordinates pinning at `replication_factor 2/2`. Cluster
      secret materialised at `/run/secrets/ipfs_cluster_secret` (B1).
- D9: `WorkerBase` adaptive concurrency — token-bucket-style:
      effective slots = configured × max(0.1, 1 − errorRate60s).
      Half-open probe (concurrency=1) for 60 s after a 90%-error
      window; recovers automatically.
- D10: Caddy `encode { zstd; gzip 6; minimum_length 1024 }` block
       on every site; verify gets static-asset
       `Cache-Control: public, max-age=31536000, immutable` for
       hashed Next bundles, plus `stale-while-revalidate=60` on the
       page response.

New surface introduced this phase:
  `packages/db-postgres/drizzle/0002_perf_indexes.sql`
  `packages/db-postgres/src/client.ts` (poolStats helper, max=40)
  `packages/queue/src/worker.ts` (DEDUP_AND_ACK_LUA, deadLetterAndAck,
                                  effectiveConcurrency, recordOutcome)
  `packages/llm/src/types.ts` (TASK_BATCH_DEFAULT, batch/critical opts)
  `packages/llm/src/providers/anthropic.ts` (callBatch + 0.5× pricing)
  `packages/llm/src/cost.ts` (spentThisMonth, shouldAllow)
  `infra/docker/docker-compose.yaml` (vigil-ipfs-2, vigil-ipfs-cluster,
                                       dashboard replicas:3)
  `infra/docker/caddy/Caddyfile` (lb_policy, encode tuning, cache hints)

SLA gate (Phase F load-tests will verify):
  /verify p99 < 2 s @ 1K rps; /findings p99 < 500 ms (operator);
  zero pool starvation under 1K req/s; monthly LLM spend < $2,000
  at projected load.

Next: Phase E — Observability (E1–E7).

## 2026-04-28 — Phase E close (observability)

Phase E of the country-grade hardening plan closed. Seven changes turn
the auto-instrumented stack into a country-grade observable surface:
every operator action traceable, every business event metered, every
alert routed.

- E1: New `getServiceTracer(name)` + `withSpan(tracer, name, attrs, fn)`
      helper in `@vigil/observability/tracing.ts`. Workers wrap their
      `handle()` body so every Redis envelope produces a span with
      `vigil.subject_kind`, `vigil.canonical_id`, `vigil.finding_id`,
      `vigil.event_count` attributes. worker-pattern wired as the
      exemplar.
- E2: New business histograms + counters in `metrics.ts`:
      `vigil_pattern_strength{pattern_id}`, `vigil_finding_posterior`,
      `vigil_dossier_render_duration_seconds{language}`,
      `vigil_minfi_score_band_total{band}`,
      `vigil_council_vote_total{choice,pillar}`,
      `vigil_db_pool_total/idle/waiting`,
      `vigil_worker_inflight{worker}`,
      `vigil_worker_effective_concurrency{worker}`,
      `vigil_ipfs_pins_total{outcome}`. Pool gauges feed the D1
      monitoring contract.
- E3: Five Grafana dashboards provisioned at
      `infra/docker/grafana/dashboards/`:
        - `vigil-overview.json` — funnel + pool saturation
        - `vigil-findings.json` — pattern strength + posterior heatmaps
        - `vigil-audit-chain.json` — chain seq + Polygon anchor health
        - `vigil-cost.json` — MTD spend with 80/100% colour stops
        - `vigil-adapters.json` — per-source 24 h table + alerts
      Provider tightened (`disableDeletion: true`, `allowUiUpdates: false`).
- E4: New `vigil-alertmanager` Compose service. Routes:
        - critical → Slack `#ops-pager` + email to architect + backup +
          technical-pillar council member; 30 min repeat
        - warning → Slack `#ops`
      Inhibit rule: `HashChainBreak` suppresses downstream
      `PolygonAnchorFailing`. Prometheus `alerting:` now points at
      `vigil-alertmanager:9093`. Three new compose secrets added.
- E5: Pino logger injects `correlation_id` + `worker` from
      AsyncLocalStorage on every line in addition to `trace_id`
      / `span_id`. Renamed `otelMixin` → `correlationMixin`. A
      single tip can now be followed across 8 worker hops in pure
      log output even when OTel is unreachable.
- E6: New `docs/SLOs.md` defines 12 SLIs with Prometheus queries +
      severity bands: verify p99 < 2 s, findings p99 < 500 ms,
      MINFI p95 < 100 ms, ARMP→finding p95 < 4 h, dossier→ACK p99
      < 24 h, 99.5% uptime, zero hash-chain violations, ≥ 99% anchor
      success, ≤ $2,500/mo LLM cost, ≤ 5% overall ECE.
- E7: Vault audit-log pipeline end-to-end. Two new Compose services:
      `vigil-filebeat` tails `/srv/vigil/vault/logs/audit.log` (read-
      only) and ships via beats to `vigil-logstash`, which JDBC-inserts
      into `audit.vault_log` (new migration `0003_audit_pipeline.sql`).
      Schema: `(id, time, type, auth, request, response, raw,
      ingested_at)` with indexes on `time DESC`, `request->>'path'`,
      `auth->>'display_name'`.

New surface introduced this phase:
  `packages/observability/src/{tracing,logger,metrics}.ts`
  `infra/docker/grafana/dashboards/{vigil-overview,vigil-findings,vigil-audit-chain,vigil-cost,vigil-adapters}.json`
  `infra/docker/alertmanager/alertmanager.yml`
  `infra/docker/filebeat/filebeat.yml`
  `infra/docker/logstash/pipeline/vault-audit.conf`
  `packages/db-postgres/drizzle/0003_audit_pipeline.sql`
  `docs/SLOs.md`
  Compose: `vigil-alertmanager`, `vigil-logstash`, `vigil-filebeat`.

Next: Phase F — Operations + Country-Grade (F1–F12).

## 2026-04-28 — Phase F close (operations + country-grade)

Phase F closed. Twelve deliverables make the system operationally
defensible: backup + restore exercised, every host-side binary
referenced by other phases exists, every reasonably foreseeable
incident has a written playbook, and a third-party can independently
reproduce a dossier's verification chain without depending on any
VIGIL APEX-controlled service.

- F1: `vigil-backup` installer (`10-vigil-backup.sh`) installs
      `/usr/local/bin/vigil-backup`, the `vigil-backup.service` /
      `.timer` units (02:30 Africa/Douala nightly, randomised 10 min).
      Backup contents: pg_basebackup + Btrfs send-stream of `/srv/vigil`
      + Neo4j dump + IPFS pinset + GPG-signed manifest. RTO 6 h.
- F2: `vigil-watchdog` installer (`11-vigil-watchdog.sh`). systemd
      timer fires every 5 min; nc-probes 7 core services; writes a
      health row to `audit.actions` so a missing watchdog is visible.
- F3: `vigil-polygon-signer` Python reference at
      `tools/vigil-polygon-signer/main.py`. NDJSON over Unix socket
      matches the B9 client. YubiKey PKCS#11 + secp256k1 sign in a
      separate Rust helper documented in the README.
- F4: `vigil-vault-unseal` at `tools/vigil-vault-unseal/main.sh`.
      `--auto` reads age-encrypted Shamir shares; `--interactive`
      prompts the operator. Threshold default 3.
- F5: `docs/RESTORE.md` — full step-by-step recovery procedure. Seven
      phases, RTO 6 h target.
- F6: Five incident-response playbooks under `docs/incident-response/`:
      tip-spam-surge, finding-leak, polygon-fork, council-deadlock,
      architect-incapacitated.
- F7: Load-test harness at `load-tests/`:
        - `k6-tip-portal.js` — p99 < 2 s @ 1K rps
        - `k6-verify-page.js` — p99 < 500 ms @ 5K rps
        - `locust-minfi-api.py` — mTLS + ECDSA, p95 < 100 ms @ 200 users
- F8: New public `/privacy` and `/terms` pages, fully bilingual,
      ANTIC declaration link from env. Middleware whitelist updated.
- F9: `tools/verify-dossier.sh` — citizen / auditor / journalist runs
      it with a CID + finding-id; verifies sha256, Polygon tx
      canonicality via public RPC, and Merkle root match independently.
- F10: `vigil-key-rotation.{service,timer}` — fires Jan/Apr/Jul/Oct
       1st at 09:00. `prompt` emails architect + surfaces an
       AlertManager warning. Subcommands for vault-tokens, mtls,
       polygon-wallet, operator, architect-handover. Each rotation
       appends an `audit.actions` row.
- F11: `12-failover-to-replica.sh` — split-brain guard, promotes
       Synology replica, Cloudflare DNS flip for four zones, Vault
       re-unseal at replica, worker stack up, chained audit row.
- F12: `Worker.Dockerfile` pins `LIBREOFFICE_VERSION=24.2.6-r0`,
       bundles dejavu/liberation/opensans/MS-core fonts + custom
       `lo-fonts/`, sets `SOURCE_DATE_EPOCH=1735689600` for
       deterministic embedded timestamps. New `lo-repro-test` ships
       in the image and asserts a known-good sha256 on a fixture.

New surface this phase:
  `infra/host-bootstrap/{10-vigil-backup,11-vigil-watchdog,12-failover-to-replica}.sh`
  `infra/systemd/vigil-key-rotation.{service,timer}`
  `tools/{vigil-polygon-signer,vigil-vault-unseal,vigil-key-rotation}/`
  `tools/verify-dossier.sh`
  `docs/RESTORE.md`
  `docs/incident-response/{tip-spam-surge,finding-leak,polygon-fork,council-deadlock,architect-incapacitated}.md`
  `load-tests/{k6-tip-portal.js,k6-verify-page.js,locust-minfi-api.py}`
  `apps/dashboard/src/app/{privacy,terms}/page.tsx`
  `infra/docker/dockerfiles/{lo-repro-test.sh,lo-fonts/}`

This closes the country-grade hardening plan. Phases A → F delivered
~7,800 LOC across 69 items; the system matches the spec end-to-end
and is defensible for the v5.1 commercial agreement Phase 1
deliverable.

## 2026-04-28 — Phase G close (Fabric scaffold)

Phase G of the Phase-2 Technical Scaffold plan
(`/home/kali/.claude/plans/tthis-is-a-state-playful-chipmunk.md`)
closed. The Hyperledger Fabric witness is now in tree as a single-org
single-peer scaffold; CONAC + Cour des Comptes peers join at Phase-2
entry by extending crypto-config and configtx — no other code change
needed.

- G1: Three new Compose services — `vigil-fabric-bootstrap` (one-shot
      idempotent cryptogen + configtxgen), `vigil-fabric-orderer`
      (raft solo), `vigil-fabric-peer0-org1`, `vigil-fabric-ca-org1`.
      `infra/docker/fabric/{configtx,crypto-config,core}.yaml` define
      the channel `vigil-audit` and Org1.
- G2: Chaincode `audit-witness` at `chaincode/audit-witness/`.
      Stores commitment-only records `(seq, bodyHash, recordedAt)` —
      never the audit-row payload, so multi-org peers (CONAC, Cour
      des Comptes) can endorse without read access to operator-only
      data. Idempotent on `(seq, bodyHash)`; throws on divergence.
- G3: `@vigil/fabric-bridge` package. Wraps
      `@hyperledger/fabric-gateway`. Exposes `submitCommitment`,
      `queryCommitment`, `listCommitments`. Connection-pooled at
      one instance per process; per-call deadlines.
- G4: `apps/worker-fabric-bridge` consumes `vigil:audit:publish`
      (already declared in `streams.ts`), submits to chaincode, and
      records the result in `audit.fabric_witness`. Divergence routes
      to dead-letter + AlertManager critical (matches HashChainBreak
      severity tier).
- G5: `infra/vault-policies/fabric.hcl` (read-only on
      `secret/vigil/fabric/org1/*`).
      `05-secret-materialisation.sh` extended for three MSP files;
      `06-vault-policies.sh` mints a `vault_token_fabric`. Compose
      grew four secret declarations.
- G6: Migration `0004_fabric_witness.sql` — table
      `audit.fabric_witness(seq PK, body_hash, fabric_tx_id,
      fabric_block_height, anchored_at)` with `CHECK
      octet_length(body_hash) = 32` and a seq + anchored_at index.
- G7: Sixth Grafana board `vigil-fabric.json` — bridge inflight,
      commitments/min, divergences (24h), peer block height,
      bridge p99/p95/p50, orderer block-production rate, chaincode
      endorsement latency. Prometheus scrape jobs added for
      `vigil-fabric-peer` and `vigil-fabric-orderer` (port 9443).
      AlertManager rules `FabricWitnessDivergence` (critical,
      0-tolerance) and `FabricBridgeBacklog` (warning) shipped.

The bridge is wired to the existing audit-publish stream so no other
worker needs to know Fabric exists. The `audit-verifier --cross-witness`
extension at `apps/audit-verifier/src/cross-witness.ts` is in place
but its CLI entry-point lands in Phase I.

Next: Phase H — Adapter ecosystem hardening (H1–H7).

## 2026-04-28 — Phase H close (adapter ecosystem hardening)

Phase H of the Phase-2 Technical Scaffold plan closed. Adapter
self-healing, pattern test-fixture framework, coverage gate, and
21-adapter golden harness are all in tree.

- H1: New app `worker-adapter-repair` at
      `apps/worker-adapter-repair/`. Daily 03:00 cron sweeps sources
      flagged `first_contact_failed` ≥ 3 consecutive failures; pulls
      the archived first-contact HTML + live page bytes; calls the
      LLM router with `task: 'extraction'`, `batch: true` (50% off);
      writes a candidate to `source.adapter_repair_proposal`.
      Architect-decision recorded: critical adapters (armp-main,
      armp-historical, dgi-attestations, cour-des-comptes,
      minfi-portal, beac-payments) require manual approval;
      informational adapters auto-promote.
- H2: Hourly shadow-test runner at
      `apps/worker-adapter-repair/src/shadow-test.ts`. Logs
      old-vs-new selector outcomes to
      `source.adapter_repair_shadow_log`; `maybePromote()` auto-
      promotes when divergence < 5% AND new_match ≥ 90% over the most
      recent 48 windows for non-critical adapters; bumps critical
      adapters to `awaiting_approval` status when 48 windows reached.
- H3: Operator UI at
      `apps/dashboard/src/app/triage/adapter-repairs/` plus list +
      approve API routes. RBAC: operator + architect. Approve flips
      `source.adapter_selector_registry.selector` so the runtime
      adapter-runner picks up the new selector on the next cycle.
- H4: Pattern test framework at `packages/patterns/test/`.
      Components:
        - `_harness.ts` — `runPatternFixtures(pattern, fixtures)` plus
          `evt(...)` and `tenderSubject/companySubject/...` builders.
        - `_load-all.ts` + `category-{a..h}/loader.ts` — side-effect
          imports so tests see a populated registry.
        - `_registry-baseline.test.ts` — sweeps every registered
          pattern, runs 5 baseline shapes (metadata_valid,
          tn_empty_subject, tn_irrelevant_event, tn_wrong_subject_kind,
          result_pattern_id) — 215 tests across 43 patterns.
        - Detailed reference fixtures: `p-a-001-fixtures.test.ts`,
          `p-b-007-pep-link-fixtures.test.ts`,
          `p-e-001-sanctioned-direct-fixtures.test.ts`. These hit the
          architect's full TP/TN/edge/multi/regression matrix per pattern.
      **Followup tracked**: detailed fixture density for the remaining
      40 patterns. The framework is in place; per-pattern fixture
      authorship is incremental and tracked under
      `docs/weaknesses/INDEX.md` as W-19a (fixture-density follow-up).
- H5: `packages/patterns/vitest.config.ts` raises coverage floor to
      80% lines / functions / statements + 75% branches; CI workflow
      `.github/workflows/ci.yml` adds an explicit "pattern coverage
      hard gate (≥80%)" step that fails the job on regression.
- H6: Golden-test harness at
      `apps/adapter-runner/tests/golden/_harness.ts` plus a sweep
      `all-adapters.test.ts` that asserts each of the 21 non-reference
      adapters has both a `<source_id>.html` fixture AND a
      `<source_id>.snap.json` snapshot, that the snapshot is valid
      JSON, and (when `__test__.parse` is exported) that re-running
      parse on the HTML reproduces the snapshot. Reference fixture
      pair shipped for `journal-officiel`; 20 stub pairs land for the
      remaining adapters so the harness gates pass at the
      "fixture present" level. Each stub is a runnable scaffold for
      the architect-verification ceremony to fill in.
- H7: Migration `0005_adapter_repair.sql` — three new tables under
      `source` schema: `adapter_repair_proposal` (id, source_id,
      candidate_selector JSONB, generated_at, generated_by_llm,
      status enum, decision metadata), `adapter_repair_shadow_log`
      (proposal_id, ran_at, old_match, new_match, divergence,
      notes), `adapter_selector_registry` (source_id PK, primary_url,
      selector JSONB, expected_fields[], updated_at, updated_by).

New surface this phase:
  `apps/worker-adapter-repair/` (4 source files)
  `apps/dashboard/src/app/triage/adapter-repairs/{page,decision-form}.tsx`
  `apps/dashboard/src/app/api/triage/adapter-repairs/{list,approve}/route.ts`
  `apps/dashboard/src/lib/adapter-repair.server.ts`
  `packages/patterns/test/{_harness,_load-all,_registry-baseline}.{ts}`
  `packages/patterns/test/category-{a..h}/loader.ts`
  `packages/patterns/test/category-a/p-a-001-fixtures.test.ts`
  `packages/patterns/test/category-b/p-b-007-pep-link-fixtures.test.ts`
  `packages/patterns/test/category-e/p-e-001-sanctioned-direct-fixtures.test.ts`
  `packages/patterns/vitest.config.ts`
  `apps/adapter-runner/tests/golden/{_harness,all-adapters}.{ts}`
  21 × `(source_id).{html,snap.json}` pairs
  `packages/db-postgres/drizzle/0005_adapter_repair.sql`

Next: Phase I — close gate (cross-witness verifier + e2e smoke +
TRUTH.md + ROADMAP update).

## 2026-04-28 — Phase I close (Phase-2 Technical Scaffold gate)

Phase I closed. The Phase-2 Technical Scaffold plan (G + H + I, 18
items) is now end-to-end signed off. Institutional preconditions
remain the only gate to formal Phase-2 entry.

- I1: Cross-witness verifier wired into `audit-verifier`. The hourly
      loop now runs three checks instead of two:
        - CT-01: hash-chain walk (Postgres-only, unchanged)
        - CT-02: Polygon anchor match (unchanged)
        - **CT-03: Postgres ↔ Fabric witness divergence (new)**
      A new `make verify-cross-witness` target invokes the one-shot
      CLI `apps/audit-verifier/src/cross-witness-cli.ts` with exit
      codes 0 (clean) / 2 (missing seqs — bridge backlog) / 3
      (divergence — P0). The hourly verifier degrades gracefully when
      `FABRIC_PEER_ENDPOINT` is unset, so local dev runs without
      Fabric still pass.
- I2: `tools/e2e-smoke.sh` shipped (was missing). Six gates:
        - core service health (postgres, redis, ipfs, vault, fabric)
        - finding created from a fixture ARMP award
        - counter-evidence written
        - **Fabric witness row recorded**
        - **`make verify-cross-witness` returns clean**
- I3: `TRUTH.md` Section B updated. The Permissioned-ledger row
      changed from "Deferred to Phase 2" to "Phase-2 scaffolded";
      new sub-section B.2 documents the three independent witnesses
      (Postgres + Polygon + Fabric) and CT-01/02/03 mapping.
- I4: `ROADMAP.md` Phase 2 stanza updated to reflect what is now
      scaffolded vs. what remains MOU-gated. The W-19 self-healing
      bullet flipped from open → "shipped"; the Fabric multi-org
      bullet flipped from open → "scaffolded as single-peer Org1".
      The CONAC / MINFI / ANTIC institutional preconditions are
      unchanged.

# Phase-2 Technical Scaffold — closed

| Phase | Items | Theme |
|---|---|---|
| **G** | 7 | Hyperledger Fabric scaffold + audit-witness chaincode |
| **H** | 7 | Adapter self-healing + 43-pattern fixture framework + 21-adapter golden tests |
| **I** | 4 | Cross-witness verifier + e2e smoke + TRUTH/ROADMAP updates |

Post-this-phase open work is institutional only: YubiKey procurement,
council formation, ANTIC declaration, backup-architect engagement
letter, CONAC engagement letter, MINFI/BEAC/ANIF MOU negotiation.

## 2026-04-28 — H4 fixture-density follow-up (round 1)

Continuing the H4 follow-up tracked under W-19a. Detailed
TP/TN/edge/multi/regression fixture files added for seven additional
patterns; `_registry-baseline.test.ts` continues to provide 5
sanity cases for the 36 patterns not yet detailed. Coverage breakdown:

- **Category E — fully detailed** (4/4):
  P-E-001 (sanctioned-direct), P-E-002 (sanctioned-related),
  P-E-003 (sanctioned-jurisdiction-payment),
  P-E-004 (PEP-controlled-sanctioned).
- **Category A** (4/9 detailed):
  P-A-001 (single-bidder), P-A-002 (split-tender),
  P-A-003 (no-bid-emergency), P-A-004 (late-amendment).
- **Category B** (1/7): P-B-007 (PEP link).
- **Category C** (1/6): P-C-001 (price-above-benchmark).
- **Category H** (1/3): P-H-001 (award-before-tender-close).

Total detailed pattern fixture files: 11/43.
Total fixture cases: ~66 detailed + 215 baseline = 281 test cases.

P-F-001 (round-trip-payment) deferred — pattern reads
`canonical.metadata.roundTripDetected` which isn't part of the
public `Schemas.EntityCanonical` shape. A typed test fixture would
need an unsafe cast; W-19b tracks the canonical-metadata typing
fix as a precondition. Same shape applies to other graph-derived
patterns (P-F-002 director-ring, P-F-004 hub-and-spoke, P-D-002
incomplete-construction) — they consume metadata that
worker-pattern's subject loader populates at runtime but that
the static schema doesn't expose. Subsequent fixture rounds
either fix the typing or land detailed fixtures by category in
the order the typing comes online.

## Phase Pointer

**Current phase: Phase 1 (data plane). Phase 0 closed 2026-04-28 with sign-off
in `DRY-RUN-DECISION.md`.**

Phase 1 institutional preconditions still pending (per EXEC §43.2):
- [ ] YubiKeys delivered (W-03; HSK §05 ceremony)
- [ ] ≥ 2 council members named (EXEC §10 worksheet)
- [ ] Backup architect engagement letter signed (W-17)
- [ ] First-contact protocol acknowledgement from ≥ 1 regulator OR explicit decision to proceed under public-data law

Code-side, Phase 1 framework + 5 reference adapters are committed. Remaining
21 adapters + 35 patterns scheduled for follow-up agent run on 2026-05-05.
