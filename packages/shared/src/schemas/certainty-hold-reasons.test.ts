/**
 * Tier-36 audit closure — `adversarial_pipeline_failed` HoldReason.
 *
 * worker-counter-evidence sets this when the adversarial pipeline
 * itself fails to execute (LLM outage, evaluator exception). Pre-T36
 * the catch branch logged + kept going — leaving the assessment row
 * from worker-score with DEFAULT_ADVERSARIAL = passed-everything,
 * which meant the council saw the finding at action_queue tier as
 * if every check had passed. Silent false-positive promotion.
 *
 * The schema now accepts the new reason so the downgraded assessment
 * row can be persisted; these tests pin that the enum and its
 * inferred type both carry the new value.
 */
import { describe, expect, it } from 'vitest';

import { zHoldReason, type HoldReason } from './certainty.js';

describe('Tier-36 — adversarial_pipeline_failed HoldReason', () => {
  it('accepts adversarial_pipeline_failed as a valid HoldReason value', () => {
    const parsed = zHoldReason.safeParse('adversarial_pipeline_failed');
    expect(parsed.success).toBe(true);
  });

  it('rejects a similar-but-wrong reason (no silent typo acceptance)', () => {
    const parsed = zHoldReason.safeParse('adversarial_failed');
    expect(parsed.success).toBe(false);
  });

  it('TypeScript HoldReason union admits the new literal', () => {
    const r: HoldReason = 'adversarial_pipeline_failed';
    expect(r).toBe('adversarial_pipeline_failed');
  });

  it('schema still accepts the pre-existing reasons (no regression)', () => {
    const survivors: HoldReason[] = [
      'order_randomisation_disagreement',
      'devils_advocate_coherent',
      'counterfactual_collapse',
      'secondary_review_disagreement',
      'sources_below_minimum',
      'verbatim_grounding_failed',
      'schema_validation_failed',
      'canary_triggered',
      'cluster_dependency',
      'lost_in_middle_regression',
    ];
    for (const r of survivors) {
      expect(zHoldReason.safeParse(r).success).toBe(true);
    }
  });
});
