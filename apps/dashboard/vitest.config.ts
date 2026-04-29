import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The dashboard ships TWO test suites at different layers:
    //   - vitest unit tests under __tests__/ (e.g. public-audit-route)
    //   - playwright a11y specs under tests/a11y/ (run separately by `pnpm exec playwright test`)
    // Both happen to use the `.test.ts` / `.spec.ts` extension, so vitest
    // would otherwise pick up the playwright files and crash on the
    // missing `@playwright/test` runtime. Exclude them explicitly.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      'tests/a11y/**',
      'tests/**/*.spec.ts',
    ],
  },
});
