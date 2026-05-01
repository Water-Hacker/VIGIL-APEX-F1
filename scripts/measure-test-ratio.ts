#!/usr/bin/env tsx
/**
 * scripts/measure-test-ratio.ts — HARDEN-#5 / T2.04 measurement-only.
 *
 * Survey of test-coverage shape across the workspace. **No CI gate.**
 * Per the 2026-05-01 architect decision: pick a floor based on
 * observed state, not aspiration — so we measure first, threshold
 * later. The architect reviews the per-workspace numbers below and
 * promotes a subset to a hard floor in a follow-up PR.
 *
 * Two metrics per workspace:
 *
 *   1. file_ratio  = test_files / source_files
 *   2. loc_ratio   = test_LOC   / source_LOC
 *
 * Source files are *.ts / *.tsx under src/, excluding *.d.ts and
 * generated stubs (typechain-types, .next). Test files are *.test.*
 * anywhere under the workspace (most live under __tests__/ or test/).
 *
 * Output is a tab-separated table — pipe through `column -t -s $'\t'`
 * for readable formatting:
 *
 *   pnpm tsx scripts/measure-test-ratio.ts | column -t -s $'\t'
 *
 * Pattern follows scripts/check-test-coverage-floor.ts and
 * scripts/check-migration-pairs.ts. Exits 0 unconditionally — this
 * script reports, it does not gate.
 */

/// <reference types="node" />

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();
const ROOTS = [join(REPO_ROOT, 'apps'), join(REPO_ROOT, 'packages')];

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.turbo',
  '.next',
  'coverage',
  'typechain-types',
  'artifacts',
  'cache',
]);

function isTestFile(name: string): boolean {
  return /\.test\.[cm]?[tj]sx?$/.test(name);
}

function isSourceFile(name: string): boolean {
  if (/\.d\.ts$/.test(name)) return false;
  if (isTestFile(name)) return false;
  return /\.(t|j)sx?$/.test(name) || /\.cjs$/.test(name) || /\.mjs$/.test(name);
}

interface Counts {
  source_files: number;
  source_loc: number;
  test_files: number;
  test_loc: number;
}

function walk(root: string, acc: Counts, scope: 'src' | 'test' | 'mixed'): void {
  if (!existsSync(root)) return;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!entry.isFile()) continue;
      const isTest = isTestFile(entry.name);
      const isSrc = !isTest && isSourceFile(entry.name);
      if (!isTest && !isSrc) continue;
      // Scope filter — when walking `src/`, count only sources (test
      // files there are abnormal but we still tag them as tests). When
      // walking the workspace as a whole for tests, we accept tests
      // anywhere except inside `src/`.
      if (scope === 'src' && isTest) continue;
      if (scope === 'test' && isSrc) continue;
      let loc = 0;
      try {
        loc = readFileSync(p, 'utf8').split('\n').length;
      } catch {
        loc = 0;
      }
      if (isTest) {
        acc.test_files++;
        acc.test_loc += loc;
      } else {
        acc.source_files++;
        acc.source_loc += loc;
      }
    }
  }
}

interface WorkspaceRow {
  readonly path: string;
  readonly counts: Counts;
}

function measureWorkspace(wsRoot: string): WorkspaceRow {
  const counts: Counts = { source_files: 0, source_loc: 0, test_files: 0, test_loc: 0 };
  // Sources live in src/.
  walk(join(wsRoot, 'src'), counts, 'src');
  // Tests live anywhere outside src/ — most under __tests__/ and test/,
  // but a few packages put tests at the workspace root.
  const stack = [wsRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      if (entry.name === 'src') continue; // handled above
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isTestFile(entry.name)) continue;
      let loc = 0;
      try {
        loc = readFileSync(p, 'utf8').split('\n').length;
      } catch {
        loc = 0;
      }
      counts.test_files++;
      counts.test_loc += loc;
    }
  }
  return { path: relative(REPO_ROOT, wsRoot), counts };
}

function ratio(numer: number, denom: number): number {
  if (denom === 0) return 0;
  return Math.round((numer / denom) * 1000) / 1000;
}

function main(): void {
  const rows: WorkspaceRow[] = [];
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    for (const ws of readdirSync(root)) {
      const wsRoot = join(root, ws);
      try {
        if (!statSync(wsRoot).isDirectory()) continue;
      } catch {
        continue;
      }
      if (!existsSync(join(wsRoot, 'package.json'))) continue;
      rows.push(measureWorkspace(wsRoot));
    }
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));

  const header = [
    'workspace',
    'src_files',
    'src_loc',
    'test_files',
    'test_loc',
    'file_ratio',
    'loc_ratio',
  ];
  process.stdout.write(`${header.join('\t')}\n`);
  const totals: Counts = { source_files: 0, source_loc: 0, test_files: 0, test_loc: 0 };
  for (const r of rows) {
    const fr = ratio(r.counts.test_files, r.counts.source_files);
    const lr = ratio(r.counts.test_loc, r.counts.source_loc);
    process.stdout.write(
      [
        r.path,
        r.counts.source_files,
        r.counts.source_loc,
        r.counts.test_files,
        r.counts.test_loc,
        fr.toFixed(3),
        lr.toFixed(3),
      ].join('\t') + '\n',
    );
    totals.source_files += r.counts.source_files;
    totals.source_loc += r.counts.source_loc;
    totals.test_files += r.counts.test_files;
    totals.test_loc += r.counts.test_loc;
  }
  process.stdout.write(
    [
      'TOTAL',
      totals.source_files,
      totals.source_loc,
      totals.test_files,
      totals.test_loc,
      ratio(totals.test_files, totals.source_files).toFixed(3),
      ratio(totals.test_loc, totals.source_loc).toFixed(3),
    ].join('\t') + '\n',
  );
}

main();
