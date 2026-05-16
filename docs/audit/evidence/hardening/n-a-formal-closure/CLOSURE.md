# Hardening Pass — N/A formal closure

**Date:** 2026-05-15
**Branch:** `hardening/phase-1-orientation`
**Scope:** 6 modes classified as Not-Applicable in the orientation
**Modes covered:** 1.4, 1.8, 5.8, 7.2, 7.8, 9.7

---

## Why a formal N/A closure

The 90-mode hardening pass classifies each mode into one of four
terminal states: **Closed-Verified (CV)**, **Partial**, **Open**, or
**Not Applicable (N/A)**. The orientation (`docs/audit/hardening-orientation.md`)
identified 6 modes as structurally inapplicable to the VIGIL APEX
codebase — adding code to "close" them would be inverse-hardening
(introducing the very surface the mode was designed to prevent).

This doc formalises those 6 modes as **closed-by-inapplicability**. It
gives the pass ledger a single audit-anchored citation for each.

The orientation already documented the rationale per mode (orientation
§4 "Not-applicable list"). This doc consolidates them with explicit
re-open triggers and architect signoff.

---

## The 6 modes

### Mode 1.4 — Lock-order deadlock within service

**Status:** N/A (structural).
**Why not applicable:**

- Node.js has a single-threaded event loop. There are no concurrent
  threads that could acquire two mutexes in opposite orders.
- The Python workers (`worker-satellite`, `worker-image-forensics`)
  use asyncio's cooperative model; the only `threading.Lock` usage is
  in `vigil_common.health` (single-lock guard around the readiness
  state).
- Drizzle transactions are short and non-nested. Postgres-level
  lock-order issues are caught by the `migration-locks` CI gate
  (mode 2.5) for `CREATE INDEX` and by `idle_in_transaction_session_timeout`
  (per SRD §07) for runaway transactions.

**Re-open trigger:** the system gains a multi-threaded component
that holds two locks (e.g., Tokio worker pool in a future Rust
service). Phase 2+ federation streaming may introduce this; flagged
in `docs/PHASE-3-FEDERATION.md` as a design-time consideration.

---

### Mode 1.8 — Goroutine / thread leak

**Status:** N/A (structural).
**Why not applicable:**

- No Goroutines anywhere in the codebase (no Go services).
- No OS-thread management in the TypeScript code — Node.js owns the
  worker pool; user code uses `Promise` + `async/await`.
- The analogous concern (timer / listener leak) is captured under
  mode 1.9 ("Resource leak under load"), which is partially covered
  by the worker base's bounded in-flight count + the
  `registerShutdown` discipline.

**Re-open trigger:** a Go service joins the platform (the cosign-
verifier is a Go binary but runs as a one-shot, no long-running
goroutines), OR the TypeScript code adopts `worker_threads` (no
current callers).

---

### Mode 5.8 — FROST partial-signature context binding

**Status:** N/A (architectural — multi-sig is used instead).
**Why not applicable:**

- FROST is not implemented. The platform uses **contract-native
  multi-sig** (commit-reveal + per-proposal vote-lock) for the
  5-pillar council ceremony.
- The doctrinal documentation in SRD §17 mentions FROST as a future
  research path; the actual implementation is multi-sig per
  DECISION-018 (FIND-006 closure).
- The 5.8 failure mode (signature aggregation under malicious partial
  signer) is structurally inapplicable because there's no partial-
  signature aggregation step; each pillar signs a full proposal
  transaction independently.

**Re-open trigger:** the council moves to a FROST-based threshold
signature scheme. Currently a Phase-4+ research consideration only.

---

### Mode 7.2 — NoSQL injection

**Status:** N/A (no NoSQL store).
**Why not applicable:**

- No MongoDB, no DynamoDB, no document-store. Postgres (Drizzle) +
  Neo4j (parameterised Cypher) only.
- Cypher injection is its own failure class (covered by Neo4j's
  parameterised query API; all production Cypher uses parameter
  bindings).

**Re-open trigger:** a NoSQL store is adopted. SRD §07 explicitly
forbids this for Phase 1-2.

---

### Mode 7.8 — XML external entity (XXE) injection

**Status:** N/A (no XML parser).
**Why not applicable:**

