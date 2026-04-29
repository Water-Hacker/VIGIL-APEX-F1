import { z } from 'zod';

import type { LlmEvaluator } from './adversarial.js';
import type { Schemas } from '@vigil/shared';

/**
 * Production `LlmEvaluator` backed by `@vigil/llm/SafeLlmRouter`.
 *
 * Lives here (rather than in `@vigil/llm`) because the engine is the
 * consumer of the evaluator interface. The constructor takes whatever
 * SafeLlmRouter-shaped object the worker has wired — typed structurally
 * so this package does not have to depend on @vigil/llm at type level.
 */

export interface SafeRouterShape {
  call<T>(input: {
    findingId: string | null;
    assessmentId: string | null;
    promptName: string;
    task: string;
    sources: ReadonlyArray<{ id: string; label?: string; text: string }>;
    responseSchema: import('zod').ZodType<T, import('zod').ZodTypeDef, unknown>;
    modelId: string;
    temperature?: number;
  }): Promise<{ value: T }>;
}

const zEvaluateOrderResponse = z.object({
  posterior: z.number().min(0).max(1),
  rationale: z.string().max(2_000),
});
const zDevilsAdvocateResponse = z.object({
  coherent: z.boolean(),
  summary: z.string().max(2_000).nullable(),
});
const zSecondaryReviewResponse = z.object({
  agreement: z.boolean(),
  secondary_posterior: z.number().min(0).max(1),
  rationale: z.string().max(2_000),
});

export interface ClaudeLlmEvaluatorOptions {
  readonly findingId: string;
  readonly assessmentId: string | null;
  readonly modelId: string;
}

/** Builds an LlmEvaluator that routes every adversarial pass through the
 *  SafeLlmRouter, recording each call to `llm.call_record`. */
export function createClaudeLlmEvaluator(
  router: SafeRouterShape,
  opts: ClaudeLlmEvaluatorOptions,
): LlmEvaluator {
  const componentSource = (
    components: ReadonlyArray<Schemas.CertaintyComponent>,
  ): ReadonlyArray<{ id: string; label?: string; text: string }> => [
    {
      id: 'components',
      label: 'finding-components',
      text: components
        .map(
          (c) =>
            `evidence_id=${c.evidence_id}; pattern=${c.pattern_id ?? '-'}; ` +
            `source=${c.source_id ?? '-'}; strength=${c.strength.toFixed(2)}; ` +
            `LR=${c.likelihood_ratio.toFixed(2)}; weight=${c.effective_weight.toFixed(2)}; ` +
            `roots=[${c.provenance_roots.join(',')}]; ` +
            `quote=${c.verbatim_quote ?? 'null'}; rationale=${c.rationale}`,
        )
        .join('\n'),
    },
  ];

  return {
    async evaluateOrder({ findingId, components, seed }) {
      const r = await router.call({
        findingId,
        assessmentId: opts.assessmentId,
        promptName: 'adversarial.evaluate-order',
        task: `Evaluate posterior under shuffled-evidence presentation seed=${seed}.`,
        sources: componentSource(components),
        responseSchema: zEvaluateOrderResponse,
        modelId: opts.modelId,
      });
      return { posterior: r.value.posterior, rationale: r.value.rationale };
    },
    async devilsAdvocate({ findingId, components }) {
      const r = await router.call({
        findingId,
        assessmentId: opts.assessmentId,
        promptName: 'adversarial.devils-advocate',
        task: 'Devil-advocate evaluation: produce the strongest non-fraud explanation if any is coherent.',
        sources: componentSource(components),
        responseSchema: zDevilsAdvocateResponse,
        modelId: opts.modelId,
      });
      return { coherent: r.value.coherent, summary: r.value.summary };
    },
    async secondaryReview({ findingId, components, primaryPosterior }) {
      const r = await router.call({
        findingId,
        assessmentId: opts.assessmentId,
        promptName: 'adversarial.secondary-review',
        task: `Independent secondary review. Primary analyst posterior = ${primaryPosterior.toFixed(3)}. Form your own posterior; agreement=true iff within 0.05.`,
        sources: componentSource(components),
        responseSchema: zSecondaryReviewResponse,
        modelId: opts.modelId,
      });
      return {
        agreement: r.value.agreement,
        secondaryPosterior: r.value.secondary_posterior,
      };
    },
  };
}
