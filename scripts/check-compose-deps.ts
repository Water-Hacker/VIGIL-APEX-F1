#!/usr/bin/env tsx
/**
 * Mode 1.3 — Inter-service deadlock from circular dependencies.
 *
 * Parses `infra/docker/docker-compose.yaml` and asserts that the
 * dependency DAG implied by `depends_on:` is acyclic and contains
 * no self-loops. Compose tolerates self-loops at runtime (it ignores
 * them), and it ignores cycles too in some cases — but both indicate
 * a hand-maintained dependency graph that's drifted from the
 * architect's intent.
 *
 * The gate fails with parseable output ("file:line message") if any
 * cycle or self-loop is found.
 *
 * Run locally:
 *   tsx scripts/check-compose-deps.ts
 *
 * CI invocation: `.github/workflows/ci.yml` job `compose-deps`.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..');
// COMPOSE_PATH is overridable so the test suite can point at synthetic
// fixtures. Default targets the real production compose file.
const COMPOSE_PATH = process.env.COMPOSE_PATH
  ? resolve(process.env.COMPOSE_PATH)
  : join(REPO_ROOT, 'infra/docker/docker-compose.yaml');

interface ParsedService {
  name: string;
  startLine: number;
  dependsOn: string[];
}

/**
 * Regex-only parser for our specific docker-compose layout. The full
 * docker-compose schema is more complex, but we only need:
 *   - service block headers (2-space indent, `name:`)
 *   - depends_on: blocks (4-space indent, then service names at 6 spaces)
 *
 * The parser tolerates both shapes:
 *   depends_on:
 *     foo: { condition: service_healthy }
 *
 *   depends_on:
 *     - foo
 *     - bar
 */
function parseCompose(contents: string): ParsedService[] {
  const lines = contents.split('\n');
  const services: ParsedService[] = [];
  let inServices = false;
  let current: ParsedService | null = null;
  let inDependsOn = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;

    // services: section header
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;

    // A top-level (zero-indent) key ends the services section.
    if (/^[a-zA-Z]/.test(line)) {
      if (current) services.push(current);
      current = null;
      inServices = false;
      continue;
    }

    // Service block header — 2 spaces of indent, then a name and a colon.
    const serviceMatch = line.match(/^ {2}([a-zA-Z0-9_-]+):\s*$/);
    if (serviceMatch) {
      if (current) services.push(current);
      current = { name: serviceMatch[1]!, startLine: lineNo, dependsOn: [] };
      inDependsOn = false;
      continue;
    }

    if (!current) continue;

    // depends_on: header
    if (/^ {4}depends_on:\s*$/.test(line)) {
      inDependsOn = true;
      continue;
    }

    if (inDependsOn) {
      // Object form: 6 spaces of indent + name: { ... }
      const objForm = line.match(/^ {6}([a-zA-Z0-9_-]+):/);
      if (objForm) {
        current.dependsOn.push(objForm[1]!);
        continue;
      }
      // Array form: 6 spaces + dash + name
      const arrForm = line.match(/^ {6}-\s+([a-zA-Z0-9_-]+)/);
      if (arrForm) {
        current.dependsOn.push(arrForm[1]!);
        continue;
      }
      // Any other line at indent <= 4 ends the depends_on block.
      if (line.length > 0 && !/^ {6}/.test(line) && !/^\s*#/.test(line) && line.trim() !== '') {
        inDependsOn = false;
      }
    }
  }
  if (current) services.push(current);
  return services;
}

function findSelfLoops(services: ParsedService[]): Array<{ name: string; line: number }> {
  const out: Array<{ name: string; line: number }> = [];
  for (const s of services) {
    if (s.dependsOn.includes(s.name)) {
      out.push({ name: s.name, line: s.startLine });
    }
  }
  return out;
}

function findCycles(services: ParsedService[]): string[][] {
  // Tarjan-ish DFS — return any cycle found (not all SCCs).
  const byName = new Map(services.map((s) => [s.name, s]));
  const colour = new Map<string, 'white' | 'grey' | 'black'>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  function dfs(node: string): void {
    const c = colour.get(node) ?? 'white';
    if (c === 'black') return;
    if (c === 'grey') {
      // Back-edge — extract the cycle from the stack.
      const start = stack.indexOf(node);
      if (start >= 0) cycles.push([...stack.slice(start), node]);
      return;
    }
    colour.set(node, 'grey');
    stack.push(node);
    const svc = byName.get(node);
    if (svc) {
      for (const dep of svc.dependsOn) {
        if (dep === node) continue; // self-loop reported separately
        if (byName.has(dep)) dfs(dep);
      }
    }
    stack.pop();
    colour.set(node, 'black');
  }

  for (const s of services) {
    if (!colour.has(s.name)) dfs(s.name);
  }
  return cycles;
}

async function main(): Promise<number> {
  const contents = await readFile(COMPOSE_PATH, 'utf8');
  const services = parseCompose(contents);

  if (services.length === 0) {
    console.error(`[compose-deps] FATAL: no services parsed from ${COMPOSE_PATH}`);
    return 2;
  }

  let failed = false;

  const selfLoops = findSelfLoops(services);
  for (const sl of selfLoops) {
    console.error(
      `${COMPOSE_PATH}:${sl.line} ERROR: service '${sl.name}' lists itself in depends_on (self-loop).`,
    );
    failed = true;
  }

  const cycles = findCycles(services);
  for (const cycle of cycles) {
    console.error(`${COMPOSE_PATH} ERROR: depends_on cycle detected: ${cycle.join(' -> ')}`);
    failed = true;
  }

  if (failed) {
    console.error(
      `[compose-deps] FAIL — ${selfLoops.length} self-loop(s) + ${cycles.length} cycle(s). docker-compose tolerates these at runtime but they indicate dependency-graph drift.`,
    );
    return 1;
  }

  console.log(
    `[compose-deps] OK — ${services.length} services parsed, dependency DAG is acyclic, no self-loops.`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[compose-deps] crashed:', err);
    process.exit(2);
  });
