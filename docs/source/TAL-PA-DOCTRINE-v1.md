# TAL-PA Doctrine v1.0

**Total Action Logging with Public Anchoring** — DECISION-012.

> Every privileged action on the platform is captured, signed, hash-chained,
> dual-anchored, and surfaced — in redacted form — on a public audit
> portal. The system that watches Cameroonian institutions must itself be
> watched. There is no "privileged log entry" tier.

This doctrine is binding. Implementations that violate it must be rejected
in code review. Code that depends on this doctrine cites the section
number; if you find code that should reference TAL-PA but doesn't, that's a
defect.

---

## §1. Principle

The architectural commitment is single-sentence:

> *No human or service can take a consequential action on the VIGIL APEX
> platform without producing an immutable, signed, dual-anchored audit row
> that is observable — in appropriately redacted form — by anyone in the
> world, in real time.*

Three sub-commitments follow:

1. **Completeness.** The set of actions that emit an audit row is closed
   under the eleven categories defined in §2. There is no fourth state of
   "happened but not logged."
2. **Cryptographic integrity.** Every row carries a record hash that
   chains to the actor's previous row. The chain head is anchored to a
   public blockchain. Both the chain and its anchors are independently
   verifiable.
3. **Public legibility.** Within the limits of legitimate confidentiality
   (PII, ongoing investigations), the public can audit who-did-what-when
   on the platform without asking permission.

If any of these three are unattainable for a given action, the action does
not happen — see §6 (Halt-on-Failure).

---

## §2. Eleven-Category Event Taxonomy

Every TAL-PA event belongs to exactly one of eleven categories. The
category is derived from the event-type slug via
[`categoryOf()`](../../packages/shared/src/schemas/audit-log.ts) and
governs the public-view redaction policy (§5).

| Cat | Name | Examples (non-exhaustive — see [`KNOWN_EVENT_TYPES`](../../packages/shared/src/schemas/audit-log.ts)) |
|---|---|---|
| **A** | Authentication | `auth.login_attempted`, `auth.login_succeeded`, `auth.login_failed`, `auth.yubikey_touched`, `auth.session_created`, `auth.mfa_challenge_*`, `auth.logout` |
| **B** | Search & Query | `search.entity`, `search.fulltext`, `query.filter_applied`, `query.saved`, `query.zero_results`, `graph.traversal` |
| **C** | Document / Dossier Access | `dossier.opened`, `dossier.exported_pdf`, `dossier.printed`, `dossier.downloaded`, `dossier.redistributed` |
| **D** | Decision & Vote | `vote.cast`, `vote.abstained`, `vote.refused`, `signature.applied`, `analyst.cleared`, `analyst.rejected` |
| **E** | Data Modification | `record.created`, `record.edited`, `record.deleted`, `status.changed`, `classification.changed`, `priority.adjusted` |
| **F** | Configuration & Administrative | `prompt.version_committed`, `model.version_pinned`, `likelihood_ratio.adjusted`, `threshold.changed`, `user.added`, `user.removed`, `permission.granted`, `permission.revoked`, `yubikey.enrolled`, `yubikey.revoked` |
| **G** | System | `system.container_started`, `system.backup_completed`, `system.snapshot_replicated`, `system.bedrock_failover`, `system.rate_limit_hit`, `system.cost_threshold_crossed` |
| **H** | External Communication | `external.api_call`, `external.dossier_transmitted`, `external.receipt_acknowledged`, `external.email_sent` |
| **I** | Public Portal | `public.tip_submitted`, `public.voice_tip_transcribed`, `public.dashboard_viewed`, `public.report_downloaded` |
| **J** | Failed & Suspicious | `failed.auth`, `failed.authorization`, `failed.schema_validation`, `failed.canary_triggered`, `failed.multi_pass_disagreement`, `failed.counterfactual_probe` |
| **K** | Audit-of-Audit | `audit.query_executed`, `audit.external_auditor_access`, `redaction.performed`, `audit.chain_verified`, `audit.public_export_published` |

