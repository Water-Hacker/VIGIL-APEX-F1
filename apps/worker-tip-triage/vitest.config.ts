import { createRequire } from 'node:module';

import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
// libsodium-wrappers-sumo@0.7.16 ships an ESM build that references a sibling
// .mjs file pnpm relocates to a different package directory; vitest's Node
// resolver fails the import. Force the CJS main, which is self-contained.
// (Mirrors packages/security/vitest.config.ts — Block-E E.2 brings sodium
// into worker-tip-triage tests for the council-quorum decrypt E2E.)
const sumoCjs = require.resolve('libsodium-wrappers-sumo');

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      'libsodium-wrappers-sumo': sumoCjs,
    },
  },
});
