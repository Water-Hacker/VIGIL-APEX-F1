# SafeLlmRouter coverage — verification report (Step 4)

> **Status:** Steps 1-4 complete. Architect-tight-scope task closed.
> **Date:** 2026-05-01.
> **Author:** build agent.
>
> Step 1 inventory: commit `fa4ac51` ([SAFELLM-COVERAGE-INVENTORY.md](./SAFELLM-COVERAGE-INVENTORY.md)).
> Step 2 migration: commit `c69a523` (worker-entity).
> Step 3 lint: commit follows this report (scripts/check-safellm-coverage.ts + phase-gate.yml + synthetic-failure case 6).

---

## 1. Inventory diff (before / after)

| #   | Worker                  | Pre-task verdict | Post-task verdict | Action                       |
| --- | ----------------------- | ---------------- | ----------------- | ---------------------------- |
| 1   | worker-tip-triage       | SAFE             | SAFE              | none (Block-B exemplar)      |
| 2   | worker-adapter-repair   | SAFE             | SAFE              | none (Block-B A2.5)          |
| 3   | worker-counter-evidence | SAFE             | SAFE              | none (Block-B A2.2)          |
| 4   | worker-extractor        | SAFE             | SAFE              | none (Block-B A2.1)          |
| 5   | **worker-entity**       | **DRIFT**        | **SAFE**          | migrated in commit `c69a523` |

**Final state:** 5 / 5 workers SAFE. Zero drift. Zero allowlist entries.

The original architect inventory expected possible direct-call drift (`LlmRouter.call(` / `.llm.call(`) — none found anywhere in the codebase. The five hits were all `new LlmRouter(...)` instantiations in worker `main()` (legitimate dependency-construction shape), and the only behavioural drift was on worker-entity's call shape (L4 inline-vs-closed-context + L9 prompt-location).

---

## 2. worker-entity migration — before / after

### 2.1 L9 prompt registration (location)

**Before** — `packages/llm/src/safety/prompts.ts:153-176`:

```ts
// 5) Entity resolution — alias clustering. Distinct from finding-shaping
//    extraction: there are no source documents to cite; the call disambiguates
//    person/company/public_body aliases. Registered here so worker-entity
//    can run through SafeLlmRouter (prompt versioning + call-record audit
//    trail + low-temperature default + canary). See SRD §15.5.1.
globalPromptRegistry.register({
  name: 'entity.resolve-aliases',
  version: 'v1.0.0',
  description: '...',
  render: (input) => { ... },  // interpolated aliases inline
});
```

**After** — `apps/worker-entity/src/prompts.ts` (new file):

```ts
Safety.globalPromptRegistry.register({
  name: ENTITY_RESOLVE_ALIASES_PROMPT_NAME,
  version: 'v1.0.0',
  description: '...',
  render: () => ({
    system:
      '<doctrine preamble — closed-context render performed by SafeLlmRouter ...>',
    user: ENTITY_RESOLVE_ALIASES_TASK, // doctrine-instruction-only; no aliases
  }),
});
```

Plus `packages/llm/src/safety/prompts.ts` gained a documented header rule:

