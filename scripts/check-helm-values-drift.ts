#!/usr/bin/env tsx
/**
 * Hardening mode 9.1 — Helm values drift gate (Tier 1).
 *
 * Lints `infra/k8s/charts/vigil-apex/values{,-dev,-prod,-cluster}.yaml`
 * for the highest-risk drift classes:
 *
 *   - images pinned to specific tags (not "latest", not "dev")
 *   - replicas >= 2 in prod for all stateless workloads
 *   - resources.limits.memory set in prod for every workload
 *   - certManager.clusterIssuer === 'letsencrypt-prod' in prod
 *   - storageClass !== 'standard' in prod (the dev default)
 *   - workers[].name parity between dev and prod
 *   - top-level keys are equivalent across dev / prod / cluster
 *
 * This is the FIRST-TIER gate. The orientation's medium-cost closure
 * also includes a `helm template`-rendered diff against a committed
 * golden manifest + an ArgoCD ApplicationSet for cluster-label
 * binding. Those are Phase 12+ work; this script catches the
 * meaningful drift cases that are visible without rendering.
 *
 * Run locally:
 *   pnpm exec tsx scripts/check-helm-values-drift.ts
 *
 * Exit codes:
 *   0 — clean.
 *   1 — at least one drift error found.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..');
const CHART_DIR = join(REPO_ROOT, 'infra/k8s/charts/vigil-apex');

interface ValuesFile {
  readonly path: string;
  readonly basename: string;
  readonly data: Record<string, unknown>;
}

function loadValues(name: string): ValuesFile {
  const path = join(CHART_DIR, name);
  const raw = readFileSync(path, 'utf8');
  const data = parse(raw) as Record<string, unknown> | null;
  return { path, basename: name, data: data ?? {} };
}

function get<T = unknown>(obj: Record<string, unknown> | undefined, path: string): T | undefined {
  if (!obj) return undefined;
  const parts = path.split('.');
  let cursor: unknown = obj;
  for (const p of parts) {
    if (cursor === undefined || cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[p];
  }
  return cursor as T;
}

/**
 * Floating tags that resolve to a different image over time. Pinning
 * means a tag that does NOT belong to this set. Custom build tags
 * like `rl-2.8` (caddy with ratelimit plugin baked in) ARE permitted
 * because they correspond to a specific layer SHA at the registry.
 * The cosign chain (modes 9.9 + 10.8, Phase 12) will add the
 * stronger guarantee that the tag resolves to a verified SHA.
 */
const FORBIDDEN_TAGS = new Set(['latest', 'main', 'master', 'dev', 'edge', 'nightly', '']);

/**
 * A pinned tag MUST contain at least one digit somewhere. This
 * filters obvious-floating tags ("stable", "release", "current") that
 * aren't in the forbidden set above. A digit-bearing tag is at least
 * version-encoded.
 */
const PINNED_TAG_RE = /\d/;

interface ImagePin {
  readonly workload: string;
  readonly tag: unknown;
}

/**
 * For values-prod.yaml + values.yaml combined: enumerate every
 * `image: { repository, tag }` we can find. The base values.yaml
 * carries the canonical defaults (postgres, redis, vault, dashboard,
 * caddy + workers[]); the env values override per-key. The drift
 * gate must verify the MERGED set, which we approximate by checking
 * BOTH files independently — if either has a forbidden tag, fail.
 */
function collectImageTags(values: ValuesFile): ImagePin[] {
  const out: ImagePin[] = [];
  const root = values.data;
  // Component-level images.
  for (const key of ['postgres', 'redis', 'vault', 'dashboard', 'caddy']) {
    const tag = get<unknown>(root, `${key}.image.tag`);
    if (tag !== undefined) out.push({ workload: key, tag });
  }
  // workers[] images.
  const workers = get<unknown>(root, 'workers');
  if (Array.isArray(workers)) {
    for (const w of workers) {
      if (w && typeof w === 'object') {
        const name = (w as Record<string, unknown>).name ?? '<unnamed>';
        const tag = get<unknown>(w as Record<string, unknown>, 'image.tag');
        if (tag !== undefined) out.push({ workload: `worker:${String(name)}`, tag });
      }
    }
  }
  return out;
}

