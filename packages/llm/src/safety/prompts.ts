/**
 * Canonical adversarial-pipeline prompt templates — AI-SAFETY-DOCTRINE-v1
 * §B.2, §B.4, §B.8, §B.9.
 *
 * SCOPE — DOCTRINE-LEVEL ONLY.
 *
 *   This file is for doctrine-level prompts shared across all workers
 *   (canaries, devil's-advocate, secondary-review, anchoring/order-
 *   effects). Per-worker prompts live in
 *   `apps/worker-{name}/src/prompts.ts`.
 *
 *   The distinction matters: doctrine-level prompts are the canonical
 *   set checked by `Safety.adversarialPromptsRegistered()` at every
 *   worker startup; their registration is part of the @vigil/llm
 *   package's public surface. Worker-level prompts are private to
 *   their worker, registered as a side-effect when the worker's
 *   index.ts imports its `./prompts.js`. Adding a new worker prompt
 *   here would force every other worker to inherit the registration
 *   transitively, which conflates audit ownership and makes per-
 *   worker template versioning harder to reason about.
 *
 *   When in doubt: if exactly one worker uses the prompt, it goes
 *   in that worker's `apps/worker-{name}/src/prompts.ts`. If two or
 *   more workers + the certainty-engine substrate use it, it goes
 *   here.
 *
 * Each template below is registered with `globalPromptRegistry` on
 * module load. The registry's snapshot hash is captured on every
 * certainty assessment via
 * `Schemas.CertaintyAssessment.prompt_registry_hash` so a future
 * reviewer can confirm exactly which prompt set was in use when the
 * assessment was produced.
 *
 * Prompts are deliberately defensive and structured. None ask Claude to
 * compute a probability score directly — the engine does that. They ask
 * Claude only what an LLM can reliably do: identify pattern matches,
 * spot exonerating context, and surface inconsistencies.
 */

import { globalPromptRegistry } from './prompt-registry.js';

import type { Schemas } from '@vigil/shared';

const NEUTRAL_FRAMING_HEADER = `You are a research assistant for an anti-corruption platform. You evaluate evidence; you do NOT decide guilt. The platform's Bayesian engine computes the probability of fraud — your only job is to surface what a careful reviewer should see.`;

interface DevilsAdvocateInput {
  readonly findingId: string;
  readonly components: ReadonlyArray<Schemas.CertaintyComponent>;
}

interface SecondaryReviewInput {
  readonly findingId: string;
  readonly components: ReadonlyArray<Schemas.CertaintyComponent>;
  readonly primaryPosterior: number;
}

interface OrderRandomisationInput {
  readonly findingId: string;
  readonly components: ReadonlyArray<Schemas.CertaintyComponent>;
  readonly seed: number;
}

