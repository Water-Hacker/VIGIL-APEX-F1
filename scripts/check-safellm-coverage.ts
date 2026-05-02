#!/usr/bin/env -S npx tsx
/**
 * scripts/check-safellm-coverage.ts — SafeLlmRouter chokepoint gate.
 *
 * Binding doctrine: AI-SAFETY-DOCTRINE-v1 §B (the 12 LLM-failure-mode
 * defences). The L4 (prompt injection), L9 (prompt versioning), L11
 * (call-record audit), and L14 (model-pin) defences only apply if
 * every Claude call routes through SafeLlmRouter. A worker that
 * imports `LlmRouter` and calls `.call()` directly bypasses ALL
 * twelve defences — the bare router is the unwrapped primitive.
 *
 * Plain English: SafeLlmRouter is the chokepoint. The bare LlmRouter
 * is its dependency. A worker should never use the bare LlmRouter
 * for a call site; it should construct one in `main()` solely to
 * pass to `new SafeLlmRouter(llm, …)` and then route everything
 * through `safe.call(...)`.
 *
 * This lint catches the next regression of that drift class. It
 * scans `apps/` and `packages/` (excluding `packages/llm/` and any
 * `__tests__/` directories) for direct uses of:
 *
 *   - `LlmRouter.call`        — explicit class.method invocation
 *   - `new LlmRouter(`        — constructor instantiation
 *   - `.llm.call(`            — field-access call site
 *
 * The `new LlmRouter(` pattern is the legitimate-and-required shape
 * inside worker `main()` functions (it is the dependency the
 * SafeLlmRouter wraps). The lint allows it ONLY inside files that
 * also construct a SafeLlmRouter in the same file. This is the
 * structural invariant: any `new LlmRouter` must be paired with a
 * `new SafeLlmRouter` in the same file.
 *
 * The other two patterns (`LlmRouter.call` / `.llm.call(`) are
 * never legitimate outside `packages/llm/` itself; the lint
 * unconditionally rejects them.
 *
 * Wired into `.github/workflows/phase-gate.yml` as a required check.
 *
 * Architect-action item: when a future legitimate exception is
 * needed, add the file path to ALLOWLIST below with a
 * documented reason. The allowlist starts empty; each entry is a
 * deliberate, audited deviation from the chokepoint discipline.
 *
 * Refs: AI-SAFETY-DOCTRINE-v1 §B; SAFELLM-COVERAGE-INVENTORY.md
 * (architect-decision input; commit fa4ac51); commit c69a523
 * (worker-entity SafeLlmRouter migration).
 */

/// <reference types="node" />

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ['apps', 'packages'];
const EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  '__tests__',
  'test',
]);

/**
 * Files exempt from the chokepoint check. Each entry is a
 * deliberate, audited deviation. The allowlist starts EMPTY post-
 * Block-D follow-up — no current exceptions exist.
 *
 * Format: `<repo-relative-path>` → reason (free-form prose).
 * Adding to this allowlist requires architect signoff.
 */
const ALLOWLIST: ReadonlyArray<{ readonly path: string; readonly reason: string }> = [];

interface Hit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
  readonly pattern: 'new-LlmRouter' | 'LlmRouter.call' | 'field-llm-call';
}

const PATTERNS: ReadonlyArray<{ name: Hit['pattern']; re: RegExp }> = [
  { name: 'new-LlmRouter', re: /\bnew\s+LlmRouter\s*\(/ },
  { name: 'LlmRouter.call', re: /\bLlmRouter\s*\.\s*call\s*\(/ },
  // .llm.call( — field-access call site. Excludes `this.safe.call`,
  // `this.router.call`, and similar legitimate shapes.
  { name: 'field-llm-call', re: /\.llm\s*\.\s*call\s*\(/ },
];

function* walk(dir: string): Iterable<string> {
  let entries: ReadonlyArray<string>;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry)) continue;
      yield* walk(full);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      yield full;
    }
  }
}

