#!/usr/bin/env tsx
/**
 * Build-time RBAC coverage check — closes FIND-004 from
 * whole-system-audit doc 10.
 *
 * Enumerates every `page.tsx` under `apps/dashboard/src/app/` and
 * confirms that:
 *   (a) Either the route prefix is in middleware.ts PUBLIC_PREFIXES
 *       (intentionally public surface), OR
 *   (b) The route prefix is matched by a middleware.ts ROUTE_RULES
 *       entry (operator-gated surface).
 *
 * Any page that is NEITHER public NOR rule-matched is a CRITICAL
 * defect — the page would ship publicly accessible because middleware
 * does not match → does not block.
 *
 * The script reads middleware.ts as TEXT and extracts the public
 * prefix list + the rule prefixes with a regex. This is fragile by
 * choice — a structural change to middleware.ts will fail this script
 * loudly, which forces the developer to update the script alongside.
 *
 * Wire into pnpm build via the dashboard `prebuild` script (added
 * in apps/dashboard/package.json).
 *
 * Exit codes:
 *   0 — all pages mapped or explicitly public.
 *   1 — at least one operator page lacks a matching rule. Build halts.
 *   2 — middleware.ts could not be parsed. Build halts.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const APP_DIR = join(ROOT, 'apps/dashboard/src/app');
const MIDDLEWARE = join(ROOT, 'apps/dashboard/src/middleware.ts');

function fail(code: number, message: string): never {
  console.error(`\n[check-rbac-coverage] ${message}\n`);
  process.exit(code);
}

function extractStringList(src: string, varName: string): string[] {
  // Grabs the body of `const <varName> = [ ... ] as const;` (or `;`).
  // Greedy across newlines; pulls every single-quoted, double-quoted, or
  // backtick-quoted string literal inside.
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${varName}\\s*(?::[^=]+)?=\\s*\\[([\\s\\S]*?)\\]\\s*(?:as\\s+const)?\\s*;`,
    'm',
  );
  const m = re.exec(src);
  if (!m || !m[1]) {
    fail(2, `could not locate \`${varName}\` array in middleware.ts`);
  }
  const body = m[1];
  const strRe = /['"`]([^'"`]+)['"`]/g;
  const out: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = strRe.exec(body)) !== null) {
    out.push(sm[1]!);
  }
  return out;
}

function extractRulePrefixes(src: string): string[] {
  // ROUTE_RULES is `const ROUTE_RULES = [...]` (or `export const`).
  // Each entry: `{ prefix: '/x', allow: [...] }`. We don't care about
  // allow values here — only that every prefix is present.
  const re =
    /(?:export\s+)?const\s+ROUTE_RULES\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]\s*(?:as\s+const)?\s*;/m;
  const m = re.exec(src);
  if (!m || !m[1]) {
    fail(2, 'could not locate `ROUTE_RULES` array in middleware.ts');
  }
  const body = m[1];
  const prefixRe = /prefix\s*:\s*['"`]([^'"`]+)['"`]/g;
  const out: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = prefixRe.exec(body)) !== null) {
    out.push(sm[1]!);
  }
  return out;
}

function walkPages(root: string, found: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const abs = join(root, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      // Skip Next.js route-group parentheses directories' parens but
      // still descend into them — `(public)`, `(operator)`, etc.
      walkPages(abs, found);
    } else if (entry === 'page.tsx' || entry === 'page.ts' || entry === 'page.jsx') {
      found.push(abs);
    }
  }
  return found;
}

function pathToRoute(absPath: string): string {
  const rel = relative(APP_DIR, dirname(absPath));
  if (rel === '' || rel === '.') return '/';
  // Strip Next.js route-group segments `(name)` from URL projection.
  const segments = rel.split('/').filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  return '/' + segments.join('/');
}

function matches(route: string, prefix: string): boolean {
  if (route === prefix) return true;
  if (route.startsWith(prefix + '/')) return true;
  // Public prefix `/` only matches the bare root, not `/anything`.
  if (prefix === '/' && route === '/') return true;
  return false;
}

function main(): void {
  const src = readFileSync(MIDDLEWARE, 'utf8');

  const publicPrefixes = extractStringList(src, 'PUBLIC_PREFIXES');
  const rulePrefixes = extractRulePrefixes(src);

  if (publicPrefixes.length === 0) {
    fail(2, 'PUBLIC_PREFIXES is empty — middleware would block everything.');
  }
  if (rulePrefixes.length === 0) {
    fail(2, 'ROUTE_RULES is empty — middleware would allow everything.');
  }

  const pages = walkPages(APP_DIR);
  if (pages.length === 0) {
    fail(2, `no page.tsx files found under ${APP_DIR}`);
  }

  const violations: { route: string; file: string }[] = [];
  for (const pageFile of pages) {
    const route = pathToRoute(pageFile);

    // Special-case the 403 page — it's reached via middleware rewrite,
    // not direct routing. It MUST NOT match a rule (would create a loop).
    if (route === '/403') continue;

    const isPublic = publicPrefixes.some((p) => matches(route, p));
    const isRuled = rulePrefixes.some((p) => matches(route, p));

    if (isPublic) continue;
    if (isRuled) continue;
    violations.push({ route, file: relative(ROOT, pageFile) });
  }

  if (violations.length > 0) {
    console.error('');
    console.error('[check-rbac-coverage] CRITICAL — unmapped operator routes (FIND-004 gate):');
    console.error('');
    for (const v of violations) {
      console.error(`  ✗  ${v.route}`);
      console.error(`     ${v.file}`);
    }
    console.error('');
    console.error('Each of the above pages is reachable WITHOUT middleware authorization.');
    console.error('Add a matching ROUTE_RULES entry in apps/dashboard/src/middleware.ts:');
    console.error("  { prefix: '/<your-prefix>', allow: ['<role>', ...] }");
    console.error('');
    console.error('OR — if the page is intentionally public — add the prefix to');
    console.error('PUBLIC_PREFIXES (above ROUTE_RULES) in the same file.');
    console.error('');
    process.exit(1);
  }

  console.log(
    `[check-rbac-coverage] OK — ${pages.length} pages mapped (${publicPrefixes.length} public prefixes, ${rulePrefixes.length} route rules).`,
  );
}

main();
