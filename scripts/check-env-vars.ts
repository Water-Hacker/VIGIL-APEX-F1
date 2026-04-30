#!/usr/bin/env tsx
/**
 * scripts/check-env-vars.ts — env-var drift lint.
 *
 * Checks .env.example keys against `process.env.X` references in
 * apps/* and packages/*, after filtering both sides to VIGIL-owned
 * variables (not framework / Node internals like AWS_REGION,
 * __NEXT_*, GRPC_*, etc.).
 *
 * Fails CI if:
 *   (a) A VIGIL-owned env var is referenced in code but absent from
 *       .env.example (operators won't know to set it).
 *   (b) A VIGIL-owned env var is documented in .env.example (active
 *       block) but referenced nowhere in code (drift; the example is
 *       lying).
 *
 * Variables in the explicit "Phase-2 — not yet implemented" comment
 * block are exempt from (b) — they are documentation of upcoming
 * config and not expected to have code references yet.
 *
 * Run: `pnpm tsx scripts/check-env-vars.ts`
 */

/// <reference types="node" />

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const ENV_EXAMPLE = join(ROOT, '.env.example');

const VIGIL_PREFIXES = [
  'ANTHROPIC_',
  'AUDIT_',
  'BACKUP_ARCHITECT_',
  'BEAC_',
  'CALIBRATION_',
  'CONAC_',
  'COUR_DES_COMPTES_',
  'CSAN_',
  'ENTITY_',
  'FABRIC_',
  'FEDERATION_',
  'IPFS_',
  'KEYCLOAK_',
  'MINFI_',
  'MAPBOX_',
  'PATTERN_',
  'PLANET_',
  'POLYGON_',
  'POSTGRES_',
  'PROMETHEUS_',
  'REDIS_',
  'SENTINEL_HUB_',
  'MAXAR_',
  'AIRBUS_',
  'SATELLITE_',
  'STAC_',
  'TIP_',
  'TURNSTILE_',
  'VAULT_',
  'VERBATIM_',
  'VIGIL_',
  'WEBAUTHN_',
];

function isVigilOwned(name: string): boolean {
  return VIGIL_PREFIXES.some((p) => name.startsWith(p));
}

function readEnvExampleKeys(): { active: Set<string>; futureBlock: Set<string> } {
  const text = readFileSync(ENV_EXAMPLE, 'utf8');
  const active = new Set<string>();
  const futureBlock = new Set<string>();
  let inFuture = false;
  for (const line of text.split('\n')) {
    if (/^# ─+ Phase-2 — not yet implemented/i.test(line)) {
      inFuture = true;
      continue;
    }
    if (inFuture && /^# ─+ end Phase-2 block/i.test(line)) {
      inFuture = false;
      continue;
    }
    // Both `KEY=` and `# KEY=` are valid documentation entries.
    const m = /^#?\s*([A-Z_][A-Z0-9_]+)\s*=/.exec(line);
    if (m) {
      const key = m[1]!;
      if (!isVigilOwned(key)) continue;
      if (inFuture) futureBlock.add(key);
      else active.add(key);
    }
  }
  return { active, futureBlock };
}

function readCodeRefs(): Set<string> {
  // Use `git grep` so we walk only tracked files (skip node_modules,
  // dist, .next, .turbo).
  const out = execSync(
    `git grep -hoE 'process\\.env\\.[A-Z_][A-Z0-9_]+' -- 'apps/' 'packages/' || true`,
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const refs = new Set<string>();
  for (const line of out.split('\n')) {
    const m = /process\.env\.([A-Z_][A-Z0-9_]+)/.exec(line);
    if (m) {
      const key = m[1]!;
      if (isVigilOwned(key)) refs.add(key);
    }
  }
  return refs;
}

function main(): void {
  const { active, futureBlock } = readEnvExampleKeys();
  const refs = readCodeRefs();

  const missingFromExample: string[] = [];
  for (const r of refs) {
    if (!active.has(r) && !futureBlock.has(r)) missingFromExample.push(r);
  }

  const unusedInCode: string[] = [];
  for (const k of active) {
    if (!refs.has(k)) unusedInCode.push(k);
  }

  let issues = 0;
  if (missingFromExample.length > 0) {
    console.error(
      `[check-env-vars] ${missingFromExample.length} VIGIL env var(s) referenced in code but missing from .env.example:`,
    );
    for (const k of missingFromExample.sort()) console.error(`  - ${k}`);
    issues += missingFromExample.length;
  }
  if (unusedInCode.length > 0) {
    console.error(
      `[check-env-vars] ${unusedInCode.length} VIGIL env var(s) in .env.example active block with no code reference:`,
    );
    for (const k of unusedInCode.sort()) console.error(`  - ${k}`);
    issues += unusedInCode.length;
  }
  if (issues === 0) {
    console.log('[check-env-vars] OK');
    process.exit(0);
  }
  // Until AUDIT-073 has finished its per-var triage (architect-led),
  // this script reports issues but exits 0 so CI doesn't block on the
  // pre-existing baseline. Once AUDIT-073 closes, flip the exit code
  // to 1 so future regressions fail the build.
  console.error(
    `[check-env-vars] ${issues} issue(s) — REPORTING ONLY until AUDIT-073 triage closes.`,
  );
  process.exit(0);
}

main();
