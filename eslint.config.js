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
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/explicit-function-return-type': [
    'warn',
    { allowExpressions: true, allowTypedFunctionExpressions: true },
  ],
  '@typescript-eslint/no-unused-vars': [
    'warn',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/no-non-null-assertion': 'warn',
};

const SECURITY_RULES = {
  'security/detect-object-injection': 'warn',
  'security/detect-non-literal-fs-filename': 'warn',
  'security/detect-child-process': 'warn',
  'security/detect-eval-with-expression': 'error',
  'security/detect-pseudoRandomBytes': 'error',
  'security/detect-unsafe-regex': 'warn',
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
  'require-atomic-updates': 'warn',
  'prefer-const': 'error',
  eqeqeq: ['error', 'always'],
  curly: ['error', 'multi-line'],
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
      '**/eslint.config.js',
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
      // CommonJS adapters (worker-extract, dashboard middleware) need
      // require()-style imports for ESM-only deps. Soften to warning so
      // legacy code passes while we migrate.
      '@typescript-eslint/no-require-imports': 'warn',
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
  // Prettier compatibility — must come last.
  prettierConfig,
];
