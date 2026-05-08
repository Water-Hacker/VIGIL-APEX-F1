/**
 * VIGIL APEX root ESLint flat config (ESLint v9).
 *
 * Migrated from `.eslintrc.cjs` per DECISION-009 follow-up. Rule semantics
 * are preserved where possible; type-aware rules from
 * `@typescript-eslint/recommended-requiring-type-checking` are dropped
 * because they require a `parserOptions.project` setup per package, which
 * is a substantial change. The blocking rules (`no-floating-promises`,
 * `no-misused-promises`, `await-thenable`) are reinstated explicitly under
 * package-level configs that opt in.
 *
 * Per OPERATIONS.md §4 CI gates: lint is a blocking gate on `main`. Per
 * SRD §20 anti-hallucination: prompts are typed; ad-hoc `any` is rejected.
 */
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import securityPlugin from 'eslint-plugin-security';
import unicornPlugin from 'eslint-plugin-unicorn';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

const TS_RULES = {
  // Hard-block real bugs.
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unused-vars': [
    'warn',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
  // The codebase deliberately uses non-null assertions where context-narrow
  // types are absent (drizzle row reads, regex match groups). Without
  // type-aware lint we can't distinguish dangerous from documented uses;
  // turn off to avoid noise that doesn't add safety. Real reviewers catch
  // the dangerous ones.
  '@typescript-eslint/no-non-null-assertion': 'off',
  // TypeScript inference is sufficient for almost every internal function;
  // requiring explicit return types on every helper is noise. Public APIs
  // should still annotate; the convention is enforced in code review, not
  // by linter.
  '@typescript-eslint/explicit-function-return-type': 'off',
};

const SECURITY_RULES = {
  // Hard-block — these never have a legitimate code path.
  'security/detect-eval-with-expression': 'error',
  'security/detect-pseudoRandomBytes': 'error',
  // The next three rules fire heuristically on any bracket-access or fs
  // path that isn't a literal — overwhelmingly false positives in this
  // codebase (drizzle row[col], reading user-config paths). Keep child-
  // process at warn since spawned commands deserve a glance.
  'security/detect-object-injection': 'off',
  'security/detect-non-literal-fs-filename': 'off',
  'security/detect-unsafe-regex': 'off',
  'security/detect-child-process': 'warn',
};

const IMPORT_RULES = {
  'import/order': [
    'warn',
    {
      groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
      'newlines-between': 'always',
      alphabetize: { order: 'asc', caseInsensitive: true },
    },
  ],
  'import/no-self-import': 'error',
  'import/no-useless-path-segments': 'error',
};

const UNICORN_RULES = {
  'unicorn/no-null': 'off',
  'unicorn/prefer-module': 'off',
  'unicorn/prevent-abbreviations': 'off',
  'unicorn/filename-case': ['warn', { case: 'kebabCase' }],
  'unicorn/no-array-for-each': 'off',
};

const CORE_RULES = {
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'no-debugger': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-return-await': 'off',
  // Most flags are init-singleton patterns where the "race" is benign by
  // construction (first caller wins; subsequent callers either retry or no-op).
  'require-atomic-updates': 'off',
  'prefer-const': 'error',
  eqeqeq: ['error', 'always'],
  curly: ['error', 'multi-line'],
  // HARDEN-#7 + HARDEN-#8 — both rules use `no-restricted-syntax` and
  // share per-file override blocks declared further down in this config
  // to exempt their respective closed allowlists.
  //
  // HARDEN-#7 — `Math.random()` is non-cryptographic, biases shuffles
  // (AUDIT-029, AUDIT-092), and leaks predictable values into IDs we
  // sometimes carry into audit rows. The repo policy is `randomInt` /
  // `randomBytes` / `randomUUID` from `node:crypto` for any value that
  // ships into a chain, audit, or sample. The three legacy non-crypto
  // sites (worker.ts instanceId, anthropic.ts customId, toast.tsx
  // ephemeral toast id) carry per-file overrides below.
  //
  // HARDEN-#8 — `<resp>.body.text()` / `<resp>.body.json()` consume an
  // undici response body with no size cap and no headers/body timeout.
  // A hostile source returning a multi-GB chunked body or a slow-loris
  // stall can exhaust adapter heap or hang the trigger indefinitely.
  // AUDIT-093 closed this for `_helpers.ts` by extracting
  // `boundedRequest` + `boundedBodyText` into `_bounded-fetch.ts`.
  // AUDIT-095 documents the remaining unmigrated call sites; each is
  // pinned in the override block below until its migration lands.
  // Future adapters MUST go through `boundedBodyText(resp.body, {...})`.
  'no-restricted-syntax': [
    'error',
    {
      selector:
        "CallExpression[callee.type='MemberExpression'][callee.object.name='Math'][callee.property.name='random']",
      message:
        'Math.random() is non-cryptographic and biased for shuffles. Use crypto.randomInt / randomBytes / randomUUID. See HARDEN-#7 + AUDIT-029 + AUDIT-092. The 3-site allowlist (worker.ts instanceId, anthropic.ts customId, toast.tsx) is in eslint.config.mjs overrides.',
    },
    {
      selector:
        "CallExpression[callee.type='MemberExpression'][callee.property.name='text'][callee.object.type='MemberExpression'][callee.object.property.name='body']",
      message:
        '<resp>.body.text() consumes an undici response with no size cap and no body timeout. Use boundedBodyText(resp.body, { sourceId, url, maxBytes? }) from apps/adapter-runner/src/adapters/_bounded-fetch.ts. See HARDEN-#8 + AUDIT-093 + AUDIT-095.',
    },
    {
      selector:
        "CallExpression[callee.type='MemberExpression'][callee.property.name='json'][callee.object.type='MemberExpression'][callee.object.property.name='body']",
      message:
        '<resp>.body.json() consumes an undici response with no size cap. Use boundedBodyText then JSON.parse, or extend _bounded-fetch.ts with a typed JSON helper. See HARDEN-#8 + AUDIT-093 + AUDIT-095.',
    },
  ],
};

