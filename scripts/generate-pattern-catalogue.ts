#!/usr/bin/env -S npx tsx
//
// Generate docs/patterns/P-X-NNN.md skeletons from each PatternDef in
// packages/patterns/src/category-X/p-X-NNN-slug.ts. Pulls title_fr/title_en,
// description_fr/en, defaultPrior, defaultWeight, status, and the
// subjectKinds — everything the catalogue page needs to be useful without
// a full hand-written essay.
//
// Idempotent: re-running regenerates only the auto-managed sections;
// any architect prose between BEGIN auto-generated and END auto-generated
// gets refreshed, the rest is preserved.
//
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

function loadPatterns(): PatternMeta[] {
  const out: PatternMeta[] = [];
  for (const f of walk(PATTERN_SRC_ROOT)) {
    const base = path.basename(f);
    const m = base.match(/^(p-([a-h])-\d{3})-/);
    if (!m) continue;
    const id = m[1]!.toUpperCase();
    const cat = m[2]!.toUpperCase();
    const src = readFileSync(f, 'utf8');
    out.push({
      id,
      file: f,
      category: cat,
      subjectKinds: extractSubjectKinds(src),
      title_fr: extract('title_fr', src) ?? '(missing)',
      title_en: extract('title_en', src) ?? '(missing)',
      description_fr: extract('description_fr', src) ?? '(missing)',
      description_en: extract('description_en', src) ?? '(missing)',
      defaultPrior: extractNumber('defaultPrior', src),
      defaultWeight: extractNumber('defaultWeight', src),
      status: extract('status', src) ?? 'live',
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
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

function main(): void {
  if (!existsSync(CATALOGUE_ROOT)) mkdirSync(CATALOGUE_ROOT, { recursive: true });
  const patterns = loadPatterns();
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
  const idxLines: string[] = [
    '# Pattern Catalogue',
    '',
    `> Auto-generated from \`packages/patterns/src/\` by \`scripts/generate-pattern-catalogue.ts\`. ${patterns.length} patterns; one entry per file.`,
    '',
    '| ID | Category | Title (EN) | Status | Default prior | Default weight |',
    '|---|---|---|---|---|---|',
  ];
  for (const p of patterns) {
    idxLines.push(
      `| [${p.id}](${p.id}.md) | ${p.category} | ${p.title_en} | ${p.status} | ${p.defaultPrior ?? '-'} | ${p.defaultWeight ?? '-'} |`,
    );
  }
  writeFileSync(path.join(CATALOGUE_ROOT, 'index.md'), idxLines.join('\n') + '\n');

  console.log(`✓ wrote ${patterns.length} per-pattern docs + index.md to docs/patterns/`);
}

main();
