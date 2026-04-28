/* eslint-env node */
/**
 * VIGIL APEX root ESLint config.
 *
 * Per OPERATIONS.md §4 CI gates: lint is a blocking gate on `main`.
 * Per SRD §20 anti-hallucination: prompts are typed; ad-hoc `any` is rejected.
 */
module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: false,
  },
  plugins: ['@typescript-eslint', 'import', 'security', 'unicorn'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'plugin:security/recommended-legacy',
    'prettier',
  ],
  settings: {
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
        project: ['tsconfig.base.json', 'packages/*/tsconfig.json', 'apps/*/tsconfig.json'],
      },
      node: true,
    },
  },
  rules: {
    // Strictness — anti-hallucination posture
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': [
      'warn',
      { allowExpressions: true, allowTypedFunctionExpressions: true },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/strict-boolean-expressions': [
      'error',
      { allowString: false, allowNumber: false, allowNullableObject: true },
    ],
    '@typescript-eslint/switch-exhaustiveness-check': 'error',

    // Security
    'security/detect-object-injection': 'warn',
    'security/detect-non-literal-fs-filename': 'warn',
    'security/detect-child-process': 'warn',
    'security/detect-eval-with-expression': 'error',
    'security/detect-pseudoRandomBytes': 'error',
    'security/detect-unsafe-regex': 'error',

    // Imports — predictable order, no circulars
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    'import/no-cycle': ['error', { maxDepth: 5 }],
    'import/no-default-export': 'off',
    'import/no-self-import': 'error',
    'import/no-useless-path-segments': 'error',

    // No console — use structured logger from @vigil/observability
    'no-console': ['error', { allow: ['warn', 'error'] }],

    // Unicorn (style + correctness)
    'unicorn/no-null': 'off',
    'unicorn/prefer-module': 'off',
    'unicorn/prevent-abbreviations': 'off',
    'unicorn/filename-case': ['error', { case: 'kebabCase' }],
    'unicorn/no-array-for-each': 'off',

    // Core
    'no-debugger': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-return-await': 'off',
    'require-atomic-updates': 'error',
    'prefer-const': 'error',
    eqeqeq: ['error', 'always'],
    curly: ['error', 'multi-line'],
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        'security/detect-object-injection': 'off',
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
  ],
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    '.next',
    'out',
    'coverage',
    '.turbo',
    '*.cjs',
    'apps/dashboard/.next',
    'contracts/artifacts',
    'contracts/cache',
    'contracts/typechain-types',
  ],
};