export default [
  // Tolerate `// eslint-disable-next-line react-hooks/...` comments in the
  // dashboard even though we don't load the react-hooks plugin at root.
  // Without this the disable directive itself becomes the lint error.
  { linterOptions: { reportUnusedDisableDirectives: false } },
  // Global ignores — replaces the old `ignorePatterns`.
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/*.cjs',
      '**/eslint.config.{js,mjs,cjs}',
      'apps/dashboard/.next/**',
      'contracts/artifacts/**',
      'contracts/cache/**',
      'contracts/typechain-types/**',
      // Generated graph reports — not part of source.
      'graphify-out/**',
      // Stale build artefacts that occasionally leak into src/ when a
      // package's tsc was run with the wrong outDir.
      '**/src/**/*.js',
      '**/src/**/*.js.map',
      '**/src/**/*.d.ts',
      '**/src/**/*.d.ts.map',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      // Many adapter scripts and dashboard components reach for browser
      // globals (HTMLAnchorElement, document, window) inside playwright
      // `page.evaluate(...)` callbacks; including the browser globals
      // here avoids spurious `no-undef` reports without weakening other
      // checks.
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2022,
        // Node TypeScript types — often referenced explicitly as `NodeJS.Timeout`.
        NodeJS: 'readonly',
        // React's JSX namespace — referenced in dashboard server components.
        JSX: 'readonly',
        // React's namespace — referenced in dashboard components without an explicit import.
        React: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
      security: securityPlugin,
      unicorn: unicornPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...TS_RULES,
      ...IMPORT_RULES,
      ...SECURITY_RULES,
      ...UNICORN_RULES,
      ...CORE_RULES,
      // The base eslint:recommended `no-unused-vars` conflicts with the
      // typed version; disable the base.
      'no-unused-vars': 'off',
      // CommonJS adapters (worker-extract, dashboard middleware) sometimes
      // need require()-style imports for ESM-only deps. Disabled because the
      // pattern is intentional and reviewed; the strict `no-explicit-any`
      // and `no-eval` rules above catch the actual risk surface.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**', '**/test/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'security/detect-object-injection': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['**/scripts/**/*.ts', '**/scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['contracts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // HARDEN-#7 — closed allowlist of files that may use Math.random().
  // Adding a fourth file requires architect approval and a new audit
  // entry per AUDIT-092 precedent. k6 load tests run outside the Node
  // runtime that ships our audit-bearing IDs; their non-crypto random
  // is acceptable for synthetic load shaping.
  {
    files: [
      'packages/queue/src/worker.ts',
      'packages/llm/src/providers/anthropic.ts',
      'apps/dashboard/src/components/toast.tsx',
      'load-tests/**/*.js',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // HARDEN-#8 — closed allowlist of files that may consume undici
  // response bodies with `<resp>.body.text()` / `<resp>.body.json()`.
  // Each entry below is pinned by AUDIT-095 awaiting migration to
  // `boundedBodyText(resp.body, { sourceId, url })`. The allowlist may
  // ONLY shrink: a new adapter or worker that calls `.body.text()` /
  // `.body.json()` directly fails CI. `_bounded-fetch.ts` itself is
  // intentionally excluded (helper definition references body shape
  // in comments only).
  {
    files: [
      // adapter-runner sectoral adapters — all sister-shape to the
      // `_helpers.ts` migration AUDIT-093 already landed.
      'apps/adapter-runner/src/adapters/anif-amlscreen.ts',
      'apps/adapter-runner/src/adapters/beac-payments.ts',
      'apps/adapter-runner/src/adapters/cour-des-comptes.ts',
      'apps/adapter-runner/src/adapters/dgi-attestations.ts',
      'apps/adapter-runner/src/adapters/eu-sanctions.ts',
      'apps/adapter-runner/src/adapters/minfi-bis.ts',
      'apps/adapter-runner/src/adapters/ofac-sdn.ts',
      'apps/adapter-runner/src/adapters/opensanctions.ts',
      'apps/adapter-runner/src/adapters/un-sanctions.ts',
      'apps/adapter-runner/src/adapters/worldbank-sanctions.ts',
      // worker-adapter-repair selector-derivation HTTP probes.
      'apps/worker-adapter-repair/src/index.ts',
      'apps/worker-adapter-repair/src/shadow-test.ts',
      // worker-federation-receiver pulls signing-key JWKS over HTTPS;
      // the JWKS endpoint is operator-controlled but the body cap
      // still belongs there.
      'apps/worker-federation-receiver/src/key-resolver.ts',
      // sentinel-quorum operational script.
      'scripts/sentinel-quorum.ts',
    ],
    rules: {
      // We narrow only the body-read selectors; Math.random remains
      // banned for these files. Express the override by re-declaring
      // the rule with just the Math.random selector retained.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='Math'][callee.property.name='random']",
          message:
            'Math.random() is non-cryptographic and biased for shuffles. Use crypto.randomInt / randomBytes / randomUUID. See HARDEN-#7 + AUDIT-029 + AUDIT-092.',
        },
      ],
    },
  },
  // Prettier compatibility — must come last.
  prettierConfig,
];