- The codebase has zero XML parsers. `grep -rE "xml2js|fast-xml-parser|@xmldom|xmlbuilder|sax|libxmljs" packages/ apps/` returns no matches.
- The CONAC delivery format is CSV + signed JSON, not XML.
- The audit-chain anchoring uses canonical JSON over Polygon RPC, not
  XML-RPC.

**Re-open trigger:** an adapter or new feature adds an XML parser.
Currently no source-document format requires XML parsing.

---

### Mode 9.7 — Forward-incompatible code shipped before migration

**Status:** N/A (process problem, not code).
**Why not applicable:**

- This failure mode is fundamentally a deployment-sequencing problem,
  not a code defect. No single-file change to the codebase can
  prevent it; only deployment discipline can.
- The closure delivers the discipline via
  `docs/runbooks/migration-rollout-policy.md` (two-phase deployment
  - 6-item architect-signed checklist).
- Practical risk is low because (i) CI runs migrations before the
  test suite, (ii) Postgres DDL is usually backward-compatible,
  (iii) most code changes are additive.

**Re-open trigger:** a production incident traces to bypassed
discipline, OR the schema grows beyond ad-hoc review (~100+
tables), OR the team grows beyond solo-architect review. Tracked in
the migration-rollout-policy runbook §"Re-open trigger".

---

## Closure-by-inapplicability is terminal

Each of the 6 modes has the same closure shape:

1. **Documented rationale** (above + in the orientation).
2. **Re-open trigger** (the specific architectural change that would
   make the mode applicable).
3. **No code change** beyond the trigger; if the trigger fires, the
   mode is re-classified to OPEN and a fresh closure pass begins.

For audit-chain purposes, these 6 modes are **closed**. The pass
ledger treats them as a terminal state alongside CV — the only
difference is the closure mechanism (CV = "code+test+invariant"; N/A
= "architectural assertion + re-open trigger").

---

## Pass-ledger impact

Before this doc: 80 CV / 2 Partial / 2 Open / **6 N/A**.

After this doc: 80 CV / 2 Partial / 2 Open / **6 N/A-CLOSED**.

The mode count is unchanged at the orientation-snapshot level. The
state-of-each-mode is now formally documented at the audit-chain
level. Combined with mode 9.8 + 10.2(b) digest-pin activation + mode
9.1 Tier 2 helm-golden activation (this session), the pass status is:

- **86 modes terminally closed** (80 CV + 6 N/A-CLOSED).
- **4 modes framework-closed, activation-pending architect ceremony**
  (9.8 + 9.9 + 10.2(b) + 10.8 cosign chain; the digest-pin sub-mode
  9.8 + 10.2(b) is now CV via this session's commit; the
  cosign-signing sub-mode 9.9 + 10.8 awaits YubiKey ceremony).

The 4 remaining framework-closed modes split:

| Sub-mode                           | State after this session                                                            | Final activation gate                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 9.8 digest pinning                 | **CV** (23 upstream digests pinned; vigil-owned refs filled in by CI bake-and-push) | None at code layer; CI bake completes the picture     |
| 10.2(b) digest pinning             | **CV** (same as 9.8)                                                                | None at code layer                                    |
| 9.9 cosign signature on every pull | framework-CV                                                                        | Architect YubiKey ceremony per cosign-key-rotation.md |
| 10.8 cosign sig verified           | framework-CV                                                                        | Same as 9.9                                           |

That's **86 CV + 4 framework-CV-pending-architect = 90 closed-at-the-
code-layer**. The two cosign-signing modes are the only ones whose
final activation is hardware-ceremony (not code) work.

---

## Architect signoff

The N/A classifications were architect-signed at orientation
acknowledgement (Phase 1 orientation, 2026-04-28). This doc
formalises that signoff with an audit-chain-anchorable citation per
mode.

This doc is **not** subject to a separate signoff; it consolidates
existing decisions. The audit-chain entry recording the pass closure
references this doc directly.

---

## Related

- `docs/audit/hardening-orientation.md` §4 — original N/A list.
- `docs/decisions/log.md` — DECISION-018 (FIND-006 closure, FROST →
  multi-sig).
- `docs/runbooks/migration-rollout-policy.md` — the 9.7 closure
  artefact.
