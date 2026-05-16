import { createLogger, type Logger } from '@vigil/observability';
import { Errors } from '@vigil/shared';

import {
  TASK_TEMPERATURE,
  type LlmCallOptions,
  type LlmCallResult,
  type LlmModelClass,
  type ProviderClient,
} from '../types.js';

/**
 * Tier 2 — local sovereign LLM (Qwen 3.5 / DeepSeek R1 via Ollama).
 *
 * Activated only when Tiers 0 and 1 are both unreachable (total cloud severance).
 * Outputs are labelled `degraded: true`; the operator pipeline holds these in
 * a human-review queue and DOES NOT auto-generate findings (MVP §03.4).
 */

export interface LocalProviderOptions {
  readonly baseUrl?: string;
  readonly modelPrimary?: string;
  readonly modelFallback?: string;
  readonly timeoutMs?: number;
  readonly logger?: Logger;
}

interface OllamaResponse {
  response: string;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class LocalLlmProvider implements ProviderClient {
  public readonly name = 'local' as const;
  private readonly logger: Logger;
  private readonly baseUrl: string;
  private readonly primary: string;
  private readonly fallback: string;
  private readonly timeoutMs: number;
  private healthy = true;

  constructor(opts: LocalProviderOptions = {}) {
    this.logger = opts.logger ?? createLogger({ service: 'llm-local' });
    // The tier-2 sovereign LLM is reached via an explicit base URL — either
    // injected by the caller or set in env. We refuse to silently target
    // host.docker.internal: a misconfigured local-tier route would mask
    // failures behind ECONNREFUSED rather than surface "DEGRADED" mode.
    const baseUrl = opts.baseUrl ?? process.env.LOCAL_LLM_BASE_URL;
    if (!baseUrl) {
      throw new Error(
        'LocalLlmProvider: baseUrl unset. Set LOCAL_LLM_BASE_URL or pass opts.baseUrl. The tier-2 sovereign LLM endpoint must be explicit.',
      );
    }
    this.baseUrl = baseUrl;
    this.primary = opts.modelPrimary ?? process.env.LOCAL_LLM_MODEL_PRIMARY ?? 'qwen2.5:72b';
    this.fallback = opts.modelFallback ?? process.env.LOCAL_LLM_MODEL_FALLBACK ?? 'deepseek-r1:70b';
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  async call(opts: LlmCallOptions, modelClass: LlmModelClass): Promise<LlmCallResult> {
    void modelClass; // local provider ignores class — uses configured primary/fallback
    const start = Date.now();
    const temperature = opts.temperatureOverride ?? TASK_TEMPERATURE[opts.task];

    try {
      const res = await this.callOllama(this.primary, opts, temperature);
      return {
        tier: 2,
        provider: this.name,
        model: this.primary,
        content: res.response,
        inputTokens: res.prompt_eval_count ?? 0,
        outputTokens: res.eval_count ?? 0,
        costUsd: 0,
        latencyMs: Date.now() - start,
        degraded: true,
      };
    } catch (e) {
      this.logger.warn({ err: e, model: this.primary }, 'local-primary-failed');
      try {
        const res = await this.callOllama(this.fallback, opts, temperature);
        return {
          tier: 2,
          provider: this.name,
          model: this.fallback,
          content: res.response,
          inputTokens: res.prompt_eval_count ?? 0,
          outputTokens: res.eval_count ?? 0,
          costUsd: 0,
          latencyMs: Date.now() - start,
          degraded: true,
        };
      } catch (e2) {
        this.healthy = false;
        throw new Errors.VigilError({
          code: 'LLM_LOCAL_BOTH_FAILED',
          message: `Local LLM tier exhausted (primary=${this.primary}, fallback=${this.fallback})`,
          severity: 'fatal',
          cause: e2,
        });
      }
    }
  }

  private async callOllama(
    model: string,
    opts: LlmCallOptions,
    temperature: number,
  ): Promise<OllamaResponse> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const r = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: `${opts.system}\n\n${opts.user}`,
          options: { temperature, num_predict: opts.maxTokens ?? 4096 },
          stream: false,
        }),
        signal: ac.signal,
      });
      if (!r.ok) throw new Error(`ollama HTTP ${r.status}`);
      // Tier-10 LLM-pipeline audit closure: bound the response body
      // before parsing. `await r.json()` reads the entire body without
      // a size cap; a compromised Ollama instance or network-injected
      // response could serve a multi-GB blob and OOM the worker.
      // 16 MB is generous for any realistic Ollama JSON (a typical
      // response is well under 1 MB; the cap exists to fail loudly on
      // pathological inputs rather than constrain legitimate use).
      const text = await readWithCap(r, LOCAL_PROVIDER_MAX_BODY_BYTES);
      return JSON.parse(text) as OllamaResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const LOCAL_PROVIDER_MAX_BODY_BYTES = 16 * 1024 * 1024;

async function readWithCap(r: Response, maxBytes: number): Promise<string> {
  const reader = r.body?.getReader();
  if (!reader) {
    // No streaming body (mocked / synthetic Response). Fall back to
    // text() but enforce cap after read; an attacker controlling the
    // stream side can still emit huge content, so this path remains
    // the slow-but-cap-enforced fallback.
    const t = await r.text();
    if (t.length > maxBytes) {
      throw new Error(`ollama response exceeds ${maxBytes}-byte cap (got ${t.length})`);
    }
    return t;
  }
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* best-effort */
      }
      throw new Error(`ollama response exceeds ${maxBytes}-byte cap (observed ≥${total})`);
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}
