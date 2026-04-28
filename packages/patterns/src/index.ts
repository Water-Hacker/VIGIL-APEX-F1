/**
 * @vigil/patterns — PatternDef interface, registry, signal types.
 *
 * The 43 patterns themselves live under `src/category-{a..h}/` and are
 * loaded by the registry at startup. Adding a new pattern is config + a
 * new file; no code change is required to wire it in (BUILD-V1 §16.5).
 */
export * from './types.js';
export * from './registry.js';
export * from './bayesian.js';
