#!/usr/bin/env tsx
/**
 * Hardening Phase 12a / Modes 9.8 + 9.9 — Enumerate VIGIL-built
 * container images that get signed + digest-pinned at release.
 *
 * The list is derived from `infra/docker/dockerfiles/*.Dockerfile`:
 *   each Dockerfile produces one or more named images. The Helm chart's
 *   image.repository field (per service in values.yaml) is the
 *   canonical name; the tag is `appVersion` from Chart.yaml at
 *   release time.
 *
 * Output: one fully-qualified image ref per line on stdout.
 *
 * Used by:
 *   - `.github/workflows/security.yml` `cosign-sign-images` job —
 *     feeds the image list into `cosign sign --key file:...`.
 *   - `scripts/pin-image-digests.ts` (companion) — same enumeration is
 *     the source for "which images need their FROM lines + Helm
 *     values updated to `tag@sha256:digest`".
 *
 * Activation gating: until the Forgejo registry is live and the bake
 * pipeline produces these tags, the registry-prefixed images don't
 * exist. The script still enumerates the LIST shape so framework
 * consumers (the CI step, the digest-pin script) can be developed +
 * tested against the names.
 *
 * Exit codes:
 *   0 — at least one image enumerated.
 *   1 — zero images (suggests Chart.yaml or values.yaml drift).
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

import { parse } from 'yaml';

const CHART_YAML = 'infra/k8s/charts/vigil-apex/Chart.yaml';
const VALUES_YAML = 'infra/k8s/charts/vigil-apex/values.yaml';

/**
 * Default registry per SRD §1253. Override via VIGIL_REGISTRY env in
 * CI / local dev pointing at a different host (e.g. ghcr.io/water-hacker
 * for Phase-2 partner-mirroring per SRD §1253 second clause).
 */
const DEFAULT_REGISTRY = process.env.VIGIL_REGISTRY ?? 'registry.vigilapex.local';

interface ImageRef {
  readonly repository: string; // e.g. "vigil-apex/worker-pattern"
  readonly tag: string; // e.g. "0.1.0"
}

function readChartVersion(): string {
  try {
    const raw = readFileSync(CHART_YAML, 'utf8');
    const data = parse(raw) as { appVersion?: string; version?: string };
    return data.appVersion ?? data.version ?? '0.0.0-unset';
  } catch (e) {
    process.stderr.write(`[enumerate-publish-images] cannot read ${CHART_YAML}: ${String(e)}\n`);
    return '0.0.0-unset';
  }
}

function enumerateFromValues(appVersion: string): ImageRef[] {
  try {
    const raw = readFileSync(VALUES_YAML, 'utf8');
    const data = parse(raw) as Record<string, unknown>;
    const out: ImageRef[] = [];
    // Component-level images.
    for (const key of ['dashboard', 'caddy']) {
      const section = data[key];
      if (section && typeof section === 'object') {
        const img = (section as Record<string, unknown>).image;
        if (img && typeof img === 'object') {
          const repo = (img as Record<string, unknown>).repository;
          const tag = (img as Record<string, unknown>).tag;
          if (typeof repo === 'string' && repo.startsWith('vigil-')) {
            out.push({ repository: repo, tag: typeof tag === 'string' ? tag : appVersion });
          }
        }
      }
    }
    // workers[] images.
    const workers = data.workers;
    if (Array.isArray(workers)) {
      for (const w of workers) {
        if (w && typeof w === 'object') {
          const img = (w as Record<string, unknown>).image;
          if (img && typeof img === 'object') {
            const repo = (img as Record<string, unknown>).repository;
            const tag = (img as Record<string, unknown>).tag;
            if (typeof repo === 'string' && repo.startsWith('vigil-')) {
              out.push({ repository: repo, tag: typeof tag === 'string' ? tag : appVersion });
            }
          }
        }
      }
    }
    return out;
  } catch (e) {
    process.stderr.write(`[enumerate-publish-images] cannot read ${VALUES_YAML}: ${String(e)}\n`);
    return [];
  }
}

function main(): number {
  const appVersion = readChartVersion();
  const images = enumerateFromValues(appVersion);
  if (images.length === 0) {
    process.stderr.write(
      '[enumerate-publish-images] FAIL: zero images enumerated. Check values.yaml dashboard/caddy/workers sections.\n',
    );
    return 1;
  }
  // Emit fully-qualified refs: <registry>/<repository>:<tag>
  for (const img of images) {
    process.stdout.write(`${DEFAULT_REGISTRY}/${img.repository}:${img.tag}\n`);
  }
  process.stderr.write(
    `[enumerate-publish-images] OK: enumerated ${images.length} image(s) against registry "${DEFAULT_REGISTRY}"\n`,
  );
  return 0;
}

process.exit(main());
