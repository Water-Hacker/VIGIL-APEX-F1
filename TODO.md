> Autonomous agent execution plan for the residual gaps after the 90-mode
> hardening pass + the tier-1-to-4 deep audit pass + the tier-52-to-68
> autonomous sweep all closed.
>
> **Posture**: every task here is closeable by the build agent without
> architect input. Architect-blocked items are tracked under
> [docs/work-program/PHASE-1-COMPLETION.md](docs/work-program/PHASE-1-COMPLETION.md)
> Track F and are explicitly excluded from this list.
>
> **Ground rules** (binding for every task below):
>
> - No fabrication — every claim in a fix, test, or doc must be verified
>   against actual code before committing.
> - Every fix that closes a behavioural gap ships with a test that would
>   have caught the gap.
> - No `--no-verify`; no `--no-gpg-sign`; no destructive git ops without
>   explicit architect approval.
> - Prefer editing existing files to creating new ones.
> - No new runtime dependencies without a one-line justification in the
>   commit message.
> - All commits use Conventional Commits + the `Co-Authored-By: Claude
Opus 4.7 (1M context)` trailer.
> - Search before building. If a helper exists, use it. If a similar
>   pattern exists nearby, match it (style, naming, error shape).
> - At the end of each task, run `pnpm -w turbo run typecheck lint test`
>   for the touched workspace. Do not move on if any of the three is red.
>
> **State after this TODO.md is fully executed**: a single commit
> ready for architect review on a new branch `hardening/todo-md-sweep`,
> with each task as its own commit. Full repo passes
> `turbo run typecheck lint test` 60/60.

---

# TODO.md — Residual gap-closure sweep (2026-05-17)

## Snapshot of state on entry

- Branch: `hardening/tier-1-to-4-deep-audit` (clean, in sync with main)
- `turbo run typecheck`: 60/60 ✓
- `turbo run lint --max-warnings=0`: 60/60 ✓
- `turbo run test`: 58/58 ✓
- Hardening 90-mode pass: 82 CV + 6 N/A-Closed + 2 Code-CV-Ceremony-Pending = 90/90 at code layer
- Weaknesses: 18/27 🟩; 2 🟧 in progress; 5 🟦 architect-blocked; 1 ⬛ deferred (W-16, M2 exit); 0 🟥 unresolved
- Phase-1-completion Track A–E: all 🟩 closed except D7 (🟡 visual regression PARTIAL — baseline-stamp deferred to architect)

The codebase is structurally complete for Phase-1 acceptance gates. The
items below are _quality and consistency_ deltas that the agent can
close to leave the repo in a near-perfect state for architect review.

---

## Task index

| ID  | Title                                                                   | Effort | Branch                   |
| --- | ----------------------------------------------------------------------- | ------ | ------------------------ |
| T1  | Graduate 7 stale `LEGACY_ZERO_TEST` allowlist entries                   | 10 min | included in sweep branch |
| T2  | Add worker-counter-evidence test suite                                  | 1–2 h  | included in sweep branch |
| T3  | Add worker-dossier test suite                                           | 1–2 h  | included in sweep branch |
| T4  | Flip W-14 from 🟧 to 🟩 (corpus already at 224 rows)                    | 5 min  | included in sweep branch |
| T5  | Write `packages/audit-chain/src/scripts/recompute-body-hash.ts` + tests | 45 min | included in sweep branch |
| T6  | Add tests for `packages/llm/src/guards.ts` (L1/L2/L3)                   | 1 h    | included in sweep branch |
| T7  | Add tests for `packages/db-postgres/src/repos/entity.ts`                | 45 min | included in sweep branch |
| T8  | Targeted worker behavioural tests (caps, MTLS, vote-ceremony)           | 1.5 h  | included in sweep branch |
| T9  | Write 4 missing runbooks                                                | 45 min | included in sweep branch |
| T10 | Re-baseline INDEX.md + PHASE-1-COMPLETION.md dates                      | 10 min | included in sweep branch |
| T11 | Helm chart expansion (24 missing service templates)                     | 3–4 h  | included in sweep branch |
| T12 | Final repo-wide typecheck + lint + test + handoff note                  | 15 min | included in sweep branch |

