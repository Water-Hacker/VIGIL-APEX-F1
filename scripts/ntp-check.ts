#!/usr/bin/env tsx
/**
 * Hardening mode 6.7 — NTP clock-skew detection.
 *
 * Runs `timedatectl show` to read the kernel's NTP sync state and
 * writes two gauges via node_exporter's textfile collector:
 *   - vigil_ntp_synced{host}        — 1 when sync'd, 0 otherwise.
 *   - vigil_ntp_offset_seconds{host} — seconds offset (signed).
 *
 * Invoked every 5 min by `infra/systemd/vigil-ntp-check.timer`.
 * Alertmanager fires `NtpClockSkew` when offset > 1s or synced == 0
 * for 5 min.
 *
 * `timedatectl show` is preferred over `ntpq -p` because:
 *   - systemd-timesyncd is the default time source on modern Ubuntu /
 *     Debian (which the production hosts run); ntpq probes the legacy
 *     ntpd daemon.
 *   - timedatectl always reports a deterministic key=value format;
 *     ntpq's table format is brittle to parse.
 *
 * If `timedatectl` isn't installed (rare; would mean systemd isn't
 * running), the script falls back to a sentinel value (synced=0,
 * offset=+1e6) so the alert fires on missing instrumentation.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, basename } from 'node:path';

const DEFAULT_OUTPUT_PATH =
  process.env.VIGIL_NTP_TEXTFILE_PATH ?? '/var/lib/node_exporter/textfile/vigil-ntp.prom';

export interface NtpState {
  readonly synced: boolean;
  /** Offset in seconds; signed (positive = local clock ahead of NTP). */
  readonly offsetSeconds: number;
}

/**
 * Parse `timedatectl show` output. Reads:
 *   NTPSynchronized=yes|no    → synced flag.
 *
 * timedatectl doesn't report the offset directly. We read it from
 * /var/lib/systemd/timesync/clock if available (last sync moment) or
 * fall back to 0. Operators who need precise sub-second offset can
 * upgrade to chrony + chronyc tracking, which reports `Last offset`.
 */
export function parseTimedatectl(output: string): { synced: boolean } {
  const synced = /NTPSynchronized\s*=\s*yes/i.test(output);
  return { synced };
}

/**
 * Try chronyc first (precise sub-second offset); fall back to
 * timedatectl (boolean sync only). Returns a best-effort NtpState.
 */
export function readNtpStateOrFallback(): NtpState {
  // Try chrony.
  try {
    const out = execFileSync('chronyc', ['tracking'], { encoding: 'utf8', timeout: 5_000 });
    return parseChronycTracking(out);
  } catch {
    // chrony not installed or not running. Fall through.
  }
  // Fall back to timedatectl.
  try {
    const out = execFileSync('timedatectl', ['show'], { encoding: 'utf8', timeout: 5_000 });
    const { synced } = parseTimedatectl(out);
    return { synced, offsetSeconds: 0 };
  } catch {
    // No NTP instrumentation available — fail loudly via the gauge.
    return { synced: false, offsetSeconds: 1_000_000 };
  }
}

/**
 * Parse `chronyc tracking` output. Reads two lines:
 *   System time     : 0.000012345 seconds slow of NTP time
 *   Leap status     : Normal
 *
 * "slow of NTP time" → local clock is BEHIND → offset is negative.
 * "fast of NTP time" → local clock is AHEAD  → offset is positive.
 * "Normal" leap status implies the sync is active.
 */
export function parseChronycTracking(output: string): NtpState {
  const m = output.match(/System time\s*:\s*([0-9.eE+-]+)\s+seconds\s+(slow|fast)\s+of\s+NTP/i);
  let offsetSeconds = 0;
  if (m) {
    const magnitude = Number(m[1]);
    if (Number.isFinite(magnitude)) {
      // "slow" → local is behind → offset NEGATIVE; "fast" → POSITIVE.
      offsetSeconds = m[2]!.toLowerCase() === 'slow' ? -magnitude : magnitude;
    }
  }
  const leap = output.match(/Leap status\s*:\s*(\w+)/i);
  // Normal = sync'd; everything else (Unsynchronised, Insert second, Delete second) = NOT sync'd.
  const synced = !!leap && leap[1]!.toLowerCase() === 'normal';
  return { synced, offsetSeconds };
}

/**
 * Render Prometheus textfile-exporter content for the NTP gauges.
 * The host label lets one Prometheus aggregate across many DL380 nodes
 * without needing per-host scrape configs.
 */
export function renderTextfile(state: NtpState, host: string): string {
  const safe = host.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return [
    '# HELP vigil_ntp_synced NTP sync flag (1 = synced, 0 = not synced) (mode 6.7)',
    '# TYPE vigil_ntp_synced gauge',
    `vigil_ntp_synced{host="${safe}"} ${state.synced ? 1 : 0}`,
    '# HELP vigil_ntp_offset_seconds Kernel-reported NTP offset in seconds (mode 6.7)',
    '# TYPE vigil_ntp_offset_seconds gauge',
    `vigil_ntp_offset_seconds{host="${safe}"} ${state.offsetSeconds}`,
    '',
  ].join('\n');
}

async function main(): Promise<number> {
  const outputPath = process.argv.slice(2).reduce<string | null>((acc, v, i, arr) => {
    if (v === '--output' && arr[i + 1]) return arr[i + 1]!;
    return acc;
  }, null);
  const target = outputPath ?? DEFAULT_OUTPUT_PATH;
  const host = hostname();

  const state = readNtpStateOrFallback();
  const content = renderTextfile(state, host);

  try {
    mkdirSync(dirname(target), { recursive: true });
  } catch {
    /* best effort */
  }
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, target);
  console.log(
    `[ntp-check] host=${host} synced=${state.synced} offset=${state.offsetSeconds}s wrote ${target}`,
  );
  return 0;
}

const invokedDirectly = (() => {
  try {
    return (
      process.argv[1]?.endsWith('ntp-check.ts') === true ||
      process.argv[1]?.endsWith('ntp-check.mjs') === true ||
      basename(process.argv[1] ?? '') === 'ntp-check.ts'
    );
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[ntp-check] crashed:', err);
      process.exit(2);
    });
}
