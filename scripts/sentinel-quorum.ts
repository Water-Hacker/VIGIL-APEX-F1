#!/usr/bin/env -S npx tsx
//
// scripts/sentinel-quorum.ts — 2-of-3 outage-attestation quorum.
//
// Per TRUTH §B: 3 sentinel VPS (Helsinki, Tokyo, NYC) probe the Yaoundé
// dashboard + Hetzner ingestion VPS independently. If two of three report
// "down" within the same 5-minute window, the on-host coordinator
// declares an outage and emits a `system.health_degraded` audit-of-audit
// row.
//
// This script is the CLI / cron entry point. The pure quorum logic is
// exported so it can be unit-tested in isolation.

import { quorumDecide, type SentinelReport, type SentinelOutcome } from '@vigil/observability';
import { request } from 'undici';

export { quorumDecide };
export type { SentinelReport, SentinelOutcome };

interface SentinelEndpoint {
  readonly site: 'helsinki' | 'tokyo' | 'nyc';
  readonly url: string;
}

async function probeSentinel(endpoint: SentinelEndpoint, target: string): Promise<SentinelReport> {
  const url = `${endpoint.url.replace(/\/+$/, '')}/probe?target=${encodeURIComponent(target)}`;
  try {
    const res = await request(url, { method: 'GET', headersTimeout: 10_000 });
    if (res.statusCode !== 200) {
      return {
        site: endpoint.site,
        target,
        outcome: 'unknown',
        observed_at: new Date().toISOString(),
      };
    }
    const body = (await res.body.json()) as { outcome: SentinelOutcome };
    return {
      site: endpoint.site,
      target,
      outcome: body.outcome,
      observed_at: new Date().toISOString(),
    };
  } catch {
    return {
      site: endpoint.site,
      target,
      outcome: 'unknown',
      observed_at: new Date().toISOString(),
    };
  }
}

async function emitOutageAuditRow(
  decision: ReturnType<typeof quorumDecide>,
  target: string,
): Promise<void> {
  const sock = process.env.AUDIT_BRIDGE_SOCKET ?? '/run/vigil/audit-bridge.sock';
  const payload = {
    action: 'system.health_degraded',
    actor: 'system:sentinel-quorum',
    subject_kind: 'system',
    subject_id: target,
    payload: {
      decision: decision.decision,
      up: decision.up,
      down: decision.down,
      unknown: decision.unknown,
      attesting_sites: decision.attesting_sites,
    },
  };
  // UDS request via undici
  try {
    const res = await request(`http://localhost/append`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      bodyTimeout: 5_000,
      // @ts-expect-error — undici undocumented unix socket override
      socketPath: sock,
    });
    if (res.statusCode >= 400) {
      console.error(`audit-bridge POST returned ${res.statusCode}`);
    }
  } catch (e) {
    console.error('audit-bridge unreachable:', e);
  }
}

async function main(): Promise<void> {
  const target = process.argv[2] ?? 'dashboard';
  const endpoints: SentinelEndpoint[] = [];
  for (const site of ['helsinki', 'tokyo', 'nyc'] as const) {
    const url = process.env[`SENTINEL_${site.toUpperCase()}_URL`];
    if (url && !url.startsWith('PLACEHOLDER')) {
      endpoints.push({ site, url });
    }
  }
  if (endpoints.length < 3) {
    console.log(`only ${endpoints.length}/3 sentinel endpoints configured — quorum not attainable`);
    process.exit(2);
  }

  const reports = await Promise.all(endpoints.map((e) => probeSentinel(e, target)));
  const decision = quorumDecide(reports);
  console.log(JSON.stringify({ target, ...decision }, null, 2));

  if (decision.decision === 'down') {
    await emitOutageAuditRow(decision, target);
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error('sentinel-quorum failed:', e);
    process.exit(3);
  });
}
