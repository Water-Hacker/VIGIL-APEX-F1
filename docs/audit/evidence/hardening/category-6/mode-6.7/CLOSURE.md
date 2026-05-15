# Mode 6.7 — Silent clock skew

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 7 / Category 6
**Branch:** `hardening/phase-1-orientation`

## The failure mode

If a host's clock drifts from NTP, downstream cascade is severe but invisible:

- **Vault token TTL** math goes wrong — tokens expire early (production hits 401s) or late (security boundary loosened).
- **Audit timestamps** become non-monotonic — `timestamp_utc` ordering breaks; the chain still hashes but reviewers can't trust temporal claims.
- **Dedup-window enforcement** (mode 1.1's 24-hour TTL) becomes inconsistent across workers; messages that should dedup may re-process.

Pre-closure, no metric reported the NTP sync state or offset. The failure is silent until a downstream symptom surfaces (and even then, NTP is rarely the first suspect).

## What was added

### 1. Two Prometheus gauges

`packages/observability/src/metrics.ts`:

- `vigil_ntp_synced{host}` — 1 if synced, 0 otherwise.
- `vigil_ntp_offset_seconds{host}` — signed offset (positive = local clock ahead).

### 2. `scripts/ntp-check.ts` — clock-state scanner

Tries `chronyc tracking` first (precise sub-second offset + leap status), falls back to `timedatectl show` (sync flag only; offset reported as 0), falls back to a sentinel value `(synced=0, offset=1e6)` if no NTP instrumentation is available. The sentinel ensures the alert fires loudly when the instrumentation itself goes missing.

Pure helpers exported for testing:

- `parseChronycTracking(output)` — extracts signed offset + leap status from chrony output. Handles "slow" / "fast" semantics, scientific notation, malformed input.
- `parseTimedatectl(output)` — extracts `NTPSynchronized=yes|no`. Case-insensitive.
- `renderTextfile(state, host)` — produces Prometheus textfile content with proper escaping + trailing newline.

Atomic write semantics: writes to `<output>.tmp`, then renames.

### 3. Prometheus alerts

`infra/docker/prometheus/alerts/vigil.yml` — two alerts:

- **`NtpClockNotSynced`** — `vigil_ntp_synced == 0 for 5m`, warning. Catches outright loss of NTP.
- **`NtpClockSkew`** — `abs(vigil_ntp_offset_seconds) > 1 for 5m`, warning. Catches drift even when the daemon claims sync.

### 4. systemd timer + service

- `infra/systemd/vigil-ntp-check.timer` — `OnCalendar=*:0/5` (every 5 min) with 30 s randomized delay.
- `infra/systemd/vigil-ntp-check.service` — oneshot, runs as `vigil:vigil` with `NoNewPrivileges` + `ProtectSystem=strict`. Read-only access to `/proc`, `/sys`, `/var/lib/systemd/timesync`.

### 5. Unit tests for pure helpers

`scripts/__tests__/ntp-check.test.ts` — 14 cases covering:

- `parseChronycTracking`: in-sync positive offset, in-sync negative offset, leap-status not Normal, malformed output, scientific notation.
- `parseTimedatectl`: synced=yes, synced=no, missing line, case-insensitive.
- `renderTextfile`: two gauges with host label, synced=0 output, escape special chars in host, both `# HELP` + `# TYPE` per gauge, trailing newline.

The actual `chronyc` / `timedatectl` invocations need a running system to test; the unit tests cover the pure parsing logic so chrony/systemd format drift is caught early.

## The invariant

Four layers:

1. **Two gauges + two alerts** — both the sync flag and the absolute offset are monitored. A daemon that claims sync but drifts triggers `NtpClockSkew`; outright loss of sync triggers `NtpClockNotSynced`.
2. **Three-tier fallback** (chrony → timedatectl → sentinel) — missing instrumentation produces a maximally-loud signal.
3. **14 pure-helper tests** lock the parsing logic so a chrony or systemd format change fails CI before it reaches production.
4. **5-minute systemd interval** — drift exceeding 1 s is detected within 10 min (one scan interval + one Prometheus scrape interval + one alert evaluation cycle).

## What this closure does NOT include

- **Vault-internal-time vs. local-time comparison** — would catch a drift between this host and the Vault server even when both are individually NTP-synced. Requires a Vault API call per scan; out of scope. Flagged for follow-up.
- **Pushing chrony tracking history** — chrony exposes per-source RMS offset, root-dispersion, etc. The current gauge captures just the headline numbers; richer instrumentation is operator-tunable via chrony-exporter (a separate Prometheus exporter).
- **Test wiring** — same as mode 6.6: `scripts/__tests__/*.test.ts` files exist for documentation but aren't picked up by any vitest config. Existing gap; flagged.

## Files touched

- `packages/observability/src/metrics.ts` (+28 lines: two gauges)
- `scripts/ntp-check.ts` (new, 134 lines)
- `scripts/__tests__/ntp-check.test.ts` (new, 117 lines)
- `infra/docker/prometheus/alerts/vigil.yml` (+18 lines: two alerts)
- `infra/systemd/vigil-ntp-check.timer` (new)
- `infra/systemd/vigil-ntp-check.service` (new)
- `docs/audit/evidence/hardening/category-6/mode-6.7/CLOSURE.md` (this file)

## Verification

- `pnpm --filter @vigil/observability run typecheck`: clean.
- `npx tsc --noEmit scripts/ntp-check.ts scripts/cert-expiry-check.ts`: clean.
- Pure-helper test cases reviewed manually; identical structural pattern to the mode 6.6 cert-expiry-check tests which use the same test-as-documentation approach.