Total estimated effort: ~10–12 hours of agent time.

---

## T1 — Graduate stale `LEGACY_ZERO_TEST` allowlist entries

**Failure mode**: [scripts/check-test-coverage-floor.ts](scripts/check-test-coverage-floor.ts)
allowlist contains 9 workers that were zero-test as of 2026-05-01.
Today 7 of those 9 have test files. The allowlist's contract is
_monotonic shrink only_; a worker that has graduated must be removed
so that a future regression (someone deleting their tests) trips CI.

**Verified state** (2026-05-17):

| Worker                    | Test files      | Action          |
| ------------------------- | --------------- | --------------- |
| `audit-verifier`          | 2               | remove          |
| `worker-audit-watch`      | 1               | remove          |
| `worker-conac-sftp`       | 1               | remove          |
| `worker-entity`           | 2               | remove          |
| `worker-governance`       | 2               | remove          |
| `worker-minfi-api`        | 1               | remove          |
| `worker-tip-triage`       | 3               | remove          |
| `worker-counter-evidence` | 0 → fixed by T2 | remove after T2 |
| `worker-dossier`          | 0 → fixed by T3 | remove after T3 |

**Acceptance criteria**:

- 7 entries deleted from `LEGACY_ZERO_TEST` in T1 commit.
- The two `0`-test workers (`worker-counter-evidence`, `worker-dossier`)
  are removed in the T2/T3 commits respectively (NOT in T1, so the
  allowlist stays a working bandaid until those tests land).
- After T1+T2+T3, `LEGACY_ZERO_TEST = new Set([])` AND the
  doc-comment header is updated to reflect 2026-05-17 graduation.
- Run `pnpm tsx scripts/check-test-coverage-floor.ts` — exit 0.

**Files touched**: `scripts/check-test-coverage-floor.ts`.

---

## T2 — Worker-counter-evidence test suite

**Failure mode**: 373 LOC of devil's-advocate adversarial-pipeline code
([apps/worker-counter-evidence/src/index.ts](apps/worker-counter-evidence/src/index.ts))
with zero tests. The worker downgrades scoring tier on LLM failure
(line ~176–221) and rejects on unregistered adversarial prompts
(~line 335) — both behaviours are silent until something breaks in
production.

**Tests to write** (`apps/worker-counter-evidence/__tests__/devils-advocate.test.ts`):

1. **`handle() routes through SafeLlmRouter with the registered prompt name`**
   — instantiate the worker with a mocked `SafeLlmRouterLike` adapter
   (mirrors the `apps/worker-extractor/src/llm-extractor.ts` pattern);
   call `handle({ payload: { assessment_id: 'a-1' } })`; assert
   `safe.call({ promptName: 'counter-evidence.devils-advocate-narrative', … })`
   was invoked exactly once.
2. **`handle() degrades tier + adds 'adversarial_pipeline_failed' hold
reason on LLM error`** — make the mock throw a tagged
   `LlmCallError`; assert the worker writes `tier: 'low'` and an
   `adversarial_pipeline_failed` hold-reason row to the mock
   FindingRepo.
3. **`handle() skips the adversarial pipeline when assessment_id is
missing`** — payload without `assessment_id` → no `safe.call`; no
   tier downgrade; structured log `skip_reason: 'no_assessment_id'`.
