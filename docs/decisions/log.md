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
