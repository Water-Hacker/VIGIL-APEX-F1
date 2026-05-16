import { llmRateLimitExhaustedTotal } from '@vigil/observability';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Bedrock SDK before the BedrockProvider import resolves it.
// The real SDK fails to resolve `@anthropic-ai/sdk/core` at vitest time
// because of an internal package-exports issue — at production runtime
// it works (AnthropicBedrock loads via Node's own resolution). The
// mock keeps the test focused on our rate-limit detection helper +
// the catch-block plumbing, not the SDK's import shape.
vi.mock('@anthropic-ai/bedrock-sdk', () => ({
  AnthropicBedrock: class MockAnthropicBedrock {
    public messages = { create: vi.fn() };
    constructor(_opts: unknown) {}
  },
}));

// eslint-disable-next-line import/order
import { BedrockProvider } from '../src/providers/bedrock.js';

/**
 * Mode 6.4 follow-up — Bedrock rate-limit detection.
 *
 * The Cat-6 mode 6.4 closure landed Anthropic-direct rate-limit
 * detection. Bedrock was left as a flagged follow-up because the
 * `@anthropic-ai/bedrock-sdk` doesn't re-export AWS error types and
 * AWS throws different exception classes via `@aws-sdk/client-
 * bedrock-runtime`.
 *
 * This closure mirrors the Anthropic test pattern but uses duck-typed
 * `.name` checks because the Bedrock-side error types are surfaced
 * with `.name === "ThrottlingException"` /
 * `"ServiceQuotaExceededException"` / `"TooManyRequestsException"`.
 *
 * Assertions:
 *   1. ThrottlingException → counter increments.
 *   2. ServiceQuotaExceededException → counter increments.
 *   3. Generic Error → counter does NOT increment.
 *   4. Counter labels: provider=bedrock + the resolved model id.
 */

interface MockBedrockClient {
  messages: { create: ReturnType<typeof vi.fn> };
}

function makeBedrockProvider(client: MockBedrockClient): BedrockProvider {
  const provider = new BedrockProvider({
    region: 'eu-west-1',
  });
  (provider as unknown as { client: MockBedrockClient }).client = client;
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

/**
 * Construct an AWS-shaped throttle error. AWS SDK v3 service exceptions
 * extend Error and have a `.name` matching the exception type. The
 * BedrockProvider's `isBedrockRateLimitError` helper duck-types on this.
 */
function makeAwsError(name: string, message = 'aws-throttled'): Error {
  const e = new Error(message);
  Object.defineProperty(e, 'name', { value: name });
  return e;
}

describe('mode 6.4 follow-up — Bedrock rate-limit detection', () => {
  beforeEach(() => {
    llmRateLimitExhaustedTotal.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('increments the rate-limit counter on ThrottlingException', async () => {
    const err = makeAwsError('ThrottlingException', 'rate exceeded');
    const client: MockBedrockClient = {
      messages: { create: vi.fn().mockRejectedValue(err) },
    };
    const provider = makeBedrockProvider(client);

    await expect(
      provider.call(
        { system: 'sys', user: 'usr', task: 'extract' as const, maxTokens: 100 },
        'sonnet',
      ),
    ).rejects.toThrow('rate exceeded');

    const count = readCounter('bedrock', 'anthropic.claude-sonnet-4-6');
    expect(count).toBe(1);
  });

  it('increments the rate-limit counter on ServiceQuotaExceededException', async () => {
    const err = makeAwsError('ServiceQuotaExceededException', 'quota exhausted');
    const client: MockBedrockClient = {
      messages: { create: vi.fn().mockRejectedValue(err) },
    };
    const provider = makeBedrockProvider(client);

    await expect(
      provider.call({ system: 's', user: 'u', task: 'extract' as const, maxTokens: 100 }, 'haiku'),
    ).rejects.toThrow('quota exhausted');

    const count = readCounter('bedrock', 'anthropic.claude-haiku-4-5-20251001');
    expect(count).toBe(1);
  });

  it('increments the rate-limit counter on TooManyRequestsException', async () => {
    const err = makeAwsError('TooManyRequestsException');
    const client: MockBedrockClient = {
      messages: { create: vi.fn().mockRejectedValue(err) },
    };
    const provider = makeBedrockProvider(client);

    await expect(
      provider.call({ system: 's', user: 'u', task: 'extract' as const, maxTokens: 100 }, 'opus'),
    ).rejects.toBeDefined();

    const count = readCounter('bedrock', 'anthropic.claude-opus-4-7');
    expect(count).toBe(1);
  });

  it('does NOT increment the rate-limit counter on generic errors', async () => {
    const err = new Error('connection reset');
    const client: MockBedrockClient = {
      messages: { create: vi.fn().mockRejectedValue(err) },
    };
    const provider = makeBedrockProvider(client);

    await expect(
      provider.call({ system: 's', user: 'u', task: 'extract' as const, maxTokens: 100 }, 'sonnet'),
    ).rejects.toThrow('connection reset');

    const count = readCounter('bedrock', 'anthropic.claude-sonnet-4-6');
    expect(count).toBe(0);
  });
});