New event-type slugs may be added to `KNOWN_EVENT_TYPES`; the regex-fallback
in `categoryOf()` keeps unknown slugs categorisable. **No event may exist
that does not categorise.** A new category requires a doctrine amendment.

The high-significance subset (anchored individually to Polygon within
seconds — §4) is enumerated in
[`HIGH_SIGNIFICANCE_EVENT_TYPES`](../../packages/shared/src/schemas/audit-log.ts).

---

## §3. Per-Actor Hash Chain & Record Canonicalisation

Each actor (user, service, council member) has an independent hash chain.
A row's `prior_event_id` is the previous row this actor emitted. The chain
head is tracked in `audit.user_action_chain` and updated under
SELECT-FOR-UPDATE compare-and-swap inside
[`UserActionEventRepo.insertAndAdvanceChain`](../../packages/db-postgres/src/repos/audit-log.ts).
A concurrent caller racing on the same actor sees a CAS conflict and must
re-fetch the head before retrying. The chain is therefore gap-free per
actor.

### 3.1 Record-hash canonicalisation

The record hash is `sha256(canonicalJson(record))` where canonical JSON
means:

1. Every string field is NFKC-normalised (Unicode form NFKC).
2. Object keys are emitted in lexicographic order, recursively.
3. Numbers are emitted as JSON literals (no trailing zeros).
4. `null`, `true`, `false` literally.

Implementation: [`computeRecordHash()`](../../packages/audit-log/src/hash.ts).
Determinism is enforced by
[`hash.test.ts`](../../packages/audit-log/__tests__/hash.test.ts) (key-permutation
and Unicode-equivalence cases).

### 3.2 Signature

Every row carries a `digital_signature` field. In production the signer is
the actor's YubiKey accessed via PKCS#11; in tests it is
[`DeterministicTestSigner`](../../packages/audit-log/src/signer.ts), which
returns `sha256(actorId|recordHash|"test-signer")` so tests are
reproducible without hardware. `NoopSigner` is reserved for migrations and
rejected at boot in production.

The signature covers the record hash, not the row body — so canonicalisation
drift cannot mask a forged row.

### 3.3 Dual-write contract

Every emitted event lands in **two** chains in a single
[`emitAudit()`](../../packages/audit-log/src/emit.ts) call:

1. The global `audit.actions` chain (operated by
   [`HashChain`](../../packages/audit-chain/src/hash-chain.ts)) — the
   platform's gap-detected linear ledger.
2. The per-actor `audit.user_action_event` chain — the rich TAL-PA row
   with category, target, payload, signature, and Polygon anchor link.

The dual-write is not transactional across both substrates by design: the
global chain is the source-of-truth for "something happened"; if the
per-actor write fails after the global write succeeds, the global row
remains and an `audit.hash_chain_break` audit-of-audit row is emitted on
the next verification sweep (§7, rule `chain_integrity`).

---

## §4. Two-Chain Architecture (Internal + Public)

### 4.1 Internal substrate (`audit.actions`)

Append-only Postgres table. Each row carries `seq` (monotonic),
`prev_hash`, and `body_hash`. The chain is verified hourly by
[`HashChain.verify()`](../../packages/audit-chain/src/hash-chain.ts), which
emits an `audit.hash_chain_verified` audit-of-audit row on success and an
`audit.hash_chain_break` row on failure (the latter pages on-call).

This substrate replaces Hyperledger Fabric for MVP per W-11 (see SRD §17).
A future upgrade to Fabric is a new adapter package; the doctrine does not
change.

### 4.2 Public substrate (Polygon mainnet)

Two cadences:

- **Hourly Merkle batch.** [`apps/worker-anchor/`](../../apps/worker-anchor/)
  computes a Merkle root over all `body_hash` values in the unanchored
  range and submits it to `VIGILAnchor.sol` on Polygon. Ranges are
  `[seq_from, seq_to]`; recorded in `audit.anchor_commitment`. Inclusion
  proofs are O(log n).
