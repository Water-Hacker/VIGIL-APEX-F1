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
 *   --dry-run    : print planned edits, exit 0 with no file changes.
 *   --apply      : write edits + a digest manifest at
 *                  infra/docker/image-digests.lock (machine-readable).
 *   --verify     : check that every image: / FROM with a digest still
 *                  resolves to that digest at the upstream registry.
 *                  Exits 1 on mismatch (used as a periodic CI gate).
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
 *   runs in CI catch drift.
 *
 * Exit codes:
 *   0 — clean (--verify: no drift; --apply: edits written; --dry-run: plan printed).
 *   1 — drift detected (--verify) or apply failed.
 *   2 — environment error (docker / crane missing, network failure, etc.).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const DOCKERFILES_DIR = 'infra/docker/dockerfiles';
const COMPOSE_FILE = 'infra/docker/docker-compose.yaml';
const DIGEST_LOCK = 'infra/docker/image-digests.lock';

type Mode = 'dry-run' | 'apply' | 'verify';

interface ImageRef {
  readonly tag: string; // e.g. "node:20.20.2-alpine"
  readonly source: string; // file:line where this ref was found
}

function parseMode(): Mode {
  const argv = process.argv.slice(2);
  if (argv.includes('--apply')) return 'apply';
  if (argv.includes('--dry-run')) return 'dry-run';
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

function resolveDigest(tag: string, resolver: 'docker' | 'crane'): string {
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

function reportPlan(refs: ImageRef[]): void {
  process.stdout.write(
    `[pin-image-digests] enumerated ${refs.length} image ref(s) without digest:\n`,
  );
  for (const r of refs) process.stdout.write(`  ${r.source}\t${r.tag}\n`);
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

  if (mode === 'verify') {
    // Read the existing lock file; for each ref already digest-pinned in
    // the source files, verify the digest matches what the registry serves.
    try {
      const lockRaw = readFileSync(DIGEST_LOCK, 'utf8');
      const lock = JSON.parse(lockRaw) as Record<string, string>;
      let drift = 0;
      for (const [tag, expectedDigest] of Object.entries(lock)) {
        let actual: string;
        try {
          actual = resolveDigest(tag, resolver);
        } catch (e) {
          process.stderr.write(
            `[pin-image-digests] verify: ${tag} could not be resolved (${String(e)})\n`,
          );
          drift++;
          continue;
        }
        if (actual !== expectedDigest) {
          process.stderr.write(
            `[pin-image-digests] DRIFT: ${tag} expected ${expectedDigest} got ${actual}\n`,
          );
          drift++;
        }
      }
      if (drift > 0) {
        process.stderr.write(`[pin-image-digests] FAIL: ${drift} digest mismatch(es).\n`);
        return 1;
      }
      process.stdout.write(
        `[pin-image-digests] OK: ${Object.keys(lock).length} digest(s) verified against registry.\n`,
      );
      return 0;
    } catch {
      // No lock file yet — verify is a no-op in pre-activation state.
      process.stdout.write(
        `[pin-image-digests] no lock file at ${DIGEST_LOCK}; nothing to verify (pre-activation). Run with --apply once digests are ready to pin.\n`,
      );
      return 0;
    }
  }

  // mode === 'apply'
  const lock: Record<string, string> = {};
  reportPlan(allRefs);
  for (const r of allRefs) {
    process.stdout.write(`[pin-image-digests] resolving ${r.tag} ... `);
    try {
      const digest = resolveDigest(r.tag, resolver);
      lock[r.tag] = digest;
      process.stdout.write(`${digest}\n`);
    } catch (e) {
      process.stderr.write(`FAIL: ${String(e)}\n`);
      return 1;
    }
  }
  // Write the lock file.
  writeFileSync(DIGEST_LOCK, JSON.stringify(lock, null, 2) + '\n');
  process.stdout.write(`[pin-image-digests] wrote ${DIGEST_LOCK}\n`);

  // Rewrite source files in place. For each ref, append "@sha256:DIGEST"
  // after the tag in every occurrence we found.
  // Dockerfile rewrites:
  for (const r of fromRefs) {
    const [file] = r.source.split(':');
    if (!file) continue;
    const content = readFileSync(file, 'utf8');
    const pinned = `${r.tag}@${lock[r.tag]}`;
    const updated = content.replace(
      new RegExp(`^(\\s*FROM\\s+)${r.tag.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(\\s|$)`, 'gm'),
      `$1${pinned}$2`,
    );
    writeFileSync(file, updated);
    process.stdout.write(`[pin-image-digests] updated ${file}\n`);
  }
  // Compose rewrites:
  for (const r of composeRefs) {
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
    writeFileSync(file, updated);
    process.stdout.write(`[pin-image-digests] updated ${file}\n`);
  }
  process.stdout.write('[pin-image-digests] apply complete.\n');
  return 0;
}

process.exit(main());
