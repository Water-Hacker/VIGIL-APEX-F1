import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import { createLogger, type Logger } from '@vigil/observability';
import { Errors } from '@vigil/shared';

import { CircuitBreaker } from '../circuit.js';
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
 */

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
      return {
        tier: 1,
        provider: this.name,
        model,
        content,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        costUsd: 0, // priced like Anthropic; MVP defers exact accounting
        latencyMs: Date.now() - start,
        degraded: false,
      };
    } catch (e) {
      this.circuit.recordFailure();
      this.logger.error({ err: e, model }, 'bedrock-call-failed');
      throw e;
    }
  }
}
