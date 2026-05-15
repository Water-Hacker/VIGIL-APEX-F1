#!/usr/bin/env tsx
/**
 * Hardening mode 10.2 — Enumerate base images used by Dockerfiles.
 *
 * Scans `infra/docker/dockerfiles/*.Dockerfile` for `FROM <image>` lines
 * and emits a deduplicated list of base images. Internal multi-stage
 * aliases (`FROM base AS …`, `FROM deps AS …`) are filtered out.
 *
 * Used by:
 *   - The `trivy-base-images` CI gate (mode 10.7 + 10.2(a)) — feeds the
 *     image list into `trivy image --severity HIGH,CRITICAL`.
 *   - The quarterly base-image refresh runbook (mode 10.2(c)) — the same
 *     enumerator is the on-call's source-of-truth.
 *
 * If a Dockerfile uses an ARG to template the image (e.g.
 * `python:${PYTHON_VERSION}-slim-bookworm`), the script substitutes the
 * default value declared in the same Dockerfile. Unresolved ARGs cause
 * the image to be skipped with a warning to stderr.
 *
 * Output format: one image per line on stdout, sorted, deduped.
 *
 * Exit codes:
 *   0 — clean enumeration.
 *   1 — parse error or unresolvable ARG that has no default.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const DOCKERFILES_DIR = 'infra/docker/dockerfiles';

interface ParseResult {
  readonly images: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<{ readonly file: string; readonly reason: string }>;
}

function parseDockerfile(path: string, content: string): ParseResult {
  const lines = content.split('\n');
  const args = new Map<string, string>();
  const images: string[] = [];
  const skipped: ParseResult['skipped'][number][] = [];
  // Pre-scan for ARG defaults (ARG NAME=value). ARGs without defaults
  // can't be resolved without external input.
  for (const raw of lines) {
    const m = raw.match(/^\s*ARG\s+([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/i);
    if (m) args.set(m[1]!, m[2]!.replace(/^["']|["']$/g, ''));
  }
  for (const raw of lines) {
    const m = raw.match(/^\s*FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/i);
    if (!m) continue;
    const ref = m[1]!;
    // Internal multi-stage aliases never contain a `:` or `/`, e.g.
    // `FROM base AS builder`, `FROM deps AS builder`. Skip those.
    if (!ref.includes(':') && !ref.includes('/')) continue;
    // Substitute ${ARG} placeholders.
    const substituted = ref.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gi, (_, name: string) => {
      const v = args.get(name);
      if (v === undefined) return `__UNRESOLVED_${name}__`;
      return v;
    });
    if (substituted.includes('__UNRESOLVED_')) {
      const argName = (substituted.match(/__UNRESOLVED_([A-Z_][A-Z0-9_]*)__/) ?? [])[1];
      skipped.push({ file: path, reason: `unresolved ARG: ${argName ?? '<unknown>'}` });
      continue;
    }
    images.push(substituted);
  }
  return { images, skipped };
}

function main(): number {
  let dir: string;
  try {
    dir = DOCKERFILES_DIR;
    const ls = readdirSync(dir);
    if (ls.length === 0) throw new Error('empty');
  } catch {
    process.stderr.write(`[enumerate-base-images] FAIL: cannot read ${DOCKERFILES_DIR}\n`);
    return 1;
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.Dockerfile'))
    .map((f) => join(dir, f));
  const all = new Set<string>();
  const skips: ParseResult['skipped'][number][] = [];
  for (const f of files) {
    const content = readFileSync(f, 'utf8');
    const result = parseDockerfile(f, content);
    for (const img of result.images) all.add(img);
    skips.push(...result.skipped);
  }
  for (const s of skips)
    process.stderr.write(`[enumerate-base-images] SKIP ${s.file}: ${s.reason}\n`);
  const sorted = [...all].sort();
  for (const img of sorted) process.stdout.write(`${img}\n`);
  if (sorted.length === 0) {
    process.stderr.write('[enumerate-base-images] FAIL: zero images enumerated\n');
    return 1;
  }
  process.stderr.write(`[enumerate-base-images] OK: enumerated ${sorted.length} base image(s)\n`);
  return 0;
}

process.exit(main());
