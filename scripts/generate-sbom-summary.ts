#!/usr/bin/env -S npx tsx
//
// scripts/generate-sbom-summary.ts — workspace-only dependency summary.
//
// Walks every package.json under packages/ and apps/, collapses dependencies
// into a deduplicated list with the resolving versions, and emits a JSON
// document suitable for the architect's release notes. Complementary to
// the full Syft-generated CycloneDX / SPDX SBOMs.
//
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

interface Workspace {
  name: string;
  manifest: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

function walkDirs(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    const pj = path.join(full, 'package.json');
    try {
      statSync(pj);
      out.push(full);
    } catch {
      // not a package
    }
  }
  return out;
}

function loadWorkspace(dir: string): Workspace {
  const pj = path.join(dir, 'package.json');
  const data = JSON.parse(readFileSync(pj, 'utf8')) as {
    name: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return {
    name: data.name,
    manifest: path.relative(ROOT, pj),
    dependencies: data.dependencies ?? {},
    devDependencies: data.devDependencies ?? {},
  };
}

function main(): void {
  const workspaceDirs = [
    ...walkDirs(path.join(ROOT, 'packages')),
    ...walkDirs(path.join(ROOT, 'apps')),
  ];
  const workspaces = workspaceDirs.map(loadWorkspace);

  const externalDeps = new Map<string, Set<string>>();
  for (const w of workspaces) {
    for (const [k, v] of Object.entries({ ...w.dependencies, ...w.devDependencies })) {
      if (k.startsWith('@vigil/')) continue;
      const set = externalDeps.get(k) ?? new Set<string>();
      set.add(v);
      externalDeps.set(k, set);
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    workspace_count: workspaces.length,
    external_dep_count: externalDeps.size,
    workspaces: workspaces.map((w) => ({
      name: w.name,
      manifest: w.manifest,
      dep_count: Object.keys(w.dependencies).length,
      dev_count: Object.keys(w.devDependencies).length,
    })),
    external_deps: Array.from(externalDeps.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ name: k, versions: [...v].sort() })),
  };

  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

main();
