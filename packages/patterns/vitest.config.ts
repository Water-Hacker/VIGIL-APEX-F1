import { defineConfig } from 'vitest/config';

/**
 * Phase H5 — coverage gate ≥ 80%.
 *
 * Vitest's V8 coverage provider is fast and accurate; we exclude
 * type-only files and the registry's CommonJS shim from coverage so
 * the floor reflects actual pattern logic.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/types.ts',
        'src/index.ts',
        'src/registry.ts', // exercised transitively
        'src/_register-patterns.ts',
      ],
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
        statements: 80,
      },
    },
  },
});