- **Immediate per-event for high-significance.**
  [`runHighSigAnchorLoop()`](../../apps/worker-anchor/src/index.ts) polls
  `audit.user_action_event` every `AUDIT_HIGH_SIG_INTERVAL_MS` (default
  5 s) for rows where `high_significance = true AND chain_anchor_tx IS NULL`,
  anchors each individually, and writes the `(event_id, polygon_tx_hash)`
  mapping into `audit.public_anchor` with `is_individual = true`.

The hourly batch and the individual fast-lane do not interfere: the
fast-lane sets `chain_anchor_tx` on the event row, and the batch anchor's
Merkle leaf is unaffected.

Polygon was chosen over Ethereum L1 for cost (~$0.001 per individual
anchor, ~$0.05 per Merkle batch) and over private chains for legibility
(any block explorer, any verifier, any time).

### 4.3 What anchoring buys

Anchoring an event to Polygon binds its existence to a public,
adversarial, expensive-to-rewrite ledger. After confirmation the only way
to make the event "not have happened" is to re-org Polygon — which costs
billions of dollars and is observable to every market participant.
Anchoring does **not** by itself prove the row is legitimate; it proves
the row existed at the anchored moment, which is necessary for any
non-repudiation argument.

---

## §5. Public-View Scoping

Anyone, anywhere, can `GET /api/audit/public` or visit `/public/audit`. No
auth gate, no IP allowlist, no rate limit beyond standard DDoS protection.

The serialiser is
[`toPublicView()`](../../packages/audit-log/src/public-view.ts). The
contract:

| Field | Public view |
|---|---|
| `event_id`, `event_type`, `category`, `timestamp_utc`, `result_status`, `chain_anchor_tx`, `high_significance` | Verbatim |
| `actor_role` | Verbatim (`operator`, `analyst`, `auditor`, `architect`, `council`, `service`, `public`, `system`) |
| `actor_id`, `actor_yubikey_serial`, `actor_ip`, `actor_device_fingerprint`, `session_id` | **Dropped** |
| `actor_authenticated` | Boolean derived from `actor_id` (`system:` prefix → false; `public` role → false; otherwise true) |
| `target_resource` (Cat B, C) | `[REDACTED:CATEGORY-X]` — the query string and document path are PII surfaces |
| `target_resource` (Cat I) | `[PUBLIC]` — submitter identity must never leak |
| `target_resource` (other) | First 500 chars verbatim |
| `action_payload` | **Dropped** |
| `digital_signature`, `record_hash`, `prior_event_id` | Dropped from public API; preserved in the quarterly CSV under a salted `actor_id_hash` column |

### 5.1 PII salting

The quarterly anonymised CSV (§8) replaces `actor_id` with
`hashPii(actor_id, AUDIT_PUBLIC_EXPORT_SALT)` — a per-quarter rotated
32-byte salt. The salt is loaded from env at export time; the trigger
refuses to run if the salt is absent or PLACEHOLDER. An attacker cannot
brute-force the actor population from the hashes without the salt; an
auditor with the salt and a known actor list can verify per-actor
activity. The salt is rotated each quarter so cross-quarter linkage is
deliberately frustrated.

### 5.2 What the public sees vs. does not see

**Sees:** that *an analyst* searched at 14:32 UTC, that *an operator*
viewed a document, that *the council* voted on a proposal, that *a
service* anchored a batch.

**Does not see:** which analyst, which document, which council member
voted which way (until the proposal escalates and the dossier is
published per W-15 / SRD §22.4), which IP address.

This is enough for civic accountability and far below the
authorisation-misuse line.

---

## §6. Halt-on-Failure

If the audit emitter cannot persist a row, the action that triggered it
**does not proceed**. There is no "log later," no "retry queue," no
"degrade gracefully." The dashboard route handler wraps its work in
[`audit(req, spec, work)`](../../apps/dashboard/src/lib/audit-emit.server.ts),
which calls
[`withHaltOnFailure(emit, work)`](../../packages/audit-log/src/halt.ts) —
emit runs first; if it throws, an
[`AuditEmitterUnavailableError`](../../packages/audit-log/src/halt.ts) is
re-raised and the route returns HTTP 503 with `Retry-After: 30`. `work`
is never called.