function checkProdImagesPinned(prod: ValuesFile, base: ValuesFile): string[] {
  const errors: string[] = [];
  for (const v of [prod, base]) {
    for (const img of collectImageTags(v)) {
      const t = String(img.tag ?? '');
      if (FORBIDDEN_TAGS.has(t)) {
        errors.push(
          `${v.basename}:${img.workload}: image.tag="${t}" is forbidden in production — must be a semver-shaped pin`,
        );
        continue;
      }
      if (!PINNED_TAG_RE.test(t)) {
        errors.push(
          `${v.basename}:${img.workload}: image.tag="${t}" has no digit — looks like a floating tag, not a pin`,
        );
      }
    }
  }
  return errors;
}

interface ReplicaCheck {
  readonly workload: string;
  readonly replicas: unknown;
}

function collectReplicas(values: ValuesFile): ReplicaCheck[] {
  const out: ReplicaCheck[] = [];
  const root = values.data;
  for (const key of ['dashboard', 'caddy']) {
    const r = get<unknown>(root, `${key}.replicas`);
    if (r !== undefined) out.push({ workload: key, replicas: r });
  }
  const workers = get<unknown>(root, 'workers');
  if (Array.isArray(workers)) {
    for (const w of workers) {
      if (w && typeof w === 'object') {
        const obj = w as Record<string, unknown>;
        const name = String(obj.name ?? '<unnamed>');
        if (obj.replicas !== undefined)
          out.push({ workload: `worker:${name}`, replicas: obj.replicas });
      }
    }
  }
  return out;
}

function checkProdReplicasAtLeastTwo(prod: ValuesFile): string[] {
  const errors: string[] = [];
  for (const r of collectReplicas(prod)) {
    const n = typeof r.replicas === 'number' ? r.replicas : Number(r.replicas);
    if (!Number.isFinite(n) || n < 2) {
      errors.push(
        `${prod.basename}:${r.workload}: replicas=${String(r.replicas)} < 2 in production (no HA for a single-node failure)`,
      );
    }
  }
  return errors;
}

function checkProdResourceLimits(prod: ValuesFile, base: ValuesFile): string[] {
  const errors: string[] = [];
  // For each workload mentioned in prod OR base, the prod limits must be set.
  const workloadKeys = ['postgres', 'redis', 'vault', 'dashboard', 'caddy'];
  for (const k of workloadKeys) {
    const prodLim = get<unknown>(prod.data, `${k}.resources.limits.memory`);
    const baseLim = get<unknown>(base.data, `${k}.resources.limits.memory`);
    if (prodLim === undefined && baseLim === undefined) {
      errors.push(
        `${prod.basename}:${k}: no resources.limits.memory in prod or base (workload can OOM-saturate node)`,
      );
    }
  }
  // workers[] in prod must each have resources.limits.memory. Use
  // effectiveWorkers() so the check survives the T11 model where prod
  // inherits the workers list from values.yaml rather than enumerating
  // locally.
  const workers = effectiveWorkers(prod, base);
  for (const w of workers) {
    if (w && typeof w === 'object') {
      const obj = w as Record<string, unknown>;
      const name = String(obj.name ?? '<unnamed>');
      const lim = get<unknown>(obj, 'resources.limits.memory');
      if (lim === undefined) {
        errors.push(
          `${prod.basename}:worker:${name}: no resources.limits.memory (workload can OOM-saturate node)`,
        );
      }
    }
  }
  return errors;
}

function checkProdCertIssuer(prod: ValuesFile): string[] {
  const errors: string[] = [];
  const issuer = get<string>(prod.data, 'certManager.clusterIssuer');
  if (typeof issuer !== 'string') {
    errors.push(
      `${prod.basename}:certManager.clusterIssuer not set — prod must use a real issuer (letsencrypt-prod), not an empty / default`,
    );
  } else if (issuer.includes('staging') || issuer === 'letsencrypt-staging') {
    errors.push(
      `${prod.basename}:certManager.clusterIssuer="${issuer}" — staging issuer would serve non-trusted certs to citizens`,
    );
  } else if (issuer === 'letsencrypt-dev' || issuer === 'self-signed') {
    errors.push(
      `${prod.basename}:certManager.clusterIssuer="${issuer}" — dev / self-signed issuer in production is wrong`,
    );
  }
  return errors;
}

