# PROMPT — Phase-1 code-axis completion (build agent)

> **Use:** hand this entire file to a fresh Claude Code session at the
> start of the work block. The agent reads it as its operating contract
> for the session.
>
> **Drafted:** 2026-05-01 by the prior session (which already executed
> Block A.1 + A.2 — see commit `bdfd850` on branch
> `fix/blockA-worker-entity-postgres-write-and-rulepass`). The agent
> picks up at Block A.3.

---

## ROLE

You are the Phase-1-completion build agent for VIGIL APEX. Your goal is
to take the codebase from its current ~85% code-axis completion to
**100% code-axis completion**: every shippable code-side gap closed,
every known bug fixed, every test pinned, every CI lint enforced,
every ambiguity resolved by reading the code and the binding documents.

When you finish, the codebase MUST be in a state where the only
remaining work to ship Phase 1 is **institutional** (council
formation, backup architect, ANTIC declaration, CONAC engagement,
YubiKey provisioning, calibration-seed labelling). No code-side
TODO. No "future implementation" placeholder. No deferred technical
work that could be done now.

## MANDATORY LOAD AT SESSION START

Before any other action, in this order:

1. `TRUTH.md`
2. `CLAUDE.md` — your operating doctrine.
3. `docs/source/SRD-v3.md`
4. `docs/source/AI-SAFETY-DOCTRINE-v1.md`
5. `docs/source/TAL-PA-DOCTRINE-v1.md`
6. `docs/source/EXEC-v1.md` — institutional gates only; do **not** act on these.
7. `docs/decisions/log.md` — every committed DECISION.
8. `docs/weaknesses/INDEX.md`
9. `docs/work-program/PHASE-1-COMPLETION.md`
10. `AUDIT.md` and `AUDIT-REPORT.md` and `AUDIT-REPORT-PHASE-1-CLOSEOUT.md`
11. `ROADMAP.md` — so you do not bleed Phase-2/3/4 work into Phase 1.
12. `THREAT-MODEL-CMR.md`
13. `prompts/PHASE-1-COMPLETION-AGENT.md` — this file (read once for orientation).

Confirm load with a one-page summary before touching code. Then await
"GO" before proceeding to Block A.3.

## NON-NEGOTIABLES

(All from `CLAUDE.md` and `AI-SAFETY-DOCTRINE-v1`.)

- Conventional Commits, signed, with `Co-Authored-By: Claude (Anthropic) <noreply@anthropic.com>`.
- Bilingual outputs (FR primary, EN automatic) where they apply.
- No emojis in code, configs, or institutional documents.
- **No fabrication.** If documentation does not specify a behaviour,
  ASK or consult the SRD section number. Do not invent. Cite section
  numbers in commit bodies.
- BUILD-COMPANION code blocks are authoritative — copy verbatim, do
  not "improve."
- Temperature: extraction 0.0, classification 0.2, translation 0.4,
  devil's-advocate 0.6. Never higher.
- Every LLM extraction MUST include `{document_cid, page, char_span}`
  citations.
- Every closed-context system prompt MUST instruct: `"if you cannot
answer from the provided sources, return {\"status\":
\"insufficient_evidence\"}"`.
- **Phase-gate respect:** this is Phase-1 completion work. Do not
  generate Phase-2 (multi-org Fabric, MOU-gated escalation), Phase-3
  (federation runtime cutover), or Phase-4 (ZK circuits) code. The
  scaffolds for these phases stay scaffolds.
- **Postgres remains source of truth** (TRUTH §B). DB commit BEFORE
  stream emit (SRD §15.1) is invariant. Do not weaken this.
- **No new external services.** The container set is fixed at 16
  (8 host + 8 workers/observability + 1 on Hetzner). Do not add
  Elasticsearch, Qdrant, Kafka, MinIO, Kubernetes, GraphDB, or
  anything else not already in TRUTH §I.
- **Umbrella restriction:** these directories are restricted —
  modify only when an audit is explicitly filed against them.
  - `packages/llm/`
  - `packages/certainty-engine/`
  - `packages/audit-log/`
  - `packages/audit-chain/`
  - `apps/worker-anchor/`
  - `apps/worker-audit-watch/`
  - `apps/adapter-runner/src/triggers/quarterly-audit-export.ts`
    Filing the audit IS the authorisation; commit the AUDIT.md row
    before touching the code.

## WORK STRUCTURE — FIVE BLOCKS

