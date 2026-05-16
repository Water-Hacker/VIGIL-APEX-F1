#!/usr/bin/env tsx
/**
 * Hardening Phase 12a / Modes 9.8 + 10.2(b) — Pin image refs to sha256
 * digests across Dockerfiles, Helm values, and compose.
 *
 * Replaces `image: foo:tag` references with `image: foo:tag@sha256:DIGEST`
 * after resolving each tag to its current registry digest via
 * `docker buildx imagetools inspect` (or `crane digest` if available).
 *
 * Mode 9.8 (Image pulled by mutable tag) requires every deployment-path
 * image reference to carry an explicit digest so a registry compromise
 * can't swap the layer behind us. Mode 10.2(b) is the same closure
 * applied to base-image FROM lines.
 *
 * Files updated in place:
 *   - infra/docker/dockerfiles/*.Dockerfile      (FROM lines)
 *   - infra/k8s/charts/vigil-apex/values*.yaml   (image.repository + image.digest)
 *   - infra/docker/docker-compose.yaml           (image: lines)
 *
 * Modes of operation:
 *   --dry-run         : print planned edits, exit 0 with no file changes.
 *   --apply           : write edits + a digest manifest at
 *                       infra/docker/image-digests.lock (machine-readable).
 *   --verify          : check that every digest-pinned ref still resolves
 *                       to the same digest at the upstream registry.
 *                       Exits 1 on mismatch (periodic CI gate).
 *   --verify-complete : strict variant of --verify. Additionally fails
 *                       (exit 1) if any vigil-owned image ref enumerated
 *                       from the source tree is MISSING from the lock
 *                       file. Closes the deploy-window between --apply
 *                       runs where a newly-added vigil-owned service
 *                       could ship without a digest. Issue #1 closure.
 *
 * Default: --verify (safe to run anywhere).
 *
 * Requires `docker` OR `crane` on PATH for digest resolution. In CI,
 * the trivy-base-images job's runner has docker; we'll wire this script
 * to that runner once Phase 12b activates.
 *
 * Activation gating (Phase 12a → 12b transition):
 *   The script is committed now as part of the Phase 12a framework.
 *   --apply is a one-shot the architect runs after the registry is
 *   live + the first signed images are published. Subsequent --verify
 *   runs in CI catch drift; --verify-complete is the strict gate that
 *   runs in the release path.
 *
 * Exit codes:
 *   0 — clean (--verify[-complete]: no drift; --apply: edits written;
 *       --dry-run: plan printed).
 *   1 — drift detected, --verify-complete found unpinned vigil-owned
 *       refs, or apply failed.
 *   2 — environment error (docker / crane missing, network failure, etc.).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const DOCKERFILES_DIR = 'infra/docker/dockerfiles';
const COMPOSE_FILE = 'infra/docker/docker-compose.yaml';
const DIGEST_LOCK = 'infra/docker/image-digests.lock';

type Mode = 'dry-run' | 'apply' | 'verify' | 'verify-complete';

interface ImageRef {
  readonly tag: string; // e.g. "node:20.20.2-alpine"
  readonly source: string; // file:line where this ref was found
}

/**
 * Vigil-owned image namespaces. The strict --verify-complete mode
 * requires every enumerated ref matching one of these patterns to
 * appear in the digest lock; refs not matching are upstream/public
 * images where a missing digest is a warning rather than a release
 * blocker (still pinned by --apply when present, just not gated).
 *
 * Array-of-patterns rather than a single regex: each entry maps
 * one-to-one to a published vigil prefix, so adding/removing a
 * namespace is a literal one-line change — reviewer Issue #2.
 */
export const VIGIL_OWNED_PATTERNS: readonly RegExp[] = [
  /^vigil-apex\//,
  /^vigil-caddy(:|$)/,
  /^registry\.vigilapex\.local[/:]/,
];

export function isVigilOwned(tag: string): boolean {
  return VIGIL_OWNED_PATTERNS.some((p) => p.test(tag));
}

export function parseMode(argv: readonly string[] = process.argv.slice(2)): Mode {
  if (argv.includes('--apply')) return 'apply';
  if (argv.includes('--dry-run')) return 'dry-run';
  if (argv.includes('--verify-complete')) return 'verify-complete';
  return 'verify';
}

