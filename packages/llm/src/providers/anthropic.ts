import Anthropic, { RateLimitError } from '@anthropic-ai/sdk';
import { createLogger, llmRateLimitExhaustedTotal, type Logger } from '@vigil/observability';
import { expose, type Secret } from '@vigil/security';
import { Errors } from '@vigil/shared';

import { CircuitBreaker } from '../circuit.js';
import { anthropicCostUsd } from '../pricing.js';
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
      haiku: opts.modelHaiku ?? process.env.ANTHROPIC_MODEL_HAIKU ?? 'claude-haiku-4-5-20251001',
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

    // Phase D5 — Batch API. Anthropic's `client.messages.batches.create`
    // queues up to 24h; pricing is 50% off. We only opt into batch mode
    // when the caller has set `opts.batch: true` AND the SDK exposes
    // batches; otherwise we fall back to the synchronous endpoint.
    if (opts.batch && (this.client as { messages?: { batches?: unknown } }).messages?.batches) {
      return this.callBatch(opts, modelClass, model, temperature, maxTokens);
    }

    const start = Date.now();
    try {
      // Prompt caching on the system block (SDK ≥ 0.91): the 12-layer
      // anti-hallucination wrapper (SRD §20) is byte-identical across every
      // call from the same worker, so we mark it cacheable with a 1h TTL.
      // Cached reads bill at ~10% of normal input-token cost; the longer
      // TTL beats the default 5m for VIGIL's steady-state load (workers
      // typically issue > 1 call per minute against the same system block).
      const res = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        ...(opts.stopSequences !== undefined && { stop_sequences: [...opts.stopSequences] }),
        system: [
          {
            type: 'text',
            text: opts.system,
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
        ],
        messages: [{ role: 'user', content: opts.user }],
      });
      const latencyMs = Date.now() - start;
      if (this.circuit.isLatencyExceeded(latencyMs)) {
        this.circuit.recordTimeout();
      } else {
        this.circuit.recordSuccess();
      }

      const content = this.extractText(res);
      const usage = res.usage as Anthropic.Usage & {
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
      };
      const inputTokens = usage.input_tokens;
      const outputTokens = usage.output_tokens;
      const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
      const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
      // Block-A reconciliation §2.A.4 — pricing keyed by model_id
      // (NOT modelClass). Throws LlmPricingNotConfiguredError if the
      // entry is missing — no silent zero-cost fallback.
      const cost = anthropicCostUsd(
        model,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
      );

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
      // Mode 6.4 — surface rate-limit exhaustion as a distinct signal.
      // The SDK retries 429 internally (default 3); when those retries
      // are exhausted the SDK throws RateLimitError. We log it
      // separately and increment a typed Prometheus counter so
      // operators see "we're being throttled" vs. "the model errored."
      if (e instanceof RateLimitError) {
        llmRateLimitExhaustedTotal.inc({ provider: this.name, model });
        this.logger.warn(
          { model, task: opts.task },
          'anthropic-rate-limit-exhausted; SDK retries (default 3) were not enough',
        );
      } else {
        this.logger.error({ err: e, model, task: opts.task }, 'anthropic-call-failed');
      }
      throw e;
    }
  }

  /**
   * Submit one item to the Anthropic Message Batches API and poll
   * for completion. Discount: ~50% on input + output tokens. SLA: 24h
   * but typical < 1h for small batches. We submit a single-item batch
   * per call so the existing call signature stays synchronous from
   * the worker's perspective; for true bulk savings the router can
   * be extended in Phase D5b to coalesce N calls into one batch.
   */
  private async callBatch(
    opts: LlmCallOptions,
    modelClass: LlmModelClass,
    model: string,
    temperature: number,
    maxTokens: number,
  ): Promise<LlmCallResult> {
    const start = Date.now();
    const customId = `vigil-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const batchClient = (
      this.client as unknown as {
        messages: {
          batches: {
            create: (b: unknown) => Promise<{ id: string }>;
            retrieve: (id: string) => Promise<{
              processing_status: 'in_progress' | 'ended';
              results_url: string | null;
            }>;
            results: (id: string) => AsyncIterable<{
              custom_id: string;
              result:
                | { type: 'succeeded'; message: Anthropic.Message }
                | { type: 'errored'; error: { type: string; message: string } };
            }>;
          };
        };
      }
    ).messages.batches;

    const created = await batchClient.create({
      requests: [
        {
          custom_id: customId,
          params: {
            model,
            max_tokens: maxTokens,
            temperature,
            ...(opts.stopSequences !== undefined && { stop_sequences: [...opts.stopSequences] }),
            system: [
              { type: 'text', text: opts.system, cache_control: { type: 'ephemeral', ttl: '1h' } },
            ],
            messages: [{ role: 'user', content: opts.user }],
          },
        },
      ],
    });

    // Poll with exponential backoff: 5s, 10s, 30s, 60s, 60s, 60s…
    // Capped at 30 minutes total — caller can re-enqueue if longer.
    const delays = [5_000, 10_000, 30_000, 60_000];
    let attempt = 0;
    const deadline = Date.now() + 30 * 60_000;
    let status: 'in_progress' | 'ended' = 'in_progress';
    while (status === 'in_progress' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, delays[attempt] ?? 60_000));
      attempt = Math.min(attempt + 1, delays.length - 1);
      const s = await batchClient.retrieve(created.id);
      status = s.processing_status;
    }
    if (status !== 'ended') {
      throw new Errors.LlmError({
        code: 'LLM_BATCH_TIMEOUT',
        message: `batch ${created.id} did not complete within 30m`,
      });
    }

    let message: Anthropic.Message | null = null;
    for await (const r of batchClient.results(created.id)) {
      if (r.custom_id !== customId) continue;
      if (r.result.type === 'succeeded') message = r.result.message;
      else
        throw new Errors.LlmError({
          code: 'LLM_BATCH_ITEM_ERROR',
          message: `${r.result.error.type}: ${r.result.error.message}`,
        });
    }
    if (!message) {
      throw new Errors.LlmError({
        code: 'LLM_BATCH_NO_RESULT',
        message: `no result for custom_id ${customId}`,
      });
    }

    const usage = message.usage;
    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    // Batch billing — half of standard. Block-A reconciliation §2.A.4
    // — keyed by model_id (NOT modelClass).
    const cost = anthropicCostUsd(model, inputTokens, outputTokens) * 0.5;

    this.circuit.recordSuccess();
    return {
      tier: 0,
      provider: this.name,
      model,
      content: this.extractText(message),
      inputTokens,
      outputTokens,
      costUsd: cost,
      latencyMs: Date.now() - start,
      degraded: false,
    };
  }

  private extractText(res: Anthropic.Message): string {
    const out: string[] = [];
    for (const block of res.content) {
      if (block.type === 'text') out.push(block.text);
    }
    return out.join('\n');
  }
}

// `computeCostUsd` removed — Block-A reconciliation §2.A.4 moved
// pricing into `infra/llm/pricing.json`, keyed by exact model_id.
// `anthropicCostUsd` from ../pricing.js is the canonical entry point.

export type { LlmTaskClass };
