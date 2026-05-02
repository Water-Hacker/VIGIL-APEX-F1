#!/usr/bin/env -S npx tsx
/**
 * scripts/check-source-credentials.ts — pre-boot credential precheck.
 *
 * Reads the operator's `.env` (or env vars currently exported) and
 * reports, per-source, whether the credential surface is ready for
 * `docker compose up`. Three states per row:
 *
 *   READY        — adapter will run and emit events
 *   FALLBACK     — adapter runs in degraded mode (no auth, fewer events)
 *   DISABLED     — adapter refuses to run (returns 0 events; correct
 *                  pre-MOU posture for mou-gated sources)
 *   BLOCKING     — a platform-wide guard will refuse to boot
 *
 * Plus a platform-secrets section that flags the keys whose absence
 * blocks the whole stack.
 *
 * The script does NOT call any source — it only inspects env presence
 * and PLACEHOLDER patterns. It is safe to run on a host with no
 * network access. Operator interpretation: BLOCKING rows fail boot;
 * DISABLED rows are intentional pre-MOU; FALLBACK rows are degraded
 * but functional.
 *
 * Run:
 *   pnpm tsx scripts/check-source-credentials.ts          # verbose
 *   pnpm tsx scripts/check-source-credentials.ts --quiet  # summary only
 *   pnpm tsx scripts/check-source-credentials.ts --env <path>  # alternate .env
 *
 * Exit codes:
 *   0 — no BLOCKING rows
 *   1 — at least one BLOCKING row
 */

/// <reference types="node" />

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();

type Status = 'READY' | 'FALLBACK' | 'DISABLED' | 'BLOCKING';

interface Row {
  readonly category: 'platform' | 'source';
  readonly id: string;
  readonly tier?: string;
  readonly status: Status;
  readonly message: string;
}

/** Parse a `.env`-style file into a Map. Does not honour shell
 *  expansion or quoted multi-line values; the build's lint-staged
 *  prettier already keeps `.env.example` simple, and this is a
 *  pre-boot smoke, not a production loader. */
function loadEnvFile(path: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/^\s*export\s+/, '').trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

/** A value is "set" iff it is non-empty AND does not start with the
 *  PLACEHOLDER sentinel (matches the pattern AUDIT-094 / T1.04
 *  established for the NICFI gate). */
function isSet(env: Map<string, string>, key: string): boolean {
  const v = env.get(key) ?? process.env[key] ?? '';
  if (v === '') return false;
  if (v.startsWith('PLACEHOLDER')) return false;
  return true;
}

// `_FILE` companion checks are handled inline by listing both the
// bare key and the `${base}_FILE` form in each PlatformCheck.keys
// array; no helper needed. The operator's docker-compose secret-mount
// pattern stores the file path; we accept either the inline value or
// the `_FILE` reference as evidence the operator has wired it.

