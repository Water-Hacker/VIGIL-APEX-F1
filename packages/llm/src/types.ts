import { z } from 'zod';

/**
 * Common LLM types — provider-agnostic.
 *
 * Per SRD §20.3 anti-hallucination: every LLM response is treated as untrusted
 * until it passes the 12-layer guard. Citations are mandatory for extraction.
 */

export type LlmTier = 0 | 1 | 2;

export type LlmModelClass = 'opus' | 'sonnet' | 'haiku';

export type LlmTaskClass =
  | 'extraction'
  | 'classification'
  | 'translation'
  | 'devils_advocate'
  | 'entity_resolution'
  | 'pattern_evidence'
  | 'dossier_narrative'
  | 'tip_classify';

export const TASK_TEMPERATURE: Record<LlmTaskClass, number> = {
  extraction: 0.0,
  classification: 0.2,
  translation: 0.4,
  devils_advocate: 0.6,
  entity_resolution: 0.0,
  pattern_evidence: 0.0,
  dossier_narrative: 0.4,
  tip_classify: 0.2,
};

export const TASK_MODEL: Record<LlmTaskClass, LlmModelClass> = {
  extraction: 'sonnet',
  classification: 'haiku',
  translation: 'sonnet',
  devils_advocate: 'opus',
  entity_resolution: 'haiku',
  pattern_evidence: 'sonnet',
  dossier_narrative: 'sonnet',
  tip_classify: 'haiku',
};

export interface LlmCallOptions {
  readonly task: LlmTaskClass;
  readonly system: string;
  readonly user: string;
  readonly maxTokens?: number;
  readonly temperatureOverride?: number;
  readonly modelClassOverride?: LlmModelClass;
  readonly stopSequences?: readonly string[];
  /** If provided, response is parsed against this Zod schema. */
  readonly responseSchema?: z.ZodSchema;
  /** Cache key — when set, identical (cacheKey + payload) hits cache. */
  readonly cacheKey?: string;
  /** Correlation propagation. */
  readonly correlationId?: string;
}

export interface LlmCallResult<T = string> {
  readonly tier: LlmTier;
  readonly provider: 'anthropic' | 'bedrock' | 'local';
  readonly model: string;
  readonly content: T;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly degraded: boolean; // true on Tier 2 (sovereign / local)
}

export interface ProviderClient {
  readonly name: 'anthropic' | 'bedrock' | 'local';
  call(opts: LlmCallOptions, modelClass: LlmModelClass): Promise<LlmCallResult>;
  isHealthy(): boolean;
}
