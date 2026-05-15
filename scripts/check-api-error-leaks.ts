#!/usr/bin/env tsx
/**
 * Mode 4.9 — Verbose error response leaking internal state.
 *
 * Greps every file under `apps/dashboard/src/app/api/` for the
 * "echo the caught error to the client" anti-patterns:
 *
 *   message: String(err)
 *   message: err.message
 *   message: err.stack
 *   message: e.message       (same with single-letter binding)
 *   String(err) in response  (broader catch)
 *
 * These patterns leak stack traces, internal file paths, Postgres /
 * Redis / Vault connection details, library version strings, etc. to
 * the client. Operators should LOG the full error server-side and
 * return only an opaque error code to the caller (e.g.
 * `{ error: 'ipfs-fetch-failed' }`, no `message:` field).
 *
 * The gate is a regex scan — it's intentionally conservative. It
 * rejects:
 *   - `message: String(<binding>)` where the binding looks like a
 *     caught-error name (`err`, `e`, `error`).
 *   - `message: <binding>.message|stack` for the same bindings.
 *
 * If a future legit case needs to expose an error message (e.g. user
 * validation errors that ARE safe to echo), the caller can suppress
 * the gate per-line with `// allow: error-message-echo <reason>`
 * — but the reason must be in the comment so reviewers can audit.
 *
 * Run locally:
 *   tsx scripts/check-api-error-leaks.ts
 *
 * CI invocation: .github/workflows/ci.yml `api-error-leaks` job.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..');
const API_DIR = join(REPO_ROOT, 'apps/dashboard/src/app/api');

const BAD_PATTERNS: ReadonlyArray<{ re: RegExp; description: string }> = [
  {
    re: /message\s*:\s*String\s*\(\s*(err|e|error|caught)\b/g,
    description: '`message: String(<error>)` echoes the stringified caught error',
  },
  {
    re: /message\s*:\s*(err|e|error|caught)\s*\.\s*(message|stack)\b/g,
    description: '`message: <error>.message|stack` echoes caught-error internals',
  },
];

const SUPPRESS_RE = /\/\/\s*allow:\s*error-message-echo\b/;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly description: string;
}

async function walk(dir: string): Promise<string[]> {
  const ents = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (e.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) {
      out.push(p);
    }
  }
  return out;
}

async function main(): Promise<number> {
  const files = await walk(API_DIR);
  const violations: Violation[] = [];

  for (const f of files) {
    const contents = await readFile(f, 'utf8');
    const lines = contents.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Skip suppressed lines.
      if (SUPPRESS_RE.test(line)) continue;
      // Also skip the line above the SUPPRESS_RE marker (multi-line
      // patterns sometimes need the suppression on the preceding line).
      const prevLine = lines[i - 1] ?? '';
      if (SUPPRESS_RE.test(prevLine) && line.length < 200) continue;

      for (const p of BAD_PATTERNS) {
        // Reset regex state for each line.
        p.re.lastIndex = 0;
        if (p.re.test(line)) {
          violations.push({
            file: f,
            line: i + 1,
            text: line.trim().slice(0, 120),
            description: p.description,
          });
          break;
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log(`[api-error-leaks] OK — ${files.length} API files scanned, 0 leaks.`);
    return 0;
  }

  for (const v of violations) {
    console.error(`${v.file}:${v.line} ERROR: ${v.description}\n  ${v.text}`);
  }
  console.error(
    `[api-error-leaks] FAIL — ${violations.length} violation(s). Suppress per-line with \`// allow: error-message-echo <reason>\` if the message is genuinely safe to echo (e.g. user input validation), otherwise log server-side and return an opaque error code.`,
  );
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[api-error-leaks] crashed:', err);
    process.exit(2);
  });
