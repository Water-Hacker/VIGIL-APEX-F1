/**
 * Tier-57 audit closure — SafeLlmRouter must thread costUsd to the
 * call-record sink.
 *
 * Pre-fix, every safe-routed call recorded `cost_usd: 0` regardless of
 * the actual API cost. The CostTracker's own ceiling enforcement was
 * unaffected (it reads from a separate counter in router.ts), but the
 * per-call audit row was wrong — the AI-Safety dashboard's cost panel
 * silently under-reported every closed-context call by exactly its
 * cost. That misled cost-budget reviews.
 *
 * Post-fix, safe-router pulls `costUsd` from the inner LlmCallResult
 * and stores it in the sink.record() payload.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { SafeLlmRouter, type CallRecordSink } from '../src/safe-router.js';
import { globalPromptRegistry } from '../src/safety/prompt-registry.js';

describe('Tier-57 — SafeLlmRouter threads cost_usd through to sink', () => {
  it('uses the inner LlmCallResult.costUsd, not hard-coded 0', async () => {
    // Register a prompt so safe-router doesn't throw on the lookup.
    globalPromptRegistry.register({
      name: 'tier57-test',
      version: 'v1.0.0',
      description: 'tier-57 cost-thread test',
      render: () => ({ system: 'sys', user: 'usr' }),
    });

    const sink: CallRecordSink = {
      record: vi.fn(async () => undefined),
    };
    const inner = {
      call: vi.fn(async () => ({
        content: { ok: true },
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        tier: 0,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.0237, // <-- the inner cost the safe-router must thread
      })),
    } as unknown as ConstructorParameters<typeof SafeLlmRouter>[0];
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never;
    const router = new SafeLlmRouter(inner, logger, sink);

    await router.call({
      findingId: null,
      assessmentId: null,
      promptName: 'tier57-test',
      task: 'extract',
      sources: [{ id: 's1', text: 'evidence' }],
      responseSchema: z.object({ ok: z.boolean() }),
      modelId: 'claude-opus-4-7',
    });

    expect(sink.record).toHaveBeenCalledOnce();
    const [recorded] = (sink.record as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((recorded as { cost_usd: number }).cost_usd).toBe(0.0237);
  });

  it('falls back to 0 when the inner call result omits costUsd', async () => {
    globalPromptRegistry.register({
      name: 'tier57-test-no-cost',
      version: 'v1.0.0',
      description: 'tier-57 cost-thread test',
      render: () => ({ system: 'sys', user: 'usr' }),
    });

    const sink: CallRecordSink = {
      record: vi.fn(async () => undefined),
    };
    const inner = {
      call: vi.fn(async () => ({
        content: { ok: true },
        provider: 'local',
        model: 'local-llama',
        tier: 2,
        inputTokens: 0,
        outputTokens: 0,
        // costUsd intentionally absent
      })),
    } as unknown as ConstructorParameters<typeof SafeLlmRouter>[0];
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never;
    const router = new SafeLlmRouter(inner, logger, sink);

    await router.call({
      findingId: null,
      assessmentId: null,
      promptName: 'tier57-test-no-cost',
      task: 'extract',
      sources: [{ id: 's1', text: 'evidence' }],
      responseSchema: z.object({ ok: z.boolean() }),
      modelId: 'local-llama',
    });
    const [recorded] = (sink.record as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((recorded as { cost_usd: number }).cost_usd).toBe(0);
  });
});
