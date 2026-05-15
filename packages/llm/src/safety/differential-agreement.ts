/**
 * Layer 15 — Differential model agreement.
 *
 * Closes FRONTIER-AUDIT Layer-1 E1.3 gap #3: SafeLlmRouter today
 * fails-over between Anthropic API and AWS Bedrock — same model,
 * different infrastructure. That catches infrastructure outages but
 * NOT model-specific failure modes. A single-provider hallucination,
 * a model-version-specific bias, or a single-provider safety-
 * training regression would silently corrupt the platform's outputs.
 *
 * Frontier mitigation: for high-significance findings, the same
 * factual question is asked to TWO independent provider/model
 * families. If they disagree materially, the finding is held for
 * human review. If they agree, the finding proceeds with the
 * confidence boost of cross-provider corroboration.
 *
 * Provider families intended:
 *   - Anthropic Claude (sonnet pinned)
 *   - Mistral Large (via self-hosted on Hetzner GPU OR via Bedrock)
 *
 * Disagreement test is domain-specific. For binary classification
 * tasks (fraud / not-fraud), simple equality. For posterior-
 * probability tasks, an absolute-delta threshold (default 0.10).
 * For free-text extraction tasks, semantic-equivalence via a
 * third LLM call (off by default — too expensive for routine use).
 */

export interface DifferentialAgreementInput {
  /** Output from the primary provider call. */
  readonly primary: {
    readonly value: unknown;
    readonly provider_path: string;
    readonly model_id: string;
  };
  /** Output from the secondary provider call (different model family). */
  readonly secondary: {
    readonly value: unknown;
    readonly provider_path: string;
    readonly model_id: string;
  };
  /** Comparator. */
  readonly comparator: DifferentialComparator;
  /** Threshold for numerical comparators (default 0.10). */
  readonly threshold?: number;
}

export type DifferentialComparator =
  | { kind: 'exact' }
  | { kind: 'numeric_within'; threshold: number }
  | { kind: 'set_jaccard'; minJaccard: number };

export interface DifferentialAgreementResult {
  readonly verdict: 'agreed' | 'disagreed';
  readonly rationale: string;
  readonly primary_provider: string;
  readonly secondary_provider: string;
  readonly delta?: number;
}

export function evaluateDifferentialAgreement(
  input: DifferentialAgreementInput,
): DifferentialAgreementResult {
  const { primary, secondary, comparator } = input;
  if (primary.provider_path === secondary.provider_path) {
    throw new Error(
      `differential-agreement requires DIFFERENT provider paths; got ${primary.provider_path} twice`,
    );
  }

  switch (comparator.kind) {
    case 'exact': {
      const agreed = primary.value === secondary.value;
      return {
        verdict: agreed ? 'agreed' : 'disagreed',
        rationale: agreed
          ? `both providers returned ${JSON.stringify(primary.value)}`
          : `primary=${JSON.stringify(primary.value)}, secondary=${JSON.stringify(secondary.value)}`,
        primary_provider: primary.provider_path,
        secondary_provider: secondary.provider_path,
      };
    }
    case 'numeric_within': {
      const p = Number(primary.value);
      const s = Number(secondary.value);
      if (!Number.isFinite(p) || !Number.isFinite(s)) {
        return {
          verdict: 'disagreed',
          rationale: `non-numeric output: primary=${primary.value}, secondary=${secondary.value}`,
          primary_provider: primary.provider_path,
          secondary_provider: secondary.provider_path,
        };
      }
      const delta = Math.abs(p - s);
      const agreed = delta <= comparator.threshold;
      return {
        verdict: agreed ? 'agreed' : 'disagreed',
        rationale: `delta=${delta.toFixed(3)} ${agreed ? '≤' : '>'} threshold=${comparator.threshold}`,
        primary_provider: primary.provider_path,
        secondary_provider: secondary.provider_path,
        delta,
      };
    }
    case 'set_jaccard': {
      const a = new Set<string>(asStringArray(primary.value));
      const b = new Set<string>(asStringArray(secondary.value));
      const intersection = new Set<string>([...a].filter((x) => b.has(x)));
      const union = new Set<string>([...a, ...b]);
      const jaccard = union.size === 0 ? 1 : intersection.size / union.size;
      const agreed = jaccard >= comparator.minJaccard;
      return {
        verdict: agreed ? 'agreed' : 'disagreed',
        rationale: `jaccard=${jaccard.toFixed(2)} ${agreed ? '≥' : '<'} min=${comparator.minJaccard}`,
        primary_provider: primary.provider_path,
        secondary_provider: secondary.provider_path,
        delta: 1 - jaccard,
      };
    }
  }
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return [];
}
