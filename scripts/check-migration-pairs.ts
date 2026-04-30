#!/usr/bin/env tsx
/**
 * scripts/check-migration-pairs.ts — AUDIT-051 fix.
 *
 * Refuses CI merge of a new Drizzle migration that does not ship a
 * paired *_down.sql.
 *
 * Naming convention enforced:
 *   packages/db-postgres/drizzle/NNNN_<slug>.sql        (forward)
 *   packages/db-postgres/drizzle/NNNN_<slug>_down.sql   (inverse)
 *
 * The bootstrap (`000_bootstrap.sql`) and a closed allowlist of legacy
 * forward-only migrations (0001..0006, 0008) are exempt — those pre-date
 * the round-trip discipline. Every NNNN >= 0009 must pair.
 *
 * Run: `pnpm tsx scripts/check-migration-pairs.ts`
 */

/// <reference types="node" />

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();
const DIR = join(REPO_ROOT, 'packages/db-postgres/drizzle');

const LEGACY_FORWARD_ONLY = new Set([
  '0001_init',
  '0002_perf_indexes',
  '0003_audit_pipeline',
  '0004_fabric_witness',
  '0005_adapter_repair',
  '0006_webauthn_challenge',
  '0008_satellite_request_tracking',
]);

interface MigrationPair {
  readonly stem: string;
  readonly forward: string;
  readonly down: string | null;
}

function listMigrations(): MigrationPair[] {
  const all = readdirSync(DIR).filter((f) => /^\d{3,4}.*\.sql$/.test(f));
  const forwards = all.filter((f) => !/_down\.sql$/.test(f));
  const downs = new Set(all.filter((f) => /_down\.sql$/.test(f)));
  const pairs: MigrationPair[] = [];
  for (const f of forwards.sort()) {
    const stem = f.replace(/\.sql$/, '');
    const expectedDown = `${stem}_down.sql`;
    pairs.push({
      stem,
      forward: f,
      down: downs.has(expectedDown) ? expectedDown : null,
    });
  }
  return pairs;
}

function main(): void {
  const pairs = listMigrations();
  const errors: string[] = [];
  let pairedCount = 0;
  let legacyCount = 0;

  for (const p of pairs) {
    if (p.stem === '000_bootstrap') {
      legacyCount++;
      continue;
    }
    if (p.down === null) {
      if (LEGACY_FORWARD_ONLY.has(p.stem)) {
        legacyCount++;
        continue;
      }
      errors.push(
        `${p.forward} has no paired ${p.stem}_down.sql — every new migration must ship its inverse (AUDIT-051)`,
      );
    } else {
      pairedCount++;
    }
  }

  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`[check-migration-pairs] ${e}\n`);
    process.stderr.write(`[check-migration-pairs] FAIL: ${errors.length} unpaired migration(s)\n`);
    process.exit(1);
  }
  process.stdout.write(
    `[check-migration-pairs] OK: ${pairedCount} paired migrations, ${legacyCount} legacy forward-only (allow-listed)\n`,
  );
}

main();