This is the strongest guarantee in the doctrine. It is the operational
mechanism by which §1's "no privileged action without an audit row"
becomes machine-enforced.

The cost is real: an audit-emitter outage takes the privileged surfaces
of the platform down. This is the deliberate trade-off — completeness over
availability.

---

## §7. Anomaly Detection

The watch worker
[`apps/worker-audit-watch/`](../../apps/worker-audit-watch/) runs every
`AUDIT_WATCH_INTERVAL_MS` (default 5 min). For each tick it loads the last
`AUDIT_WATCH_WINDOW_HOURS` (default 24) of `audit.user_action_event` rows
and runs every rule in
[`ALL_RULES`](../../packages/audit-log/src/anomaly.ts). Triggered alerts
are persisted via `AnomalyAlertRepo.create()` with `state = 'open'`.

Each tick itself emits an `audit.hash_chain_verified` audit-of-audit row
so the watcher's own activity is on the chain.

### 7.1 Rule catalogue (RULE_VERSION = `v1.0.0`)

| Kind | Signal |
|---|---|
| `fishing_query_pattern` | Same actor runs ≥ 50 distinct entity searches with ≤ 1 result each within an hour. Marker for opportunistic intelligence-gathering. |
| `after_hours_dossier_access` | Cat-C event by an analyst between 22:00–05:00 Africa/Douala. |
| `analyst_clearance_uniform` | Same analyst clears > 95 % of recent findings as `cleared` (rubber-stamping). |
| `council_repeated_abstention` | Same council member abstains on ≥ 5 consecutive proposals (de-facto recusal without declaration). |
| `auth_burst_new_ip` | ≥ 10 successful auth events from a previously-unseen IP within 10 min. |
| `export_volume_spike` | Cat-C dossier export count exceeds the actor's 30-day rolling p95 by ≥ 3×. |
| `dossier_view_no_signature` | `dossier.opened` without a paired `signature.applied` within the configured window. |
| `config_change_without_pr` | Cat-F change emitted without a corresponding GitHub PR reference in the payload. |
| `sensitive_entity_query` | Cat-B event whose query string maps to an entity in `AUDIT_WATCHLIST_ENTITIES`. |
| `yubikey_geographic_improbable` | Two YubiKey-touched events from the same serial but geographically incompatible IPs within the travel-time window. |

Rules are versioned: an alert produced at `v1.0.0` reproduces at that
version even after the rule library evolves. New rules require a doctrine
amendment.

### 7.2 Severity policy

`info | low | medium | high | critical`. `high` and `critical` alerts page
the on-call rota; lower severities surface in the dashboard's anomaly
panel only. The mapping is per-rule (see `anomaly.ts`).

---

## §8. Retention & Public-Permanence Export

**Internal retention.** Append-only, no row is ever deleted. Right-to-be-
forgotten claims are honoured via a separate `audit.redaction` row that
records *which* fields were redacted, *why*, and *by whom*. The original
record hash remains valid because the redaction row is a sibling, not a
mutation.

**Public permanence.** Every quarter, on the first day at 05:00
Africa/Douala (cron `0 5 1 1,4,7,10 *`), the previous quarter's
`audit.user_action_event` rows are streamed through `toPublicView()`,
written to a CSV with a salted `actor_id_hash` column (§5.1), pinned to
IPFS, and recorded in `audit.public_export`. The trigger
[`runQuarterlyAuditExport()`](../../apps/adapter-runner/src/triggers/quarterly-audit-export.ts)
emits one `audit.public_export_published` audit-of-audit row per
publication. The CSV CID is permanent; even if the platform disappears,
the public log persists on the IPFS network.

The export is idempotent on `period_label` and refuses to run without a
real salt.

