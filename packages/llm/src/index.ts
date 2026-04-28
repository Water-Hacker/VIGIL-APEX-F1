/**
 * @vigil/llm — LLM tier router + prompt registry + anti-hallucination.
 *
 * Public API:
 *   - LlmRouter: select tier, call provider, enforce circuit + cost ceilings
 *   - PromptRegistry: load + version templates from disk
 *   - MetaWrapper: inject anti-hallucination preamble (SRD §20.3)
 *   - HallucinationGuards: 12 layers of post-call validation (SRD §20.1)
 */
export * from './types.js';
export * from './router.js';
export * from './circuit.js';
export * from './cost.js';
export * from './meta-wrapper.js';
export * from './guards.js';
export * from './prompt-registry.js';
export * from './providers/anthropic.js';
export * from './providers/bedrock.js';
export * from './providers/local.js';
