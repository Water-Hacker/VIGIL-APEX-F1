import { createLogger, llmCallsTotal, type Logger } from '@vigil/observability';
import type { Secret } from '@vigil/security';
import { Errors } from '@vigil/shared';
import { z } from 'zod';

import { CostTracker } from './cost.js';
import { assertGuardsPass, type GuardContext } from './guards.js';
import { wrapSystemPrompt } from './meta-wrapper.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { BedrockProvider } from './providers/bedrock.js';
import { LocalLlmProvider } from './providers/local.js';
import {
  TASK_MODEL,
  TASK_TEMPERATURE,
  type LlmCallOptions,
  type LlmCallResult,
  type LlmModelClass,
  type LlmTaskClass,
  type ProviderClient,
} from './types.js';

/**
 * LlmRouter — single entry point for every LLM call in VIGIL APEX.
 *
 * Responsibilities:
 *   - Pick the model class for the task class (configurable via TASK_MODEL)
 *   - Pick the provider tier (Anthropic > Bedrock > Local) honouring circuits
 *   - Wrap the system prompt with the anti-hallucination meta-wrapper
 *   - Call the provider with task-class-bound temperature
 *   - Run the 12 anti-hallucination guards on the response
 *   - Track USD cost and enforce daily ceilings
 *   - Emit Prometheus metrics + structured logs
 *
 * Workers receive an `LlmRouter` and never see provider implementations.
 */

export interface LlmRouterOptions {
  readonly anthropicApiKey: Secret<string>;
  readonly bedrockEnabled?: boolean;
  readonly localEnabled?: boolean;
  readonly costTracker?: CostTracker;
  readonly logger?: Logger;
}

export class LlmRouter {
  private readonly providers: readonly ProviderClient[];
  private readonly cost: CostTracker;
  private readonly logger: Logger;

  constructor(opts: LlmRouterOptions) {
    this.logger = opts.logger ?? createLogger({ service: 'llm-router' });
    this.cost = opts.costTracker ?? new CostTracker();

    const t0 = new AnthropicProvider({ apiKey: opts.anthropicApiKey });
    const providers: ProviderClient[] = [t0];

    if (opts.bedrockEnabled !== false && process.env.AWS_BEDROCK_ENABLED !== 'false') {
      providers.push(new BedrockProvider());
    }
    if (opts.localEnabled === true || process.env.LOCAL_LLM_ENABLED === 'true') {
      providers.push(new LocalLlmProvider());
    }

    this.providers = providers;
  }

  /**
   * Make an LLM call.
   *
   * @param opts Call options (task, system, user, optional schema/cache).
   * @param ctx  Guard context — required when calling for extraction so L7
   *             quote-match can verify excerpts against source documents.
   */
  async call<T>(
    opts: LlmCallOptions & { responseSchema?: z.ZodType<T, z.ZodTypeDef, unknown> },
    ctx?: GuardContext,
  ): Promise<LlmCallResult<T extends string ? string : T>> {
    this.cost.enforceBeforeCall();

    const modelClass: LlmModelClass = opts.modelClassOverride ?? TASK_MODEL[opts.task];
    const temperature = opts.temperatureOverride ?? TASK_TEMPERATURE[opts.task];
    const wrappedSystem = wrapSystemPrompt(opts.system, {
      templateVersion: 'router-v1',
      templateDate: new Date().toISOString().slice(0, 10),
    });
    const callOpts: LlmCallOptions = {
      ...opts,
      system: wrappedSystem,
      temperatureOverride: temperature,
    };

    let lastErr: unknown;
    for (const provider of this.providers) {
      if (!provider.isHealthy()) {
        this.logger.warn({ provider: provider.name }, 'skip-unhealthy-provider');
        continue;
      }
      try {
        const result = await provider.call(callOpts, modelClass);

        // Cost tracking
        this.cost.record({
          model: result.model,
          modelClass,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
          at: Date.now(),
        });
        llmCallsTotal
          .labels({
            provider: result.provider,
            model: result.model,
            tier: String(result.tier),
            outcome: 'ok',
          })
          .inc();

        // Parse against schema + run guards
        let typedContent: unknown = result.content;
        if (opts.responseSchema) {
          try {
            typedContent = opts.responseSchema.parse(JSON.parse(result.content));
          } catch (parseErr) {
            llmCallsTotal
              .labels({
                provider: result.provider,
                model: result.model,
                tier: String(result.tier),
                outcome: 'schema_violation',
              })
              .inc();
            throw new Errors.LlmHallucinationDetectedError('L1', {
              reason: parseErr instanceof Error ? parseErr.message : 'schema parse failed',
            });
          }
        }
        if (ctx) {
          assertGuardsPass(typedContent, {
            ...ctx,
            temperatureUsed: temperature,
            temperatureMax: TASK_TEMPERATURE[opts.task],
          });
        }
        return { ...result, content: typedContent as T extends string ? string : T };
      } catch (e) {
        lastErr = e;
        this.logger.warn({ err: e, provider: provider.name }, 'provider-call-failed');
        llmCallsTotal
          .labels({ provider: provider.name, model: 'unknown', tier: 'n/a', outcome: 'error' })
          .inc();
        // Try next provider
      }
    }

    throw new Errors.VigilError({
      code: 'LLM_ALL_TIERS_FAILED',
      message: 'All LLM tiers failed',
      severity: 'error',
      cause: lastErr,
    });
  }
}