---

## §9. Adversarial Scenarios

| Scenario | Mitigation |
|---|---|
| Operator attempts to suppress a Cat-D event before vote escalation | Halt-on-failure (§6) blocks the vote at the route layer; per-actor CAS chain (§3) prevents back-dating; high-sig anchor (§4.2) commits the event to Polygon within seconds. |
| Insider mutates an old `audit.user_action_event` row | Hourly verify (§4.1) detects the body-hash mismatch and emits `audit.hash_chain_break`; Polygon batch anchor (§4.2) is the independent witness. |
| Rogue admin truncates `audit.actions` | The Polygon anchor for the truncated range still exists; the verifier ([`LedgerVerifier`](../../packages/audit-chain/src/verifier.ts)) compares the on-chain root to the local computation and detects the divergence. |
| External adversary scrapes `/api/audit/public` to deanonymise users | Public view drops `actor_id` (§5); the quarterly CSV salts the hash and rotates the salt (§5.1); rate limits bound the damage. |
| Compromised YubiKey is used to forge events | The `actor_yubikey_serial` field on each row plus rule `yubikey_geographic_improbable` (§7.1) flag the impossible movement; revocation emits a `yubikey.revoked` Cat-F high-sig event. |
| Audit emitter is taken down by a DoS | Halt-on-failure (§6) takes the privileged surfaces down with it. The platform fails closed; civic-side `/public/audit` continues to serve the cached read replica. |

---

## §10. Institutional Commitments

**To CONAC, the Cour des Comptes, MINFI, and ANIF.** Every dossier
delivered via the SFTP adapters carries the SHA-256 of every
`audit.user_action_event` row that contributed to its production
(intake, OCR, scoring, council vote, render, sign). The receiving body
can independently verify against the Polygon anchor.

**To the council (the five-pillar deliberative body).** Each council
member's vote is a Cat-D high-significance event signed by their YubiKey,
anchored individually to Polygon within seconds, and immutably linked to
the proposal. No vote can be re-written, no abstention can be
backdated.

**To the public.** The `/public/audit` page and the `/api/audit/public`
REST API are read-only and unauthenticated. The quarterly CSV export
provides a permanent IPFS-pinned audit log for the prior quarter. Civic
society can run independent analyses without our cooperation.

**To future operators.** When this team is replaced — by mandate, by
attrition, by reorganisation — the audit chain remains. The successor
team inherits a system whose history is cryptographically attested and
publicly observable. There is no "trust us" — there is "verify against
Polygon."

**What the doctrine does *not* promise.**
- It does not anonymise actors against an attacker who already holds the
  current quarter's salt and a known actor list. (That's a feature, not a
  bug — the regulator should be able to deanonymise on warrant.)
- It does not protect against a coalition of platform admin + Polygon
  reorg + every block explorer simultaneously. (Out of threat model; see
  THREAT-MODEL-CMR.md.)
- It does not replace the legal evidentiary process. The chain is one
  input to a court; admissibility is the prosecution's burden.

---

## §11. Implementation Index

### Schemas & types
- [`packages/shared/src/schemas/audit-log.ts`](../../packages/shared/src/schemas/audit-log.ts) — `zUserActionEvent`, `KNOWN_EVENT_TYPES`, `HIGH_SIGNIFICANCE_EVENT_TYPES`, `categoryOf`, `zPublicAuditView`, `zAnomalyKind`.
- [`packages/shared/src/schemas/audit.ts`](../../packages/shared/src/schemas/audit.ts) — `zAuditAction` enum (includes `audit.public_export_published`).

### Persistence
- [`packages/db-postgres/drizzle/0010_tal_pa.sql`](../../packages/db-postgres/drizzle/0010_tal_pa.sql) — seven tables + CHECK constraints + indexes.
- [`packages/db-postgres/src/schema/audit-log.ts`](../../packages/db-postgres/src/schema/audit-log.ts) — Drizzle mirrors.
- [`packages/db-postgres/src/repos/audit-log.ts`](../../packages/db-postgres/src/repos/audit-log.ts) — `UserActionEventRepo` (CAS chain), `SessionRepo`, `PublicAnchorRepo`, `AnomalyAlertRepo`, `RedactionRepo`, `PublicExportRepo`.