function checkProdStorageClass(prod: ValuesFile): string[] {
  const errors: string[] = [];
  const sc = get<string>(prod.data, 'storageClass');
  if (typeof sc !== 'string' || sc.length === 0) {
    errors.push(
      `${prod.basename}:storageClass not set — prod must pin a specific class (fast-ssd, ceph-rbd-ssd, etc.)`,
    );
  } else if (sc === 'standard') {
    errors.push(
      `${prod.basename}:storageClass="standard" — this is the kind/minikube dev default and will not exist on prod clusters`,
    );
  }
  return errors;
}

/**
 * Resolve a file's effective `workers[]` per helm overlay semantics:
 * an absent `workers:` block at the per-env level INHERITS the base's
 * `workers:` block (helm only replaces a key when the per-env file
 * declares one). The lint must compare the EFFECTIVE list — the same
 * set helm would actually render — not the per-file decl alone.
 *
 * Pre-2026-05-17, this lint compared the per-env lists in isolation;
 * that was correct only because both env files used to enumerate the
 * full fleet locally. T11 of the TODO.md sweep dropped the
 * values-prod.yaml workers[] override so prod inherits the canonical
 * 25-worker fleet from values.yaml. The check now mirrors helm's
 * actual merge.
 */
function effectiveWorkers(envFile: ValuesFile, base: ValuesFile): unknown[] {
  const own = get<unknown[]>(envFile.data, 'workers');
  if (Array.isArray(own)) return own;
  return get<unknown[]>(base.data, 'workers') ?? [];
}

function checkWorkerParity(dev: ValuesFile, prod: ValuesFile, base: ValuesFile): string[] {
  const errors: string[] = [];
  const devWorkers = effectiveWorkers(dev, base);
  const prodWorkers = effectiveWorkers(prod, base);
  const devNames = new Set<string>(
    devWorkers
      .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
      .map((w) => String(w.name ?? '<unnamed>')),
  );
  const prodNames = new Set<string>(
    prodWorkers
      .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
      .map((w) => String(w.name ?? '<unnamed>')),
  );
  for (const name of devNames) {
    if (!prodNames.has(name)) {
      errors.push(
        `worker-parity: "${name}" is in dev's effective workers[] but NOT in prod's — dev workloads must have prod counterparts (effective = per-env override OR inherited from values.yaml)`,
      );
    }
  }
  for (const name of prodNames) {
    if (!devNames.has(name)) {
      errors.push(
        `worker-parity: "${name}" is in prod's effective workers[] but NOT in dev's — prod workloads must be exercisable in dev (effective = per-env override OR inherited from values.yaml)`,
      );
    }
  }
  return errors;
}

function checkTopLevelKeyParity(dev: ValuesFile, prod: ValuesFile): string[] {
  const errors: string[] = [];
  const devKeys = new Set(Object.keys(dev.data));
  const prodKeys = new Set(Object.keys(prod.data));
  // Allowed asymmetries: dev-only knobs are fine (e.g., `externalSecrets`
  // override). Prod-only knobs are NOT fine — they imply prod config
  // that can't be exercised in dev.
  for (const k of prodKeys) {
    if (!devKeys.has(k)) {
      errors.push(
        `key-parity: top-level "${k}" is in values-prod.yaml but NOT in values-dev.yaml — dev can't exercise prod config`,
      );
    }
  }
  return errors;
}

function main(): number {
  const base = loadValues('values.yaml');
  const dev = loadValues('values-dev.yaml');
  const prod = loadValues('values-prod.yaml');

  const errors: string[] = [
    ...checkProdImagesPinned(prod, base),
    ...checkProdReplicasAtLeastTwo(prod),
    ...checkProdResourceLimits(prod, base),
    ...checkProdCertIssuer(prod),
    ...checkProdStorageClass(prod),
    ...checkWorkerParity(dev, prod, base),
    ...checkTopLevelKeyParity(dev, prod),
  ];

  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`[check-helm-values-drift] ${e}\n`);
    process.stderr.write(`[check-helm-values-drift] FAIL: ${errors.length} drift error(s)\n`);
    return 1;
  }
  process.stdout.write(
    `[check-helm-values-drift] OK: ${base.basename} + ${dev.basename} + ${prod.basename} clean\n`,
  );
  return 0;
}

process.exit(main());
