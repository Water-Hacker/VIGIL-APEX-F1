import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import { createLogger, llmRateLimitExhaustedTotal, type Logger } from '@vigil/observability';
import { Errors } from '@vigil/shared';

import { CircuitBreaker } from '../circuit.js';
import { bedrockCostUsd } from '../pricing.js';
import {
  TASK_TEMPERATURE,
  type LlmCallOptions,
  type LlmCallResult,
  type LlmModelClass,
  type ProviderClient,
} from '../types.js';

/**
 * Tier 1 — Amazon Bedrock failover (Claude on AWS).
 *
 * Activated automatically by the LlmRouter when Tier 0's circuit breaker is
 * open. Same model identity, different serving infrastructure. Per MVP §03.4
 * cost is $0 baseline; only billed on activation.
 *
 * Block-A reconciliation §2.A.5 — the previous implementation returned
 * `costUsd: 0` from every Bedrock call. On a Tier-0 → Tier-1 failover,
 * the cost-tracker therefore saw a zero-cost stream and the daily/monthly
 * ceilings stayed inert. Now we resolve the model_id against the
 * pricing table and apply the `aws_bedrock_premium_multiplier`
 * field. AWS bills Claude on Bedrock at parity with Anthropic-direct
 * rates today (multiplier = 1.0); the field exists so a per-request
 * surcharge or rate divergence surfaces as a one-line config change.
 *
 * Bedrock SKUs are namespaced with an `anthropic.` prefix
 * (`anthropic.claude-opus-4-7`); pricing.json uses the bare Anthropic
 * model_id. We strip the prefix at lookup time so the table stays
 * single-keyed.
 */
function stripBedrockNamespace(bedrockModelId: string): string {
  return bedrockModelId.startsWith('anthropic.')
    ? bedrockModelId.slice('anthropic.'.length)
    : bedrockModelId;
}

/**
 * Mode 6.4 follow-up — Bedrock rate-limit detection.
 *
 * The Anthropic-direct SDK ships a typed `RateLimitError` (closed in
 * the Cat-6 mode 6.4 commit). The Bedrock SDK doesn't re-export AWS
 * error types; instead, AWS throws instances of
 * `@aws-sdk/client-bedrock-runtime`'s `ThrottlingException` /
 * `ServiceQuotaExceededException`. Both carry `.name` matching the
 * exception name (AWS SDK v3 convention) and `.$metadata` shape.
 *
 * We duck-type via `.name` to avoid pulling `@aws-sdk/client-bedrock-runtime`
 * as a direct dep (it's already transitive via the Bedrock SDK; importing
 * it directly would pin the version twice).
 *
 * Returns true for any AWS exception that operators should see as
 * "we're being throttled" — not "the model errored" — in the
 * `llm_rate_limit_exhausted_total` Prometheus counter.
 */
function isBedrockRateLimitError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: string }).name;
  if (typeof name !== 'string') return false;
  return (
    name === 'ThrottlingException' ||
    name === 'ServiceQuotaExceededException' ||
    name === 'TooManyRequestsException'
  );
}

export interface BedrockProviderOptions {
  readonly region?: string;
  readonly logger?: Logger;
  readonly modelOpus?: string;
  readonly modelSonnet?: string;
  readonly modelHaiku?: string;
  readonly circuit?: CircuitBreaker;
}

export class BedrockProvider implements ProviderClient {
  public readonly name = 'bedrock' as const;
  private readonly client: AnthropicBedrock;
  private readonly logger: Logger;
  private readonly modelByClass: Record<LlmModelClass, string>;
  private readonly circuit: CircuitBreaker;

  constructor(opts: BedrockProviderOptions = {}) {
    this.logger = opts.logger ?? createLogger({ service: 'llm-bedrock' });
    this.client = new AnthropicBedrock({
      awsRegion: opts.region ?? process.env.AWS_BEDROCK_REGION ?? 'eu-west-1',
    });
    this.modelByClass = {
      opus: opts.modelOpus ?? process.env.AWS_BEDROCK_MODEL_OPUS ?? 'anthropic.claude-opus-4-7',
      sonnet:
        opts.modelSonnet ?? process.env.AWS_BEDROCK_MODEL_SONNET ?? 'anthropic.claude-sonnet-4-6',
      haiku:
        opts.modelHaiku ??
        process.env.AWS_BEDROCK_MODEL_HAIKU ??
        'anthropic.claude-haiku-4-5-20251001',
    };
    this.circuit =
      opts.circuit ??
      new CircuitBreaker({
        name: 'bedrock',
        failureThreshold: 5,
        failureWindowMs: 60_000,
        probeIntervalMs: 60_000,
        latencyTimeoutMs: 60_000,
      });
  }

  isHealthy(): boolean {
    return !this.circuit.isOpen();
  }

  async call(opts: LlmCallOptions, modelClass: LlmModelClass): Promise<LlmCallResult> {
    if (this.circuit.isOpen()) throw new Errors.LlmCircuitOpenError(this.name);
    const model = this.modelByClass[modelClass];
    const temperature = opts.temperatureOverride ?? TASK_TEMPERATURE[opts.task];
    const start = Date.now();

    try {
      const res = await this.client.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 4096,
        temperature,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      });
      this.circuit.recordSuccess();
      const content = res.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('\n');
      // Block-A reconciliation §2.A.5 — actual cost accounting on the
      // Tier-1 failover path. Strip the `anthropic.` Bedrock namespace
      // so the pricing-table lookup uses the same key as the
      // Anthropic-direct provider, then apply the per-model
      // aws_bedrock_premium_multiplier. Throws
      // LlmPricingNotConfiguredError when the model_id has no entry
      // — we will not silently zero-cost the call.
      const inputTokens = res.usage.input_tokens;
      const outputTokens = res.usage.output_tokens;
      const cost = bedrockCostUsd(stripBedrockNamespace(model), inputTokens, outputTokens);
      return {
        tier: 1,
        provider: this.name,
        model,
        content,
        inputTokens,
        outputTokens,
        costUsd: cost,
        latencyMs: Date.now() - start,
        degraded: false,
      };
    } catch (e) {
      this.circuit.recordFailure();
      // Mode 6.4 — surface rate-limit exhaustion as a distinct signal
      // (mirrors the Anthropic-direct provider). AWS Bedrock throws
      // ThrottlingException / ServiceQuotaExceededException /
      // TooManyRequestsException via the underlying @aws-sdk/client-
      // bedrock-runtime; we duck-type via `.name` per the helper above.
      if (isBedrockRateLimitError(e)) {
        llmRateLimitExhaustedTotal.inc({ provider: this.name, model });
        this.logger.warn(
          { model, errorName: (e as { name?: string }).name },
          'bedrock-rate-limit-exhausted; AWS Bedrock throttle / quota signal',
        );
      } else {
        this.logger.error({ err: e, model }, 'bedrock-call-failed');
      }
      throw e;
    }
  }
}