### SDK
- [`packages/audit-log/src/emit.ts`](../../packages/audit-log/src/emit.ts) — `emitAudit()`.
- [`packages/audit-log/src/halt.ts`](../../packages/audit-log/src/halt.ts) — `withHaltOnFailure()`, `AuditEmitterUnavailableError`.
- [`packages/audit-log/src/hash.ts`](../../packages/audit-log/src/hash.ts) — `computeRecordHash()`.
- [`packages/audit-log/src/signer.ts`](../../packages/audit-log/src/signer.ts) — `AuditSigner`, `DeterministicTestSigner`, `NoopSigner`.
- [`packages/audit-log/src/public-view.ts`](../../packages/audit-log/src/public-view.ts) — `toPublicView()`, `hashPii()`.
- [`packages/audit-log/src/anomaly.ts`](../../packages/audit-log/src/anomaly.ts) — `evaluateAnomalies()`, `ALL_RULES`, `RULE_VERSION`.

### Dashboard surface
- [`apps/dashboard/src/lib/audit-emit.server.ts`](../../apps/dashboard/src/lib/audit-emit.server.ts) — `audit(req, spec, work)`.
- [`apps/dashboard/src/app/api/audit/public/route.ts`](../../apps/dashboard/src/app/api/audit/public/route.ts) — paginated public read.
- [`apps/dashboard/src/app/api/audit/aggregate/route.ts`](../../apps/dashboard/src/app/api/audit/aggregate/route.ts) — counts per role per category.
- [`apps/dashboard/src/app/public/audit/page.tsx`](../../apps/dashboard/src/app/public/audit/page.tsx) — bilingual public portal.
- [`apps/dashboard/src/middleware.ts`](../../apps/dashboard/src/middleware.ts) — public-prefix allowlist.

### Workers
- [`apps/worker-anchor/src/index.ts`](../../apps/worker-anchor/src/index.ts) — hourly Merkle batch + 5 s high-sig fast-lane.
- [`apps/worker-audit-watch/src/index.ts`](../../apps/worker-audit-watch/src/index.ts) — 5 min anomaly evaluation loop.
- [`apps/adapter-runner/src/triggers/quarterly-audit-export.ts`](../../apps/adapter-runner/src/triggers/quarterly-audit-export.ts) — CSV → IPFS → audit-of-audit.

### Tests
- [`packages/audit-log/__tests__/`](../../packages/audit-log/__tests__/) — 34 unit tests (hash, halt, public-view, coverage, anomaly).
- [`apps/adapter-runner/__tests__/quarterly-audit-export.test.ts`](../../apps/adapter-runner/__tests__/quarterly-audit-export.test.ts) — 5 redaction/idempotency tests.
- [`apps/worker-anchor/__tests__/high-sig-loop.test.ts`](../../apps/worker-anchor/__tests__/high-sig-loop.test.ts) — fast-lane flow.
- [`apps/dashboard/__tests__/public-audit-route.test.ts`](../../apps/dashboard/__tests__/public-audit-route.test.ts) — public-route redaction contract.
- [`packages/db-postgres/__tests__/audit-log-cas.test.ts`](../../packages/db-postgres/__tests__/audit-log-cas.test.ts) — chain CAS race (gated on `INTEGRATION_DB_URL`).

### Operations
- `.env.example` — `AUDIT_HIGH_SIG_INTERVAL_MS`, `AUDIT_WATCH_INTERVAL_MS`, `AUDIT_WATCH_WINDOW_HOURS`, `AUDIT_WATCHLIST_ENTITIES`, `AUDIT_PUBLIC_EXPORT_*`.
- DECISION-012 — see `docs/decisions/log.md`.
