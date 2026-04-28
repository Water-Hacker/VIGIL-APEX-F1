import Anthropic from '@anthropic-ai/sdk';
import { createLogger, type Logger } from '@vigil/observability';
import { expose, type Secret } from '@vigil/security';
import { Errors } from '@vigil/shared';

import { CircuitBreaker } from '../circuit.js';
import {
  TASK_TEMPERATURE,
  type LlmCallOptions,
  type LlmCallResult,
  type LlmModelClass,
  type LlmTaskClass,
  type ProviderClient,
} from '../types.js';

/**
 * Tier 0 — Anthropic direct.
 *
 * Per SRD §18.2: Opus / Sonnet / Haiku are the three model classes; the env
 * variables ANTHROPIC_MODEL_{OPUS,SONNET,HAIKU} pin the exact model IDs so a
 * model rev-swap is a config change, not a code deploy.
 */

export interface AnthropicProviderOptions {
  readonly apiKey: Secret<string>;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly logger?: Logger;
  readonly modelOpus?: string;
  readonly modelSonnet?: string;
  readonly modelHaiku?: string;
  readonly circuit?: CircuitBreaker;
}

export class AnthropicProvider implements ProviderClient {
  public readonly name = 'anthropic' as const;
  private readonly client: Anthropic;
  private readonly logger: Logger;
  private readonly modelByClass: Record<LlmModelClass, string>;
  private readonly circuit: CircuitBreaker;

  constructor(opts: AnthropicProviderOptions) {
    this.logger = opts.logger ?? createLogger({ service: 'llm-anthropic' });
    this.client = new Anthropic({
      apiKey: expose(opts.apiKey),
      baseURL: opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
      timeout: opts.timeoutMs ?? Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 60_000),
      maxRetries: opts.maxRetries ?? Number(process.env.ANTHROPIC_MAX_RETRIES ?? 3),
    });
    this.modelByClass = {
      opus: opts.modelOpus ?? process.env.ANTHROPIC_MODEL_OPUS ?? 'claude-opus-4-7',
      sonnet: opts.modelSonnet ?? process.env.ANTHROPIC_MODEL_SONNET ?? 'claude-sonnet-4-6',
      haiku:
        opts.modelHaiku ??
        process.env.ANTHROPIC_MODEL_HAIKU ??
        'claude-haiku-4-5-20251001',
    };
    this.circuit =
      opts.circuit ??
      new CircuitBreaker({
        name: 'anthropic',
        failureThreshold: Number(process.env.LLM_CIRCUIT_FAILURE_THRESHOLD ?? 3),
        failureWindowMs: Number(process.env.LLM_CIRCUIT_FAILURE_WINDOW_MS ?? 60_000),
        probeIntervalMs: Number(process.env.LLM_CIRCUIT_PROBE_INTERVAL_MS ?? 60_000),
        latencyTimeoutMs: Number(process.env.LLM_CIRCUIT_TIMEOUT_LATENCY_MS ?? 30_000),
      });
  }

  isHealthy(): boolean {
    return !this.circuit.isOpen();
  }

  async call(opts: LlmCallOptions, modelClass: LlmModelClass): Promise<LlmCallResult> {
    if (this.circuit.isOpen()) {
      throw new Errors.LlmCircuitOpenError(this.name);
    }
    const model = this.modelByClass[modelClass];
    const temperature = opts.temperatureOverride ?? TASK_TEMPERATURE[opts.task];
    const maxTokens = opts.maxTokens ?? 4096;

    const start = Date.now();
    try {
      const res = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        ...(opts.stopSequences !== undefined && { stop_sequences: [...opts.stopSequences] }),
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      });
      const latencyMs = Date.now() - start;
      if (this.circuit.isLatencyExceeded(latencyMs)) {
        this.circuit.recordTimeout();
      } else {
        this.circuit.recordSuccess();
      }

      const content = this.extractText(res);
      const inputTokens = res.usage.input_tokens;
      const outputTokens = res.usage.output_tokens;
      const cost = computeCostUsd(modelClass, inputTokens, outputTokens);

      return {
        tier: 0,
        provider: this.name,
        model,
        content,
        inputTokens,
        outputTokens,
        costUsd: cost,
        latencyMs,
        degraded: false,
      };
    } catch (e) {
      this.circuit.recordFailure();
      this.logger.error({ err: e, model, task: opts.task }, 'anthropic-call-failed');
      throw e;
    }
  }

  private extractText(res: Anthropic.Message): string {
    const out: string[] = [];
    for (const block of res.content) {
      if (block.type === 'text') out.push(block.text);
    }
    return out.join('\n');
  }
}

function computeCostUsd(modelClass: LlmModelClass, inTok: number, outTok: number): number {
  const p = {
    opus: { input: 5.0, output: 25.0 },
    sonnet: { input: 3.0, output: 15.0 },
    haiku: { input: 1.0, output: 5.0 },
  }[modelClass];
  return (inTok * p.input) / 1_000_000 + (outTok * p.output) / 1_000_000;
}

export type { LlmTaskClass };
