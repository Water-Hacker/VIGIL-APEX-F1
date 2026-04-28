/* eslint-env node */
/**
 * Conventional Commits per BUILD-V1 §05.4 / OPERATIONS.md §3.
 *
 * Allowed types are scoped to the VIGIL APEX domain: every commit message
 * declares which ring/package it belongs to so the audit chain can later
 * group them.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'chore',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'security',
        'deps',
        'revert',
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        // top-level
        'repo',
        'docs',
        'infra',
        'ci',
        'contracts',
        // packages
        'shared',
        'db-postgres',
        'db-neo4j',
        'queue',
        'observability',
        'security',
        'llm',
        'audit-chain',
        'governance',
        'dossier',
        'patterns',
        'adapters',
        // apps
        'dashboard',
        'api',
        'adapter-runner',
        'worker-entity',
        'worker-pattern',
        'worker-score',
        'worker-counter-evidence',
        'worker-document',
        'worker-dossier',
        'worker-anchor',
        'worker-governance',
        'worker-tip-triage',
        'worker-conac-sftp',
        'worker-minfi-api',
        'worker-adapter-repair',
        // Python apps + shared
        'worker-satellite',
        'worker-image-forensics',
        'py-common',
        // ring-level (cross-package commits)
        'ring-0',
        'ring-1',
        'ring-2',
        'ring-3',
        'ring-4',
        'ring-5',
        // Phase-2 MOU-gated adapters
        'minfi-bis',
        'beac-payments',
        'anif-amlscreen',
      ],
    ],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 100],
  },
};
