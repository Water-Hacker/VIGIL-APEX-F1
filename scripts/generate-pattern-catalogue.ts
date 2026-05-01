#!/usr/bin/env -S npx tsx
//
// Generate docs/patterns/P-X-NNN.md skeletons + the rolled-up
// docs/patterns/catalogue.md from each PatternDef in
// packages/patterns/src/category-X/p-X-NNN-slug.ts. Pulls title_fr/title_en,
// description_fr/en, defaultPrior, defaultWeight, status, and the
// subjectKinds — everything the catalogue page needs to be useful without
// a full hand-written essay.
//
// Block-C B1 (architect signoff 2026-05-01): strict-fail on missing
// registry fields. Required: title_fr, title_en, description_fr,
// description_en, defaultPrior, defaultWeight, status, plus a paired
// fixture-test file. A pattern that lacks any of these fails the
// generator (exit 1), wired into the phase-gate workflow so a
// missing field surfaces as CI red rather than a silent
// "(missing)" entry in the catalogue.
//
// Modes:
//   pnpm exec tsx scripts/generate-pattern-catalogue.ts
//     → write catalogue.md + index.md + per-pattern docs (mutating)
//
//   pnpm exec tsx scripts/generate-pattern-catalogue.ts --check
//     → validate registry fields + assert committed catalogue.md
//       matches what would be regenerated. Read-only. Used in CI.
//
// Idempotent: re-running regenerates only the auto-managed sections;
// any architect prose between BEGIN auto-generated and END auto-generated
// gets refreshed, the rest is preserved.
//
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(__dirname, '..');
const PATTERN_SRC_ROOT = path.join(ROOT, 'packages/patterns/src');
const CATALOGUE_ROOT = path.join(ROOT, 'docs/patterns');

interface PatternMeta {
  id: string; // e.g. P-A-001
  file: string; // absolute path to source
  category: string;
  subjectKinds: string[];
  title_fr: string;
  title_en: string;
  description_fr: string;
  description_en: string;
  defaultPrior: number | null;
  defaultWeight: number | null;
  status: string;
}

function* walk(dir: string): Iterable<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function extract(field: string, src: string): string | null {
  // Patterns use either single or double quotes; sometimes the value sits
  // on the next line after `field:` (template-literal style indentation).
  // The `\s*` after the colon must allow newlines, so we don't need /s.
  for (const quote of ["'", '"']) {
    const re = new RegExp(`${field}\\s*:[\\s\\n]*${quote}((?:[^${quote}\\\\]|\\\\.)*)${quote}`);
    const m = src.match(re);
    if (m)
      return m[1]!
        .replace(new RegExp(`\\\\${quote}`, 'g'), quote)
        .replace(/\s+/g, ' ')
        .trim();
  }
  return null;
}

function extractNumber(field: string, src: string): number | null {
  const re = new RegExp(`${field}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`);
  const m = src.match(re);
  return m ? Number(m[1]!) : null;
}

function extractSubjectKinds(src: string): string[] {
  const m = src.match(/subjectKinds\s*:\s*\[([^\]]+)\]/);
  if (!m) return [];
  return m[1]!
    .split(',')
    .map((s) => s.replace(/['"]/g, '').trim())
    .filter(Boolean);
}

function repoRelative(absPath: string): string {
  return path.relative(ROOT, absPath);
}

function findFixtureTest(id: string, category: string): string | null {
  const dir = path.join(ROOT, `packages/patterns/test/category-${category.toLowerCase()}`);
  if (!existsSync(dir)) return null;
  const idLower = id.toLowerCase();
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(`${idLower}-`) && entry.endsWith('-fixtures.test.ts')) {
      return repoRelative(path.join(dir, entry));
    }
  }
  return null;
}

/**
 * Strict load: every pattern file MUST declare title_fr, title_en,
 * description_fr, description_en, defaultPrior, defaultWeight, and
 * status. Missing fields raise — Block-C B1 contract.
 *
 * The fixture-test file is checked separately (findFixtureTest);
 * a missing fixture is also a hard fail because the catalogue's
 * "Fixture test" column has to point at something.
 */
