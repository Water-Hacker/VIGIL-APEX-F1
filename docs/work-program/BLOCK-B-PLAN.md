# BLOCK B — plan (Track A from PHASE-1-COMPLETION.md, items A1–A10)

> **Status:** awaiting architect counter-signature on §3 hold-points.
> **Date:** 2026-05-01.
> **Author:** build agent (Claude).
>
> Plan-first per architect instruction. No code changes until §3 is
> signed. The actionable-item count is **smaller than the prompt
> suggests** — most of Track A has already shipped on prior branches;
> the plan catalogues what survived and what's left.

---

## 1. State reconciliation — what is already done

[docs/work-program/PHASE-1-COMPLETION.md](../work-program/PHASE-1-COMPLETION.md)
was last updated before several follow-up commits landed on `main`.
A pre-flight sweep against the live tree shows:

| Item                                        | Spec                                                          | Live state                                                                                                                                                                                                                              | Verdict               |
| ------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **A1** Anti-hallucination corpus            | 40 → 200 rows                                                 | `packages/llm/__tests__/synthetic-hallucinations.jsonl` has **224 rows** (one JSON object per line)                                                                                                                                     | **DONE — flip 🟩**    |
| **A2** SafeLlmRouter per-worker migration   | `worker-extract`, `worker-counter-evidence`, `worker-pattern` | DRIFT — see §3 hold-point #1                                                                                                                                                                                                            | **HOLD**              |
| **A3** NO_TESTS packages → real tests       | 11 packages                                                   | All 11 have ≥ 1 test file (verified: observability=3, db-neo4j=7, queue=2, dossier=3, fabric-bridge=1, worker-document=4, worker-federation-agent=1, audit-bridge=1, worker-adapter-repair=1, worker-fabric-bridge=1, worker-pattern=1) | **DONE — flip 🟩**    |
| **A4** worker-federation-receiver test fail | 1 test file fails                                             | `pnpm --filter worker-federation-receiver test` → **40/40 pass, 3 files**                                                                                                                                                               | **DONE — flip 🟩**    |
| **A5** CAS integration harness in CI        | Wire pg + INTEGRATION_DB_URL                                  | `audit-log-cas.test.ts` still skipped in default CI; `.github/workflows/ci.yml` has no postgres service                                                                                                                                 | **ACTIONABLE**        |
| **A6** DECISION-012 PROVISIONAL → FINAL     | Promote                                                       | Still PROVISIONAL ([docs/decisions/log.md:2444](../decisions/log.md#L2444)); read-through is architect work                                                                                                                             | **ARCHITECT-BLOCKED** |
| **A7** Stale TODOs sweep                    | 2 files                                                       | Both already cleaned — `vote-ceremony.tsx` has only a descriptive "DECISION-008 C5b" reference; `challenge/route.ts` says "Closes the C5b TODO" past-tense                                                                              | **DONE — flip 🟩**    |
| **A8** End-to-end fixture script            | `scripts/e2e-fixture.sh` + `scripts/seed-fixture-events.ts`   | Both files exist (134 + 108 lines) — see §3 hold-point #3 for SRD §30 coverage check                                                                                                                                                    | **HOLD**              |
| **A9** Production-placeholder sweep         | Audit + classify each PLACEHOLDER                             | `grep -r PLACEHOLDER` against `.env.example` + `infra/sources.json` + `infra/docker` + `infra/host-bootstrap` returns **23 hits** to classify                                                                                           | **ACTIONABLE**        |
| **A10** Pattern coverage gate               | New CI script                                                 | `scripts/check-pattern-coverage.ts` exists and is wired in `phase-gate.yml`                                                                                                                                                             | **DONE — flip 🟩**    |

**Net actionable code items:** A5, A9 — and possibly A2 / A8 once
hold-points clear.

**Already-done items needing only doc updates:** A1, A3, A4, A7,
A10. These flip from 🟧/🟥 → 🟩 in PHASE-1-COMPLETION.md.

**Architect-blocked:** A6 (read-through).

---

## 2. Proposed Block B execution order

Pre-flight assumes §3 hold-points are signed. If A2 is descoped per
hold-point #1, the order shrinks accordingly.

| #   | Item                                              | Source                  | Scope                                                                                                         |
| --- | ------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| B.1 | Doc reconciliation (mark already-done items 🟩)   | A1 / A3 / A4 / A7 / A10 | Update `docs/work-program/PHASE-1-COMPLETION.md` to reflect live state                                        |
| B.2 | A9 — PLACEHOLDER sweep                            | A9                      | Classify 23 hits, ship boot-guards / dev-defaults / refuse-to-boot per DECISION-008 Tier-1                    |
| B.3 | A5 — CAS integration in CI                        | A5                      | Add postgres service to `.github/workflows/ci.yml`, run drizzle migrations, export INTEGRATION_DB_URL         |
| B.4 | A2 — SafeLlmRouter migration of remaining workers | A2 (post-hold)          | Migrate the actually-unmigrated workers; preserve every doctrine layer per AI-SAFETY-DOCTRINE-v1              |
| B.5 | A8 — E2E fixture coverage gap-fill                | A8 (post-hold)          | If §3 hold-point #3 surfaces gaps in `e2e-fixture.sh`, fill against SRD §30                                   |
| B.6 | A6 — DECISION-012 promotion prep                  | A6                      | A6.1 cross-reference audit + A6.3 schema side-by-side + A6.4 salt rotation doc — leave A6.2/A6.5 to architect |

Each item is one commit; one logical unit. Conventional Commits +
Co-Authored-By tag.

---

## 3. Hold-points — batched

### Hold-point #1 — A2 SafeLlmRouter migration scope drift

**The drift.** PHASE-1-COMPLETION.md A2 names three workers:
`worker-extract`, `worker-counter-evidence`, `worker-pattern`. Live
tree:

- [`apps/worker-extractor/src/index.ts:288`](../../apps/worker-extractor/src/index.ts#L288) — instantiates `SafeLlmRouter` and passes a `SafeLlmRouterLike` adapter to the extractor. **Already migrated.**
- [`apps/worker-counter-evidence/src/index.ts:189`](../../apps/worker-counter-evidence/src/index.ts#L189) — calls `this.safe.call({...})`. **Already migrated.**
- [`apps/worker-pattern/src/`](../../apps/worker-pattern/src/) — has **zero LLM calls** in source. The pattern dispatcher does deterministic pattern evaluation; there is no Claude call to wrap. The PHASE-1-COMPLETION text mentions a hypothetical `task: 'pattern_evaluate'` task class but no code path uses it.

**The actual gap.** A `grep -rn "LlmRouter\b"` across `apps/`
identifies two workers that import `LlmRouter` and call it directly
WITHOUT going through `SafeLlmRouter`:

- [`apps/worker-tip-triage/src/index.ts:122`](../../apps/worker-tip-triage/src/index.ts#L122) — `this.llm.call<...>(...)` — paraphrase + classify; tip content is operator-facing (sensitive)
- [`apps/worker-adapter-repair/src/index.ts:121`](../../apps/worker-adapter-repair/src/index.ts#L121) — `llm.call<...>(...)` — selector-derivation prompt for adapter repair

Both go through raw `LlmRouter`, so the AI-SAFETY-DOCTRINE-v1
chokepoints (L4 schema validation, L5 citation requirement, L6
multi-pass cluster check, L9 prompt-version pin, L11 call-record
audit) **do not apply uniformly** to these two workers.

**Question for architect.** Three possible reads:

1. **The doc lags reality.** The named three workers are already
   migrated; A2 should be **descoped**. (If so, flip A2 to 🟩 in
   PHASE-1-COMPLETION.md without further code change.)
2. **The doc names the wrong workers.** The actual gap is
   `worker-tip-triage` + `worker-adapter-repair`; A2 should be
   **redirected** to these two. (If so, the agent does the
   migration with extra care for the doctrine layers.)
3. **Both.** A2 covers both: flip the named-three to 🟩 AND
   migrate the actually-unmigrated two.

**Default if unspecified.** Read #3 — agent does the broader sweep.

**Doctrine-preservation guarantee for the migration.** When the
agent migrates `worker-tip-triage` + `worker-adapter-repair`, every
layer in AI-SAFETY-DOCTRINE-v1 §B that the prompt registry / call
record currently enforces will continue to enforce. Specifically:

- The migration registers each worker's prompt with
  `Safety.globalPromptRegistry` (L9 prompt-version pin, B.12
  reproducibility).
- The call sites switch from `llm.call(...)` to `safe.call({findingId, assessmentId, promptName, task, sources, responseSchema, ...})` so L4 schema validation, L5 citation requirement, L6 cluster check, L11 call-record audit run.
- The temperature comes from `TASK_TEMPERATURE[task]`, NOT from a
  per-call override, unless the prompt registry explicitly carries
  one (B.1 low-temperature default).
- For `worker-tip-triage`, the prompt is closed-context (the tip
  body is the source); response schema rejects any field not in the
  declared shape (B.4 prompt injection).
- The migration adds **at least one test per worker** that calls a
  fake `SafeLlmRouter` and asserts the call carries the expected
  prompt name + task + schema — pinning the doctrine surface.

If the agent finds an existing call shape that cannot be ported
without weakening any layer, the agent halts and surfaces it
rather than landing the migration.

### Hold-point #2 — A6 DECISION-012 read-through is architect work

**Scope.** A6.1 (cross-reference audit), A6.3 (schema side-by-side),
A6.4 (salt-rotation doc) are agent-doable. A6.2 (architect read-
through checklist) and A6.5 (FINAL flip in log.md) are architect-only.

**Question for architect.** Should B.6 ship A6.1 / A6.3 / A6.4 in
this block, with the FINAL flip queued for a separate architect
session? Or hold A6 entirely for a dedicated read-through pass?

**Default if unspecified.** Ship A6.1 + A6.3 + A6.4 in B.6; leave
A6.2 + A6.5 for the architect's separate read-through.

### Hold-point #3 — A8 e2e-fixture.sh + seed-fixture-events.ts coverage

**State.** Both files exist (134 + 108 lines). The PHASE-1-COMPLETION
spec calls for coverage of "every Phase 1 critical path in SRD §30
acceptance tests". Without re-deriving the SRD §30 list and
diff-ing against the existing fixture, the agent can't tell whether
the existing files are complete or stub.

**Question for architect.** Three possible reads:

1. **Skip the audit.** If the existing files were known-complete
   when written, A8 is **DONE**; flip to 🟩 with no change.
2. **Run the audit.** Compare the existing scripts against SRD §30
   line-by-line; ship gap-fills as B.5.
3. **Defer.** A8 is a Phase-1-exit deliverable; full audit can wait
   until Block C / pre-cutover.

**Default if unspecified.** Read #2 — audit and gap-fill — but the
audit alone could be a multi-commit sub-block. The agent will
budget one commit for the audit doc and one commit per coherent
gap-fill, capped at 3 gap-fill commits before halting for review.

---

## 4. Block B operating posture (re-stated for the record)

Per architect instruction 2026-05-01:

- Plan first — this document. **HALT FOR ARCHITECT REVIEW.**
- Batch hold-points — collected in §3 above.
- One commit per logical unit. Conventional Commits, signed,
  Co-Authored-By tag.
- Update `docs/work-program/PHASE-1-COMPLETION.md` as items close.
- Stop after a commit only if a test or lint fails.
- At Block B close, produce
  `docs/work-program/BLOCK-B-COMPLETION-SUMMARY.md` and halt for
  review before opening Block C.

**Doctrine ratchet.** The SafeLlmRouter migration in B.4 will not
land if any AI-SAFETY-DOCTRINE-v1 layer would be weakened. The
agent will halt and flag rather than weaken.

---

## 5. What the architect signs

Three checkboxes, one signature:

- [ ] §3 hold-point #1 (A2 scope) — pick read 1, 2, or 3 (default 3).
- [ ] §3 hold-point #2 (A6 partial) — pick "ship A6.1+A6.3+A6.4" or "hold all" (default ship).
- [ ] §3 hold-point #3 (A8 audit scope) — pick read 1, 2, or 3 (default 2).

**Architect signature:** \***\*\_\_\_\_\*\*** **Date:** \***\*\_\_\_\_\*\***

When all three are signed, the agent advances to **B.1** (doc
reconciliation) and proceeds top-to-bottom through §2.

---

## 6. Critical-files list (forward-looking)

Files this block will touch (depending on which hold-points clear):

| File                                                                                      | Item  | Change                                                           |
| ----------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------- |
| `docs/work-program/PHASE-1-COMPLETION.md`                                                 | B.1   | Flip A1, A3, A4, A7, A10 to 🟩; add commit-sha column            |
| `infra/host-bootstrap/*.sh`, `.env.example`, `infra/sources.json`, `infra/docker/**.yaml` | B.2   | Boot-guards / dev-defaults / refuse-to-boot per DECISION-008     |
| `.github/workflows/ci.yml`                                                                | B.3   | Add postgres service + drizzle migrate step + INTEGRATION_DB_URL |
| `apps/worker-tip-triage/src/index.ts` + register prompt                                   | B.4   | Migrate to SafeLlmRouter (pending hold-point #1)                 |
| `apps/worker-adapter-repair/src/index.ts` + register prompt                               | B.4   | Migrate to SafeLlmRouter (pending hold-point #1)                 |
| `apps/worker-tip-triage/__tests__/safe-call.test.ts` (new)                                | B.4   | Doctrine-surface test                                            |
| `apps/worker-adapter-repair/__tests__/safe-call.test.ts` (new)                            | B.4   | Doctrine-surface test                                            |
| `scripts/e2e-fixture.sh`, `scripts/seed-fixture-events.ts`                                | B.5   | Gap-fill (pending hold-point #3)                                 |
| `docs/decisions/decision-012-readthrough-checklist.md` (new)                              | B.6   | A6.1 + A6.3 + A6.4 prep                                          |
| `docs/work-program/BLOCK-B-COMPLETION-SUMMARY.md` (new)                                   | close | Block close report                                               |

Existing utilities that will be reused:

- `Safety.globalPromptRegistry` from `@vigil/llm/safety` — prompt
  registration + canary check.
- `SafeLlmRouter` constructor pattern from existing
  `worker-counter-evidence` and `worker-extractor`.
- Drizzle migration runner — `pnpm --filter @vigil/db-postgres run migrate`.