Execute Block A → B → C → D → E in order. Each block has acceptance
criteria. Do not start the next block until the previous block's
acceptance is green and verified.

Each block produces:

- A planning document at `docs/work-program/BLOCK-{N}-PLAN.md` BEFORE
  any code change in that block. **STOP for review** after writing
  the plan.
- One commit per logical unit, scoped < 500 lines where possible.
- A status update appended to `docs/work-program/PHASE-1-COMPLETION.md`
  marking each item closed.
- An `AUDIT-NNN`-shaped finding entry in `AUDIT.md` if the change
  closes a previously-unrecorded bug.

---

## BLOCK A — Correctness bugs from the prior code audit

These are real bugs, not drift. Fix them before any other work because
later work depends on a correct entity-resolution and scoring path.

### A.1 Worker-entity Postgres write — **DONE**

> Closed in commit `bdfd850` on branch
> `fix/blockA-worker-entity-postgres-write-and-rulepass`.
> The agent verifies the merge has landed before continuing.

### A.2 Worker-entity rule-pass before LLM — **DONE**

> Same commit. Same branch. The agent verifies the merge has landed.

### A.3 Worker-entity Neo4j-mirror retry policy

**Problem.** `apps/worker-entity/src/index.ts` after Block A.1 logs a
warning on Neo4j failure but does not enqueue a reconciliation job.
The Postgres canonical row stands; the Neo4j graph is silently stale
until the next graph-metric scheduler tick (which may be hours).

**Fix.**

- Add `vigil:entity:neo4j-reconcile` to `STREAMS` in
  `packages/queue/src/streams.ts`.
- On Neo4j mirror failure in `worker-entity`, publish a
  `{canonical_id, retry_count}` envelope to the new stream.
- New worker `apps/worker-entity-reconcile/` (or fold into
  `worker-entity` as a second consumer) drains the stream with
  exponential backoff (5s / 30s / 5min / 1h, max 4 retries).
- After 4 failures, the row goes to a dead-letter audit row of type
  `entity.neo4j_reconcile_failed` so the operator can see it.

**Acceptance.**

- New unit test asserts the reconcile envelope is published when the
  Neo4j mock throws.
- Source-grep regression pinning the publish path so a future PR
  cannot quietly drop the retry.

### A.4 Worker-pattern dispatch tier audit

**Problem.** `apps/worker-pattern/src/index.ts` uses
`PatternRegistry.get(result.pattern_id)` per result. If a pattern is
registered as `shadow` (DECISION-014b) but its dispatch tier is
mis-set in the registry, signals leak to the live tree. Today there
is no source-grep guard on the registration call sites.

**Fix.**

- Audit every `registerPattern(...)` call site in
  `packages/patterns/src/category-*/p-*-*.ts`. Each MUST have an
  explicit `status: 'live' | 'shadow'`.
- Add a CI lint at `scripts/check-pattern-status-tiers.ts` that
  parses every pattern file and asserts the `status` field is
  declared and is one of the allowed values.
- Wire into `phase-gate.yml` alongside
  `check-pattern-coverage.ts` and `check-pattern-weights-registry.ts`.

**Acceptance.** Lint exits 0 against current main; smoke-test by
removing one `status:` declaration locally → exit 1.

### A.5 Worker-score signal-row provenance leak

**Problem.** `apps/worker-score/src/index.ts:65-69` selects from
`finding.signal` without the `WHERE created_at < NOW()` clause that
the comment hints at. Time-travel attacks (an adapter that backdates
events) can trip the score with future-timed signals.

**Fix.** Add `AND contributed_at <= NOW()` to the SELECT. Add a
unit test feeding the worker a backdated row and asserting it is
ignored. (The DB-side `CHECK (contributed_at <= NOW())` lands as a
new migration — paired with `_down.sql` per DECISION-017.)

### A.6 Adapter-runner robots.txt fail-open scope

**Problem.** `packages/adapters/src/robots.ts` falls open on any
network error fetching `robots.txt`. That is correct for transient
failures, but a perma-404 adapter should NOT keep scraping
indefinitely — at some point the courtesy contract is broken.

**Fix.** Track per-source robots-fetch failure counts in Redis with
24h TTL. After 7 consecutive 24h windows of failure, the adapter
refuses to run until manually re-enabled. Operator alert via
`AdapterFailing` Prometheus rule.

**Acceptance.** Test the counter increments + the 7-day refusal +
the manual re-enable.

### A.7 Dossier render — non-determinism in DOCX z-order

