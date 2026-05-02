#!/usr/bin/env -S npx tsx
/**
 * scripts/synthetic-failure.ts — Block-D D.7 / C7.
 *
 * Architect-spec'd validation harness for the phase-gate lints.
 *
 * The phase-gate workflow (.github/workflows/phase-gate.yml) is the
 * forward contract: every PR must pass 10 lints before merge. But a
 * lint that silently passes on broken input is worse than no lint at
 * all — it gives the operator false confidence that a class of bug
 * cannot ship.
 *
 * This script proves the lints actually reject broken input. For each
 * of 5 known-violation cases, it:
 *   1. saves the original file content (or path metadata for adds)
 *   2. mutates the working tree on-the-fly
 *   3. spawns the lint, capturing exit code + stderr
 *   4. ALWAYS restores the original tree (try/finally)
 *   5. asserts the lint exited non-zero, logging REJECTED
 *   6. on lint exiting zero, logs ESCAPED and the meta-test fails
 *
 * Per architect signoff for Block-D D.7 (option (b) on-the-fly
 * mutation + per-gate REJECTED log): "5 violations, run sequentially,
 * each restores cleanly, REJECTED log per gate, ESCAPED any-one fails
 * the workflow."
 *
 * The 5 cases were chosen to exercise mutually-different mutation
 * surfaces (markdown append, json edit, single-line text patch, src
 * file add, src file add):
 *   1. check-decision-cross-links — append DECISION-099 with no AUDIT
 *      / W / commit reference
 *   2. check-source-count — bump TRUTH.md "29 sources" → "30 sources"
 *      (binding-doc count drift)
 *   3. check-llm-pricing — empty out infra/llm/pricing.json's models map
 *   4. check-pattern-coverage — add p-a-999-synthetic.ts with no fixture
 *   5. check-migration-pairs — add 9999_synthetic.sql with no _down.sql
 *
 * Wired into `.github/workflows/synthetic-failure.yml` (PR-triggered
 * on changes to scripts/check-*.ts or scripts/synthetic-failure.ts,
 * plus weekly schedule + manual workflow_dispatch).
 *
 * Architect-action item: when a future phase-gate lint joins the
 * batch, ALSO add a case here. The 1:1 invariant — every lint has a
 * synthetic-failure case — is the unit-test of the gate itself.
 */

/// <reference types="node" />

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import process from 'node:process';

