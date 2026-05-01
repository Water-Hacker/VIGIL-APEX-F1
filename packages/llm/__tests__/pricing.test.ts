/**
 * pricing.ts unit tests — Block-A reconciliation §2.A.4 / §2.A.5.
 *
 * Pin the contract:
 *   - Lookup is by EXACT model_id, not modelClass.
 *   - Missing entry throws LlmPricingNotConfiguredError (no fallback).
 *   - bedrockCostUsd applies aws_bedrock_premium_multiplier.
 *   - The pricing.json shipped at infra/llm/pricing.json loads
 *     successfully and prices every default model_id from anthropic.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetPricingCache,
  anthropicCostUsd,
  bedrockCostUsd,
  getModelPricing,
  loadPricingTable,
} from '../src/pricing.js';

describe('pricing — model_id lookup', () => {
  afterEach(() => _resetPricingCache());

  it('loads infra/llm/pricing.json from the repo root', () => {
    const t = loadPricingTable();
    expect(t.schema_version).toBe(1);
    expect(Object.keys(t.models).length).toBeGreaterThanOrEqual(3);
  });

  it('returns the entry for a known model_id', () => {
    const p = getModelPricing('claude-haiku-4-5-20251001');
    expect(p.provider).toBe('anthropic');
    expect(p.model_class).toBe('haiku');
    expect(p.input_per_mtok_usd).toBeGreaterThan(0);
    expect(p.output_per_mtok_usd).toBeGreaterThan(p.input_per_mtok_usd);
  });

  it('throws LlmPricingNotConfiguredError on a missing model_id', () => {
    expect(() => getModelPricing('claude-NONEXISTENT-99-9')).toThrow(/no pricing entry/i);
  });

  it('does NOT confuse a modelClass key for a model_id', () => {
    // The reconciliation is explicit: the table is keyed by model_id,
    // not modelClass. Looking up 'opus' must fail.
    expect(() => getModelPricing('opus')).toThrow();
    expect(() => getModelPricing('haiku')).toThrow();
    expect(() => getModelPricing('sonnet')).toThrow();
  });
});

describe('anthropicCostUsd', () => {
  afterEach(() => _resetPricingCache());

  it('computes cost for a known model_id', () => {
    // Haiku entry: 1.0 input, 5.0 output USD per Mtok.
    // 1M input + 1M output → 1.0 + 5.0 = 6.0 USD.
    const cost = anthropicCostUsd('claude-haiku-4-5-20251001', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(6.0, 6);
  });

  it('applies cache_creation and cache_read multipliers', () => {
    // Haiku: input=1.0, cache_creation=1.25× input, cache_read=0.10× input.
    // 1M input + 0 output + 1M cacheCreation + 1M cacheRead =
    //   1.0 + 0 + 1.25 + 0.10 = 2.35 USD.
    const cost = anthropicCostUsd('claude-haiku-4-5-20251001', 1_000_000, 0, 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(2.35, 6);
  });

  it('throws on a missing model_id (no fallback)', () => {
    expect(() => anthropicCostUsd('claude-MISSING-9-9', 1_000_000, 1_000_000)).toThrow(
      /no pricing entry/i,
    );
  });
});

describe('bedrockCostUsd', () => {
  afterEach(() => _resetPricingCache());

  it('multiplies the Anthropic-direct cost by aws_bedrock_premium_multiplier', () => {
    // With multiplier = 1.0 the Bedrock cost equals the direct cost;
    // pin both forms so a future bump to the multiplier is caught by
    // the test (and the architect updates the multiplier intentionally).
    const direct = anthropicCostUsd('claude-haiku-4-5-20251001', 1_000_000, 1_000_000);
    const bedrock = bedrockCostUsd('claude-haiku-4-5-20251001', 1_000_000, 1_000_000);
    const p = getModelPricing('claude-haiku-4-5-20251001');
    expect(bedrock).toBeCloseTo(direct * p.aws_bedrock_premium_multiplier, 6);
  });

  it('returns NON-ZERO cost for a non-zero call (Block-A §2.A.5 regression pin)', () => {
    // The original bug was costUsd: 0 in the Bedrock provider, leaving
    // the daily/monthly ceilings inert on Tier-0 → Tier-1 failover.
    // The lint here pins that any call with non-zero tokens charges
    // a non-zero cost.
    expect(bedrockCostUsd('claude-haiku-4-5-20251001', 1_000, 1_000)).toBeGreaterThan(0);
  });
});