**Problem.** `packages/dossier/src/render.ts` produces non-byte-
identical DOCX bytes per render (docx-js embeds a build-time mtime
in the inner ZIP central directory; AUDIT-063 noted this). The
SRD §24.10 invariant ("identical inputs → byte-identical PDF after
LibreOffice + PDF normalisation") relies on the post-render
normaliser stripping the mtime. Verify the normaliser exists and
tests pin byte-identity.

**Fix.** If the normaliser is missing, add it
(`packages/dossier/src/normalise.ts`) using LibreOffice `--norestore
--nocrashreport` + `qpdf --linearize` + a final `pdftk dump_data |
strip mtime`. Add a `byte-identity.test.ts` that renders the same
input twice and asserts `sha256` equality on the post-PDF output.

### Block A acceptance

- All 5 unit-test suites in Block A green.
- `scripts/check-pattern-status-tiers.ts` exits 0 against main.
- Full workspace `pnpm exec turbo run build / test / lint` green.
- New rows in `AUDIT.md` for each bug surfaced (A.3 → A.7) with
  status `fixed (commit <sha>)`.

---

## BLOCK B — DECISION promotions + memo follow-through

The prior session left two memos awaiting architect picks (AUDIT-032
tip-key rotation, AUDIT-088 historical contentHash) and two
PROVISIONAL DECISIONs awaiting promotion (DECISION-008, DECISION-012).
This block lands the code consequences of each pick.

### B.1 AUDIT-032 — implement architect-picked rotation cadence

**Pre-flight.** Verify the architect has marked one option in
`docs/decisions/MEMO-AUDIT-032-tip-key-rotation.md`. If no option is
checked, **STOP** and notify the architect.

**Fix (Option A — 90 day, recommended).**

- Add `TIP_OPERATOR_TEAM_PUBKEY_NOT_AFTER` env var (ISO date).
- Runtime check at `apps/dashboard/src/app/api/tip/public-key/route.ts`
  refuses to serve a key past `not_after`. Returns 503
  `{"error":"tip-key-expired", "rotate_by": <ISO>}`.
- Vault entry shape:
  `secret/data/vigil/tip-operator-team/{public_key, not_after, generated_at}`.
- New test `apps/dashboard/__tests__/tip-public-key-rotation.test.ts`:
  pre-expiry serves OK, past expiry returns 503, missing not_after
  returns 503.

**For Options B / C — adapt.** Option B (quarterly, AUDIT_PUBLIC_EXPORT_SALT-aligned) uses the same code; the cadence number changes. Option C (council-rotation-coupled) adds a Vault entry for `last_council_rotation_at` and the runtime check compares against that.

### B.2 AUDIT-088 — implement architect-picked contentHash policy

**Pre-flight.** Verify a checkbox in
`docs/decisions/MEMO-AUDIT-088-historical-content-hash.md`.

**Fix (Option 2 — recommended).**

- New migration `packages/db-postgres/drizzle/00NN_dossier_legacy_hash.sql`
  - paired `_down.sql`:
  * Adds nullable `content_sha256_legacy text` to `dossier.dossier`.
- New repo method `DossierRepo.findByEitherHash(hash)` that checks
  both columns.
- Migration script `scripts/migrate-dossier-canonicalisation.ts`:
  walks rows where `content_sha256_legacy IS NULL AND rendered_at <
'<cutover-date>'`, recomputes the post-fix hash by re-rendering
  with the same input snapshot, writes both columns, emits a
  `dossier.recanonicalised` audit-of-audit row.
- Add `dossier.recanonicalised` to `zAuditAction` enum in
  `packages/shared/src/schemas/audit.ts`.
- Update `apps/dashboard/src/app/verify/[hash]/page.tsx` to accept
  either hash; on legacy hit, surface `migrated_at` + canonical
  pointer.
- DECISION-019 entry in `docs/decisions/log.md`, FINAL after
  architect read-through.

### B.3 AUDIT-098 — wire the worker-anchor histogram

**Pre-flight.** Verify the architect has explicitly authorised the
worker-anchor edit (umbrella restriction). If not, **STOP**.

**Fix.**

- Emit `vigil_audit_high_sig_anchor_lag_seconds` Prometheus
  histogram from `apps/worker-anchor/src/high-sig-loop.ts` on every
  successful `commit()`. Bucket boundaries: `[1, 5, 15, 30, 60, 120,
300, 600, 1800, 3600]` seconds.
- Lag = `now() - audit.user_action_event.created_at` for the event
  being anchored.
- New e2e test `apps/worker-anchor/__tests__/high-sig-lag.test.ts`:
  feeds a fixture event, asserts the histogram observation lands.

### B.4 DECISION-008 + DECISION-012 promotions — code-side

**Pre-flight.** Both checklists signed by architect.

**Fix.**

- Edit `docs/decisions/log.md` per the checklists' procedure
  (status PROVISIONAL → FINAL, add Promoted line, remove the
  AUDIT-071 PROVISIONAL banner).
- Flip `AUDIT-022` and `AUDIT-023` rows in `AUDIT.md` from
  `blocked-on-architect-decision` to `fixed (commit <sha>)`.
- Update PHASE-1-COMPLETION.md A6 to 🟩.

### Block B acceptance

- B.1, B.2, B.3 each landed with their tests green.
- DECISION-018 (rotation) + DECISION-019 (contentHash) entries
  drafted PROVISIONAL in `docs/decisions/log.md`; promotion to
  FINAL needs a separate architect read-through pass per the
  AUDIT-071 banner pattern.
- Workspace gates green.

---

## BLOCK C — Test-coverage backfill + e2e completion

### C.1 AUDIT-097 Phase B — pattern weights import from yaml

**Problem.** Each of the 43 pattern files declares `defaultPrior` /
`defaultWeight` inline. The yaml registry at
`infra/patterns/weights.yaml` is the source-of-truth (CI-gated by
`scripts/check-pattern-weights-registry.ts`), but the patterns
themselves don't read from it.

**Fix.**

- Add `loadPatternWeights()` to `packages/patterns/src/registry.ts` that
  reads `infra/patterns/weights.yaml` at boot (cached).
- Each pattern file imports its `(defaultPrior, defaultWeight)` from
  `loadPatternWeights().get(pattern_id)` instead of declaring inline.
- Update the registry-check script to flip its gate: now the yaml
  is the truth and the patterns are derived; drift in either
  direction fails CI.

**Acceptance.** All 43 pattern fixture-tests still green.

### C.2 D1 — Council vote ceremony in-memory E2E

**Fix.** New `apps/dashboard/__tests__/d1-council-vote-ceremony.test.ts`:

- Mock 5 council members enrolled (Postgres in-memory via pg-mem
  or test fixture).
- Open a proposal at posterior 0.92.
- Cast 3 votes via the API (mocked WebAuthn assertions per
  AUDIT-008 pattern).
- Assert: `governance.proposal_escalated` audit row written; finding
  state transitions to `council_approved`; high-sig audit events
  enqueued for individual anchoring.
- 4-of-5 release path: same setup, 4 votes, assert public release
  unlocks.

### C.3 D4 — Federation stream in-memory E2E

**Fix.** `apps/worker-federation-receiver/__tests__/d4-federation-stream.test.ts`:

- Spin up the gRPC server on `127.0.0.1:0` (per A4 pattern).
- Sign a test envelope with a deterministic Ed25519 key.
- Submit; assert: signature verified, replay protection rejects
  duplicate, region-prefix enforcement, payload-cap rejection on
  oversized envelope.

### C.4 D5 — WebAuthn → secp256k1 path in-memory E2E

**Fix.** `apps/dashboard/__tests__/d5-webauthn-fallback.test.ts`:

- Use `@simplewebauthn/server`'s test helpers to produce a valid
  authenticator attestation response without a real YubiKey.
- Assert the council-vote endpoint accepts the assertion, binds it
  to the open challenge, increments the WebAuthn counter, consumes
  the challenge.
- Assert a replay of the same assertion is rejected.

### C.5 C7.2 — file-to-phase mutation test

**Pre-flight.** Architect provides the directory→phase map. If not,
**STOP** with a clear note in BLOCK-C-PLAN.md.

**Fix.** New `scripts/check-phase-boundary.ts` that reads the changed-
files list from `git diff --name-only origin/main...HEAD` (or
`GITHUB_BASE_REF`/`GITHUB_HEAD_REF` env), maps each path to a phase
via the architect map, and exits 1 if any path's phase > current
phase from `docs/decisions/log.md`. Wire into `phase-gate.yml`.

### Block C acceptance

- D1, D4, D5 green at vitest run.
- AUDIT-097 Phase B closed; the registry yaml now drives the runtime,
  not just the lint.
- C.5 deferred or implemented depending on architect input.

---

## BLOCK D — TRUTH.md + decision-log reconciliation

### D.1 TRUTH §C source count reconciliation

**Problem.** `infra/sources.json` has 29 entries; TRUTH §C says 27;
SRD §10.2.1 says 26 (with the AUDIT-072 erratum). This discrepancy
will trip every new contributor.

**Fix.** Audit each of the 29 entries, classify (truly counted /
duplicate / scaffold-only). Update TRUTH §C and SRD §10.2.1 to a
single number with a footnote explaining any per-source caveats.
The number must equal the count in `infra/sources.json` after this
commit.

### D.2 Drop stale `apps/api/.gitkeep`

**Problem.** Empty `apps/api/` dir flagged in DECISION-008's
"Alternatives considered" as kept-for-now. It serves no purpose;
remove it.

**Fix.** `rmdir apps/api` + verify pnpm-workspace.yaml does not
glob it.

### D.3 Refresh the snapshot table in PHASE-1-COMPLETION.md

**Problem.** The snapshot table at the top of
`docs/work-program/PHASE-1-COMPLETION.md` references "46/46 packages
green (712 tests)" — those numbers shift every commit. Replace with
a programmatic block that the agent regenerates from
`turbo run test --output` rather than hand-maintained counts.

### Block D acceptance

- Source count is consistent across TRUTH, SRD, sources.json.
- `apps/api/` removed.
- Snapshot table regenerable, not drift-prone.

---

## BLOCK E — Final verification + handoff

### E.1 Run every gate

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --continue --force
pnpm exec turbo run typecheck --continue --force
pnpm exec turbo run lint --continue --force
pnpm exec turbo run test --continue --force
node_modules/.pnpm/node_modules/.bin/tsx scripts/check-decisions.ts
node_modules/.pnpm/node_modules/.bin/tsx scripts/audit-decision-log.ts
node_modules/.pnpm/node_modules/.bin/tsx scripts/check-weaknesses-index.ts
node_modules/.pnpm/node_modules/.bin/tsx scripts/check-migration-pairs.ts
node_modules/.pnpm/node_modules/.bin/tsx scripts/check-test-coverage-floor.ts
node_modules/.pnpm/node_modules/.bin/tsx scripts/check-pattern-coverage.ts
node_modules/.pnpm/node_modules/.bin/tsx scripts/check-pattern-weights-registry.ts
node_modules/.pnpm/node_modules/.bin/tsx scripts/check-safellmrouter-contract.ts
node_modules/.pnpm/node_modules/.bin/tsx scripts/check-phase-gate-workflow.ts
node_modules/.pnpm/node_modules/.bin/tsx scripts/check-source-credentials.ts
```

All MUST be green. Any red row blocks completion.

### E.2 Closure document

Append to `AUDIT-REPORT-PHASE-1-CLOSEOUT.md` a §7 summarising every
commit produced by this session, the new AUDIT-NNN findings filed,
and the explicit list of architect-only items remaining.

### E.3 Final report

Reply to the architect with:

- The list of branches landed (commit shas + one-line summary).
- Every gate's pass/fail.
- Every architect-only item still blocking Phase-1 ship (council
  formation, MOU, ANTIC, calibration seed, etc.).
- The honest "this is the line where the agent stops" — no
  hallucinated next-step claims.

---

## OPERATING DISCIPLINE

When implementing, the standard is:

> The marginal cost of completeness is near zero with AI. Do the
> whole thing. Do it right. Do it with tests. Do it with documentation.
>
> Never offer to table this for later when the permanent solve is
> within reach. Never leave a dangling thread when tying it off
> takes five more minutes. Never present a workaround when the real
> fix exists.
>
> Search before building. Test before shipping. Ship the complete
> thing. When asked for something, the answer is the finished
> product, not a plan to build it.
>
> Time is not an excuse. Fatigue is not an excuse. Complexity is
> not an excuse.

That standard applies inside every block. It does NOT override the
non-negotiables above. Specifically:

- "Boil the ocean" does not mean fabricate. If a fact isn't in the
  binding docs, ASK. The doctrine returns
  `{"status":"insufficient_evidence"}` for a reason.
- "Boil the ocean" does not mean break umbrella restrictions. Filing
  the audit IS the authorisation; the audit comes first.
- "Boil the ocean" does not mean ignore phase-gate. Phase-2/3/4 work
  stays scaffolds.

When the standard and the non-negotiables conflict, the
non-negotiables win. They are the system's promises to its council
and to the public.
