#!/usr/bin/env -S npx tsx
//
// scripts/sentinel-quorum.ts — 2-of-3 outage-attestation quorum CLI.
//
// Per TRUTH §B: 3 sentinel VPS (Helsinki, Tokyo, NYC) probe the Yaoundé
// dashboard + Hetzner ingestion VPS independently. If two of three report
// "down" within the same 5-minute window, the on-host coordinator
// declares an outage and emits a `sentinel.quorum_outage` audit-of-audit
// row.
//
// All logic lives in `@vigil/observability`. This file is the systemd
// timer entry point (see infra/host-bootstrap/systemd/vigil-sentinel-
// quorum.{service,timer}). The integration test
// (packages/observability/__tests__/sentinel-quorum-integration.test.ts)
// drives `runSentinelQuorum` directly against localhost mocks.

import {
  runSentinelQuorum,
  type SentinelEndpoint,
  type SentinelReport,
  type SentinelOutcome,
  quorumDecide,
} from '@vigil/observability';

export { runSentinelQuorum, quorumDecide };
export type { SentinelEndpoint, SentinelReport, SentinelOutcome };

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

  const result = await runSentinelQuorum({ endpoints, target });
  console.log(JSON.stringify({ target: result.target, ...result.decision }, null, 2));
  if (result.decision.decision === 'down') {
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
