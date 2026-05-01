/**
 * Block-A reconciliation §2.A.4 + §2.A.5 — LLM pricing table.
 *
 * Loaded once at module init from `infra/llm/pricing.json`. The file
 * is keyed by EXACT `model_id` (e.g. 'claude-opus-4-7',
 * 'claude-haiku-4-5-20251001'), NOT by `model_class`. Two reasons:
 *
 *   - The model_class abstraction was lossy. When TRUTH §C bumped
 *     from 'claude-opus-4-6' to 'claude-opus-4-7', the modelClass
 *     stayed 'opus' and the cost-accounting code never noticed; the
 *     prices baked in `Constants.ANTHROPIC_PRICING_USD_PER_MTOK`
 *     drifted relative to the rate card.
 *
 *   - Bedrock charges a per-request premium that is per-model_id
 *     (Anthropic-on-Bedrock "Sonnet 4.6" is not the same SKU as the
 *     direct Anthropic Sonnet 4.6); modelling that requires a
 *     model_id key.
 *
 * On a missing entry we throw `LlmPricingNotConfiguredError` instead
 * of silently zero-cost-ing the call. The daily and monthly cost
 * ceilings depend on accurate per-call cost; falling through to a
 * default would leave them inert on a model swap.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { Errors } from '@vigil/shared';

export interface ModelPricing {
  readonly provider: 'anthropic' | 'bedrock';
  readonly model_class: 'opus' | 'sonnet' | 'haiku';
  readonly input_per_mtok_usd: number;
  readonly output_per_mtok_usd: number;
  readonly cache_creation_multiplier: number;
  readonly cache_read_multiplier: number;
  readonly aws_bedrock_premium_multiplier: number;
  readonly effective_date: string;
}

export interface PricingTable {
  readonly schema_version: number;
  readonly generated_at: string;
  readonly models: Readonly<Record<string, ModelPricing>>;
}

let cached: PricingTable | null = null;

/**
 * Resolve the pricing.json path. Tests can override via env
 * `VIGIL_LLM_PRICING_PATH`; the default walks up from `process.cwd()`
 * looking for `infra/llm/pricing.json`.
 */
function resolvePricingPath(): string {
  const env = process.env.VIGIL_LLM_PRICING_PATH;
  if (env !== undefined && env !== '') return env;
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, 'infra', 'llm', 'pricing.json');
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      /* keep walking */
    }
    const next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  // Final fallback: the repo-root path computed relative to this file.
  // packages/llm/src/pricing.ts → ../../../infra/llm/pricing.json
  return path.resolve(__dirname, '..', '..', '..', 'infra', 'llm', 'pricing.json');
}

export function loadPricingTable(): PricingTable {
  if (cached !== null) return cached;
  const p = resolvePricingPath();
  const raw = readFileSync(p, 'utf8');
  cached = JSON.parse(raw) as PricingTable;
  return cached;
}

/** Reset the module cache. Test-only. */
export function _resetPricingCache(): void {
  cached = null;
}

export function getModelPricing(modelId: string): ModelPricing {
  const t = loadPricingTable();
  const entry = t.models[modelId];
  if (entry === undefined) {
    throw new Errors.LlmPricingNotConfiguredError(modelId, 'anthropic');
  }
  return entry;
}

/**
 * Compute the Anthropic-direct USD cost for a call. Throws
 * `LlmPricingNotConfiguredError` when the model_id has no entry.
 */
export function anthropicCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens = 0,
  cacheReadTokens = 0,
): number {
  const p = getModelPricing(modelId);
  return (
    (inputTokens * p.input_per_mtok_usd) / 1_000_000 +
    (outputTokens * p.output_per_mtok_usd) / 1_000_000 +
    (cacheCreationTokens * p.input_per_mtok_usd * p.cache_creation_multiplier) / 1_000_000 +
    (cacheReadTokens * p.input_per_mtok_usd * p.cache_read_multiplier) / 1_000_000
  );
}

/**
 * Compute the Bedrock (AWS-billed) USD cost. Multiplies the
 * Anthropic-direct cost by `aws_bedrock_premium_multiplier`. The
 * Bedrock provider should ALWAYS use this fn so that failover from
 * Tier-0 Anthropic to Tier-1 Bedrock surfaces the correct cost on the
 * daily ceiling.
 */
export function bedrockCostUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const p = getModelPricing(modelId);
  const direct = anthropicCostUsd(modelId, inputTokens, outputTokens);
  return direct * p.aws_bedrock_premium_multiplier;
}
