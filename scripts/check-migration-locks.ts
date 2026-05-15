#!/usr/bin/env tsx
/**
 * Mode 2.5 — Migration locks under production load.
 *
 * Scans `packages/db-postgres/drizzle/*.sql` and enforces that any
 * `CREATE INDEX` against a "country-scale large table" either:
 *
 *   (a) uses `CREATE INDEX CONCURRENTLY ...` (does not acquire an
 *       exclusive lock on the table; the only safe path in production
 *       under sustained traffic), OR
 *
 *   (b) is in a migration file that opts out with a top-of-file marker:
 *       `-- @migration-locks-acknowledged: <reason>` — this is the
 *       grandfather clause for migrations that pre-date the closure
 *       AND for migrations that target the large table BEFORE it has
 *       grown large (e.g. when the table is being created and is
 *       empty at the time of migration).
 *
 * Without this gate, an operator who runs `drizzle-kit migrate` in
 * production against a large `finding.signal` table will block all
 * writes for the duration of the index build. The gate refuses to let
 * such a migration land in `main` without a documented justification.
 *
 * Failure output is parseable: every violation is one line of
 * `file:line message` for easy grep / CI annotation.
 *
 * Run locally:
 *   tsx scripts/check-migration-locks.ts
 *
 * CI invocation:
 *   .github/workflows/ci.yml `migration-locks` step.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages/db-postgres/drizzle');

/**
 * Tables that are projected to reach > 10^6 rows under country-scale
 * Phase-1 deployment. Indexes added to these without CONCURRENTLY
 * block all writes for minutes-to-hours during the build.
 *
 * Adding a new entry here is the right move when a new table grows
 * large; removing an entry requires architect sign-off (the discipline
 * exists to protect production traffic).
 */
const LARGE_TABLES: readonly string[] = [
  // Core finding pipeline
  'finding.finding',
  'finding.signal',
  'finding.routing_decision',
  // Entity graph (high-cardinality)
  'entity.canonical',
  'entity.alias',
  'entity.relationship',
  // Source ingest
  'source.events',
  'source.documents',
  // Audit chain (every action emits at least one row)
  'audit.actions',
  'audit.user_action_event',
  'audit.user_action_chain',
  'audit.fabric_witness',
  // Certainty-engine LLM history (call_record grows fast)
  'certainty.call_record',
  'certainty.assessment',
  'certainty.fact_provenance',
  // Dossier / governance
  'dossier.dossier',
];

const ACK_MARKER = /^\s*--\s*@migration-locks-acknowledged:\s*(.+)$/m;

interface Violation {
  file: string;
  line: number;
  table: string;
  rawStmt: string;
}

/**
 * Parse a SQL file and return any `CREATE INDEX` against a large
 * table that does NOT use CONCURRENTLY. The parser is intentionally
 * simple: it works on whole-statement strings (`CREATE INDEX ... ;`)
 * and uses regex. Drizzle-generated migrations follow predictable
 * formatting; we don't need a full SQL parser.
 */
function findUnsafeIndexes(filePath: string, contents: string): Violation[] {
  const violations: Violation[] = [];

  // Match `CREATE INDEX [CONCURRENTLY] [IF NOT EXISTS] name ON table_qualified` —
  // captures the optional CONCURRENTLY flag and the target table.
  // Multi-line tolerant via the [\s\S] character class.
  const RE =
    /CREATE\s+INDEX\s+(?<conc>CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[\w"]+\s+ON\s+(?<table>[\w"]+(?:\.[\w"]+)?)/gi;

  for (const match of contents.matchAll(RE)) {
    const tableQualified = (match.groups?.table ?? '').replace(/"/g, '');
    if (!LARGE_TABLES.includes(tableQualified)) continue;
    if (match.groups?.conc) continue; // CONCURRENTLY present
    // Find the line number of this match.
    const charIdx = match.index ?? 0;
    const lineNo = contents.slice(0, charIdx).split('\n').length;
    violations.push({
      file: filePath,
      line: lineNo,
      table: tableQualified,
      rawStmt: match[0].slice(0, 80),
    });
  }

  return violations;
}

async function main(): Promise<number> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));

  let totalViolations = 0;
  for (const filePath of files) {
    const contents = await readFile(filePath, 'utf8');
    const ack = contents.match(ACK_MARKER);
    const violations = findUnsafeIndexes(filePath, contents);
    if (violations.length === 0) continue;

    if (ack) {
      // Acknowledged — log informationally but do not fail.
      const ackedReason = (ack[1] ?? 'unspecified').trim();
      console.log(
        `[migration-locks] ${filePath}: ${violations.length} unsafe CREATE INDEX (acknowledged: ${ackedReason})`,
      );
      continue;
    }

    for (const v of violations) {
      console.error(
        `${v.file}:${v.line} ERROR: CREATE INDEX on large table '${v.table}' without CONCURRENTLY — add CONCURRENTLY or add a top-of-file ` +
          `'-- @migration-locks-acknowledged: <reason>' marker. Stmt: ${v.rawStmt}...`,
      );
      totalViolations++;
    }
  }

  if (totalViolations === 0) {
    console.log(`[migration-locks] OK — ${files.length} migration files scanned, 0 violations.`);
    return 0;
  }
  console.error(
    `[migration-locks] FAIL — ${totalViolations} violation(s). New migrations to large tables must use CONCURRENTLY or carry an acknowledged-locks marker. See LARGE_TABLES list in this script.`,
  );
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[migration-locks] crashed:', err);
    process.exit(2);
  });
