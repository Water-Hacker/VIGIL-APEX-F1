# BLOCK A — reconciliation between original prompt and shipped scope

> **Status:** COUNTER-SIGNED 2026-05-01. Implementation in progress.
> **Date:** 2026-05-01.
> **Author:** build agent (Claude).
>
> All four hold-points in §6 are signed. Revised running order in §4
> reflects architect-approved ordering (§5.b migration first).

---

## 1. Why this document exists

The Phase-1 completion prompt the architect drafted on 2026-05-01
specified Block A items A.1 and A.2 in detail, then the message
truncated. The build agent filled in A.3–A.7 in the completed
prompt at [`prompts/PHASE-1-COMPLETION-AGENT.md`](../../prompts/PHASE-1-COMPLETION-AGENT.md)
(commit `af71f3c`).

The architect's actual mental list for Block A was:

- A.3 finally-block emit (worker-entity)
- A.4 Anthropic pricing
- A.5 Bedrock cost
- A.6 worker-score dead query
- A.7 alias trgm index
- A.8 pgvector
- A.9 source-count lint

The agent's filled-in list was:

- A.3 worker-entity Neo4j-mirror retry policy
- A.4 worker-pattern dispatch tier audit
- A.5 worker-score signal-row provenance leak (backdated)
- A.6 adapter-runner robots.txt fail-open scope
- A.7 dossier render byte-identity

These two lists overlap on substance only at A.3 (both touch
worker-entity) and A.5↔A.6 (both touch worker-score). Otherwise
the agent invented bugs the architect did not flag, and the agent
omitted bugs the architect knows about. This document maps each
side to one of {DONE, KEEPING, DEFERRED, DROPPED}, with rationale.

**Discipline note.** The agent should have asked instead of guessing
when the prompt truncated. The "boil the ocean" closing standard in
the prompt does NOT override the non-negotiable
`if you cannot answer from the provided sources, return
{"status":"insufficient_evidence"}`. The agent treated truncation as
ambiguity and invented; that was wrong. This reconciliation is the
correction.

---

## 2. Original-prompt items

### A.3 — finally-block emit (worker-entity)

**Status:** **KEEPING.** Promote to A.3 in the revised list.

