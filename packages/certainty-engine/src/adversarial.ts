import type { Schemas } from '@vigil/shared';

import { ENGINE_VERSION, computePosterior } from './bayes.js';
import { counterfactualProbe } from './assess.js';

/**
 * Adversarial pipeline — AI-SAFETY-DOCTRINE-v1 Part B (failure modes 2, 3, 8, 9).
 *
 * Wraps four independent checks around the deterministic Bayesian core:
 *   1. Devil's-advocate Claude pass — given the same evidence, find the
 *      strongest non-fraud explanation. Coherent ⇒ downgrade.
 *   2. Counterfactual probe — drop the strongest single component;
 *      collapse below 0.95 ⇒ flag as fragile.
 *   3. Order randomisation — three Claude passes with shuffled evidence
 *      order; max-min span > 0.05 ⇒ flag as unstable.
 *   4. Independent secondary review — second Claude call with a different
 *      system prompt + framing; disagreement ⇒ downgrade.
 *
 * The Claude calls themselves are abstracted behind the `LlmEvaluator`
 * interface so the engine can be exercised against mocks in tests and
 * against the real provider in production.
 */

export interface LlmEvaluator {
  /** Returns the posterior the model would compute given a shuffled
   *  ordering of the evidence presented. Used for order randomisation. */
  evaluateOrder(opts: {
    findingId: string;
    components: ReadonlyArray<Schemas.CertaintyComponent>;
    seed: number;
  }): Promise<{ posterior: number; rationale: string }>;

  /** Returns whether the model can construct a coherent non-fraud story. */
  devilsAdvocate(opts: {
    findingId: string;
    components: ReadonlyArray<Schemas.CertaintyComponent>;
  }): Promise<{ coherent: boolean; summary: string | null }>;

  /** Independent secondary review with different framing. Returns whether
   *  it agrees with the primary posterior within tolerance. */
  secondaryReview(opts: {
    findingId: string;
    components: ReadonlyArray<Schemas.CertaintyComponent>;
    primaryPosterior: number;
  }): Promise<{ agreement: boolean; secondaryPosterior: number }>;
}

export interface RunAdversarialInput {
  readonly findingId: string;
  readonly prior: number;
  readonly components: ReadonlyArray<Schemas.CertaintyComponent>;
  readonly evaluator: LlmEvaluator;
  /** Order-disagreement tolerance in posterior space, default 0.05. */
  readonly orderToleranceProb?: number;
  /** Secondary-review tolerance, default 0.05. */
  readonly secondaryToleranceProb?: number;
}

export async function runAdversarial(
  input: RunAdversarialInput,
): Promise<Schemas.AdversarialOutcome> {
  const orderTol = input.orderToleranceProb ?? 0.05;
  const secondaryTol = input.secondaryToleranceProb ?? 0.05;

  // 1. Order randomisation — three passes.
  const orderRuns = await Promise.all(
    [1, 2, 3].map((seed) =>
      input.evaluator.evaluateOrder({
        findingId: input.findingId,
        components: input.components,
        seed,
      }),
    ),
  );
  const orderPosteriors = orderRuns.map((r) => r.posterior);
  const orderMin = Math.min(...orderPosteriors);
  const orderMax = Math.max(...orderPosteriors);
  const orderStable = orderMax - orderMin <= orderTol;

  // 2. Devil's advocate.
  const devil = await input.evaluator.devilsAdvocate({
    findingId: input.findingId,
    components: input.components,
  });

  // 3. Counterfactual probe — pure.
  const cf = counterfactualProbe({ prior: input.prior, components: input.components });

  // 4. Independent secondary review.
  const primaryPosterior = computePosterior({
    prior: input.prior,
    components: input.components,
  }).posterior;
  const secondary = await input.evaluator.secondaryReview({
    findingId: input.findingId,
    components: input.components,
    primaryPosterior,
  });
  const secondaryAgreement =
    secondary.agreement && Math.abs(secondary.secondaryPosterior - primaryPosterior) <= secondaryTol;

  return {
    devils_advocate_coherent: devil.coherent,
    devils_advocate_summary: devil.summary,
    counterfactual_robust: cf.robust,
    counterfactual_posterior: cf.posterior,
    order_randomisation_stable: orderStable,
    order_randomisation_min: orderMin,
    order_randomisation_max: orderMax,
    secondary_review_agreement: secondaryAgreement,
  };
}

/** Engine version emitted in adversarial summaries. */
export const ADVERSARIAL_VERSION = ENGINE_VERSION;
