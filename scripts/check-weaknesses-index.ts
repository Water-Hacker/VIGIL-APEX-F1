#!/usr/bin/env tsx
/**
 * scripts/check-weaknesses-index.ts — AUDIT-075 fix.
 *
 * Refuses CI merge when docs/weaknesses/INDEX.md drifts from the
 * docs/weaknesses/W-*.md files on disk. Specifically:
 *
 *   (a) Every W-NN.md on disk must have a row in INDEX.md whose first
 *       column is `[W-NN](W-NN.md)`.
 *   (b) Every row in INDEX.md must reference a file that exists.
 *   (c) The Severity column in each row must match the `**Severity**`
 *       value declared in the corresponding W-NN.md.
 *   (d) The "Severity tally" section must total the per-row counts
 *       (Critical / High / Medium / Low).
 *   (e) The header line must declare the same total count as the
 *       number of W-NN.md files on disk ("the 27 weaknesses").
 *
 * A previous PR could flip a W-*.md status without updating INDEX.md;
 * this script makes that PR fail before review.
 *
 * Run: `pnpm tsx scripts/check-weaknesses-index.ts`
 */

/// <reference types="node" />

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();
const DIR = join(REPO_ROOT, 'docs/weaknesses');
const INDEX_PATH = join(DIR, 'INDEX.md');

type Severity = 'Critical' | 'High' | 'Medium' | 'Low';
const SEVERITIES: readonly Severity[] = ['Critical', 'High', 'Medium', 'Low'] as const;

interface IndexRow {
  readonly id: string;
  readonly severity: string;
  readonly raw: string;
}

function listWeaknessFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => /^W-\d{2}\.md$/.test(f))
    .sort();
}

function fileSeverity(file: string): string | null {
  const text = readFileSync(join(DIR, file), 'utf8');
  const m = text.match(/^\|\s*Severity\s*\|\s*\*\*([A-Za-z]+)\*\*\s*\|/m);
  return m ? m[1]! : null;
}

function parseIndexRows(text: string): IndexRow[] {
  const rows: IndexRow[] = [];
  for (const line of text.split('\n')) {
    // Match: | [W-01](W-01.md) | High | Title | Status |
    const m = line.match(/^\|\s*\[(W-\d{2})\]\((W-\d{2}\.md)\)\s*\|\s*([A-Za-z]+)\s*\|/);
    if (!m) continue;
    if (m[1] !== m[2]!.replace(/\.md$/, '')) {
      // Defensive: catches `[W-05](W-06.md)` typos.
      continue;
    }
    rows.push({ id: m[1]!, severity: m[3]!, raw: line });
  }
  return rows;
}

function parseTally(text: string): Record<Severity, number | null> {
  const result: Record<Severity, number | null> = {
    Critical: null,
    High: null,
    Medium: null,
    Low: null,
  };
  for (const sev of SEVERITIES) {
    // Match the `- **High**: 12` style (allows trailing parenthetical like
    // `(W-07 — resolved)`).
    const re = new RegExp(`^\\-\\s*\\*\\*${sev}\\*\\*:\\s*(\\d+)`, 'm');
    const m = text.match(re);
    if (m) result[sev] = Number(m[1]);
  }
  return result;
}

function parseHeaderTotal(text: string): number | null {
  // Match `the 27 weaknesses identified during assimilation`.
  const m = text.match(/the\s+(\d+)\s+weaknesses\b/i);
  return m ? Number(m[1]) : null;
}

function main(): void {
  const files = listWeaknessFiles();
  const indexText = readFileSync(INDEX_PATH, 'utf8');
  const rows = parseIndexRows(indexText);

  const errors: string[] = [];

  // (a) Every file present on disk has a row.
  const rowIds = new Set(rows.map((r) => r.id));
  for (const f of files) {
    const id = f.replace(/\.md$/, '');
    if (!rowIds.has(id)) {
      errors.push(`docs/weaknesses/${f} exists but has no row in INDEX.md`);
    }
  }

  // (b) Every row references a file that exists.
  const fileIds = new Set(files.map((f) => f.replace(/\.md$/, '')));
  for (const r of rows) {
    if (!fileIds.has(r.id)) {
      errors.push(`INDEX.md row ${r.id} has no matching docs/weaknesses/${r.id}.md`);
    }
  }

  // (c) Per-row severity matches the file's `**Severity**` field.
  const perRowCounts: Record<Severity, number> = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
  };
  for (const r of rows) {
    if (!fileIds.has(r.id)) continue; // already reported in (b)
    const fileSev = fileSeverity(`${r.id}.md`);
    if (fileSev === null) {
      errors.push(`docs/weaknesses/${r.id}.md has no parseable Severity field`);
      continue;
    }
    if (fileSev !== r.severity) {
      errors.push(
        `INDEX.md row ${r.id} says Severity="${r.severity}" but ${r.id}.md says Severity="${fileSev}"`,
      );
      continue;
    }
    if (!(SEVERITIES as readonly string[]).includes(r.severity)) {
      errors.push(`INDEX.md row ${r.id} has unknown severity "${r.severity}"`);
      continue;
    }
    perRowCounts[r.severity as Severity] += 1;
  }

  // (d) Tally section equals per-row totals.
  const declared = parseTally(indexText);
  for (const sev of SEVERITIES) {
    const got = declared[sev];
    const expect = perRowCounts[sev];
    if (got === null) {
      errors.push(`INDEX.md "Severity tally" is missing the **${sev}** line`);
    } else if (got !== expect) {
      errors.push(
        `INDEX.md "Severity tally" says ${sev}=${got} but the row table contains ${expect} ${sev} entries`,
      );
    }
  }

  // (e) Header weakness count equals number of files on disk.
  const declaredTotal = parseHeaderTotal(indexText);
  if (declaredTotal === null) {
    errors.push(`INDEX.md header is missing a "the N weaknesses" phrase to anchor the count`);
  } else if (declaredTotal !== files.length) {
    errors.push(
      `INDEX.md header declares "${declaredTotal} weaknesses" but ${files.length} W-*.md files exist on disk`,
    );
  }

  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`[check-weaknesses-index] ${e}\n`);
    process.stderr.write(`[check-weaknesses-index] FAIL: ${errors.length} drift issue(s)\n`);
    process.exit(1);
  }
  process.stdout.write(
    `[check-weaknesses-index] OK: ${files.length} W-*.md files, ${rows.length} INDEX rows aligned\n`,
  );
}

main();
