/**
 * SafeLlmRouter prompt registration for worker-entity.
 *
 * Block-D follow-up (post-Block-D, pre-Block-E): per architect call on
 * the SafeLlmRouter coverage inventory, `entity.resolve-aliases` is
 * lifted from `packages/llm/src/safety/prompts.ts` (which is for
 * doctrine-level prompts shared across all workers — canaries,
 * devil's-advocate, secondary-review) into this worker-local file
 * (which is the established pattern for per-worker prompts; see also
 * worker-tip-triage, worker-adapter-repair, worker-counter-evidence,
 * worker-extractor).
 *
 * L4 doctrine surface: `ENTITY_RESOLVE_ALIASES_TASK` is the doctrine-
 * instruction-only user content; it does NOT contain the candidate
 * aliases. The aliases are passed by the worker as a closed-context
 * `<source_document id="aliases-pending-resolution">` via the
 * SafeLlmRouter `sources` parameter at call time. This keeps the
 * adversarial-trust alias strings inside the doctrine boundary that
 * teaches the model to treat tag contents as data, not instructions
 * (renderClosedContext + DEFAULT_PREAMBLE per
 * AI-SAFETY-DOCTRINE-v1 §B.4).
 *
 * Imported for side-effects from `./index.ts` so the registration
 * happens at module load before any safe.call.
 */

import { Safety } from '@vigil/llm';

export const ENTITY_RESOLVE_ALIASES_PROMPT_NAME = 'entity.resolve-aliases';

/**
 * Doctrine-instruction-only user content. Aliases are NOT in this
 * string — they arrive at the model inside a `<source_document>` tag
 * supplied via SafeLlmRouter's `sources` parameter.
 */
export const ENTITY_RESOLVE_ALIASES_TASK =
  'From the aliases inside the <source_document id="aliases-pending-resolution"> tag, ' +
  'group by referent and emit canonical clusters. ' +
  'Output JSON: {"clusters":[{"canonical":"<name>","aliases":["..."],"kind":"person|company|public_body","confidence":<0..1>}]}. ' +
  'Disambiguation rules: ' +
  "treat 'Jean-Paul MBARGA', 'J.P. Mbarga', 'Mbarga J.' as the same person if context permits; " +
  'companies with identical RCCM numbers are the same company, otherwise treat them as distinct; ' +
  'confidence < 0.70 → output as separate single-element clusters (let the review queue handle it); ' +
  'if you cannot disambiguate, return {"status":"insufficient_evidence","reason":"..."}.';

Safety.globalPromptRegistry.register({
  name: ENTITY_RESOLVE_ALIASES_PROMPT_NAME,
  version: 'v1.0.0',
  description:
    'Alias clustering for Cameroonian person / company / public-body names across FR + EN. Block-D follow-up: lifted from packages/llm/src/safety/prompts.ts (doctrine-level only) into this worker-local file (per-worker pattern). Aliases are passed as a closed-context source (L4) at call time, not interpolated here. No verbatim-grounding requirement (this prompt does not cite source documents); output validated by zErResp.',
  render: () => ({
    system:
      '<doctrine preamble — closed-context render performed by SafeLlmRouter. The body of this prompt is ENTITY_RESOLVE_ALIASES_TASK above; the system rules come from AI-SAFETY-DOCTRINE-v1 DEFAULT_PREAMBLE.>',
    user: ENTITY_RESOLVE_ALIASES_TASK,
  }),
});