**Evidence.** [`apps/worker-entity/src/index.ts:307-318`](../../apps/worker-entity/src/index.ts#L307-L318)
publishes to `STREAMS.PATTERN_DETECT` from a `finally` block — which
fires regardless of `try` outcome. Two real failure modes:

1. When the handler returns `{kind: 'retry', ...}` because the LLM
   call failed, the publish still happens. PATTERN_DETECT receives
   an envelope for a finding that was not written; downstream
   workers either skip silently (best case) or fire patterns
   against an inconsistent state (worst case).
2. The published envelope is hard-coded with `subject_kind: 'Tender',
canonical_id: null, related_ids: [], event_ids: []` — every
   resolution event triggers an empty-subject pattern dispatch.
   That is wasteful and probably skips real patterns.

**Why the agent missed this.** The agent saw the `finally` block in
the original code, kept it verbatim, and added the new
rule-pass + transaction logic around it. The `finally` was the
SUSPECT line, not the safe line.

**Priority.** Higher than the agent's A.3 (Neo4j retry queue). A
Neo4j retry is forward-progress on a known degradation; the finally
emit is a live correctness bug routing wrong envelopes to
downstream workers right now.

### A.4 — Anthropic pricing

**Status:** **NEEDS-CLARIFICATION.** The agent does not have enough
context to classify this without the architect's input.

**Possibilities.**

1. **Pricing table drift in `packages/llm/src/router.ts` cost
   accounting.** `LlmRouter` records cost per call in
   `llm.call_record.cost_usd`. The pricing constants might be stale
   relative to current Anthropic rate cards.
2. **Tier mapping in `packages/llm/src/types.ts` `TASK_MODEL`.**
   Tasks are mapped to model classes (haiku / sonnet / opus); the
   architect may want a re-tier (e.g., entity_resolution moves
   off haiku to sonnet, or vice versa).
3. **Daily/monthly circuit-breaker thresholds in
   `LLM_MONTHLY_CIRCUIT_FRACTION` env var.** The default might be
   set wrong relative to the architect's USD 30/day soft / USD
   100/day hard ceilings.

**Question for architect.** Which of these (or something else) does
"Anthropic pricing" refer to? The agent will ship the fix once
scoped.

### A.5 — Bedrock cost

**Status:** **NEEDS-CLARIFICATION.** Same shape as A.4.

**Possibilities.**

1. **Tier-1 Bedrock failover cost not surcharged in `cost_usd`.**
   `packages/llm/src/providers/bedrock.ts` may report Anthropic
   API rates when the actual Bedrock invoke includes an AWS
   per-request surcharge.
2. **Bedrock circuit doesn't propagate to the daily ceiling.**
   When Tier 0 trips and Tier 1 takes over, the daily ceiling math
   in `circuit-breaker.ts` may double-count (charging the failed
   Tier-0 call AND the Tier-1 retry).

**Question for architect.** Same: what specifically is the bug?

### A.6 — worker-score dead query

**Status:** **NEEDS-CLARIFICATION** (likely SUBSUMES the agent's
A.5 backdated-signal item).

**Possibilities.**

1. **Backdated-signal acceptance.** `worker-score` selects from
   `finding.signal` without `WHERE contributed_at <= NOW()` — a
   backdated row from a misbehaving adapter trips the score with
   a future-timed signal. (This is what the agent guessed at as
   its own A.5.)
2. **A literal dead query** — code path that builds SQL but never
   executes, or executes with a filter that always evaluates false.
   The agent has not located such a dead query; if the architect
   has one in mind, please name the file/line.
3. **The `provenanceBySource` lookup in `worker-score`** —
   [`apps/worker-score/src/index.ts:215-249`](../../apps/worker-score/src/index.ts#L215-L249)
   runs an unused execute-then-discard pattern (`r` is voided at
   line 231 and `r2` is the actual query). That looks like a real
   dead query — see lines 224-231.

**Provisional action.** The agent will ship the `contributed_at
<= NOW()` clause AND clean up the dead `r` query at lines 224-231.
If the architect meant something else, the next item is bumped
to a follow-up.

### A.7 — alias trgm index

**Status:** **KEEPING.** Real concern; the agent's A.1 commit
introduced the gap.

**Evidence.** [`packages/db-postgres/src/schema/entity.ts:31-43`](../../packages/db-postgres/src/schema/entity.ts#L31-L43)
declares `nameIdx` as a GIN trgm index on `display_name`. The new
`findCanonicalByNormalizedName` query (commit `bdfd850`) does an
exact-equality lookup against a normalised expression — Postgres
cannot use a GIN trgm index for `WHERE expr_normalised = $1`. The
query falls through to a sequential scan on every rule-pass call.

**Fix.** Add a B-tree index on the **computed** normalised
expression — i.e., a functional / expression index:

```sql
CREATE INDEX canonical_display_name_normalised_idx
  ON entity.canonical
  ((regexp_replace(
       lower(translate(display_name, '<accent-source>', '<accent-target>')),
       '[^a-z0-9 ]', ' ', 'g')));
```

Migration `00NN_canonical_normalised_name_idx.sql` + paired
`_down.sql` per DECISION-017. The migration is non-destructive
(adds an index) and CONCURRENT to avoid table lock.

**Priority.** Now — without this index, every adapter run pays
sequential-scan cost on `entity.canonical` for every alias the
rule-pass tries to match by name. Latency grows linearly with
table size. At Phase-1 scale (~10k entities) tolerable; at Phase-2
scale catastrophic.

### A.8 — pgvector

**Status:** **DEFERRED to Block C or its own track.**

**Evidence.** pgvector enables embedding-based similarity for the
LLM-pass review-queue band (0.70–0.92 confidence). It is wired in
the Companion v2 §59 spec but not currently used by `worker-entity`
(LLM emits raw `confidence`; the worker doesn't recompute via
embeddings).

**Why defer.** Two reasons:

1. The pgvector extension itself needs to be enabled in the host
   Postgres image (`infra/docker/postgres/Dockerfile`); that's a
   compose-stack change with operational implications.
2. The calibration seed (W-16, deferred to M2 exit) is the real
   driver — embeddings need a reference set to compute similarity
   against. Pre-seed, the embeddings would float.

**Recommended target.** Block C (test-coverage + e2e completion
phase) is the wrong home. Suggest a new Block F or a Phase-2
follow-up.

### A.9 — source-count lint

**Status:** **KEEPING and bumped to Block A**.

**Evidence.** TRUTH §C says 27 sources; SRD §10.2.1 says 26;
`infra/sources.json` has 29 entries. The discrepancy will drift
again. The agent had this as Block D.1; the architect's prompt put
it in Block A. **Following the architect's placement.**

**Fix.** New `scripts/check-source-count.ts` that reads the JSON

- greps the binding docs + asserts equality. Wire into
  `phase-gate.yml`. The single canonical number is set by the
  architect after auditing the 29 vs 27 vs 26 gap.

---

## 3. Agent's filled-in items — disposition

### Agent A.3 — Neo4j-mirror retry policy

**Status:** **DEFERRED to Block A.10.**

**Why.** Real concern but lower priority than the architect's
A.3 (finally-block emit) which is a live envelope-routing bug.
The Neo4j retry is forward-progress on a known degradation; we
can ship Block A without it.

**Companion.** Verification §3b below adds a soft alert
(`vigil_neo4j_mirror_pending_total` metric) and a state column on
`entity.canonical` so the gap is visible BEFORE the retry queue
lands.

### Agent A.4 — worker-pattern dispatch tier audit

**Status:** **DEFERRED to Block C.**

**Why.** Real concern but speculative — the agent did not find a
shadow→live leak in the current `registerPattern` calls. The
ad-hoc lint script is good preventative scaffolding; not a
correctness fix. Belongs with the test-coverage backfill block.

### Agent A.5 — worker-score backdated-signal leak

**Status:** **MERGES INTO architect's A.6.**

**Why.** Same code surface (`worker-score` SELECT from
`finding.signal`). Will be addressed atomically in the architect's
A.6 fix. The dead `r` query at lines 224-231 is a separate clean-up
that goes in the same commit.

### Agent A.6 — adapter-runner robots.txt fail-open scope

**Status:** **DROPPED from Block A; tracked for Block D or a
follow-up.**

**Why.** The current fail-open behaviour is documented and matches
EXEC §10's robots-policy doctrine. The 7-window failure counter is
a hardening on top of correct behaviour, not a bug fix. Lower
priority than every other Block A item.

### Agent A.7 — dossier render byte-identity

**Status:** **KEEPING but moved to A.11 (after the original
prompt's A.9 source-count lint).**

**Why.** Real invariant per SRD §24.10 ("byte-identical PDF after
LibreOffice + PDF normalisation"). AUDIT-063 already partially
addressed; verification of the post-PDF normaliser is a worthwhile
follow-up. Lower priority than the correctness bugs above.

---

## 4. Revised Block A — running order (architect-approved 2026-05-01)

The architect approved with one ordering change: §5.b Neo4j-mirror-
state migration moves to FIRST. Rationale: the migration adds
observability that benefits every subsequent block and lands cleanly
before the more invasive finally-block change.

| Item  | Source             | Priority | Scope                                                                                  | Commit    |
| ----- | ------------------ | -------- | -------------------------------------------------------------------------------------- | --------- |
| A.1   | original (DONE)    | done     | worker-entity Postgres-first commit                                                    | `bdfd850` |
| A.2   | original (DONE)    | done     | worker-entity rule-pass before LLM                                                     | `bdfd850` |
| A.3   | §5.b verification  | high     | Neo4j-mirror-state column + metric (one column, one metric, one migration)             | `3bc1250` |
| A.4   | original A.3       | high     | worker-entity finally-block emit — fix the unconditional PATTERN_DETECT publish        | `9236061` |
| A.5   | original A.6       | high     | worker-score dead query + backdated-signal clause                                      | `c3359b0` |
| A.6   | original A.7       | high     | alias trgm index → expression B-tree index for the rule-pass exact-match lookup        | `9afd186` |
| A.7   | original A.9       | high     | source-count coherence lint                                                            | `2e5d3da` |
| A.8   | original A.4       | high     | Anthropic pricing table — dated JSON keyed by exact `model_id` under `infra/llm/`      | `9b4b274` |
| A.9   | original A.5       | high     | Bedrock cost accounting — same per-`model_id` table + `aws_bedrock_premium_multiplier` | `2db2271` |
| (gap) | original A.8       | DEFERRED | pgvector — Phase-2 / new track                                                         |           |
| (gap) | agent original A.3 | DEFERRED | Neo4j-mirror retry queue (state column lands now; reconcile worker later)              |           |
| (gap) | agent A.4          | DEFERRED | worker-pattern dispatch tier audit — Block C                                           |           |
| (gap) | agent A.6          | DROPPED  | adapter-runner robots.txt 7-window counter — preventative, not corrective              |           |
| (gap) | agent A.7          | DEFERRED | dossier render byte-identity — Block D follow-up                                       |           |

**Architect signature on the running order:** APPROVED 2026-05-01 (with §5.b moved to A.3 / first).

**Block A: CLOSED 2026-05-01.** All seven planned items shipped; full
workspace sweep green (39 build, 48 test, 56 lint). Block A completion
summary: see §7 below. Halt for architect review before opening Block B.

### Procedural rule going forward

Per architect instruction 2026-05-01: when the agent hits hold-points
in a block, batch ALL clarifications into a single list and halt
once. Do not present hold-points incrementally. Record each
architect countersignature back into the relevant reconciliation
document.

---

## 5. Verification of Block A.1 + A.2 (commit `bdfd850`)

Each row is either `PASS` (with one-line confirmation) or `FIX
COMMITTED` (with commit sha) or `FIX PENDING` (if the fix is
non-trivial and lands in a follow-up commit on this same branch).

### 5.a `upsertCluster()` uses Drizzle's `db.transaction()` primitive

**PASS.** [`packages/db-postgres/src/repos/entity.ts:301`](../../packages/db-postgres/src/repos/entity.ts#L301)
reads `return this.db.transaction(async (tx) => { ... })`. Drizzle
serialises the BEGIN/COMMIT through a single pool connection;
atomicity holds.

### 5.b Neo4j-mirror failure visibility

**APPROVED SHAPE (architect-signed 2026-05-01).** Two real gaps:

1. `Cypher.addAlias` ([`packages/db-neo4j/src/queries.ts:13-18`](../../packages/db-neo4j/src/queries.ts#L13-L18))
   begins with `MATCH (e:Entity {id: $entity_id})`. If the Entity
   node does NOT exist (because a prior mirror failed), the MATCH
   yields zero rows, the subsequent MERGE on the alias never fires,
   and the call is a silent no-op.
2. There is no `vigil_neo4j_mirror_state_total{state}` metric and no
   `neo4j_mirror_state` column on `entity.canonical` to surface
   the gap.

**Approved migration shape (architect 2026-05-01).** One column on
`entity.canonical`:

- `neo4j_mirror_state` enum-style text with `CHECK IN ('synced',
'pending', 'failed')`, default `'pending'`.
- Set to `'synced'` on successful Cypher write.
- Set to `'failed'` after N retries (N configurable, default 3).
- Emit Prometheus gauge `vigil_neo4j_mirror_state_total{state}`
  derived from `SELECT neo4j_mirror_state, count(*) FROM
entity.canonical GROUP BY neo4j_mirror_state`.
- Reconciliation logic (background worker that retries pending /
  resets failed) is OUT OF SCOPE for this migration — that lands in
  the deferred Neo4j retry queue (not Block A).
- One migration file, one column, one metric.

Also fix the `Cypher.addAlias` silent-no-op by changing `MATCH` to
`MERGE` on the entity node — the lazy create is safe because the
canonical Postgres row has authoritative props; the Neo4j Entity
node's `display_name`/`kind` get filled by the next `upsertEntity`
call (which uses MERGE + SET).

### 5.c Rule-pass auto-merge policy

**FIX REQUIRED.** Current code at
[`apps/worker-entity/src/index.ts:151-159`](../../apps/worker-entity/src/index.ts#L151-L159)
auto-merges on normalised-name alone:

```ts
const hit = await this.entityRepo.findCanonicalByNormalizedName(alias);
if (hit) {
  resolved.push({ alias, canonicalId: hit.id, via: 'normalised_name' });
  continue;
}
```

The architect's correct call: two real distinct companies can share
the same display name. Name-only auto-merge is a silent
data-corruption mode.

**Fix (committed as part of this reconciliation):**

- Normalised-name match no longer auto-merges. It enters a third
  bucket: `nameOnlyCandidates` — held aside.
- After the RCCM/NIU rule-pass completes, every
  `nameOnlyCandidate` is re-checked: if any RCCM/NIU match in the
  same alias batch points to the SAME canonical_id, the
  name-only alias is corroborated and attaches.
- Otherwise the name-only alias is routed to
  `entity.er_review_queue` with `proposed_action='merge'` and
  `similarity` set to 1.0 (exact normalised-name match).
- The LLM is NOT invoked for name-only candidates routed to the
  review queue (we already have the candidate; human review
  decides).

This commit lands as a follow-up on this branch.

### 5.d `source_id` fallback to `'unknown'`

**FIX REQUIRED.** [`apps/worker-entity/src/index.ts:181`](../../apps/worker-entity/src/index.ts#L181)
reads:

```ts
const sourceId = env.payload.source_event_id ?? 'unknown';
```

The architect's correct call: `entity.alias` has unique constraint
`(canonical_id, alias, source_id)`. Two legitimately different
events that both omit `source_event_id` collapse to the same key
under `'unknown'`, losing the second's history.

**Fix (committed as part of this reconciliation):**

- Tighten the worker `zPayload` schema: `source_event_id` becomes
  required (was `.optional()`).
- The handler returns `{kind: 'dead-letter', reason:
'missing-source-event-id'}` if the field is absent. Operator
  alert via the existing dead-letter dashboard.
- The LLM-pass cluster code that previously read `sourceId ??
'unknown'` now uses the validated `source_event_id` directly.

### 5.e Adversarial regex tests

**FIX REQUIRED.** Five new tests added to
`apps/worker-entity/__tests__/rule-pass.test.ts`:

1. RCCM with one digit too few (sequence < 1 digit).
2. RCCM with one digit too many (sequence > 6 digits).
3. NIU with transposed character class (digit in checksum slot).
4. Foreign-jurisdiction RCCM-shape (Gabonese `RC-G/2024/B/01234` —
   the shape passes the regex; the lookup fails because the
   foreign RCCM is not in our table — that's the correct outcome,
   the test pins it).
5. Whitespace + zero-width characters embedded in a valid RCCM —
   the regex MUST NOT match a string with embedded U+200B / U+FEFF.

### 5.f Cross-language tests

**FIX REQUIRED.** Two new tests added to
`packages/db-postgres/__tests__/entity-repo-helpers.test.ts`:

1. `Coopérative` (FR) and `Cooperative` (EN) — both normalise to
   `cooperative`. (Positive.)
2. `Société` (FR) and `Sociedade` (ES) — `societe` ≠ `sociedade`.
   (Negative.) Pins that we do NOT do over-aggressive cross-Romance
   folding.

---

## 6. Hold-points — COUNTER-SIGNED 2026-05-01

- [x] **§4 revised running order — APPROVED** with one ordering
      change. §5.b Neo4j-mirror-state migration moves to FIRST
      (before the original-A.3 finally-block fix). Rationale: the
      migration adds observability that benefits every subsequent
      block and lands cleanly before the more invasive
      finally-block change.

- [x] **§2.A.4 Anthropic pricing — APPROVED full original-prompt
      scope.** The bug is the combination of (i) keying by
      `modelClass` not `model_id`, (ii) values not matching the
      TRUTH §C model versions, and (iii) no CI check for missing
      entries. Fix: dated JSON keyed by exact `model_id` under
      `infra/llm/`, throw `LlmPricingNotConfiguredError` on missing
      entry, no default fallback, CI test asserting every model in
      `TASK_MODEL` has an entry.

- [x] **§2.A.5 Bedrock cost — APPROVED full original-prompt scope.**
      The bug is `costUsd: 0` returned from the Bedrock provider,
      making the daily and monthly ceilings inert on failover. Fix:
      same per-`model_id` pricing table, `aws_bedrock_premium_multiplier`
      field per model, use response token counts, no estimation
      fallback unless a count is genuinely missing.

- [x] **§5.b Neo4j-mirror-state migration — APPROVED.** Shape per
      §5.b above: one column `neo4j_mirror_state` with CHECK
      `('synced','pending','failed')` default `'pending'`, set to
      `synced` on successful Cypher write, `failed` after N retries
      (N configurable, default 3). Prometheus gauge
      `vigil_neo4j_mirror_state_total{state}`. Reconciliation
      logic out of scope (deferred to Neo4j retry queue track).

**Architect signature:** APPROVED 2026-05-01.

**Going-forward procedural rule.** When the agent hits hold-points
in a block, batch all clarifications into a single list and halt
once. Do not present hold-points incrementally. Record each
architect countersignature back into the relevant reconciliation
document.

**Implementation order (per architect 2026-05-01):**

1. §5.b migration (one commit) — Neo4j-mirror-state column + metric
2. Original A.3 finally-block emit (one commit)
3. Original A.6 worker-score dead query (one commit)
4. Original A.7 alias expression B-tree index (one commit)
5. Original A.9 source-count coherence lint (one commit)
6. Original A.4 Anthropic pricing table (one commit)
7. Original A.5 Bedrock cost accounting (one commit)

Stop after each commit if any test or lint fails. Otherwise proceed
to the next item without further architect input until Block A is
fully closed, at which point produce a Block A completion summary
and stop for review before opening Block B.

---

## 7. Block A — completion summary (2026-05-01)

All seven planned items in §6's implementation order shipped. The
branch `fix/blockA-worker-entity-postgres-write-and-rulepass` is
green on every workspace gate. **Halting for architect review
before opening Block B.**

### Commits

| #   | Item                            | Commit    |
| --- | ------------------------------- | --------- |
| 0   | Reconciliation counter-sign     | `df6d826` |
| A.3 | Neo4j-mirror-state column       | `3bc1250` |
| A.4 | finally-block emit fix          | `9236061` |
| A.5 | worker-score dead query + bound | `c3359b0` |
| A.6 | alias expression B-tree index   | `9afd186` |
| A.7 | source-count coherence lint     | `2e5d3da` |
| A.8 | Anthropic pricing table         | `9b4b274` |
| A.9 | Bedrock cost accounting         | `2db2271` |

(A.1 and A.2 landed earlier on the same branch as `bdfd850`; the
verification commits 5.c–5.f from the reconciliation pass landed as
`1bdfa64`.)

### Workspace gate state

- `pnpm exec turbo run build  --continue --force` → **39/39 green**
- `pnpm exec turbo run test   --continue --force` → **48/48 green**
- `pnpm exec turbo run lint   --continue --force` → **56/56 green**

### CI lints (phase-gate workflow)

- `scripts/check-llm-pricing.ts` → **PASS** (3 models, 3 defaults all priced)
- `scripts/check-source-count.ts` → **DRIFT (intended)**.
  Surfaces the pre-existing `infra/sources.json: 29` vs
  `TRUTH.md / SRD-v3.md: 26` gap. The lint exists to make this gap
  blocking; resolution is the architect's call per §2.A.9. Two
  options: (a) align the binding-doc phrasing to 29; (b) remove or
  disable 3 entries in `infra/sources.json`.

### Surfaced + landed (this block)

- **DB hot path correctness.** Postgres-first commit + atomic cluster
  write (A.1/A.2). worker-pattern can now read every fresh canonical
  it expects to.
- **Rule-pass policy.** Three-bucket classification (RCCM/NIU
  resolved, name-only candidates held, unresolved → LLM); name-only
  matches route to the review queue instead of auto-merging
  (verification 5.c).
- **Source-id discipline.** Sentinel `'unknown'` fallback removed;
  worker dead-letters with operator alert when `source_event_id` is
  absent (verification 5.d).
- **Neo4j-mirror visibility.** New `neo4j_mirror_state` column +
  `vigil_neo4j_mirror_state_total{state}` Prometheus gauge +
  paging/warning alerts. `Cypher.addAlias` MATCH→MERGE fixes the
  silent-no-op on missing Entity nodes (A.3).
- **Pattern-dispatch correctness.** worker-entity no longer publishes
  PATTERN_DETECT from a `finally` block with a hardcoded empty
  envelope; success-path only, per-canonical, with real id and
  source_event_id (A.4).
- **Score discipline.** worker-score filters backdated/future-timed
  signals (`contributed_at <= NOW()`); the dead `IN (...)` query is
  removed (A.5).
- **Rule-pass performance.** Expression B-tree index on the
  normalised display_name lookup. The previous trgm GIN index could
  not serve the rule-pass exact-equality query (A.6).
- **Source-count coherence.** New CI lint asserts the catalogue size
  matches across `infra/sources.json`, `TRUTH.md`, and SRD §10.2
  (A.7).
- **LLM pricing.** Pricing table moved to `infra/llm/pricing.json`,
  keyed by exact `model_id`. `LlmPricingNotConfiguredError` throws
  on missing entry — no silent zero-cost fallback. CI lint asserts
  every default model_id is priced (A.8).
- **Bedrock cost accounting.** Tier-1 failover no longer reports
  `costUsd: 0`. The pricing-table lookup applies the
  `aws_bedrock_premium_multiplier` so the daily/monthly ceilings
  stay live during failover (A.9).

### Held / deferred (out of Block A by architect-approved scope)

- pgvector — Phase-2 / new track.
- Neo4j-mirror reconcile worker (state column lands now; the
  background retry/reset worker is its own track).
- worker-pattern dispatch tier audit — Block C.
- adapter-runner robots.txt 7-window counter — DROPPED.
- dossier render byte-identity — Block D follow-up.

### Architect decisions still pending (do NOT block this block)

1. **Source-count canonical number.** Pick 29 (and update the binding
   docs) or pick 26 (and remove 3 entries from `infra/sources.json`).
   The lint will pass once one path is taken.

### Hand-off to Block B

When the architect signs the completion summary, the next step is
Block B (per the original Phase-1-completion prompt's structure,
not yet drafted in this branch). The agent will halt at this point
and await the architect's Block-B prompt.
