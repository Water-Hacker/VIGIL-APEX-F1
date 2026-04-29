#!/usr/bin/env -S npx tsx
//
// scripts/sentinel-tor-check.ts — periodic Tor .onion health probe.
//
// Runs hourly from the Hetzner sentinel monitors (TRUTH §B; W-09). For each
// of the platform's hidden services, checks reachability via SOCKS5h to the
// local Tor daemon. Reports the result to the Prometheus pushgateway so
// dashboard panels and alertmanager can react.
//
// Usage (cron @hourly):
//   TOR_SOCKS_HOST=127.0.0.1 TOR_SOCKS_PORT=9050 \
//   TIP_ONION_HOSTNAME=<addr>.onion \
//   PROM_PUSHGATEWAY_URL=http://prom-pushgateway:9091 \
//   pnpm tsx scripts/sentinel-tor-check.ts
//
// Exits 0 if every onion is reachable, 1 if any is down.
//
import { ProxyAgent, request } from 'undici';

interface OnionTarget {
  readonly name: string; // metric label, e.g. "tip"
  readonly hostname: string; // <addr>.onion (no path)
  readonly path: string; // typically "/health" or "/"
  readonly expectedStatus?: number; // default 200
}

function readTargets(): OnionTarget[] {
  const targets: OnionTarget[] = [];
  if (process.env.TIP_ONION_HOSTNAME && !process.env.TIP_ONION_HOSTNAME.startsWith('PLACEHOLDER')) {
    targets.push({
      name: 'tip',
      hostname: process.env.TIP_ONION_HOSTNAME,
      path: '/api/health',
    });
  }
  if (
    process.env.VERIFY_ONION_HOSTNAME &&
    !process.env.VERIFY_ONION_HOSTNAME.startsWith('PLACEHOLDER')
  ) {
    targets.push({
      name: 'verify',
      hostname: process.env.VERIFY_ONION_HOSTNAME,
      path: '/',
    });
  }
  return targets;
}

async function checkOnion(
  target: OnionTarget,
): Promise<{ ok: boolean; latency_ms: number; status: number | null; error?: string }> {
  const socksHost = process.env.TOR_SOCKS_HOST ?? '127.0.0.1';
  const socksPort = Number(process.env.TOR_SOCKS_PORT ?? 9050);
  const url = `http://${target.hostname}${target.path}`;

  const proxy = new ProxyAgent(`socks5h://${socksHost}:${socksPort}`);
  const start = Date.now();
  try {
    const res = await request(url, {
      dispatcher: proxy,
      method: 'GET',
      headersTimeout: 30_000,
      bodyTimeout: 30_000,
    });
    await res.body.dump();
    const latency_ms = Date.now() - start;
    const status = res.statusCode;
    const expected = target.expectedStatus ?? 200;
    return { ok: status === expected, latency_ms, status };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - start, status: null, error: String(e) };
  }
}

async function pushMetrics(
  results: Array<{ target: OnionTarget; ok: boolean; latency_ms: number }>,
): Promise<void> {
  const pgw = process.env.PROM_PUSHGATEWAY_URL;
  if (!pgw) {
    console.log('PROM_PUSHGATEWAY_URL unset — skipping push');
    return;
  }
  const job = 'sentinel-tor';
  const lines: string[] = [];
  lines.push('# HELP vigil_tor_onion_up onion reachable from sentinel');
  lines.push('# TYPE vigil_tor_onion_up gauge');
  for (const r of results) {
    lines.push(`vigil_tor_onion_up{target="${r.target.name}"} ${r.ok ? 1 : 0}`);
  }
  lines.push('# HELP vigil_tor_onion_latency_seconds round-trip latency to onion');
  lines.push('# TYPE vigil_tor_onion_latency_seconds gauge');
  for (const r of results) {
    lines.push(
      `vigil_tor_onion_latency_seconds{target="${r.target.name}"} ${(r.latency_ms / 1000).toFixed(3)}`,
    );
  }
  const body = lines.join('\n') + '\n';
  const res = await request(`${pgw}/metrics/job/${job}`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain; version=0.0.4' },
    body,
  });
  if (res.statusCode >= 400) {
    console.error(`pushgateway returned ${res.statusCode}`);
  } else {
    console.log(`pushed ${results.length} target results to ${pgw}`);
  }
}

async function main(): Promise<void> {
  const targets = readTargets();
  if (targets.length === 0) {
    console.log('no onion targets configured (set TIP_ONION_HOSTNAME / VERIFY_ONION_HOSTNAME)');
    process.exit(0);
  }
  console.log(`probing ${targets.length} onion target(s) via Tor SOCKS5h`);
  const results = await Promise.all(
    targets.map(async (t) => ({ target: t, ...(await checkOnion(t)) })),
  );
  let exitCode = 0;
  for (const r of results) {
    const status = r.ok ? '✓' : '✗';
    console.log(
      `${status} ${r.target.name} (${r.target.hostname}) status=${r.status ?? 'err'} latency=${r.latency_ms}ms` +
        (r.error ? ` error=${r.error}` : ''),
    );
    if (!r.ok) exitCode = 1;
  }
  await pushMetrics(results);
  process.exit(exitCode);
}

main().catch((e: unknown) => {
  console.error('sentinel-tor-check failed:', e);
  process.exit(2);
});