function loadPatterns(): PatternMeta[] {
  const out: PatternMeta[] = [];
  const errors: string[] = [];
  for (const f of walk(PATTERN_SRC_ROOT)) {
    const base = path.basename(f);
    const m = base.match(/^(p-([a-h])-\d{3})-/);
    if (!m) continue;
    const id = m[1]!.toUpperCase();
    const cat = m[2]!.toUpperCase();
    const src = readFileSync(f, 'utf8');

    const title_fr = extract('title_fr', src);
    const title_en = extract('title_en', src);
    const description_fr = extract('description_fr', src);
    const description_en = extract('description_en', src);
    const defaultPrior = extractNumber('defaultPrior', src);
    const defaultWeight = extractNumber('defaultWeight', src);
    const status = extract('status', src);

    const missing: string[] = [];
    if (!title_fr) missing.push('title_fr');
    if (!title_en) missing.push('title_en');
    if (!description_fr) missing.push('description_fr');
    if (!description_en) missing.push('description_en');
    if (defaultPrior === null) missing.push('defaultPrior');
    if (defaultWeight === null) missing.push('defaultWeight');
    if (!status) missing.push('status');
    if (missing.length > 0) {
      errors.push(`${id} (${repoRelative(f)}): missing fields [${missing.join(', ')}]`);
      continue;
    }

    const fixture = findFixtureTest(id, cat);
    if (!fixture) {
      errors.push(
        `${id} (${repoRelative(f)}): no paired fixture test in packages/patterns/test/category-${cat.toLowerCase()}/`,
      );
      continue;
    }

    out.push({
      id,
      file: f,
      category: cat,
      subjectKinds: extractSubjectKinds(src),
      title_fr: title_fr!,
      title_en: title_en!,
      description_fr: description_fr!,
      description_en: description_en!,
      defaultPrior: defaultPrior!,
      defaultWeight: defaultWeight!,
      status: status!,
    });
  }
  if (errors.length > 0) {
    process.stderr.write(
      '[generate-pattern-catalogue] FATAL — registry-field gaps blocking catalogue generation:\n\n',
    );
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.stderr.write(
      '\nFill the missing fields in the pattern source(s) and rerun.\n' +
        'See docs/work-program/BLOCK-C-PLAN.md §3 hold-point #1 for the contract.\n',
    );
    process.exit(1);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const AUTO_BEGIN = '<!-- BEGIN auto-generated -->';
const AUTO_END = '<!-- END auto-generated -->';

function renderPatternDoc(p: PatternMeta): string {
  const sourceRel = repoRelative(p.file);
  const fixture = findFixtureTest(p.id, p.category);
  const subjectKinds = p.subjectKinds.length > 0 ? p.subjectKinds.join(', ') : '_(none declared)_';

  return `# ${p.id} — ${p.title_en}

> ${p.title_fr}

${AUTO_BEGIN}

| Attribute | Value |
|---|---|
| Pattern ID | \`${p.id}\` |
| Category | ${p.category} |
| Subject kinds | ${subjectKinds} |
| Default prior | ${p.defaultPrior ?? '_(none)_'} |
| Default weight | ${p.defaultWeight ?? '_(none)_'} |
| Status | ${p.status} |
| Source | [${sourceRel}](../../${sourceRel}) |
| Fixture test | ${fixture ? `[${fixture}](../../${fixture})` : '_(missing — pattern coverage gate must add one)_'} |

## Description (EN)

${p.description_en}

## Description (FR)

${p.description_fr}

${AUTO_END}

## Likelihood-ratio reasoning

<!-- Architect: cite the SRD §21 entry that justifies the default prior + weight. -->

## Known false-positive traps

<!-- Architect: list scenarios where this pattern fires but the underlying activity is benign. -->

## Calibration history

<!-- Architect: log of reliability-band adjustments per quarter. -->
`;
}

function mergeWithExisting(existing: string, regenerated: string): string {
  // If the existing file has the auto-block, replace JUST that block and
  // keep everything else (the architect's prose).
  const begin = existing.indexOf(AUTO_BEGIN);
  const end = existing.indexOf(AUTO_END);
  if (begin === -1 || end === -1 || end < begin) {
    return regenerated;
  }
  const newBegin = regenerated.indexOf(AUTO_BEGIN);
  const newEnd = regenerated.indexOf(AUTO_END) + AUTO_END.length;
  if (newBegin === -1 || newEnd === -1) return regenerated;
  return (
    existing.slice(0, begin) +
    regenerated.slice(newBegin, newEnd) +
    existing.slice(end + AUTO_END.length)
  );
}

/**
 * Block-C B1 — render the rolled-up `docs/patterns/catalogue.md`.
 *
 * One section per pattern with description_fr/en, prior, weight,
 * fixture link, and calibration link. The calibration link points
 * at the per-pattern `## Calibration history` anchor in the
 * existing P-X-NNN.md file (placeholder the architect fills with
 * per-quarter band history per AI-SAFETY-DOCTRINE-v1 §A.6).
 */
function renderCatalogue(patterns: PatternMeta[]): string {
  const head = `# Pattern Catalogue

> Auto-generated from \`packages/patterns/src/\` by
> [\`scripts/generate-pattern-catalogue.ts\`](../../scripts/generate-pattern-catalogue.ts).
>
> Edits to per-pattern descriptions, priors, or weights MUST be made
> in the \`PatternDef\` source file. Re-run the generator (or land the
> pattern PR; the phase-gate will regenerate in CI) to refresh this
> file. ${patterns.length} patterns total.

---

`;
  const sections: string[] = [];
  for (const p of patterns) {
    const fixture = findFixtureTest(p.id, p.category)!;
    const subjectKinds =
      p.subjectKinds.length > 0 ? p.subjectKinds.join(', ') : '_(none declared)_';
    const sourceRel = repoRelative(p.file);
    sections.push(`## ${p.id} — ${p.title_en}

> ${p.title_fr}

| Field | Value |
|---|---|
| Pattern ID | \`${p.id}\` |
| Category | ${p.category} |
| Subject kinds | ${subjectKinds} |
| Default prior | ${p.defaultPrior} |
| Default weight | ${p.defaultWeight} |
| Status | ${p.status} |
| Source | [${sourceRel}](../../${sourceRel}) |
| Fixture test | [${fixture}](../../${fixture}) |
| Calibration link | [./${p.id}.md#calibration-history](./${p.id}.md#calibration-history) |

### Description (FR)

${p.description_fr}

### Description (EN)

${p.description_en}

---
`);
  }
  return head + sections.join('\n');
}

/**
 * Block-C B1 — check mode. Read-only validation for CI:
 *   - loadPatterns() runs the strict-fail registry-field check
 *     (process.exit(1) if any pattern is missing a required field
 *     or fixture).
 *   - Asserts the committed catalogue.md matches what the generator
 *     would produce. Drift fails the job, prompts the operator to
 *     re-run the generator + commit the result.
 *   - Asserts the committed index.md matches.
 *   - Per-pattern docs: NOT checked here. Architect prose between
 *     AUTO_END and EOF is allowed to drift; the auto-block alone
 *     would be fragile to check (architect may have refreshed the
 *     header with a typo-fixed source). The pattern-coverage gate
 *     covers the existence + fixture-pairing axis.
 */
function runCheckMode(patterns: PatternMeta[]): void {
  const errors: string[] = [];

  const expectedCatalogue = renderCatalogue(patterns);
  const cataloguePath = path.join(CATALOGUE_ROOT, 'catalogue.md');
  if (!existsSync(cataloguePath)) {
    errors.push(
      `docs/patterns/catalogue.md missing. Run: pnpm exec tsx scripts/generate-pattern-catalogue.ts`,
    );
  } else {
    const actual = readFileSync(cataloguePath, 'utf8');
    if (actual !== expectedCatalogue) {
      errors.push(
        `docs/patterns/catalogue.md is stale. Re-run: pnpm exec tsx scripts/generate-pattern-catalogue.ts`,
      );
    }
  }

  const expectedIndex = renderIndex(patterns);
  const indexPath = path.join(CATALOGUE_ROOT, 'index.md');
  if (!existsSync(indexPath)) {
    errors.push(
      `docs/patterns/index.md missing. Run: pnpm exec tsx scripts/generate-pattern-catalogue.ts`,
    );
  } else {
    const actual = readFileSync(indexPath, 'utf8');
    if (actual !== expectedIndex) {
      errors.push(
        `docs/patterns/index.md is stale. Re-run: pnpm exec tsx scripts/generate-pattern-catalogue.ts`,
      );
    }
  }

  if (errors.length > 0) {
    process.stderr.write('[generate-pattern-catalogue --check] FAIL\n\n');
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `[generate-pattern-catalogue --check] OK — catalogue.md + index.md fresh, ${patterns.length} patterns priced.\n`,
  );
}

function renderIndex(patterns: PatternMeta[]): string {
  const lines: string[] = [
    '# Pattern Catalogue',
    '',
    `> Auto-generated from \`packages/patterns/src/\` by \`scripts/generate-pattern-catalogue.ts\`. ${patterns.length} patterns; one entry per file.`,
    '',
    '| ID | Category | Title (EN) | Status | Default prior | Default weight |',
    '|---|---|---|---|---|---|',
  ];
  for (const p of patterns) {
    lines.push(
      `| [${p.id}](${p.id}.md) | ${p.category} | ${p.title_en} | ${p.status} | ${p.defaultPrior} | ${p.defaultWeight} |`,
    );
  }
  return lines.join('\n') + '\n';
}

function main(): void {
  const checkMode = process.argv.includes('--check');

  if (!existsSync(CATALOGUE_ROOT)) {
    if (checkMode) {
      process.stderr.write('[generate-pattern-catalogue --check] FAIL: docs/patterns/ missing\n');
      process.exit(1);
    }
    mkdirSync(CATALOGUE_ROOT, { recursive: true });
  }

  const patterns = loadPatterns(); // strict — exits 1 on missing fields

  if (checkMode) {
    runCheckMode(patterns);
    return;
  }

  console.log(`generating catalogue for ${patterns.length} patterns`);

  // Per-pattern docs
  for (const p of patterns) {
    const out = path.join(CATALOGUE_ROOT, `${p.id}.md`);
    const regenerated = renderPatternDoc(p);
    if (existsSync(out)) {
      const existing = readFileSync(out, 'utf8');
      const merged = mergeWithExisting(existing, regenerated);
      writeFileSync(out, merged);
    } else {
      writeFileSync(out, regenerated);
    }
  }

  // Top-level index
  writeFileSync(path.join(CATALOGUE_ROOT, 'index.md'), renderIndex(patterns));

  // Block-C B1 — rolled-up catalogue.md
  writeFileSync(path.join(CATALOGUE_ROOT, 'catalogue.md'), renderCatalogue(patterns));

  console.log(
    `✓ wrote ${patterns.length} per-pattern docs + index.md + catalogue.md to docs/patterns/`,
  );
}

main();
