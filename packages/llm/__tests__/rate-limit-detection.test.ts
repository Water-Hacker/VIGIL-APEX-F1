import { RateLimitError } from '@anthropic-ai/sdk';
import { llmRateLimitExhaustedTotal } from '@vigil/observability';
import { wrapSecret } from '@vigil/security';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnthropicProvider } from '../src/providers/anthropic.js';

/**
 * Mode 6.4 — Silent rate-limit response from upstream.
 *
 * Pre-closure, the Anthropic provider's catch block logged all errors
 * identically; a 429-exhaustion looked the same as a model outage or
 * an auth error in the metrics. Operators couldn't distinguish "we're
 * being throttled" from "the model is down."
 *
 * Closure: the catch block now detects `RateLimitError` from the
 * Anthropic SDK and increments `vigil_llm_rate_limit_exhausted_total`
 * with provider + model labels. The error is logged at warn level
 * (distinct from the error-level log for other failures).
 *
 * These tests assert:
 *   1. A RateLimitError → the rate-limit counter increments.
 *   2. Other errors → the rate-limit counter does NOT increment.
 *   3. The thrown error propagates unchanged in both cases.
 */

interface MockClient {
  messages: { create: ReturnType<typeof vi.fn> };
}

function makeProvider(client: MockClient): AnthropicProvider {
  const provider = new AnthropicProvider({
    apiKey: wrapSecret('test-key'),
    timeoutMs: 1_000,
    maxRetries: 0,
  });
  // Inject the mock client. The provider's private `client` field is
  // overridden via the structural cast so tests don't need to spin up
  // a real HTTP server.
  (provider as unknown as { client: MockClient }).client = client;
  return provider;
}

function readCounter(provider: string, model: string): number {
  const metric = (
    llmRateLimitExhaustedTotal as unknown as {
      hashMap: Record<string, { value: number }>;
    }
  ).hashMap;
  for (const k of Object.keys(metric)) {
    if (k.includes(`provider:${provider}`) && k.includes(`model:${model}`)) {
      return metric[k]!.value;
    }
  }
  return 0;
}

describe('mode 6.4 — LLM rate-limit detection', () => {
  beforeEach(() => {
    llmRateLimitExhaustedTotal.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('increments vigil_llm_rate_limit_exhausted_total when Anthropic SDK throws RateLimitError', async () => {
    // Construct a RateLimitError. The SDK's RateLimitError constructor
    // signature varies across versions; we use Object.create + setProto
    // to build an instance without depending on the constructor.
    const err = Object.create(RateLimitError.prototype) as Error;
    err.message = 'rate-limited';

    const client: MockClient = {
      messages: {
        create: vi.fn().mockRejectedValue(err),
      },
    };
    const provider = makeProvider(client);

    await expect(
      provider.call(
        {
          system: 'sys',
          user: 'usr',
          task: 'extract' as const,
          maxTokens: 100,
        },
        'sonnet',
      ),
    ).rejects.toBeInstanceOf(RateLimitError);

    // The counter should reflect exactly one rate-limit exhaustion
    // for sonnet model.
    const sonnetCount = readCounter('anthropic', 'claude-sonnet-4-6');
    expect(sonnetCount).toBe(1);
  });

  it('does NOT increment the rate-limit counter on non-rate-limit errors', async () => {
    const err = new Error('connection refused');
    const client: MockClient = {
      messages: { create: vi.fn().mockRejectedValue(err) },
    };
    const provider = makeProvider(client);

    await expect(
      provider.call(
        {
          system: 'sys',
          user: 'usr',
          task: 'extract' as const,
          maxTokens: 100,
        },
        'haiku',
      ),
    ).rejects.toThrow('connection refused');

    const haikuCount = readCounter('anthropic', 'claude-haiku-4-5-20251001');
    expect(haikuCount).toBe(0);
  });

  it('rate-limit counter labels include both provider and model', async () => {
    const err = Object.create(RateLimitError.prototype) as Error;
    err.message = 'rate-limited';

    const client: MockClient = {
      messages: { create: vi.fn().mockRejectedValue(err) },
    };
    const provider = makeProvider(client);

    // Two calls against opus, one against sonnet — counters split by
    // model so an operator can see which model is being throttled.
    await provider
      .call({ system: 's', user: 'u', task: 'extract' as const, maxTokens: 100 }, 'opus')
      .catch(() => {});
    await provider
      .call({ system: 's', user: 'u', task: 'extract' as const, maxTokens: 100 }, 'opus')
      .catch(() => {});
    await provider
      .call({ system: 's', user: 'u', task: 'extract' as const, maxTokens: 100 }, 'sonnet')
      .catch(() => {});

    expect(readCounter('anthropic', 'claude-opus-4-7')).toBe(2);
    expect(readCounter('anthropic', 'claude-sonnet-4-6')).toBe(1);
  });
});
