#!/usr/bin/env tsx
/**
 * scripts/check-source-count.ts — Block-A reconciliation §2.A.9.
 *
 * Lints the source-catalogue count for coherence across:
 *   - infra/sources.json — operational truth (adapter-runner reads here).
 *   - TRUTH.md — single source of truth (committed phrasing "N sources").
 *   - docs/source/SRD-v3.md — binding spec (§10.2 catalogue header).
 *
 * If the three numbers disagree, fail with a clear remediation message.
 * The architect resolves the discrepancy by either:
 *   - editing the binding doc phrasing to match infra/sources.json, or
 *   - removing/disabling source entries to match the doc count.
 *
 * Run: `pnpm tsx scripts/check-source-count.ts` (or via the phase-gate
 * GitHub workflow).
 */

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();
const SOURCES_JSON = join(REPO_ROOT, 'infra/sources.json');
const TRUTH_MD = join(REPO_ROOT, 'TRUTH.md');
const SRD_MD = join(REPO_ROOT, 'docs/source/SRD-v3.md');

interface CountClaim {
  readonly file: string;
  readonly count: number;
  readonly evidence: string;
}

function readJsonCount(): CountClaim {
  const raw = readFileSync(SOURCES_JSON, 'utf8');
  const j = JSON.parse(raw) as { sources?: unknown[] };
  if (!Array.isArray(j.sources)) {
    throw new Error(`${SOURCES_JSON}: top-level "sources" key missing or not an array`);
  }
  return { file: 'infra/sources.json', count: j.sources.length, evidence: '$.sources.length' };
}

/**
 * Match phrases like "26 sources" / "27 sources" / "29 sources" — the
 * convention every binding doc uses for the catalogue size. Requires
 * at least 2 digits because (a) the source catalogue will never drop
 * below ~10 entries and (b) single-digit matches collide with phrases
 * like "tier-1 sources" / "P-3 sources".
 */
function readDocCount(filename: string, displayName: string): CountClaim | null {
  const text = readFileSync(filename, 'utf8');
  const re = /\b(\d{2,})\s+sources\b/g;
  const counts = new Set<number>();
  const evidence: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number.parseInt(m[1]!, 10);
    counts.add(n);
    if (evidence.length < 3) evidence.push(`"${m[0]}"`);
  }
  if (counts.size === 0) return null;
  if (counts.size > 1) {
    // The doc itself disagrees with itself; surface that.
    const sorted = Array.from(counts).sort((a, b) => a - b);
    throw new Error(
      `${displayName} contains contradictory source counts: ${sorted.join(', ')}. ` +
        `Examples: ${evidence.join(', ')}.`,
    );
  }
  return {
    file: displayName,
    count: counts.values().next().value!,
    evidence: evidence.join(', '),
  };
}

function main(): void {
  const claims: CountClaim[] = [readJsonCount()];
  const truth = readDocCount(TRUTH_MD, 'TRUTH.md');
  if (truth !== null) claims.push(truth);
  const srd = readDocCount(SRD_MD, 'docs/source/SRD-v3.md');
  if (srd !== null) claims.push(srd);

  const distinct = new Set(claims.map((c) => c.count));
  if (distinct.size === 1) {
    process.stdout.write(`[source-count] coherent: ${claims[0]!.count} sources\n`);
    return;
  }

  // Disagreement — fail with a clear message that names the gap and
  // points the architect at the resolution choices.
  process.stderr.write('[source-count] DRIFT — binding docs and infra/sources.json disagree.\n\n');
  for (const c of claims) {
    process.stderr.write(`  ${c.file}: ${c.count}  (${c.evidence})\n`);
  }
  process.stderr.write(
    '\n' +
      'Resolve by either:\n' +
      '  (a) edit the binding doc phrasing to match infra/sources.json, or\n' +
      '  (b) remove/disable source entries to match the doc count.\n' +
      '\n' +
      'The single canonical number is an architect call. See\n' +
      'docs/work-program/BLOCK-A-RECONCILIATION.md §2.A.9.\n',
  );
  process.exit(1);
}

main();
