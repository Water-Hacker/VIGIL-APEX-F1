#!/usr/bin/env -S npx tsx
/**
 * audit-decision-log.ts — verify every external reference in
 * `docs/decisions/log.md` and `docs/source/TAL-PA-DOCTRINE-v1.md` resolves:
 *
 *   - Markdown link targets `[X](path/to/file)` exist on disk.
 *   - In-repo file paths bare-mentioned (e.g. `apps/worker-anchor/src/index.ts`)
 *     exist on disk.
 *   - Cross-decision references like `DECISION-NNN` exist as headers in
 *     `docs/decisions/log.md`.
 *
 * Run as a CI step. Fails non-zero on any unresolved reference.
 *
 *   pnpm tsx scripts/audit-decision-log.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

// Files that describe what HAS shipped — every cross-reference must resolve.
// Excluded: work-program docs (aspirational; describe future artefacts).
const FILES_TO_CHECK = [
  'docs/decisions/log.md',
  'docs/source/TAL-PA-DOCTRINE-v1.md',
  'docs/source/AI-SAFETY-DOCTRINE-v1.md',
  'TRUTH.md',
];

interface Issue {
  readonly file: string;
  readonly line: number;
  readonly target: string;
  readonly reason: string;
}

const issues: Issue[] = [];

// Markdown link pattern: [label](relative/path) — only check non-URL targets.
// Patterns we explicitly skip: http(s)://, mailto:, anchor-only #fragment,
// `(x)` non-link parens.
const MD_LINK = /\[[^\]]*?\]\(([^)#\s]+)(?:#[^)]*)?\)/g;

// Bare-file mention pattern (a/b/c.ts) inside backticks or markdown link text.
// We catch obvious ones but don't aggressively scan prose.
const BARE_FILE = /`([a-zA-Z0-9_./-]+\.(?:ts|tsx|js|md|sh|sql|yaml|yml|json|toml|py))`/g;

// DECISION-NNN reference pattern.
const DECISION_REF = /\bDECISION-(\d{3})\b/g;

function resolvePath(fromFile: string, target: string): string | null {
  if (target.startsWith('http://') || target.startsWith('https://')) return null;
  if (target.startsWith('mailto:')) return null;
  if (target.startsWith('#')) return null;
  // Strip query / anchor.
  const clean = target.split('#')[0]!.split('?')[0]!;
  if (clean === '') return null;
  // Resolve relative to the source file's directory.
  const fromDir = path.dirname(fromFile);
  const abs = path.isAbsolute(clean) ? clean : path.resolve(fromDir, clean);
  return abs;
}

function loadDecisionIds(): Set<string> {
  const log = readFileSync(path.join(ROOT, 'docs/decisions/log.md'), 'utf8');
  const ids = new Set<string>();
  for (const line of log.split('\n')) {
    const m = line.match(/^##\s+DECISION-(\d{3})\b/);
    if (m) ids.add(m[1]!);
  }
  return ids;
}

function checkFile(rel: string, knownDecisions: Set<string>): void {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) {
    issues.push({ file: rel, line: 0, target: rel, reason: 'file does not exist' });
    return;
  }
  const text = readFileSync(abs, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Markdown links
    let m: RegExpExecArray | null;
    MD_LINK.lastIndex = 0;
    while ((m = MD_LINK.exec(line)) !== null) {
      const target = m[1]!;
      const resolved = resolvePath(abs, target);
      if (resolved === null) continue;
      if (!existsSync(resolved)) {
        issues.push({
          file: rel,
          line: i + 1,
          target,
          reason: `markdown-link target does not exist: ${path.relative(ROOT, resolved)}`,
        });
      }
    }

    // Bare backtick file mentions: only flag if the path looks
    // unambiguously repo-relative — must start with a known top-level
    // directory (apps/, packages/, scripts/, infra/, docs/, contracts/,
    // chaincode/, .github/) or with a leading `./` / `../`. This avoids
    // false positives on partial paths used as prose context (e.g.
    // `src/sign.test.ts` referring to a file inside whatever package the
    // surrounding paragraph names).
    BARE_FILE.lastIndex = 0;
    const repoRoots = [
      'apps/',
      'packages/',
      'scripts/',
      'infra/',
      'docs/',
      'contracts/',
      'chaincode/',
      '.github/',
    ];
    while ((m = BARE_FILE.exec(line)) !== null) {
      const target = m[1]!;
      // `./xxx` and `../xxx` in a markdown body are file-relative within
      // a code excerpt (e.g. `import './procurement.js'`), NOT repo-
      // relative file paths. Only flag the canonical repo-rooted forms
      // (apps/, packages/, …) so we don't false-positive on quoted
      // import statements.
      const looksRepoRelative = repoRoots.some((r) => target.startsWith(r));
      if (!looksRepoRelative) continue;
      // Skip placeholder-style paths that document a naming convention
      // rather than a real file: P-X-NNN.md, X-001.ts, <pattern>, etc.
      if (/[A-Z]-(?:X|NNN|N+)-[A-Z]/.test(target) || /[<{]/.test(target)) continue;
      const resolved = path.isAbsolute(target) ? target : path.resolve(ROOT, target);
      if (!existsSync(resolved)) {
        issues.push({
          file: rel,
          line: i + 1,
          target,
          reason: `backtick path does not exist`,
        });
      }
    }

    // DECISION-NNN references
    DECISION_REF.lastIndex = 0;
    while ((m = DECISION_REF.exec(line)) !== null) {
      const id = m[1]!;
      if (!knownDecisions.has(id)) {
        issues.push({
          file: rel,
          line: i + 1,
          target: `DECISION-${id}`,
          reason: 'no matching decision-log header',
        });
      }
    }
  }
}

function main(): void {
  const known = loadDecisionIds();
  console.log(
    `known decisions: ${[...known]
      .sort()
      .map((d) => `D-${d}`)
      .join(', ')}`,
  );
  for (const f of FILES_TO_CHECK) checkFile(f, known);

  if (issues.length === 0) {
    console.log(`\n✓ all references resolve (${FILES_TO_CHECK.length} files audited)`);
    process.exit(0);
  }
  console.error(`\n❌ ${issues.length} unresolved reference(s):\n`);
  for (const issue of issues) {
    console.error(`  ${issue.file}:${issue.line}  →  ${issue.target}`);
    console.error(`    ${issue.reason}`);
  }
  process.exit(1);
}

main();