function scanFile(absPath: string): Hit[] {
  const rel = relative(REPO_ROOT, absPath);
  // Exclude packages/llm/ entirely — that package OWNS LlmRouter
  // and SafeLlmRouter; both are defined here and used by tests.
  if (rel.startsWith('packages/llm/')) return [];
  const content = readFileSync(absPath, 'utf8');
  const lines = content.split('\n');
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        hits.push({ path: rel, line: i + 1, text: line.trim(), pattern: p.name });
      }
    }
  }
  return hits;
}

function isAllowlisted(relPath: string): boolean {
  return ALLOWLIST.some((entry) => entry.path === relPath);
}

/**
 * The `new LlmRouter(...)` pattern is legitimate inside files that
 * also construct a `SafeLlmRouter`. Scan the file for both.
 */
function pairsWithSafeLlmRouterInFile(absPath: string): boolean {
  const content = readFileSync(absPath, 'utf8');
  return /\bnew\s+SafeLlmRouter\s*\(/.test(content);
}

function main(): void {
  const allHits: Hit[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(REPO_ROOT, root);
    for (const file of walk(abs)) {
      const hits = scanFile(file);
      for (const h of hits) allHits.push(h);
    }
  }

  // Classify each hit. `new LlmRouter` paired with `new SafeLlmRouter`
  // in the same file is structurally legitimate; everything else
  // (LlmRouter.call, field-llm-call, unpaired new LlmRouter) is drift.
  const drift: Hit[] = [];
  for (const h of allHits) {
    if (isAllowlisted(h.path)) continue;
    if (h.pattern === 'new-LlmRouter') {
      const abs = join(REPO_ROOT, h.path);
      if (pairsWithSafeLlmRouterInFile(abs)) continue;
    }
    drift.push(h);
  }

  if (drift.length > 0) {
    process.stderr.write(
      `[check-safellm-coverage] FAIL — ${drift.length} direct-LlmRouter hit(s) outside the SafeLlmRouter chokepoint:\n\n`,
    );
    for (const h of drift) {
      process.stderr.write(`  ${h.path}:${h.line}  [${h.pattern}]\n`);
      process.stderr.write(`    ${h.text}\n`);
    }
    process.stderr.write(
      '\n' +
        'Migration template (worker-tip-triage exemplar, commit 10dac28):\n' +
        '  1. Register the prompt in apps/<worker>/src/prompts.ts via\n' +
        '     Safety.globalPromptRegistry.register({...}).\n' +
        '  2. Replace LlmRouter.call(...) with this.safe.call({\n' +
        '       findingId, assessmentId, promptName, task, sources,\n' +
        '       responseSchema, modelId, ... }).\n' +
        '  3. Adversarial / untrusted content goes in `sources` (closed-\n' +
        '     context source_document tag), NOT in `task` (instructions).\n' +
        '  4. Wire the worker main() to construct SafeLlmRouter with a\n' +
        '     CallRecordRepo sink + Safety.adversarialPromptsRegistered()\n' +
        '     startup check.\n' +
        '\n' +
        'See AI-SAFETY-DOCTRINE-v1 §B for the binding doctrine.\n' +
        'See docs/work-program/SAFELLM-COVERAGE-INVENTORY.md for the\n' +
        'inventory + architect-decision context.\n' +
        '\n' +
        'If a hit is a deliberate, audited exception, add it to ALLOWLIST\n' +
        'in scripts/check-safellm-coverage.ts with a documented reason\n' +
        '(architect signoff required).\n',
    );
    process.exit(1);
  }

  const total = allHits.length;
  const allowed = allHits.length - drift.length;
  process.stdout.write(
    `[check-safellm-coverage] OK — ${total} LlmRouter reference(s); ` +
      `${allowed} structurally legitimate (new LlmRouter paired with new SafeLlmRouter); ` +
      `0 drift; ${ALLOWLIST.length} entry on the allowlist.\n`,
  );
}

main();