// Resolve tsx via repo-local node_modules so this script works regardless
// of whether the caller has pnpm in PATH. CI populates the symlink during
// `pnpm install --frozen-lockfile`.
const TSX_BIN = (() => {
  const candidates = [
    join(process.cwd(), 'node_modules/.bin/tsx'),
    join(process.cwd(), 'node_modules/.pnpm/node_modules/.bin/tsx'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Fall back to PATH resolution; CI's `npx --yes tsx` works because
  // pnpm install has populated node_modules/.bin.
  return 'tsx';
})();

const REPO_ROOT = process.cwd();
const TMP = mkdtempSync(join(tmpdir(), 'vigil-synthetic-'));

interface Case {
  readonly name: string;
  readonly lint: string;
  readonly mutate: () => void;
  readonly restore: () => void;
}

function backupFile(rel: string): string {
  const src = join(REPO_ROOT, rel);
  const backup = join(TMP, rel.replace(/\//g, '__'));
  copyFileSync(src, backup);
  return backup;
}

function restoreFile(rel: string, backup: string): void {
  copyFileSync(backup, join(REPO_ROOT, rel));
}

const cases: Case[] = [
  // ─────────────────────────────────────────────────────────────────
  // 1. check-decision-cross-links — append DECISION-099 without
  //    AUDIT-NNN AND without (W-NN OR commit-sha).
  // ─────────────────────────────────────────────────────────────────
  ((): Case => {
    const rel = 'docs/decisions/log.md';
    let backup: string;
    return {
      name: 'check-decision-cross-links',
      lint: 'scripts/check-decision-cross-links.ts',
      mutate: () => {
        backup = backupFile(rel);
        const original = readFileSync(join(REPO_ROOT, rel), 'utf8');
        const synthetic =
          '\n\n## DECISION-099  Synthetic failure case (Block-D D.7)\n' +
          '\n' +
          'Status: SYNTHETIC (not a real decision; mutation harness only)\n' +
          'Date: 2026-05-01\n' +
          '\n' +
          'This block has no AUDIT-NNN reference and no W-NN / commit-sha\n' +
          'reference, so the cross-link lint MUST reject it.\n';
        writeFileSync(join(REPO_ROOT, rel), original + synthetic, 'utf8');
      },
      restore: () => restoreFile(rel, backup),
    };
  })(),

  // ─────────────────────────────────────────────────────────────────
  // 2. check-source-count — bump TRUTH.md from "29 sources" to
  //    "30 sources" without touching infra/sources.json or SRD.
  //    The lint reconciles all three; a single-doc edit drifts.
  // ─────────────────────────────────────────────────────────────────
  ((): Case => {
    const rel = 'TRUTH.md';
    let backup: string;
    return {
      name: 'check-source-count',
      lint: 'scripts/check-source-count.ts',
      mutate: () => {
        backup = backupFile(rel);
        const original = readFileSync(join(REPO_ROOT, rel), 'utf8');
        const mutated = original.replace(/29 sources/g, '30 sources');
        if (mutated === original) {
          throw new Error(
            'mutation precondition: TRUTH.md no longer contains "29 sources" — synthetic case is stale',
          );
        }
        writeFileSync(join(REPO_ROOT, rel), mutated, 'utf8');
      },
      restore: () => restoreFile(rel, backup),
    };
  })(),

  // ─────────────────────────────────────────────────────────────────
  // 3. check-llm-pricing — empty the models map. Every default
  //    Anthropic model_id in providers/anthropic.ts should now be
  //    flagged as unpriced.
  // ─────────────────────────────────────────────────────────────────
  ((): Case => {
    const rel = 'infra/llm/pricing.json';
    let backup: string;
    return {
      name: 'check-llm-pricing',
      lint: 'scripts/check-llm-pricing.ts',
      mutate: () => {
        backup = backupFile(rel);
        const original = JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8')) as Record<
          string,
          unknown
        >;
        const mutated = { ...original, models: {} };
        writeFileSync(join(REPO_ROOT, rel), JSON.stringify(mutated, null, 2), 'utf8');
      },
      restore: () => restoreFile(rel, backup),
    };
  })(),

  // ─────────────────────────────────────────────────────────────────
  // 4. check-pattern-coverage — add a pattern source file with no
  //    paired fixture-test. The lint walks src/ and test/ and rejects
  //    any srcId not in testIds.
  // ─────────────────────────────────────────────────────────────────
  ((): Case => {
    const rel = 'packages/patterns/src/category-a/p-a-999-synthetic.ts';
    return {
      name: 'check-pattern-coverage',
      lint: 'scripts/check-pattern-coverage.ts',
      mutate: () => {
        if (existsSync(join(REPO_ROOT, rel))) {
          throw new Error(`mutation precondition: ${rel} already exists`);
        }
        writeFileSync(
          join(REPO_ROOT, rel),
          '// synthetic-failure pattern — no fixture; cleaned up by harness\n' +
            "export const PATTERN_ID = 'p-a-999';\n",
          'utf8',
        );
      },
      restore: () => {
        try {
          unlinkSync(join(REPO_ROOT, rel));
        } catch {
          /* already gone */
        }
      },
    };
  })(),

  // ─────────────────────────────────────────────────────────────────
  // 5. check-migration-pairs — add a forward migration without its
  //    paired _down.sql. AUDIT-051 invariant.
  // ─────────────────────────────────────────────────────────────────
  ((): Case => {
    const rel = 'packages/db-postgres/drizzle/9999_synthetic.sql';
    return {
      name: 'check-migration-pairs',
      lint: 'scripts/check-migration-pairs.ts',
      mutate: () => {
        if (existsSync(join(REPO_ROOT, rel))) {
          throw new Error(`mutation precondition: ${rel} already exists`);
        }
        writeFileSync(
          join(REPO_ROOT, rel),
          '-- synthetic-failure migration — no _down.sql; cleaned up by harness\n' + 'SELECT 1;\n',
          'utf8',
        );
      },
      restore: () => {
        try {
          unlinkSync(join(REPO_ROOT, rel));
        } catch {
          /* already gone */
        }
      },
    };
  })(),

  // ─────────────────────────────────────────────────────────────────
  // 6. check-safellm-coverage — add a worker file that uses the bare
  //    LlmRouter without pairing it with SafeLlmRouter (no `new
  //    SafeLlmRouter` in the same file). The lint must reject this
  //    as a chokepoint bypass per AI-SAFETY-DOCTRINE-v1 §B.
  // ─────────────────────────────────────────────────────────────────
  ((): Case => {
    const rel = 'apps/worker-tip-triage/src/_synthetic-bypass.ts';
    return {
      name: 'check-safellm-coverage',
      lint: 'scripts/check-safellm-coverage.ts',
      mutate: () => {
        if (existsSync(join(REPO_ROOT, rel))) {
          throw new Error(`mutation precondition: ${rel} already exists`);
        }
        writeFileSync(
          join(REPO_ROOT, rel),
          '// synthetic-failure: bare LlmRouter, NOT paired with SafeLlmRouter\n' +
            '// in this file. Cleaned up by harness. The lint must reject this.\n' +
            "import { LlmRouter } from '@vigil/llm';\n" +
            "import { wrapSecret } from '@vigil/security';\n" +
            "export const router = new LlmRouter({ anthropicApiKey: wrapSecret('') });\n",
          'utf8',
        );
      },
      restore: () => {
        try {
          unlinkSync(join(REPO_ROOT, rel));
        } catch {
          /* already gone */
        }
      },
    };
  })(),
];

interface CaseResult {
  readonly name: string;
  readonly verdict: 'REJECTED' | 'ESCAPED' | 'ERRORED';
  readonly exitCode: number;
  readonly stderr: string;
}

function runCase(c: Case): CaseResult {
  try {
    c.mutate();
  } catch (e) {
    return {
      name: c.name,
      verdict: 'ERRORED',
      exitCode: -1,
      stderr: `mutation setup failed: ${(e as Error).message}`,
    };
  }
  let result: CaseResult;
  try {
    // Augment PATH so any nested `npx tsx` calls inside the lint resolve
    // local binaries even when pnpm isn't on the caller's PATH.
    const localBin = join(REPO_ROOT, 'node_modules/.bin');
    const augmentedPath = `${localBin}${delimiter}${process.env.PATH ?? ''}`;
    const proc = spawnSync(TSX_BIN, [c.lint], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', PATH: augmentedPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const code = proc.status ?? -1;
    result = {
      name: c.name,
      verdict: code !== 0 ? 'REJECTED' : 'ESCAPED',
      exitCode: code,
      stderr: (proc.stderr ?? '').toString().trim(),
    };
  } finally {
    try {
      c.restore();
    } catch (e) {
      // restore failure is a meta-bug; surface but don't lose the verdict
      process.stderr.write(
        `[synthetic-failure] WARN: restore for ${c.name} failed: ${(e as Error).message}\n`,
      );
    }
  }
  return result;
}

function main(): void {
  process.stdout.write(
    `[synthetic-failure] running ${cases.length} cases against the phase-gate lints\n\n`,
  );

  const results: CaseResult[] = [];
  for (const c of cases) {
    const r = runCase(c);
    results.push(r);
    const tag =
      r.verdict === 'REJECTED' ? '✓ REJECTED' : r.verdict === 'ESCAPED' ? '✗ ESCAPED' : '✗ ERRORED';
    process.stdout.write(`  [${r.name}] ${tag} (exit ${r.exitCode})\n`);
    if (r.verdict !== 'REJECTED' && r.stderr) {
      process.stdout.write(
        '    --- lint stderr (first 500 chars) ---\n    ' +
          r.stderr.slice(0, 500).split('\n').join('\n    ') +
          '\n',
      );
    }
  }

  const escaped = results.filter((r) => r.verdict !== 'REJECTED');
  process.stdout.write(
    '\n[synthetic-failure] ' +
      `${results.length - escaped.length}/${results.length} REJECTED — ` +
      `${escaped.length} ESCAPED/ERRORED\n`,
  );

  // cleanup tmpdir
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }

  if (escaped.length > 0) {
    process.stderr.write(
      '\n[synthetic-failure] FAIL — at least one phase-gate lint passed on broken input.\n' +
        '  This means the lint is not actually enforcing its contract.\n' +
        '  Investigate the ESCAPED cases above; the gate is the unit-test of the gate itself.\n',
    );
    process.exit(1);
  }
  process.stdout.write('[synthetic-failure] OK — every gate rejected its broken input\n');
}

main();
