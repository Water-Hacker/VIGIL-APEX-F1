#!/usr/bin/env tsx
/**
 * scripts/check-test-coverage-floor.ts — AUDIT-069 fix.
 *
 * Refuses CI merge if a workspace listed below has no test files, AND
 * was NOT in the legacy-allowlist when this lint was introduced.
 *
 * The intent is monotonic: an app that has zero tests today may stay
 * zero, but a NEW app must ship at least one test, and once an app
 * removes itself from the allowlist (by adding tests) it cannot
 * regress. Removing an app from the allowlist is a one-line PR.
 *
 * Currently allow-listed (zero-test apps as of 2026-05-01):
 *   - audit-verifier
 *   - worker-audit-watch
 *   - worker-conac-sftp
 *   - worker-counter-evidence
 *   - worker-dossier
 *   - worker-entity
 *   - worker-governance
 *   - worker-minfi-api
 *   - worker-tip-triage
 *
 * Graduated 2026-05-01: worker-score (ships __tests__/contract.test.ts
 * pinning DECISION-011 + STREAMS.SCORE_COMPUTE wiring; HARDEN-#3 / T1.12).
 *
 * Mirrors the existing scripts/check-migration-pairs.ts pattern.
 *
 * Run: `pnpm tsx scripts/check-test-coverage-floor.ts`
 */

/// <reference types="node" />

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();
const APPS_DIR = join(REPO_ROOT, 'apps');

const LEGACY_ZERO_TEST = new Set([
  'audit-verifier',
  'worker-audit-watch',
  'worker-conac-sftp',
  'worker-counter-evidence',
  'worker-dossier',
  'worker-entity',
  'worker-governance',
  'worker-minfi-api',
  // worker-score graduated 2026-05-01 (HARDEN-#3 / T1.12)
  'worker-tip-triage',
]);

function listAppDirs(): string[] {
  if (!existsSync(APPS_DIR)) return [];
  return readdirSync(APPS_DIR).filter((name) => {
    const p = join(APPS_DIR, name);
    return statSync(p).isDirectory() && existsSync(join(p, 'package.json'));
  });
}

function findTestFiles(root: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') continue;
    const p = join(root, entry.name);
    if (entry.isDirectory()) {
      findTestFiles(p, acc);
    } else if (/\.test\.[cm]?[tj]sx?$/.test(entry.name)) {
      acc.push(p);
    }
  }
  return acc;
}

function main(): void {
  const apps = listAppDirs();
  const errors: string[] = [];
  let okCount = 0;
  let legacyCount = 0;
  let promotedCount = 0;

  for (const app of apps) {
    const tests = findTestFiles(join(APPS_DIR, app));
    if (tests.length > 0) {
      okCount++;
      if (LEGACY_ZERO_TEST.has(app)) {
        // The app shipped tests — but is still on the allowlist. That
        // is no longer load-bearing; nudge the maintainer to remove it.
        process.stdout.write(
          `[check-test-coverage-floor] note: ${app} has tests now; consider removing from the LEGACY_ZERO_TEST allowlist\n`,
        );
        promotedCount++;
      }
      continue;
    }
    if (LEGACY_ZERO_TEST.has(app)) {
      legacyCount++;
      continue;
    }
    errors.push(
      `apps/${app}/ has zero *.test.* files and is not on the LEGACY_ZERO_TEST allowlist — every new app must ship at least one smoke test (AUDIT-069)`,
    );
  }

  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`[check-test-coverage-floor] ${e}\n`);
    process.stderr.write(
      `[check-test-coverage-floor] FAIL: ${errors.length} app(s) below the floor\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `[check-test-coverage-floor] OK: ${okCount} apps with tests, ${legacyCount} legacy zero-test (allow-listed)${promotedCount > 0 ? `, ${promotedCount} graduation candidate(s)` : ''}\n`,
  );
}

main();