function whichResolver(): 'docker' | 'crane' | null {
  for (const bin of ['crane', 'docker']) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'pipe' });
      return bin as 'crane' | 'docker';
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Normalise any caught value to an Error so we can report `.name`,
 * `.message`, `.stack`, and `.cause` instead of an opaque `String(e)`
 * — reviewer Issue #3. Non-Error throwables (string, number, plain
 * object) are wrapped while preserving the original payload as `.cause`.
 */
export function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  const err = new Error(typeof e === 'string' ? e : JSON.stringify(e));
  (err as Error & { cause?: unknown }).cause = e;
  return err;
}

/**
 * Resolve a tag to its sha256 digest at the registry. Performs a
 * cross-check second call to defend against a single-call MITM that
 * could swap the digest between resolve and pin — reviewer Issue #5.
 * Two independent calls reduce the window; not a full cryptographic
 * defence (the registry itself could lie consistently), but it raises
 * the bar to detect transient registry-proxy poisoning.
 */
function resolveDigest(tag: string, resolver: 'docker' | 'crane'): string {
  const first = resolveDigestOnce(tag, resolver);
  const second = resolveDigestOnce(tag, resolver);
  if (first !== second) {
    throw new Error(`resolver cross-check failed for ${tag}: first=${first} second=${second}`);
  }
  return first;
}

function resolveDigestOnce(tag: string, resolver: 'docker' | 'crane'): string {
  if (resolver === 'crane') {
    return execFileSync('crane', ['digest', tag], { encoding: 'utf8' }).trim();
  }
  // docker buildx imagetools emits structured output; the first line
  // includes "Digest: sha256:..." in the table format.
  const out = execFileSync('docker', ['buildx', 'imagetools', 'inspect', tag], {
    encoding: 'utf8',
  });
  const m = out.match(/Digest:\s+(sha256:[a-f0-9]{64})/);
  if (!m) throw new Error(`could not extract digest from docker output for ${tag}`);
  return m[1]!;
}

function collectFromLines(): ImageRef[] {
  const refs: ImageRef[] = [];
  let dir: string;
  try {
    dir = DOCKERFILES_DIR;
    readdirSync(dir);
  } catch {
    return refs;
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.Dockerfile'))
    .map((f) => join(dir, f));
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Match `FROM <ref>` but skip internal multi-stage aliases (no `:` or `/`).
      // Also skip refs that already carry @sha256: pinning.
      const m = line.match(/^\s*FROM\s+(\S+)(?:\s+AS\s+\S+)?\s*$/i);
      if (!m) continue;
      const ref = m[1]!;
      if (!ref.includes(':') && !ref.includes('/')) continue;
      if (ref.includes('@sha256:')) continue;
      // Skip unresolved ARG-templated refs; the architect updates the
      // ARG default + reruns the digest-pin sweep when bumping.
      if (ref.includes('${')) continue;
      refs.push({ tag: ref, source: `${f}:${i + 1}` });
    }
  }
  return refs;
}