> SCOPE — DOCTRINE-LEVEL ONLY.
>
> This file is for doctrine-level prompts shared across all workers (canaries, devil's-advocate, secondary-review, anchoring/order-effects). Per-worker prompts live in `apps/worker-{name}/src/prompts.ts`.

### 2.2 L4 closed-context sources

**Before** — `apps/worker-entity/src/index.ts:316-330`:

```ts
const rendered = Safety.globalPromptRegistry.latest('entity.resolve-aliases');
if (!rendered) { ... }
const tmpl = rendered.render({ aliases: unresolved });   // ← aliases interpolated into user text
const outcome = await this.safe.call<z.infer<typeof zErResp>>({
  findingId: null,
  assessmentId: null,
  promptName: 'entity.resolve-aliases',
  task: tmpl.user,                                       // ← aliases land in task (instructions surface)
  sources: [],                                           // ← empty
  responseSchema: zErResp,
  modelId: this.modelId,
});
```

**After** — `apps/worker-entity/src/index.ts:323-343`:

```ts
if (
  Safety.globalPromptRegistry.latest(ENTITY_RESOLVE_ALIASES_PROMPT_NAME) ===
  null
) {
  logger.error('entity-resolve-prompt-missing');
  return { kind: 'retry', reason: 'prompt-not-registered', delay_ms: 60_000 };
}
const outcome = await this.safe.call<z.infer<typeof zErResp>>({
  findingId: null,
  assessmentId: null,
  promptName: ENTITY_RESOLVE_ALIASES_PROMPT_NAME,
  task: ENTITY_RESOLVE_ALIASES_TASK, // ← doctrine-instruction-only
  sources: [
    {
      id: 'aliases-pending-resolution',
      label: 'Unresolved entity name candidates (one per line)',
      text: unresolved.map((a, idx) => `${idx + 1}. ${a}`).join('\n'),
      // ← aliases in closed-context source
    },
  ],
  responseSchema: zErResp,
  modelId: this.modelId,
});
```

### 2.3 Doctrine surface table

| Surface                                 | worker-entity (post-migration)                                       |
| --------------------------------------- | -------------------------------------------------------------------- |
| L4 closed-context `sources`             | ✓ aliases inside `<source_document id="aliases-pending-resolution">` |
| L9 `promptName` registered              | ✓ in `apps/worker-entity/src/prompts.ts` (per-worker pattern)        |
| L11 CallRecordRepo sink                 | ✓ wired in `main()` (unchanged from pre-migration)                   |
| L14 `modelId` pinned                    | ✓ `this.modelId` from `main()`'s env-pinned constructor argument     |
| `Safety.adversarialPromptsRegistered()` | ✓ startup check (line 527 in `main()`; unchanged)                    |
| Side-effect prompt registration         | ✓ `import './prompts.js'` in worker's index.ts                       |
| Source-grep regression test             | ✓ `apps/worker-entity/__tests__/safe-call.test.ts` (9 assertions)    |

---

## 3. CI lint output (zero drift)

```
$ pnpm exec tsx scripts/check-safellm-coverage.ts
[check-safellm-coverage] OK — 5 LlmRouter reference(s); 5 structurally
  legitimate (new LlmRouter paired with new SafeLlmRouter); 0 drift;
  0 entry on the allowlist.
```

The 5 paired references:

- `apps/worker-tip-triage/src/index.ts:156`
- `apps/worker-adapter-repair/src/index.ts:253`
- `apps/worker-counter-evidence/src/index.ts:239`
- `apps/worker-extractor/src/index.ts:259`
- `apps/worker-entity/src/index.ts:521`

All 5 sites are followed by a `new SafeLlmRouter(llm, ...)` in the same file. The lint's pairing-check is satisfied for each.

The `LlmRouter.call(` and `.llm.call(` patterns are unconditional drift; the lint reports zero hits on either across `apps/` + `packages/` outside `packages/llm/`.

---

## 4. Synthetic-failure test result

The regression lint is itself regression-tested by [scripts/synthetic-failure.ts](../../scripts/synthetic-failure.ts) — same harness pattern as the other 5 phase-gate lints (Block-D D.7).

The synthetic case mutates the working tree by adding a deliberate-bypass file at `apps/worker-tip-triage/src/_synthetic-bypass.ts` containing a bare `new LlmRouter(...)` with NO `new SafeLlmRouter` pairing in the same file. The lint must reject this with exit 1; the harness restores the tree on success or failure.

```
$ pnpm exec tsx scripts/synthetic-failure.ts
[synthetic-failure] running 6 cases against the phase-gate lints

  [check-decision-cross-links] ✓ REJECTED (exit 1)
  [check-source-count] ✓ REJECTED (exit 1)
  [check-llm-pricing] ✓ REJECTED (exit 1)
  [check-pattern-coverage] ✓ REJECTED (exit 1)
  [check-migration-pairs] ✓ REJECTED (exit 1)
  [check-safellm-coverage] ✓ REJECTED (exit 1)

[synthetic-failure] 6/6 REJECTED — 0 ESCAPED/ERRORED
[synthetic-failure] OK — every gate rejected its broken input
```

If a future PR breaks the SafeLlmRouter chokepoint (e.g. removes the pairing-check from the lint, or deletes the worker-entity migration), this synthetic case escapes and the meta-test fails the workflow.

---

## 5. Gate verification — all green

```
$ pnpm exec turbo run build --continue --force
 Tasks:    39 successful, 39 total

$ pnpm exec turbo run typecheck --continue --force
 Tasks:    56 successful, 56 total

$ pnpm exec turbo run lint --continue --force
 Tasks:    56 successful, 56 total

$ pnpm exec turbo run test --continue --force
 Tasks:    49 successful, 49 total
```

Build, typecheck, lint, and test are all green across the full workspace.

---

## 6. Commits in this task

| SHA       | Step | Scope                                                                                                                                            |
| --------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fa4ac51` | 1    | inventory + halt-for-review                                                                                                                      |
| `c69a523` | 2    | worker-entity migration (L4 closed-context + L9 lift + 9 regression tests + central registry rule documentation)                                 |
| (this)    | 3+4  | scripts/check-safellm-coverage.ts + phase-gate.yml wiring + synthetic-failure case 6 + PHASE-1-COMPLETION A2.6 / A2.7 + this verification report |

Three commits. Architect estimate was 4-5 if both migrations proceeded as scoped; the merge of Step 3 + Step 4 + the lint into one final commit lands on the lower side of that range.

---

## 7. Going-forward state

- **SafeLlmRouter coverage** is no longer a one-time migration; it is a permanent CI guard. PHASE-1-COMPLETION §A2.7 records the guard.
- **Allowlist starts empty.** Any future addition to `ALLOWLIST` in `scripts/check-safellm-coverage.ts` requires architect signoff (the script header documents this).
- **Per-worker prompts pattern** is now the documented convention. `packages/llm/src/safety/prompts.ts` carries the SCOPE header rule; new worker prompts that drift into the central file would be caught at code review (the header is the operator-facing reminder).
- **Block-E plan-first posture resumes** after this lands. Standing-down for §30 enumeration decisions per architect's prior instruction.