4. **`main() refuses to boot if adversarial prompts are not registered`**
   — temporarily clear the `Safety.adversarialPromptsRegistered()`
   registry; assert `main()` throws with a clear error naming the
   missing prompt. (Source: [apps/worker-counter-evidence/src/index.ts:335](apps/worker-counter-evidence/src/index.ts#L335).)

**Acceptance criteria**:

- 4 tests added; all pass.
- File added to coverage allowlist removal as part of T1.
- `pnpm --filter worker-counter-evidence run test` reports `Test Files
1 passed (1)`, `4 tests passed`.

**Files touched**:

- new: `apps/worker-counter-evidence/__tests__/devils-advocate.test.ts`
- new: `apps/worker-counter-evidence/__tests__/llm-fake.ts` (mirrors
  `apps/worker-extractor/__tests__/llm-fake.ts` if it exists; otherwise
  introduce the pattern minimally)
- new (maybe): `apps/worker-counter-evidence/vitest.config.ts` if not present
- modify: `apps/worker-counter-evidence/package.json` (add `test`
  script if missing, `vitest` devDep)

---

## T3 — Worker-dossier test suite

**Failure mode**: 433 LOC of dossier-rendering code
([apps/worker-dossier/src/index.ts](apps/worker-dossier/src/index.ts))
with zero tests. Tier-58 audit closure (commit `e76a756`) already
added defence-in-depth: render-loop cleanup, size cap, soffice stderr
capture. Those guards exist but are untested — if a future refactor
breaks them, nothing catches it.

**Tests to write** (`apps/worker-dossier/__tests__/render-guards.test.ts`):

1. **`runLibreOffice() rejects when stdout exceeds STDERR_CAP_BYTES`**
   — call with a mocked exec that emits > 4 KiB of stderr; assert
   the captured stderr is truncated to the cap; assert the truncation
   marker (`…stderr-truncated…` or similar) is appended.
2. **`runLibreOffice() kills the process when LIBREOFFICE_TIMEOUT_MS
elapses`** — use vitest fake timers; mock exec to hang; advance
   timers past the timeout; assert `child.kill('SIGKILL')` was called
   AND the function rejects with a TimeoutError naming the timeout.
3. **`handle() rejects PDFs exceeding 50 MiB`** — call with a mocked
   IPFS pin that returns a > 50 MiB buffer; assert handler throws
   `DossierTooLargeError` (or equivalent — check the actual code
   for the name) and writes no DB row.
4. **`handle() cleans tmpdir on success AND on failure`** — parameterise
   over (a) success path, (b) LibreOffice-failure path; assert
   `fs.rm(tmpdir, { recursive: true, force: true })` is called in
   both, via a finally block. Source: tier-58 closure.
5. **`handle() refuses dev-unsigned signatures in production`** —
   mock GPG signer to return `signature_fingerprint: 'DEV-UNSIGNED-…'`;
   set `NODE_ENV=production`; assert handler throws.

**Acceptance criteria**:

- 5 tests added; all pass.
- File added to coverage allowlist removal in T1 (after T3 lands).
- `pnpm --filter worker-dossier run test` reports `Test Files 1
passed (1)`, `5 tests passed`.

**Files touched**:

- new: `apps/worker-dossier/__tests__/render-guards.test.ts`
- modify: `apps/worker-dossier/package.json` (test script + vitest dep
  if not present)
- new (maybe): `apps/worker-dossier/vitest.config.ts`

---

## T4 — Flip W-14 from 🟧 to 🟩 in `docs/weaknesses/INDEX.md`

**Failure mode**: [docs/weaknesses/INDEX.md:25](docs/weaknesses/INDEX.md#L25)
says `🟧 12-layer guards live; corpus expanded 7→40 rows; … Per-pattern
expansion ongoing toward 200-row target.`
[packages/llm/**tests**/synthetic-hallucinations.jsonl](packages/llm/__tests__/synthetic-hallucinations.jsonl)
has **224 rows** (verified `wc -l`), surpassing the 200-row target.
PHASE-1-COMPLETION.md §A1 already says 🟩 ("surpasses target — closed
during a prior pass"); the INDEX is stale.

**Acceptance criteria**:

- W-14 row in INDEX.md flips `🟧` → `🟩`; status text replaced with
  `corpus at 224 rows (target 200); 12-layer guards live; per-pattern
expansion can continue post-MVP`.
- Severity tally updated: `🟧 in progress: 2` → `1` (W-10 still 🟧 — the
  native libykcs11 helper remains deferred to M3-M4 per W-10.md).
- `🟩 committed: 18` → `19`.
- `Last reconciled: 2026-04-28` → `Last reconciled: 2026-05-17 (W-14
graduation confirmed against 224-row corpus)`.
- Run `pnpm tsx scripts/check-weaknesses-index.ts` — exit 0.

**Files touched**: `docs/weaknesses/INDEX.md`, `docs/weaknesses/W-14.md`
(append a "Closed" line at the bottom for traceability).

---

## T5 — Write `packages/audit-chain/src/scripts/recompute-body-hash.ts`

**Failure mode**: [docs/audit/evidence/hardening/category-3/mode-3.4/CLOSURE.md](docs/audit/evidence/hardening/category-3/mode-3.4/CLOSURE.md)
honest-flagged that the divergence-response runbook
(`docs/runbooks/audit-chain-divergence.md`) step 3 references a
truth-test tool `recompute-body-hash.ts` that does not exist yet. An
operator following the runbook hits "file not found." The mode 3.4
closure punted this to follow-up; this is the follow-up.

**What the script does**: takes a `seq` argument (or a range), reads
the corresponding payload row from `audit.actions`, calls the existing
`hashRow` helper in `packages/audit-chain/src/canonical.ts` (or
`hash-chain.ts` — confirm by reading the file), prints the recomputed
hash next to the on-disk `body_hash`, and exits non-zero on mismatch.

**Acceptance criteria**:

- New file: `packages/audit-chain/src/scripts/recompute-body-hash.ts`
- Pure helpers exposed for testing (`recomputeForRow(row): string`).
- CLI shim at the bottom (`if (import.meta.url === ...)`) reads
  `process.argv` and connects to Postgres via `DATABASE_URL` (or
  errors loudly if absent).
- Honors a `--from N --to M` range; prints one line per seq:
  `seq=NNN db_hash=… recomputed=… status=match|MISMATCH`.
- Exits 0 if every row matches; 2 if any row mismatches (mirrors the
  exit-code convention of `apps/audit-verifier/src/cross-witness-cli.ts`).
- New test file: `packages/audit-chain/test/recompute-body-hash.test.ts`
  with 3 cases: (a) recomputed equals stored hash for a known fixture;
  (b) helper detects a tampered byte; (c) range walker handles empty
  range gracefully.
- `docs/runbooks/audit-chain-divergence.md` step 3 is updated to
  reference the actual `pnpm` invocation (e.g. `pnpm --filter
@vigil/audit-chain exec tsx src/scripts/recompute-body-hash.ts
--from 1234 --to 1234`).
- The mode 3.4 CLOSURE.md "What this closure does NOT include" §
  is updated to mark the recompute-body-hash gap as closed (add a
  `closed by T5 on 2026-05-17` line).

**Files touched**:

- new: `packages/audit-chain/src/scripts/recompute-body-hash.ts`
- new: `packages/audit-chain/test/recompute-body-hash.test.ts`
- modify: `docs/runbooks/audit-chain-divergence.md`
- modify: `docs/audit/evidence/hardening/category-3/mode-3.4/CLOSURE.md`

---

## T6 — Tests for `packages/llm/src/guards.ts`

**Failure mode**: [packages/llm/src/guards.ts](packages/llm/src/guards.ts)
implements the L1 (schema-compliance), L2 (citation-required), and L3
(CID-in-context) hallucination guards from AI-SAFETY-DOCTRINE-v1. These
are part of the doctrine chokepoint — if they regress silently,
every SafeLlmRouter call ships with broken safety. The file currently
has zero direct tests (other guards are exercised through
`packages/llm/__tests__/synthetic-hallucinations.jsonl` end-to-end,
but the per-function contract is uncovered).

**Tests to write** (`packages/llm/test/guards.test.ts`):

1. **`l1SchemaCompliance` rejects responses with unknown keys against the
   declared `response_schema`**. Stretch case: an additional sentinel key
   the schema does not declare → reject. Acceptance: assertion includes
   the unknown key name in the error.
2. **`l1SchemaCompliance` accepts a response that exactly matches the
   schema** (happy path).
3. **`l2CitationRequired` flags a cite-required prompt with zero
   `citations[]` entries**. Reason field non-empty.
4. **`l2CitationRequired` accepts a response with the minimum required
   `n` citations**.
5. **`l3CidInContext` rejects a `document_cids[]` member whose CID does
   not appear in the closed-context `sources[].cid`**.
6. **`l3CidInContext` rejects a malformed CID string (does not parse as
   CIDv1)** — defence-in-depth.
7. **`l3CidInContext` accepts a valid in-context CID** (happy path).

Match the import shape of `packages/llm/src/safety/canary.test.ts` if
present; otherwise mirror `packages/llm/test/cost-tracker.test.ts`.

**Acceptance criteria**:

- 7 tests in one new file; all pass.
- No edits to `guards.ts` (these are pure characterisation tests).
- `pnpm --filter @vigil/llm run test` reports the new file in the
  list of test files.

**Files touched**: `packages/llm/test/guards.test.ts`.

---

## T7 — Tests for `packages/db-postgres/src/repos/entity.ts`

**Failure mode**: 442 LOC of entity-resolution code with zero tests.
The exported `normalizeName` function feeds every entity-merge decision
in the system (`packages/db-postgres/src/repos/entity.ts`); a silent
regression here would cause silent identity-merging bugs. The bulk
ID cap (`ENTITY_REPO_MAX_BULK_IDS = ?` near line 13) is a recent
hardening addition without a test.

**Tests to write** (`packages/db-postgres/test/entity-repo.test.ts`):

1. **`normalizeName` strips diacritics**: `'café'` → `'cafe'`,
   `'Société Générale'` → `'societe generale'`.
2. **`normalizeName` case-folds and collapses whitespace**:
   `'  Ministry  of  Finance '` → `'ministry of finance'`.
3. **`normalizeName` is idempotent**: `normalize(normalize(s))` ===
   `normalize(s)` over a 5-case table.
4. **`normalizeName` handles empty string + whitespace-only without
   throwing**.
5. **`EntityRepo.upsertCluster` rejects bulk IDs array exceeding
   `ENTITY_REPO_MAX_BULK_IDS`** — mocked PG client; assert the call
   never reaches `db.query`. (Source: line ~13 constant.)
6. **`EntityRepo.upsertCluster` accepts the maximum allowed size** —
   bounds-check both sides of the cap.

If `normalizeName` is not actually exported, look for the
de-facto-equivalent helper (e.g. `canonicalize`, `slugifyEntity`) and
test that instead. **Verify which function is exported before writing
the test** — do not fabricate a public surface.

**Acceptance criteria**:

- File `packages/db-postgres/test/entity-repo.test.ts` added.
- 6 tests pass under `pnpm --filter @vigil/db-postgres run test`.
- The unit tests do NOT require a real Postgres (mock the client).

**Files touched**: `packages/db-postgres/test/entity-repo.test.ts`.

---

## T8 — Targeted worker behavioural tests

**Failure mode**: several recent hardening commits added behavioural
guards that aren't covered by their own tests. Each is a one- or two-
case targeted test, not a whole suite.

### T8.1 — `worker-pattern` `MAX_RELATED_IDS_PER_PAYLOAD` cap

[apps/worker-pattern/src/index.ts:40-48](apps/worker-pattern/src/index.ts#L40-L48)
defines `MAX_RELATED_IDS_PER_PAYLOAD = 256`. Tier-23 audit closure.
New test in `apps/worker-pattern/__tests__/related-ids-cap.test.ts`:

1. Payload with 257 related_ids → handler logs `event:
pattern.related_ids_truncated` AND processes only 256.
2. Payload with 256 exactly → no truncation log.

### T8.2 — `worker-governance` vote-ceremony lowercase normalisation

[apps/worker-governance/src/vote-ceremony.ts:74-81](apps/worker-governance/src/vote-ceremony.ts#L74-L81)
lowercases the `proposer` address before audit-chain write (tier-45
audit closure). New test in `apps/worker-governance/__tests__/proposer-lowercase.test.ts`:

1. `handleProposalOpened({ proposer: '0xAaBbCc…' })` → audit row carries
   `proposer: '0xaabbcc…'`.
2. Already-lowercase address passes through unchanged.

### T8.3 — `worker-conac-sftp` DEV-UNSIGNED rejection

The CONAC SFTP worker refuses to deliver dossiers whose signature
starts with `DEV-UNSIGNED-` (tier-1 audit closure). New test case in
the existing `apps/worker-conac-sftp/__tests__/sftp-delivery-e2e.test.ts`:

1. Dossier with `signature_fingerprint: 'DEV-UNSIGNED-abc'` → delivery
   rejected before any SFTP connection attempt.

### T8.4 — `worker-minfi-api` MTLS loader missing cert path

[apps/worker-minfi-api/src/index.ts:29-48](apps/worker-minfi-api/src/index.ts#L29-L48)
`loadMinfiMtls()` throws on missing/unreadable cert files. New test in
`apps/worker-minfi-api/__tests__/mtls-loader.test.ts`:

1. `MINFI_API_TLS_CERT='/dev/null/missing'` → throws with file path in
   the error.
2. All three cert paths set + files exist → returns the cert/key/ca
   trio.

**Acceptance criteria** (each sub-task):

- Test file added; targeted cases pass.
- No production-code changes in T8 — the guards already exist.
- Each touched worker's `pnpm run test` is green.

---

## T9 — Write 4 missing runbooks

**Failure mode**: services without operator runbooks. If any of them
incidents in production, operators have no procedure to follow.

### T9.1 — `docs/runbooks/worker-outcome-feedback.md`

Worker source: [apps/worker-outcome-feedback/src/](apps/worker-outcome-feedback/src/).
Job: matches finding outcomes against published CONAC/Cour-des-Comptes
disposition. Runbook structure (match the template at
[docs/runbooks/worker-pattern.md](docs/runbooks/worker-pattern.md)):

- Overview (one paragraph; what the worker does, why it matters)
- Streams in / out (READ `STREAMS.*`, WRITE `STREAMS.*`)
- Env vars (interval, batch size, etc.)
- Failure modes table (matching → fail; calibration backlog → fail; etc.)
- R1 routine deploy
- R2 restore from backup (refers to canonical RESTORE.md)
- R3 credential rotation (worker uses no creds beyond DB/Redis →
  point at db-postgres rotation runbook)
- R5 incident response (P0/P1/P2/P3)
- Cross-links to canonical R4 + R6.

### T9.2 — `docs/runbooks/worker-tip-channels.md`

Same structure; worker source: [apps/worker-tip-channels/src/](apps/worker-tip-channels/src/).

### T9.3 — `docs/runbooks/worker-reconcil-audit.md`

Same structure; worker source: [apps/worker-reconcil-audit/src/](apps/worker-reconcil-audit/src/).
This one MUST cross-link to `docs/runbooks/audit-chain-divergence.md`
in its P0 incident section.

### T9.4 — `docs/runbooks/fabric-orderer-replace.md`

Failure mode: one of the 3 Fabric orderers is permanently lost
(hardware death, host re-image). Mentioned in the DL380 migration plan
but no runbook exists. Structure:

- When to use (vs `vault-raft-reattach.md`, vs `patroni-failover.md`)
- Healthy-state baseline (`peer channel getinfo -c vigil-audit` block
  height match across 3 orderers)
- Procedure: regenerate orderer-N TLS cert via Fabric CA → update
  `configtx.yaml` Consenters block → run `osnadmin channel update` →
  verify quorum from remaining 2 orderers stays writeable throughout.
- Audit chain emission expectation
  (`fabric.orderer_replaced` row).
- Cross-link to `docs/runbooks/fabric.md` for general operations.

**Acceptance criteria**:

- 4 new files under `docs/runbooks/`.
- Each ≥ 100 lines, follows the existing runbook template, ends with
  cross-links to canonical R-runbooks.
- No broken markdown links (run
  `pnpm tsx scripts/audit-decision-log.ts` — it walks docs/ markdown
  link resolution as part of its sweep).

**Files touched**: 4 new files; no existing files modified.

---

## T10 — Re-baseline tracker dates

**Failure mode**: state-tracking docs have stale "Last reconciled" or
"Last refreshed" dates. A future agent / architect reading them risks
trusting stale data.

### T10.1 — `docs/weaknesses/INDEX.md`

Already partially addressed in T4 (the `Last reconciled` line). T10
ensures the change is committed in this sweep.

### T10.2 — `docs/work-program/PHASE-1-COMPLETION.md`

Header `Last refreshed: 2026-05-02 (Block-E E.5)` → `Last refreshed:
2026-05-17 (T1–T11 sweep)`. Update the snapshot table to reflect:

- Tests: 58/58 → still 58/58 (or N if new test files added → recount
  with `pnpm -w turbo run test 2>&1 | grep -c "Test Files"` or
  equivalent).
- Weaknesses 🟩 closed: `18 / 27` → `19 / 27` (W-14 graduation).
- Weaknesses 🟧 in progress: `2` → `1`.
- Add a one-line entry to the snapshot table noting this TODO.md
  execution.

### T10.3 — Add a one-pager closure note

`docs/decisions/todo-md-sweep-completion-note.md` — one-page summary
of what each Tn task closed, mirroring the format of
[docs/decisions/hardening-pass-90-of-90-completion-note.md](docs/decisions/hardening-pass-90-of-90-completion-note.md).
This is the handoff artefact for the architect.

**Acceptance criteria**:

- Both date headers updated.
- New completion note exists and references each Tn by ID.

**Files touched**:

- `docs/weaknesses/INDEX.md`
- `docs/work-program/PHASE-1-COMPLETION.md`
- new: `docs/decisions/todo-md-sweep-completion-note.md`

---

## T11 — Helm chart expansion (24 missing service templates)

**Failure mode**: the DL380 migration plan
(`/home/kali/.claude/plans/crispy-pondering-teapot.md`) targets a 3-node
k3s cluster running every service from `infra/docker/docker-compose.yaml`.
The Helm chart at [infra/k8s/charts/vigil-apex/templates/](infra/k8s/charts/vigil-apex/templates/)
already has 46 files covering core data + control plane (Patroni,
Vault Raft, Redis Sentinel, etcd, Fabric orderer, IPFS), but **24
service templates are missing** — every worker plus the entire
observability stack. Without them, `helm install` against a fresh
cluster produces a stack with no workers and no monitoring.

**Services missing Helm templates** (cross-reference per scout):

Observability (6):

- `vigil-alertmanager`
- `vigil-prometheus`
- `vigil-grafana`
- `vigil-falco`
- `vigil-logstash`
- `vigil-filebeat`

Workers (12):

- `audit-bridge`
- `worker-anchor`
- `worker-dossier`
- `worker-entity`
- `worker-extractor`
- `worker-fabric-bridge`
- `worker-governance`
- `worker-image-forensics`
- `worker-pattern`
- `worker-reconcil-audit`
- `worker-satellite`
- `worker-score`

Storage/Fabric bootstrap (4):

- `vigil-ipfs-2` (secondary IPFS node)
- `vigil-fabric-bootstrap`
- `vigil-fabric-ca-org1`
- `vigil-fabric-peer0-org1`

Plus init (2):

- `vigil-secret-init`
- `vigil-watchdog` (host bootstrap; possibly out of scope for k8s — verify)

**Implementation strategy**: rather than 24 unique templates, use a
single generic worker template (mirrors how `worker.yaml` in the
existing chart already abstracts over multiple deployments via
`.Values.workers`). For each missing worker, add an entry to
`values.yaml` (`workers.<name>`) with replicas, env-from-secret, env-
inline, image, resources. The existing template renders all entries.

For observability, write one StatefulSet per service since each has a
distinct PV layout. Use upstream Bitnami / kube-prometheus-stack
patterns where applicable (DO NOT copy upstream code wholesale — write
minimal manifests that match the rest of the chart's style).

For Fabric, mirror the existing `fabric-orderer-statefulset.yaml`
shape for peer + CA.

**Acceptance criteria**:

- For each of the 12 missing workers: a `values.yaml` entry under
  `workers.<name>` (DRY via the existing generic worker template).
- For each of the 6 observability services: a new `*-statefulset.yaml`
  - matching `*-service.yaml`.
- For the 4 Fabric/IPFS gaps: matching templates.
- `helm template infra/k8s/charts/vigil-apex --values
infra/k8s/charts/vigil-apex/values-dev.yaml | wc -l` increases by at
  least 1500 lines (rough check that templates actually render).
- `helm lint infra/k8s/charts/vigil-apex` exits 0.
- Re-run `scripts/render-helm-golden.sh` to regenerate the 3 goldens
  (`golden/dev.yaml`, `golden/prod.yaml`, `golden/cluster.yaml`).
  The CI helm-golden-drift gate will catch any future drift.
- Add a note to the chart's `README.md` (or create one) listing which
  services the chart now covers.

**Effort discipline**: this is the largest task. Time-box at 4 h. If
the generic-worker pattern doesn't already exist in the chart, write
ONE example (worker-pattern.yaml) end-to-end first, then replicate
the values-only pattern for the other 11. Observability services can
borrow from upstream community charts' general shape but must be
hand-authored — DO NOT add a `subcharts` dependency on
`kube-prometheus-stack`, which would balloon the chart's surface
area; the project explicitly prefers a minimal in-tree chart.

**Files touched**:

- `infra/k8s/charts/vigil-apex/values.yaml` (new worker entries)
- `infra/k8s/charts/vigil-apex/values-dev.yaml` (dev overrides if needed)
- `infra/k8s/charts/vigil-apex/values-prod.yaml`
- `infra/k8s/charts/vigil-apex/values-cluster.yaml`
- ~12 new files under `infra/k8s/charts/vigil-apex/templates/` for
  observability + Fabric peer/CA + IPFS secondary.
- Regenerated `golden/{dev,prod,cluster}.yaml`.

---

## T12 — Final verification + handoff note

**Acceptance criteria**:

- `pnpm -w turbo run typecheck` — 60/60 ✓
- `pnpm -w turbo run lint -- --max-warnings=0` — 60/60 ✓
- `pnpm -w turbo run test` — 60+/60+ ✓ (new test files raise the
  count; verify NO regression)
- `pnpm tsx scripts/check-weaknesses-index.ts` — exit 0
- `pnpm tsx scripts/check-test-coverage-floor.ts` — exit 0
- `pnpm tsx scripts/check-decisions.ts` — exit 0
- `pnpm tsx scripts/audit-decision-log.ts` — exit 0 (markdown link
  resolution)
- `pnpm tsx scripts/check-pattern-coverage.ts` — exit 0
- `pnpm tsx scripts/check-migration-pairs.ts` — exit 0
- `pnpm tsx scripts/check-source-count.ts` — exit 0
- `pnpm tsx scripts/check-llm-pricing.ts` — exit 0
- `helm lint infra/k8s/charts/vigil-apex` — exit 0
- `git status` clean except for the new sweep branch's diff.
- The handoff note at
  `docs/decisions/todo-md-sweep-completion-note.md` reflects the
  final commit graph (run `git log --oneline main..HEAD` and embed).

**Branch + commit policy**:

- All work lands on a new branch `hardening/todo-md-sweep` (cut from
  current `hardening/tier-1-to-4-deep-audit`).
- One commit per Tn, Conventional Commits, with a `Co-Authored-By:
Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Architect commits the branch + raises the PR at their discretion.
- NO `git push` from the agent.

---

## Stop conditions (when this TODO.md is "done")

This file is considered fully executed when every Tn under "Task
index" is ✓ AND T12's acceptance criteria are all green AND the
handoff note exists. At that point the agent prints the final
verification table and exits.

If any Tn encounters a blocker that cannot be resolved without
architect input (e.g. a `normalizeName` helper that turns out not to
exist with the expected shape, requiring an architectural decision
about how identity normalisation should work), the agent records the
blocker in this file at the appropriate Tn section under "Blocker:"
and continues to the next task. The agent does NOT invent surfaces
or guess at architectural decisions.

---

## Explicitly out of scope

These are real items but they're either architect-blocked (Track F)
or were deliberately deferred per architect decision. They are NOT in
this TODO.md and the agent does NOT attempt them:

- DECISION-001..007 promotion (architect read-through)
- DECISION-012/013/014/014b/014c/015 promotion (architect read-through)
- Council formation (F1.1–F1.9)
- CONAC engagement (F3)
- ANTIC declaration (F4)
- YubiKey procurement (F5)
- Polygon mainnet contract deployment (F6)
- Calibration seed population (F7 / W-16, deferred to M2 exit)
- Cosign-key ceremony (mode 9.9 + 10.8 Code-CV-Ceremony-Pending)
- D7 Visual regression baseline-stamp (architect-side)
- W-10 native libykcs11 helper (deferred M3-M4 per W-10.md and
  PHASE-1-COMPLETION.md; WebAuthn fallback is the Phase-1 ship target)
- Per-pattern hallucination corpus expansion beyond 224 rows
  (W-14 target was 200; 224 is over target; further expansion is
  post-MVP per-pattern tuning, not phase-1 closure)

If the architect later wants any of these, they request them
explicitly. The agent does not pull them into this sweep.
