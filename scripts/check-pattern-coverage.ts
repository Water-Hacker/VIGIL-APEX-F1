#!/usr/bin/env -S npx tsx
/**
 * Pattern coverage gate — every `packages/patterns/src/category-X/p-X-NNN-*.ts`
 * file must have a paired `packages/patterns/test/category-X/p-X-NNN-*-fixtures.test.ts`.
 *
 * Run as a blocking step in CI to prevent landing a new pattern definition
 * without at least one TP/FP fixture.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(ROOT, 'packages/patterns/src');
const TEST_ROOT = path.join(ROOT, 'packages/patterns/test');

interface Pattern {
  id: string; // e.g. p-a-001
  category: string; // a..h
  file: string;
}

function* walk(dir: string): Iterable<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function discover(root: string, suffix: RegExp): Pattern[] {
  const out: Pattern[] = [];
  for (const f of walk(root)) {
    const base = path.basename(f);
    const m = base.match(suffix);
    if (!m) continue;
    const id = m[1]!.toLowerCase();
    const cat = id.split('-')[1]!;
    out.push({ id, category: cat, file: f });
  }
  return out;
}

const srcPatterns = discover(SRC_ROOT, /^(p-[a-h]-\d{3})-/);
// Accept both `p-a-001-fixtures.test.ts` and `p-a-001-<slug>-fixtures.test.ts`.
const testPatterns = discover(TEST_ROOT, /^(p-[a-h]-\d{3})(?:-[\w-]+)?-fixtures\.test\.ts$/);

const srcIds = new Set(srcPatterns.map((p) => p.id));
const testIds = new Set(testPatterns.map((p) => p.id));

const srcWithoutTest = [...srcIds].filter((id) => !testIds.has(id)).sort();
const testWithoutSrc = [...testIds].filter((id) => !srcIds.has(id)).sort();

let exitCode = 0;
console.log(`patterns: src=${srcPatterns.length} test=${testPatterns.length}`);
if (srcWithoutTest.length > 0) {
  console.error(`\n❌ ${srcWithoutTest.length} pattern(s) without a paired fixture test:`);
  for (const id of srcWithoutTest) console.error(`  - ${id}`);
  exitCode = 1;
}
if (testWithoutSrc.length > 0) {
  console.error(
    `\n❌ ${testWithoutSrc.length} fixture test(s) without a matching pattern definition:`,
  );
  for (const id of testWithoutSrc) console.error(`  - ${id}`);
  exitCode = 1;
}
if (exitCode === 0) {
  console.log(`✓ every pattern has paired fixture coverage (${srcIds.size} ↔ ${testIds.size})`);
}
process.exit(exitCode);
