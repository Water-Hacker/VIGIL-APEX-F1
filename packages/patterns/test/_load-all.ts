/**
 * Side-effect imports for every pattern. Each pattern self-registers
 * via `registerPattern(definition)` at import time, so all this
 * function does is reference the modules.
 *
 * This mirrors `apps/worker-pattern/src/_register-patterns.ts` so the
 * test runner sees the same registry the worker would.
 */

import './category-a/loader.js';
import './category-b/loader.js';
import './category-c/loader.js';
import './category-d/loader.js';
import './category-e/loader.js';
import './category-f/loader.js';
import './category-g/loader.js';
import './category-h/loader.js';

export function registerAllPatternsForTest(): void {
  // No-op — the side-effect imports above did the work.
}