function shuffle<T>(arr: ReadonlyArray<T> | undefined, seed: number): T[] {
  if (!arr || arr.length === 0) return [];
  // Mulberry32 — deterministic PRNG so the same seed yields the same shuffle.
  let s = seed >>> 0;
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function componentTable(components: ReadonlyArray<Schemas.CertaintyComponent> | undefined): string {
  if (!components || components.length === 0) return '(no components)';
  return components
    .map(
      (c) =>
        `- evidence_id=${c.evidence_id} pattern=${c.pattern_id ?? '-'} ` +
        `source=${c.source_id ?? '-'} strength=${c.strength.toFixed(2)} ` +
        `LR=${c.likelihood_ratio.toFixed(2)} weight=${c.effective_weight.toFixed(2)} ` +
        `roots=[${c.provenance_roots.join(',')}] quote=${
          c.verbatim_quote ? JSON.stringify(c.verbatim_quote) : 'null'
        } rationale=${JSON.stringify(c.rationale)}`,
    )
    .join('\n');
}

// 1) Citation extraction — the canonical hardened prompt every extractor uses.
globalPromptRegistry.register({
  name: 'extract.cited-claims',
  version: 'v1.0.0',
  description:
    'Extract structured cited claims with verbatim quotes. Output validated by zCitedExtraction; verbatim quotes are searched in the cited source field by validateVerbatimGrounding.',
  render: (input) => {
    const i = input as { task: string };
    return {
      system: NEUTRAL_FRAMING_HEADER,
      user:
        i.task ??
        'Return {"status":"ok","claims":[...]} where every claim has source_record_id, source_field, and a verbatim_quote you can find in that field.',
    };
  },
});

// 2) Devil's advocate — given the same evidence, find the strongest non-fraud
//    explanation. A coherent counter-narrative downgrades the assessment.
globalPromptRegistry.register({
  name: 'adversarial.devils-advocate',
  version: 'v1.0.0',
  description:
    'Devil-advocate pass per AI-SAFETY-DOCTRINE-v1 §B.2 / §B.9. Coherent counter-story → downgrade.',
  render: (input) => {
    const i = input as DevilsAdvocateInput;
    return {
      system:
        NEUTRAL_FRAMING_HEADER +
        '\n\nYou are now the DEFENCE. Argue, in good faith, the strongest reasonable explanation of the evidence below that is NOT fraud. Cite the specific component evidence_ids your alternative explanation relies on. Do not invent facts. If you cannot construct a coherent non-fraud story, return {"coherent": false, "summary": null}.',
      user:
        `Finding: ${i.findingId ?? '<unset>'}\n\nEvidence components:\n${componentTable(i.components)}\n\n` +
        'Output JSON: {"coherent": <boolean>, "summary": <string|null, max 1500 chars>}. Schema-validated.',
    };
  },
});

// 3) Independent secondary review — different framing, evaluates whether the
//    primary posterior is reasonable.
globalPromptRegistry.register({
  name: 'adversarial.secondary-review',
  version: 'v1.0.0',
  description:
    'Independent secondary review per AI-SAFETY-DOCTRINE-v1 §B.4. Different framing from primary; disagreement beyond tolerance → downgrade.',
  render: (input) => {
    const i = input as SecondaryReviewInput;
    return {
      system:
        NEUTRAL_FRAMING_HEADER +
        '\n\nYou are an INDEPENDENT REVIEWER assessing whether a primary analyst’s probability estimate is well-supported by the evidence. You did not see the primary analyst’s reasoning. Form your own view from the components below and report it.',
      user:
        `Finding: ${i.findingId ?? '<unset>'}\nPrimary analyst posterior: ${(i.primaryPosterior ?? 0).toFixed(3)}\n\nEvidence components:\n${componentTable(i.components)}\n\n` +
        'Output JSON: {"agreement": <boolean>, "secondary_posterior": <number in [0,1]>, "rationale": <string max 800 chars>}. agreement=true iff your independently-formed posterior is within 0.05 of the primary.',
    };
  },
});

// 4) Order randomisation — three passes with different evidence orders. The
//    seed determines the shuffled order so the same seed reproduces.
globalPromptRegistry.register({
  name: 'adversarial.evaluate-order',
  version: 'v1.0.0',
  description:
    'Order-randomisation pass per AI-SAFETY-DOCTRINE-v1 §B.8. Three runs at different seeds; spread > 0.05 → unstable.',
  render: (input) => {
    const i = input as OrderRandomisationInput;
    const ordered = shuffle(i.components, i.seed);
    return {
      system: NEUTRAL_FRAMING_HEADER,
      user:
        `Finding: ${i.findingId ?? '<unset>'}\nEvidence presentation seed: ${i.seed ?? 0}\n\nEvidence components (shuffled):\n${componentTable(ordered)}\n\n` +
        'Estimate, given ONLY these components, the posterior probability of fraud. Output JSON: {"posterior": <number in [0,1]>, "rationale": <string max 600 chars>}.',
    };
  },
});

// `entity.resolve-aliases` was registered here pre-Block-D; lifted to
// `apps/worker-entity/src/prompts.ts` per the doctrine-level / worker-
// level scope rule documented in the file header. See the
// SAFELLM-COVERAGE-INVENTORY architect call for context.

export const ADVERSARIAL_PROMPT_NAMES = [
  'extract.cited-claims',
  'adversarial.devils-advocate',
  'adversarial.secondary-review',
  'adversarial.evaluate-order',
] as const;

/** True iff every canonical doctrine prompt is registered. Used by
 *  worker startup to refuse boot when the registry is incomplete. */
export function adversarialPromptsRegistered(): boolean {
  return ADVERSARIAL_PROMPT_NAMES.every((name) => globalPromptRegistry.latest(name) !== null);
}