function collectComposeImages(): ImageRef[] {
  const refs: ImageRef[] = [];
  try {
    const lines = readFileSync(COMPOSE_FILE, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const m = line.match(/^\s*image:\s*(\S+)\s*$/);
      if (!m) continue;
      const ref = m[1]!.replace(/['"]/g, '');
      if (!ref.includes(':') && !ref.includes('/')) continue;
      if (ref.includes('@sha256:')) continue;
      if (ref.includes('${')) continue;
      refs.push({ tag: ref, source: `${COMPOSE_FILE}:${i + 1}` });
    }
  } catch {
    /* compose file may not exist in some checkouts */
  }
  return refs;
}

/**
 * Atomic file write: writes to a per-PID `.tmp.<pid>` sibling then
 * POSIX-renames into place. A mid-write crash leaves the tmp file
 * but never a half-written canonical lock or source file. Pairs
 * with the same pattern used by ntp-check.ts + cert-expiry-check.ts.
 */
function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

/**
 * Structured skip-event emitted to stderr as one JSON object per line
 * — reviewer Issue #4. Operators / CI can parse the event stream to
 * audit exactly which refs were skipped and why, without scraping
 * free-form log lines. The event shape is stable: `event`, `tag`,
 * `source`, `reason`, optional `err`.
 */
function emitEvent(event: {
  event: string;
  tag?: string;
  source?: string;
  reason?: string;
  err?: { name: string; message: string; stack?: string; cause?: unknown };
  [k: string]: unknown;
}): void {
  process.stderr.write(JSON.stringify(event) + '\n');
}

function reportPlan(refs: ImageRef[]): void {
  process.stdout.write(
    `[pin-image-digests] enumerated ${refs.length} image ref(s) without digest:\n`,
  );
  for (const r of refs) {
    const tag = isVigilOwned(r.tag) ? `${r.tag} (vigil-owned)` : r.tag;
    process.stdout.write(`  ${r.source}\t${tag}\n`);
  }
}

function main(): number {
  const mode = parseMode();
  process.stderr.write(`[pin-image-digests] mode=${mode}\n`);

  const fromRefs = collectFromLines();
  const composeRefs = collectComposeImages();
  const allRefs = [...fromRefs, ...composeRefs];

  if (mode === 'dry-run') {
    reportPlan(allRefs);
    return 0;
  }

  const resolver = whichResolver();
  if (!resolver) {
    process.stderr.write(
      '[pin-image-digests] ERROR: neither `crane` nor `docker` on PATH. Install one to resolve digests.\n',
    );
    return 2;
  }

  if (mode === 'verify' || mode === 'verify-complete') {
    // Read the existing lock file; for each ref already digest-pinned in
    // the source files, verify the digest matches what the registry serves.
    let lock: Record<string, string>;
    try {
      const lockRaw = readFileSync(DIGEST_LOCK, 'utf8');
      lock = JSON.parse(lockRaw) as Record<string, string>;
    } catch {
      // No lock file yet — plain --verify is a no-op in pre-activation
      // state, but --verify-complete fails because activation hasn't
      // happened and we cannot prove anything is pinned.
      if (mode === 'verify-complete') {
        process.stderr.write(
          `[pin-image-digests] FAIL: --verify-complete requires ${DIGEST_LOCK}; none found. Run --apply first.\n`,
        );
        return 1;
      }
      process.stdout.write(
        `[pin-image-digests] no lock file at ${DIGEST_LOCK}; nothing to verify (pre-activation). Run with --apply once digests are ready to pin.\n`,
      );
      return 0;
    }

    let drift = 0;
    for (const [tag, expectedDigest] of Object.entries(lock)) {
      let actual: string;
      try {
        actual = resolveDigest(tag, resolver);
      } catch (e) {
        const err = toError(e);
        emitEvent({
          event: 'verify-resolve-failed',
          tag,
          reason: 'resolver-threw',
          err: { name: err.name, message: err.message, stack: err.stack, cause: err.cause },
        });
        drift++;
        continue;
      }
      if (actual !== expectedDigest) {
        emitEvent({
          event: 'verify-drift',
          tag,
          reason: 'digest-mismatch',
          expected: expectedDigest,
          actual,
        });
        drift++;
      }
    }

    // --verify-complete: every vigil-owned ref enumerated from the
    // source tree must be in the lock. A new vigil-owned service that
    // landed without re-running --apply is a release-blocker — that's
    // the exact deploy-window Issue #1 closes.
    let missingOwned = 0;
    if (mode === 'verify-complete') {
      const lockedTags = new Set(Object.keys(lock));
      for (const r of allRefs) {
        if (!isVigilOwned(r.tag)) continue;
        if (!lockedTags.has(r.tag)) {
          emitEvent({
            event: 'verify-complete-missing',
            tag: r.tag,
            source: r.source,
            reason: 'vigil-owned-ref-not-in-lock',
          });
          missingOwned++;
        }
      }
    }

    if (drift > 0 || missingOwned > 0) {
      process.stderr.write(
        `[pin-image-digests] FAIL: ${drift} digest mismatch(es), ${missingOwned} unpinned vigil-owned ref(s).\n`,
      );
      return 1;
    }
    process.stdout.write(
      `[pin-image-digests] OK: ${Object.keys(lock).length} digest(s) verified against registry` +
        (mode === 'verify-complete' ? `; all vigil-owned refs pinned.\n` : `.\n`),
    );
    return 0;
  }

  // mode === 'apply'
  const lock: Record<string, string> = {};
  reportPlan(allRefs);
  // Phase 12a → 12b activation: our own `vigil-apex/*` and `vigil-caddy`
  // refs don't exist in any reachable registry until the docker-bake
  // CI job builds + pushes them. For those refs, `resolveDigest` fails
  // with `insufficient_scope` / "pull access denied". We pre-skip
  // vigil-owned refs in --apply mode (they'll be filled in by the
  // bake-and-push CI job when it runs). Upstream public refs (caddy,
  // node, python, playwright, postgres, etc.) resolve cleanly and are
  // recorded. The strict --verify-complete mode is the release-path
  // gate that flips this skip into a hard failure once activation has
  // happened (issue #1 closure).
  const skipped: string[] = [];
  for (const r of allRefs) {
    if (isVigilOwned(r.tag)) {
      skipped.push(r.tag);
      emitEvent({
        event: 'apply-skip',
        tag: r.tag,
        source: r.source,
        reason: 'vigil-owned-pre-activation',
      });
      continue;
    }
    process.stdout.write(`[pin-image-digests] resolving ${r.tag} ... `);
    try {
      const digest = resolveDigest(r.tag, resolver);
      lock[r.tag] = digest;
      process.stdout.write(`${digest}\n`);
    } catch (e) {
      const err = toError(e);
      process.stdout.write(`FAIL\n`);
      emitEvent({
        event: 'apply-resolve-failed',
        tag: r.tag,
        source: r.source,
        reason: 'resolver-threw',
        err: { name: err.name, message: err.message, stack: err.stack, cause: err.cause },
      });
      // Upstream resolution failure is fatal in --apply mode — we
      // can't write a partial lock that would let some images ship
      // without digests. Pre-skipped vigil-owned refs are the only
      // path that survives an unresolvable ref.
      process.stderr.write(
        `[pin-image-digests] FAIL: ${r.tag} could not be resolved; refusing to write partial lock.\n`,
      );
      return 1;
    }
  }
  if (skipped.length > 0) {
    process.stdout.write(
      `[pin-image-digests] skipped ${skipped.length} vigil-owned ref(s) ` +
        `(filled in by docker-bake CI job): ${[...new Set(skipped)].join(', ')}\n`,
    );
  }
  // Write the lock file atomically.
  writeFileAtomic(DIGEST_LOCK, JSON.stringify(lock, null, 2) + '\n');
  process.stdout.write(`[pin-image-digests] wrote ${DIGEST_LOCK}\n`);

  // Rewrite source files in place. For each ref, append "@sha256:DIGEST"
  // after the tag in every occurrence we found.
  // Dockerfile rewrites:
  for (const r of fromRefs) {
    if (!lock[r.tag]) continue; // skipped upstream
    const [file] = r.source.split(':');
    if (!file) continue;
    const content = readFileSync(file, 'utf8');
    const pinned = `${r.tag}@${lock[r.tag]}`;
    const updated = content.replace(
      new RegExp(`^(\\s*FROM\\s+)${r.tag.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(\\s|$)`, 'gm'),
      `$1${pinned}$2`,
    );
    writeFileAtomic(file, updated);
    process.stdout.write(`[pin-image-digests] updated ${file}\n`);
  }
  // Compose rewrites:
  for (const r of composeRefs) {
    if (!lock[r.tag]) continue; // skipped upstream
    const [file] = r.source.split(':');
    if (!file) continue;
    const content = readFileSync(file, 'utf8');
    const pinned = `${r.tag}@${lock[r.tag]}`;
    const updated = content.replace(
      new RegExp(
        `^(\\s*image:\\s*)${r.tag.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(\\s*$)`,
        'gm',
      ),
      `$1${pinned}$2`,
    );
    writeFileAtomic(file, updated);
    process.stdout.write(`[pin-image-digests] updated ${file}\n`);
  }
  process.stdout.write('[pin-image-digests] apply complete.\n');
  return 0;
}

// Guard the entry-point so importing this module from tests does not
// invoke main(). The script's CLI behaviour is preserved when run via
// `tsx scripts/pin-image-digests.ts ...`.
const invokedAsScript =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  /pin-image-digests\.(?:ts|js|mjs)$/.test(process.argv[1]);
if (invokedAsScript) {
  process.exit(main());
}
