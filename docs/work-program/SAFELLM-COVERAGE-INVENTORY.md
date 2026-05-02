# SafeLlmRouter coverage — inventory (Step 1)

> **Status:** halt-for-review per architect's Step 1 gate.
> **Date:** 2026-05-01.
> **Author:** build agent.

---

## 1. Grep methodology

Per architect's spec, ran:

```sh
rg -n 'LlmRouter\.call|new LlmRouter|llm\.call\(' \
   --type ts apps/ packages/ \
   --glob '!**/__tests__/**' \
   --glob '!packages/llm/**'
```

Plus a belt-and-suspenders broadening (`this\.llm\.|this\.router\.|\bllm\b.*\.call\(`) to catch field-name variants the literal pattern would miss.

Result: **5 hits**, all `new LlmRouter(...)` instantiation in worker `main()`. Zero direct call-site bypasses (`LlmRouter.call(` or `.llm.call(`) anywhere in `apps/` or `packages/`.

The inventory therefore turns on **wiring quality** at each instantiation site — does the worker wrap the bare router in `SafeLlmRouter` with prompt registry + closed-context sources + call-record sink? — not on call-site drift.

---

## 2. Per-worker classification

| #   | Worker                      | File:line                                       | Verdict   | Notes                                                                                                        |
| --- | --------------------------- | ----------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | **worker-tip-triage**       | `apps/worker-tip-triage/src/index.ts:156`       | **SAFE**  | Block-B A2.4 exemplar (commit `10dac28`). All four surfaces present.                                         |
| 2   | **worker-adapter-repair**   | `apps/worker-adapter-repair/src/index.ts:253`   | **SAFE**  | Block-B A2.5. All four surfaces present.                                                                     |
| 3   | **worker-counter-evidence** | `apps/worker-counter-evidence/src/index.ts:239` | **SAFE**  | Block-B A2.2. All four surfaces present.                                                                     |
| 4   | **worker-extractor**        | `apps/worker-extractor/src/index.ts:259`        | **SAFE**  | Block-B A2.1. All four surfaces present (via `SafeLlmExtractor` adapter — type-decoupling shim, not bypass). |
| 5   | **worker-entity**           | `apps/worker-entity/src/index.ts:521`           | **DRIFT** | See §3 below. Doctrine question requires architect call.                                                     |

**Zero `DIRECT-CALL-INTENTIONAL` hits.** No deliberate-bypass `LlmRouter.call(...)` exists in the codebase.

---

## 3. The drift case — worker-entity

### 3.1 Surfaces inspection

| Doctrine surface                      | worker-tip-triage (exemplar)                                                            | worker-entity                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| L9 — `promptName` registered          | `tip-triage.paraphrase` in `apps/worker-tip-triage/src/prompts.ts`                      | `entity.resolve-aliases` in **`packages/llm/src/safety/prompts.ts`** (central, not worker-local) |
| L4 — closed-context `sources`         | `[{id:'tip:…', label:'tip-body', text:…}]` (citizen-supplied content in closed context) | **`sources: []` (empty)**; aliases passed inline in `task: tmpl.user`                            |
| L14 — `modelId` pinned                | `'claude-haiku-4-5-20251001'`                                                           | `this.modelId` (env-pinned in main; same shape) ✓                                                |
| L11 — CallRecordRepo sink             | wired in main                                                                           | wired in main ✓                                                                                  |
| Safety.adversarialPromptsRegistered() | startup check                                                                           | startup check ✓                                                                                  |

Two surfaces are at variance from the exemplar:

- **L9 location.** Spec says "register the prompt in the worker's `src/prompts.ts`". worker-entity's prompt lives in the central `packages/llm/src/safety/prompts.ts` instead. The prompt IS registered in `globalPromptRegistry`; the registration source-of-record is just elsewhere. Mechanical question, not doctrine question.
- **L4 sources.** worker-entity passes `sources: []` and embeds the aliases inline in the `task` field via `tmpl.user`. The exemplar pattern says adversarial / untrusted content goes in `sources`, not `task`. **This is a doctrine interpretation question** — see §3.2.

### 3.2 The L4 question (architect call)

worker-entity's `safe.call` at [apps/worker-entity/src/index.ts:316-330](../../apps/worker-entity/src/index.ts#L316):

```ts
const rendered = Safety.globalPromptRegistry.latest('entity.resolve-aliases');
if (!rendered) { ... }
const tmpl = rendered.render({ aliases: unresolved });
const outcome = await this.safe.call<z.infer<typeof zErResp>>({
  findingId: null,
  assessmentId: null,
  promptName: 'entity.resolve-aliases',
  task: tmpl.user,
  sources: [],      // ← empty
  responseSchema: zErResp,
  modelId: this.modelId,
});
```