function main(): void {
  const argv = process.argv.slice(2);
  const quiet = argv.includes('--quiet');
  const envPathIdx = argv.indexOf('--env');
  const envPath = envPathIdx >= 0 ? argv[envPathIdx + 1]! : '.env';
  const env = loadEnvFile(resolve(REPO_ROOT, envPath));

  const rows: Row[] = [];

  // ────────────────────────────────────────────────────────────────
  // Platform secrets
  // ────────────────────────────────────────────────────────────────
  type PlatformCheck = {
    id: string;
    keys: string[];
    onMissingStatus: Status;
    onMissingMessage: string;
    onSetMessage?: string;
  };
  const platform: PlatformCheck[] = [
    {
      id: 'POSTGRES_PASSWORD',
      keys: ['POSTGRES_PASSWORD', 'POSTGRES_PASSWORD_FILE'],
      onMissingStatus: 'BLOCKING',
      onMissingMessage:
        'every package opens a Pool to Postgres; without it the stack fails to boot',
    },
    {
      id: 'REDIS_PASSWORD',
      keys: ['REDIS_PASSWORD', 'REDIS_PASSWORD_FILE'],
      onMissingStatus: 'BLOCKING',
      onMissingMessage: 'every queue worker connects to Redis',
    },
    {
      id: 'VAULT_TOKEN',
      keys: ['VAULT_TOKEN', 'VAULT_TOKEN_FILE'],
      onMissingStatus: 'BLOCKING',
      onMissingMessage: 'workers reading from Vault refuse to start without an AppRole token',
    },
    {
      id: 'GPG_FINGERPRINT',
      keys: ['GPG_FINGERPRINT'],
      onMissingStatus: 'BLOCKING',
      onMissingMessage:
        'worker-dossier signs every dossier; refuses unsigned in production (DECISION-008 Tier-1)',
    },
    {
      id: 'KEYCLOAK_ADMIN_PASSWORD',
      keys: ['KEYCLOAK_ADMIN_PASSWORD', 'KEYCLOAK_ADMIN_PASSWORD_FILE'],
      onMissingStatus: 'BLOCKING',
      onMissingMessage: 'dashboard auth refuses to boot without Keycloak admin',
    },
    {
      id: 'WEBAUTHN_RP_ID',
      keys: ['WEBAUTHN_RP_ID'],
      onMissingStatus: 'BLOCKING',
      onMissingMessage: 'council vote endpoints reject every assertion without an RP_ID',
    },
    {
      id: 'WEBAUTHN_RP_ORIGIN',
      keys: ['WEBAUTHN_RP_ORIGIN'],
      onMissingStatus: 'BLOCKING',
      onMissingMessage: 'council vote endpoints need the public origin',
    },
    {
      id: 'ANTHROPIC_API_KEY',
      keys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_FILE'],
      onMissingStatus: 'FALLBACK',
      onMissingMessage:
        'worker-extractor LLM extraction disabled; deterministic-only mode (partial coverage)',
    },
    {
      id: 'AUDIT_PUBLIC_EXPORT_SALT',
      keys: ['AUDIT_PUBLIC_EXPORT_SALT'],
      onMissingStatus: 'FALLBACK',
      onMissingMessage:
        'quarterly TAL-PA export refuses to run; rest of platform unaffected (DECISION-012)',
    },
    {
      id: 'POLYGON_ANCHOR_CONTRACT',
      keys: ['POLYGON_ANCHOR_CONTRACT'],
      onMissingStatus: 'FALLBACK',
      onMissingMessage: 'worker-anchor refuses to commit; everything else runs (Phase-7 contract)',
    },
    {
      id: 'TIP_OPERATOR_TEAM_PUBKEY',
      keys: ['TIP_OPERATOR_TEAM_PUBKEY'],
      onMissingStatus: 'FALLBACK',
      onMissingMessage:
        '/tip endpoint returns 503; rest of platform runs (set after 3-of-5 council enrolment)',
    },
  ];

  for (const c of platform) {
    const haveAny = c.keys.some((k) => isSet(env, k));
    if (haveAny) {
      rows.push({
        category: 'platform',
        id: c.id,
        status: 'READY',
        message: c.onSetMessage ?? 'set',
      });
    } else {
      rows.push({
        category: 'platform',
        id: c.id,
        status: c.onMissingStatus,
        message: c.onMissingMessage,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Per-source checks (sources.json driven)
  // ────────────────────────────────────────────────────────────────
  const sourcesPath = resolve(REPO_ROOT, 'infra/sources.json');
  if (!existsSync(sourcesPath)) {
    process.stderr.write(`[check-source-credentials] FAIL: ${sourcesPath} missing\n`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(sourcesPath, 'utf8')) as {
    sources: Array<{ id: string; jurisdiction: string; contact?: { tier?: string } }>;
  };

  // For most sources the adapter does not gate on env; tier classifies
  // operator obligations. We surface the tier status without fabricating
  // env requirements that don't exist.
  const MOU_GATED: Record<string, { ackEnv: string; enableEnv: string; cred: string }> = {
    'minfi-bis': {
      ackEnv: 'MINFI_BIS_MOU_ACK',
      enableEnv: 'MINFI_BIS_ENABLED',
      cred: 'MINFI_BIS_CERT_FILE / _KEY_FILE / _CA_FILE',
    },
    'beac-payments': {
      ackEnv: 'BEAC_MOU_ACK',
      enableEnv: 'BEAC_ENABLED',
      cred: 'BEAC_CLIENT_ID + BEAC_CLIENT_SECRET_FILE',
    },
    'anif-amlscreen': {
      ackEnv: 'ANIF_AML_MOU_ACK',
      enableEnv: 'ANIF_AML_ENABLED',
      cred: 'ANIF_API_KEY_FILE',
    },
  };

  // Optional API keys per source — absence triggers FALLBACK (anonymous
  // tier) for these; READY when set.
  const OPTIONAL_KEY: Record<string, string> = {
    'occrp-aleph': 'ALEPH_API_KEY',
    opencorporates: 'OPENCORPORATES_API_KEY',
  };

  for (const s of data.sources) {
    const tier = s.contact?.tier ?? 'unknown';
    if (MOU_GATED[s.id]) {
      const g = MOU_GATED[s.id]!;
      const ack = isSet(env, g.ackEnv);
      const en = isSet(env, g.enableEnv);
      const credSet = isSet(env, g.cred.split(' ')[0] ?? g.cred);
      if (ack && en && credSet) {
        rows.push({
          category: 'source',
          id: s.id,
          tier,
          status: 'READY',
          message: `MOU acknowledged + credentials present`,
        });
      } else {
        rows.push({
          category: 'source',
          id: s.id,
          tier,
          status: 'DISABLED',
          message: `pre-MOU no-op (set ${g.ackEnv}=1 + ${g.enableEnv}=1 + ${g.cred} after MOU countersign)`,
        });
      }
      continue;
    }
    if (OPTIONAL_KEY[s.id]) {
      const k = OPTIONAL_KEY[s.id]!;
      if (isSet(env, k)) {
        rows.push({
          category: 'source',
          id: s.id,
          tier,
          status: 'READY',
          message: `${k} set`,
        });
      } else {
        rows.push({
          category: 'source',
          id: s.id,
          tier,
          status: 'FALLBACK',
          message: `anonymous tier (no ${k}); fine for Phase-1`,
        });
      }
      continue;
    }
    // Default: open-data source; READY without auth.
    rows.push({
      category: 'source',
      id: s.id,
      tier,
      status: 'READY',
      message: `${tier} — no credential gate`,
    });
  }

  // ────────────────────────────────────────────────────────────────
  // Reporting
  // ────────────────────────────────────────────────────────────────
  const blocking = rows.filter((r) => r.status === 'BLOCKING');
  const fallback = rows.filter((r) => r.status === 'FALLBACK');
  const disabled = rows.filter((r) => r.status === 'DISABLED');
  const ready = rows.filter((r) => r.status === 'READY');

  if (!quiet) {
    process.stdout.write('\n=== Platform secrets ===\n');
    for (const r of rows.filter((x) => x.category === 'platform')) {
      process.stdout.write(`  [${r.status.padEnd(8)}] ${r.id.padEnd(28)} — ${r.message}\n`);
    }
    process.stdout.write('\n=== Sources ===\n');
    for (const r of rows.filter((x) => x.category === 'source')) {
      process.stdout.write(
        `  [${r.status.padEnd(8)}] ${r.id.padEnd(22)} (${(r.tier ?? '?').padEnd(22)}) — ${r.message}\n`,
      );
    }
    process.stdout.write('\n');
  }

  process.stdout.write(
    `[check-source-credentials] summary: READY=${ready.length} FALLBACK=${fallback.length} DISABLED=${disabled.length} BLOCKING=${blocking.length}\n`,
  );

  if (blocking.length > 0) {
    process.stderr.write(`\n${blocking.length} BLOCKING row(s) — stack will not boot:\n`);
    for (const r of blocking) {
      process.stderr.write(`  - ${r.id}: ${r.message}\n`);
    }
    process.stderr.write(
      '\nFix the BLOCKING rows in `.env` (or via Vault), then re-run this script.\n',
    );
    process.exit(1);
  }

  if (disabled.length === 3) {
    process.stdout.write(
      '\nAll 3 MOU-gated sources are DISABLED — that is the correct pre-MOU posture for Phase 1.\n',
    );
  }
  process.stdout.write(
    'Stack is ready to boot. FALLBACK and DISABLED rows are intentional / phase-deferred.\n',
  );
}

main();
