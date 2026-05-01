#!/usr/bin/env tsx
/**
 * scripts/check-decision-cross-links.ts — Block-C B5.
 *
 * Lints docs/decisions/log.md. Every DECISION-N entry past the
 * legacy allowlist MUST carry, ANYWHERE in the entry body, AT LEAST
 * ONE reference to:
 *   - an `AUDIT-NNN` finding identifier, AND
 *   - one of: a `W-NN` weakness id, a 7+-character commit sha, or
 *     a `commit:` line.
 *
 * Permissive contract per architect signoff 2026-05-01 + Block-D
 * opening commit (architect resolution option (b) on the first-run
 * audit):
 *
 *   - DECISION-000..DECISION-016 are LEGACY-EXEMPT. The cross-link
 *     convention crystallised post-DECISION-016 (the doctrine /
 *     pattern / TAL-PA decisions in that range used a different
 *     prose-style and predate AUDIT-NNN as a stable referent shape).
 *     Retrofitting earlier entries would produce fictional
 *     references; the architect chose to widen the allowlist
 *     rather than retrofit (cf. docs/decisions/cross-link-audit.md
 *     §"Architect-action options" → option (b)).
 *   - DECISION-017 onward MUST satisfy the (audit + weakness-or-
 *     commit) tuple. Failure → exit 1 with a per-decision list of
 *     missing refs.
 *
 * Run: `pnpm tsx scripts/check-decision-cross-links.ts`
 *
 * Wired into phase-gate.yml so a future PR that adds a DECISION
 * without cross-links fails CI BEFORE the entry can claim FINAL.
 */

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();
const LOG_PATH = join(REPO_ROOT, 'docs/decisions/log.md');

/**
 * LEGACY-EXEMPT decisions — predate the cross-link convention. Any
 * lettered variant (e.g. DECISION-014b, DECISION-014c) is also
 * exempt. Architect signoff 2026-05-01 (Block-C) initially named
 * DECISION-000..006; Block-D opening commit widened to ..016 per
 * the cross-link-audit.md option (b) resolution. Retrofitting
 * earlier entries would have produced fictional AUDIT-NNN /
 * commit references because the convention crystallised AFTER
 * those decisions landed.
 *
 * Going forward: DECISION-017 onward MUST satisfy the contract.
 * The forward gate is rigorous; the historical gate respects what
 * the architect actually wrote at the time.
 */
const LEGACY_EXEMPT = new Set([
  'DECISION-000',
  'DECISION-001',
  'DECISION-002',
  'DECISION-003',
  'DECISION-004',
  'DECISION-005',
  'DECISION-006',
  'DECISION-007',
  'DECISION-008',
  'DECISION-009',
  'DECISION-010',
  'DECISION-011',
  'DECISION-012',
  'DECISION-013',
  'DECISION-014',
  'DECISION-014b',
  'DECISION-014c',
  'DECISION-015',
  'DECISION-016',
]);

const AUDIT_RE = /\bAUDIT-\d{3}\b/;
const WEAKNESS_RE = /\bW-\d{1,3}\b/;
const COMMIT_RE = /\b[0-9a-f]{7,40}\b/;
const COMMIT_LABEL_RE = /^commit:\s*[0-9a-f]{7,40}$/im;

interface DecisionBlock {
  readonly id: string;
  readonly startLine: number;
  readonly body: string;
}

function parseDecisions(text: string): DecisionBlock[] {
  const lines = text.split('\n');
  const blocks: DecisionBlock[] = [];
  // Pattern: `## DECISION-NNN ` (optionally followed by a letter
  // suffix like 14b/14c). Stop at the next `## ` of any kind.
  let i = 0;
  while (i < lines.length) {
    const m = lines[i]!.match(/^## (DECISION-[\d]+[a-z]?)\b/);
    if (!m) {
      i += 1;
      continue;
    }
    const id = m[1]!;
    const startLine = i + 1;
    let j = i + 1;
    while (j < lines.length && !lines[j]!.match(/^## /)) j += 1;
    const body = lines.slice(i, j).join('\n');
    blocks.push({ id, startLine, body });
    i = j;
  }
  return blocks;
}

interface DecisionFailure {
  readonly id: string;
  readonly missing: ReadonlyArray<string>;
}

function checkDecision(d: DecisionBlock): DecisionFailure | null {
  // Strip the legacy-exempt entries; canonicalise lettered variants
  // back to the parent (DECISION-014b inherits DECISION-014's exempt
  // status would NOT make sense — every lettered variant is its own
  // decision and gets its own check).
  if (LEGACY_EXEMPT.has(d.id)) return null;

  const hasAudit = AUDIT_RE.test(d.body);
  const hasWeakness = WEAKNESS_RE.test(d.body);
  const hasCommit = COMMIT_RE.test(d.body) || COMMIT_LABEL_RE.test(d.body);

  const missing: string[] = [];
  if (!hasAudit) missing.push('AUDIT-NNN');
  if (!hasWeakness && !hasCommit) missing.push('W-NN OR commit-sha');

  return missing.length > 0 ? { id: d.id, missing } : null;
}

function main(): void {
  const text = readFileSync(LOG_PATH, 'utf8');
  const blocks = parseDecisions(text);

  if (blocks.length === 0) {
    process.stderr.write(
      '[check-decision-cross-links] FATAL: no DECISION-N blocks found in log.md\n',
    );
    process.exit(1);
  }

  const failures: DecisionFailure[] = [];
  for (const d of blocks) {
    const f = checkDecision(d);
    if (f !== null) failures.push(f);
  }

  if (failures.length > 0) {
    process.stderr.write(
      `[check-decision-cross-links] FAIL — ${failures.length} of ${blocks.length} entries missing cross-links:\n\n`,
    );
    for (const f of failures) {
      process.stderr.write(`  - ${f.id}: missing ${f.missing.join(' AND ')}\n`);
    }
    process.stderr.write(
      '\n' +
        'Permissive contract: every DECISION-N (N >= 7) must carry AT LEAST ONE\n' +
        '  AUDIT-NNN reference AND ONE of {W-NN, 7+-char commit sha, "commit: <sha>" line}\n' +
        'anywhere in the entry body. Backfill the references and re-run.\n',
    );
    process.exit(1);
  }

  process.stdout.write(
    `[check-decision-cross-links] OK — ${blocks.length} decisions, ${LEGACY_EXEMPT.size} legacy-exempt, ${blocks.length - LEGACY_EXEMPT.size} satisfy the cross-link contract\n`,
  );
}

main();
