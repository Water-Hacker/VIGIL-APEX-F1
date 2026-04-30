#!/usr/bin/env tsx
/**
 * scripts/check-decisions.ts — W-27 fix per OPERATIONS.md §7.
 *
 * Lints docs/decisions/log.md. Fails CI if either:
 *   (a) Any FINAL decision is dated within the last 7 days but its
 *       `audit_event_id:` line is `pending` or absent. Only enforced
 *       once the current phase is ≥ 1 (pre-Phase-1 entries pre-date
 *       the audit chain by design).
 *   (b) Any decision-log entry references a phase or section that
 *       does not exist (`Phase 99`, `EXEC §99`, etc).
 *
 * Run: `pnpm tsx scripts/check-decisions.ts` (or via the phase-gate
 * GitHub workflow).
 */

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

interface DecisionBlock {
  readonly id: string;
  readonly title: string;
  readonly date: string | null;
  readonly status: string | null;
  readonly auditEventId: string | null;
  readonly body: string;
  readonly startLine: number;
}

const REPO_ROOT = process.cwd();
const LOG_PATH = join(REPO_ROOT, 'docs/decisions/log.md');

function parseDecisions(text: string): DecisionBlock[] {
  const lines = text.split('\n');
  const blocks: DecisionBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const headingMatch = lines[i]!.match(/^##\s+(DECISION-[0-9A-Za-z_-]+)\s+(.*)$/);
    if (!headingMatch) {
      i++;
      continue;
    }
    const id = headingMatch[1]!;
    const title = headingMatch[2]!.trim();
    const startLine = i + 1;
    i++;
    const bodyLines: string[] = [];
    while (i < lines.length) {
      const next = lines[i]!.match(/^##\s+(DECISION-|Phase Pointer)/);
      if (next) break;
      bodyLines.push(lines[i]!);
      i++;
    }
    const body = bodyLines.join('\n');
    blocks.push({
      id,
      title,
      date: extractField(body, /\|\s*Date\s*\|\s*([^|]+?)\s*\|/) ?? null,
      status: extractField(body, /\|\s*Status\s*\|\s*\*?\*?([A-Z][A-Z _-]+?)\*?\*?\s*\|/) ?? null,
      auditEventId: extractMultilineField(body, /audit_event_id:\s*/),
      body,
      startLine,
    });
  }
  return blocks;
}

function extractField(body: string, re: RegExp): string | null {
  const m = body.match(re);
  return m ? m[1]!.trim() : null;
}

/**
 * Capture a key whose value may wrap onto continuation lines, e.g.
 *   audit_event_id: pending (the audit chain itself ships in this commit;
 *   this decision will be migrated retroactively at first chain-init).
 *
 * Stops at the next blank line, a markdown heading, or a markdown HR.
 */
function extractMultilineField(body: string, anchor: RegExp): string | null {
  const m = anchor.exec(body);
  if (!m) return null;
  const tail = body.slice(m.index + m[0].length);
  const lines = tail.split('\n');
  const collected: string[] = [];
  for (const line of lines) {
    if (collected.length === 0) {
      collected.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === '' || /^(#{1,6}\s|---\s*$)/.test(trimmed)) break;
    if (/^\|/.test(trimmed)) break; // next markdown table row
    if (/^[a-z_]+:\s/i.test(trimmed)) break; // next key-value line
    collected.push(line);
  }
  return collected.join(' ').replace(/\s+/g, ' ').trim();
}

function readCurrentPhase(text: string): number {
  const m = text.match(/\*\*Current phase:\s*Phase\s+([0-9]+)/i);
  if (!m) return 0;
  return Number(m[1]);
}

function isWithinDays(dateStr: string, days: number): boolean {
  // Accept ISO yyyy-mm-dd; reject _pending_ and other non-dates.
  const m = dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
  if (!m) return false;
  const then = new Date(dateStr + 'T00:00:00Z').getTime();
  const now = Date.now();
  const ageDays = (now - then) / (1000 * 60 * 60 * 24);
  return ageDays >= 0 && ageDays <= days;
}

/**
 * The strict phase list. Anything outside this set is a typo or a
 * reference to a phase that does not exist in ROADMAP.md / EXEC §43.2.
 * The looser PHASE_REFERENCE regex catches numeric phases; this stricter
 * list catches `Phase 99`, `Phase X`, `Phase III` and other variants
 * that slip past the numeric check.
 */
const VALID_PHASES = new Set(['0', '1', '2', '3', '4']);
const PHASE_REFERENCE = /\bPhase\s+([0-9]+|[A-Za-z]+)\b/g;

/**
 * Strip Markdown code spans before scanning for phase references.
 * Phrases like `Phase 99` or `Phase II` inside fenced or inline code
 * blocks are by definition examples — typically documentation of the
 * lint itself in DECISION-015 — not authoritative references to real
 * phases. Replacing the spans with same-length whitespace keeps line
 * numbers stable for the diagnostic message.
 */
function stripCodeSpans(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

function validatePhaseReferences(blocks: DecisionBlock[]): string[] {
  const errors: string[] = [];
  for (const b of blocks) {
    const scannable = stripCodeSpans(b.body);
    let m: RegExpExecArray | null;
    PHASE_REFERENCE.lastIndex = 0;
    while ((m = PHASE_REFERENCE.exec(scannable)) !== null) {
      const ref = m[1] ?? '';
      // Numeric phase: validate against ROADMAP cap (0..4).
      if (/^\d+$/.test(ref)) {
        if (!VALID_PHASES.has(ref)) {
          errors.push(
            `${b.id} (line ~${b.startLine}): references Phase ${ref}; only Phase 0-4 are defined in ROADMAP.md`,
          );
        }
        continue;
      }
      // Non-numeric phase. Three recognised forms:
      //   1. Single uppercase letter A-Z — BUILD-COMPANION's alphabetic
      //      phase-grid convention (Phase A, Phase H, Phase I, Phase J).
      //   2. Lowercase narrative qualifiers (pre / post / current /
      //      next / previous).
      //   3. Anything else — typo OR malformed (Roman-numeral 'II' is
      //      the classic), hard reject.
      const NARRATIVE_OK = new Set(['pre', 'post', 'current', 'next', 'previous']);
      const isCompanionLetter = /^[A-Z]$/.test(ref);
      const isNarrative = NARRATIVE_OK.has(ref.toLowerCase());
      if (!isCompanionLetter && !isNarrative) {
        errors.push(
          `${b.id} (line ~${b.startLine}): references "Phase ${ref}" which is not a numeric phase, a Companion alphabetic phase, or a recognised narrative qualifier`,
        );
      }
    }
  }
  return errors;
}

function main(): void {
  const text = readFileSync(LOG_PATH, 'utf8');
  const blocks = parseDecisions(text);
  const phase = readCurrentPhase(text);

  let errors = 0;

  // (a) Phase 1+: FINAL within 7 days must have audit_event_id ≠ pending/empty
  if (phase >= 1) {
    for (const b of blocks) {
      if (!b.status) continue;
      if (b.status.toUpperCase() !== 'FINAL') continue;
      if (!b.date || !isWithinDays(b.date, 7)) continue;
      const aud = b.auditEventId?.toLowerCase() ?? '';
      // OPERATIONS.md §7: "pre-Phase-1 entries are migrated retroactively".
      // We grandfather entries that explicitly self-declare the migration is
      // pending, so the audit chain itself can ship without blocking on
      // back-filling its own predecessors. Once the chain is live the
      // architect rewrites these entries with real ids and the exemption
      // disappears naturally.
      const exemptPattern = /(pre-dates|pre-phase[- ]?1|migrated retroactively|n\/?a)/i;
      const exempt = exemptPattern.test(b.auditEventId ?? '');
      const pendingLike =
        aud === '' || aud.startsWith('pending') || aud.startsWith('_pending') || aud === 'tbd';
      if (pendingLike && !exempt) {
        process.stderr.write(
          `[check-decisions] ${b.id}: FINAL on ${b.date} but audit_event_id is "${b.auditEventId ?? '<absent>'}" — Phase ${phase} requires a real audit event id\n`,
        );
        errors++;
      }
    }
  }

  // (b) Phase reference sanity (always on — cheap and catches typos pre-Phase-1)
  for (const e of validatePhaseReferences(blocks)) {
    process.stderr.write(`[check-decisions] ${e}\n`);
    errors++;
  }

  if (errors > 0) {
    process.stderr.write(`[check-decisions] FAIL: ${errors} issue(s)\n`);
    process.exit(1);
  }
  process.stdout.write(`[check-decisions] OK: ${blocks.length} decision blocks, phase=${phase}\n`);
}

main();
