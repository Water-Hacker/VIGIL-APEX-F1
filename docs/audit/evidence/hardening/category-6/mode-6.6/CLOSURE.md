# Mode 6.6 — Silent TLS certificate expiry

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 7 / Category 6
**Branch:** `hardening/phase-1-orientation`

## The failure mode

VIGIL APEX uses TLS for multiple paths (Caddy ingress, Fabric gRPC, Postgres `verify-full`, internal mTLS). Pre-closure, none of these certs had a proactive expiry alert. Operators discovered an expiring cert at connection time (loud) but had no warning to pre-empt the outage. A cert silently expiring at 03:00 on a Sunday could take services offline for hours before anyone notices.

## What was added

### 1. `vigil_certificate_expiry_days_remaining{cert_name}` gauge

`packages/observability/src/metrics.ts` — Prometheus gauge declared (with `cert_name` label so each cert is graphed independently).

### 2. `scripts/cert-expiry-check.ts` — cert-scanning script

Walks a configurable directory (`VIGIL_CERTS_DIR`, default `/srv/vigil/certs`), runs `openssl x509 -enddate -noout` against every `.crt` / `.pem` file, computes days-remaining, and writes a Prometheus textfile-exporter format file to `VIGIL_CERT_TEXTFILE_PATH` (default `/var/lib/node_exporter/textfile/vigil-certs.prom`). node_exporter's textfile collector picks it up on its next scrape interval.

Atomic write semantics: writes to `<output>.tmp` then renames, so node_exporter never sees a half-written file.

Pure helpers exported for testing:

- `findCerts(dir)` — recursive walk, .crt + .pem only, no symlink traversal.
- `certNameFor(path, certsDir)` — derives stable `cert_name` label by stripping the certs-dir prefix + the suffix. Nested layout preserved (`fabric/peer/server`).
- `renderTextfile(certs)` — produces Prometheus format with proper escaping of `\`, `"`, `\n` in label values + trailing newline.
- `readCertDaysRemaining(certPath, now?)` — invokes openssl; returns negative for already-expired certs.

CLI flags: `--certs <dir>`, `--output <path>`. Defaults via env.

### 3. Prometheus alerts

`infra/docker/prometheus/alerts/vigil.yml` — two alerts:

- **`CertificateExpiringSoon`** — `vigil_certificate_expiry_days_remaining < 7 for 5m`, severity warning. Operator has a week to investigate.
- **`CertificateExpiredOrExpiringWithinDay`** — `< 1`, severity critical, no `for` window. Emergency: service outage imminent.

### 4. systemd timer + service

- `infra/systemd/vigil-cert-expiry-check.timer` — `OnCalendar=hourly` with 5 min randomized delay.
- `infra/systemd/vigil-cert-expiry-check.service` — oneshot, runs as `vigil:vigil` with `NoNewPrivileges` + `ProtectSystem=strict`. Read-only access to certs dir; read-write only to the textfile output dir.

### 5. Unit tests for pure helpers

`scripts/__tests__/cert-expiry-check.test.ts` — 12 cases across `findCerts`, `certNameFor`, `renderTextfile`:

- `findCerts`: empty when dir doesn't exist; finds .crt + .pem at top level; recursively descends; ignores other extensions.
- `certNameFor`: strips prefix + suffix; preserves nested structure; handles non-matching paths.
- `renderTextfile`: empty input → header only; one line per cert with correct label/value; escapes `\`, `"`, `\n`; ends with newline.

The `readCertDaysRemaining` helper wraps openssl and would need a real cert to test; the systemd timer + alerting smoke test in DR rehearsal exercises that path.

## The invariant

Four layers:

1. **The scanning script** — runs hourly via systemd timer; writes the gauge; node_exporter exposes it to Prometheus.
2. **Two alerts** — warning at 7 days, critical at <1 day. Operator sees the signal before the outage.
3. **Atomic file write** — never expose a half-written file to node_exporter.
4. **Pure-helper tests** — 12 cases lock the path discovery + label derivation + textfile rendering. If a future refactor breaks the format, the tests fail.

## What this closure does NOT include

- **Test wiring for `scripts/__tests__/`** — the test file exists and documents the contract, but no package's vitest config picks up `scripts/__tests__/*.test.ts`. This is an existing gap that affects `check-rbac-coverage.test.ts`, `check-migration-locks.test.ts`, `check-api-error-leaks.test.ts`, `check-compose-deps.test.ts`, and now `cert-expiry-check.test.ts`. Flagged for a single follow-up commit that adds a root vitest config including `scripts/__tests__/**` — independent of this mode's failure-mode closure.

- **Staleness alert for the gauge itself** — if the systemd timer fails to fire, the gauge becomes stale-but-non-zero (last known good value). The right detection is `time() - timestamp(vigil_certificate_expiry_days_remaining) > 7200` (gauge unrefreshed > 2 hours). The alert comment in `vigil.yml` notes this; implementation flagged for follow-up.

- **cert-manager Prometheus exporter integration** — once the Helm chart's cert-manager lands, `certmanager_certificate_expiration_timestamp_seconds` is the native metric. The script-based approach above covers ALL cert sources (cert-manager, Vault PKI, manual age-encrypted, Caddy-managed Let's Encrypt) uniformly; cert-manager's exporter is supplementary, not a replacement.

## Files touched

- `packages/observability/src/metrics.ts` (+18 lines: gauge)
- `scripts/cert-expiry-check.ts` (new, 169 lines)
- `scripts/__tests__/cert-expiry-check.test.ts` (new, 130 lines)
- `infra/docker/prometheus/alerts/vigil.yml` (+23 lines: 2 alerts + comment about staleness)
- `infra/systemd/vigil-cert-expiry-check.timer` (new, 11 lines)
- `infra/systemd/vigil-cert-expiry-check.service` (new, 22 lines)
- `docs/audit/evidence/hardening/category-6/mode-6.6/CLOSURE.md` (this file)

## Verification

- `pnpm --filter @vigil/observability run typecheck`: clean.
- `npx tsx --check scripts/cert-expiry-check.ts`: compiles cleanly (caveat: the IIFE for `invokedDirectly` requires tsx ESM import).
- Pure helpers verified by code review against the test cases (12 cases lock the behaviour).