The aliases are entity-name candidates the worker has identified as needing resolution. They flow from this chain:

1. Crawler produces `source.events` with raw entity strings (adversarial-trust origin).
2. worker-entity's rule-pass canonicalises a subset deterministically.
3. The remainder — name variants the rule-pass couldn't disambiguate — get sent to LLM.

So the aliases reaching the LLM are **derived from but not identical to** crawler-supplied strings. They've been through a normalisation pass; whether that pass renders them L4-safe-for-inline is the doctrine question.

**Two readings:**

- **(A) The current shape is doctrine-genuine.** Aliases are post-normalisation candidate strings, not raw crawler input. Embedding them in the `task` field is acceptable because the normalisation pass strips the prompt-injection surface (e.g. `normalizeName` removes whitespace, casing, trailing punctuation). The empty `sources: []` is correct because there are no documents under audit — only ambiguous identifiers being resolved against each other. No migration needed; just document this as the established interpretation.
- **(B) The current shape is L4 drift.** Even normalised, alias strings can carry adversarial content (Unicode look-alikes, base64-encoded instructions, etc.). They should be wrapped as `sources: [{id, label:'aliases', text: aliases.join('\n')}]` and the `task` field should contain only the doctrine instruction ("from the aliases below, group by referent…"). Migration is one structural change to the call shape + worker tests.

**My read:** I cannot pick this. (A) is defensible if the normalisation pass is rigorous; (B) is the safer default. The architect's instruction was explicit: "If the migration surfaces a doctrine ambiguity, halt and surface for my decision; do not interpret it." This is that ambiguity.

### 3.3 The L9 location question (architect call)

The architect's spec said "register the prompt template in the worker's `src/prompts.ts`". worker-entity's prompt lives in `packages/llm/src/safety/prompts.ts` (central, alongside the doctrine canonical prompts). Two options:

- **(α) Lift `entity.resolve-aliases` from `packages/llm/src/safety/prompts.ts` into a new `apps/worker-entity/src/prompts.ts`.** Matches the per-worker pattern of the other 4 workers. Centralised prompt registry (`globalPromptRegistry`) still receives the registration; the source file just moves.
- **(β) Leave it in the central package.** The prompt IS registered in `globalPromptRegistry`; the L9 surface is satisfied. Variance from the exemplar is purely organisational. Update the architect's migration template to acknowledge "central or worker-local" both work.

**My read:** (α) is the literal spec match and would tighten the new lint's coverage (the lint can require a `src/prompts.ts` per worker that imports SafeLlmRouter). (β) is the lower-effort path. Neither breaks the doctrine.

---

## 4. Halt criteria check

Per architect's Step 1 gate:

> Halt for review if the DIRECT-CALL-DRIFT list has more than three workers — that's a scope signal, not a bug list, and I want to see it.
>
> If the inventory in Step 1 surprises you (more drift than expected, doctrine-deeper-than-expected migrations needed, or any DIRECT-CALL-INTENTIONAL hits with no documented reason), HALT after Step 1 and surface.

| Trigger                                        | State                                  | Halt?                    |
| ---------------------------------------------- | -------------------------------------- | ------------------------ |
| `>3` workers in DIRECT-CALL-DRIFT              | 1 worker                               | No on this trigger       |
| Any `DIRECT-CALL-INTENTIONAL` undocumented     | 0                                      | No on this trigger       |
| Doctrine-deeper-than-expected migration needed | **Yes** (L4 question on worker-entity) | **Halt on this trigger** |

**Halting per the third trigger.** Architect picks (A) or (B) on §3.2, and (α) or (β) on §3.3, before I proceed to Step 2.

---

## 5. Architect-action checklist

- [ ] §3.2 worker-entity L4 — sources: (A) keep empty, document interpretation OR (B) wrap aliases as closed-context sources + migrate
- [ ] §3.3 worker-entity L9 — prompt location: (α) lift to `apps/worker-entity/src/prompts.ts` OR (β) keep in `packages/llm/src/safety/prompts.ts`
- [ ] If both default-acceptable: stand down for the worker-entity migration; just ship the regression lint (Step 3) covering the four other workers as the going-forward guard

Once signed: I proceed to Step 2 (migrate worker-entity per chosen path) and Step 3 (regression lint). If both architect picks come back as "current shape is doctrine-genuine" (A + β), there is no migration — Step 2 collapses to zero commits and the work becomes Step 3 + Step 4 only.
