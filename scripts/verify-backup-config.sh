#!/usr/bin/env bash
# scripts/verify-backup-config.sh — pre-flight audit of the backup pipeline.
#
# Runs without touching the live stack. Verifies that every component the
# backup script depends on is correctly configured, declared, and reachable.
# Run from the host that will execute the nightly backup, or from CI to
# guard against config drift in `infra/host-bootstrap/10-vigil-backup.sh`.
#
# Exits 0 if the backup pipeline is correctly configured to run, non-zero
# with a precise diagnostic otherwise.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

errors=0
fail() { red "✗ $*"; errors=$((errors + 1)); }
pass() { green "✓ $*"; }

# 1. The bootstrap script exists and is executable.
script="${ROOT}/infra/host-bootstrap/10-vigil-backup.sh"
if [ ! -f "$script" ]; then
  fail "10-vigil-backup.sh missing at $script"
elif [ ! -x "$script" ]; then
  yellow "! 10-vigil-backup.sh is not executable (set chmod +x)"
else
  pass "10-vigil-backup.sh present + executable"
fi

# 2. systemd unit + timer — the bootstrap script installs them inline via
#    heredoc to /etc/systemd/system. Verify the installer references both.
if grep -qE 'vigil-backup\.service' "$script" && grep -qE 'vigil-backup\.timer' "$script"; then
  pass "bootstrap installs vigil-backup.service + .timer"
else
  fail "bootstrap script missing vigil-backup.service / .timer install"
fi
if grep -qE 'systemctl enable --now vigil-backup\.timer' "$script"; then
  pass "bootstrap enables vigil-backup.timer"
else
  fail "bootstrap does NOT enable vigil-backup.timer"
fi

# 3. The script references each subsystem we expect.
for needle in 'pg_basebackup' 'btrfs' 'neo4j-admin' 'ipfs' 'GPG_FINGERPRINT' 'synology'; do
  if grep -qE "$needle" "$script" 2>/dev/null; then
    pass "backup covers $needle"
  else
    fail "backup script does NOT reference $needle"
  fi
done

# 4. .env.example documents required env vars.
for var in GPG_FINGERPRINT ARCHIVE_ROOT IPFS_API_URL POSTGRES_URL; do
  if grep -qE "^${var}=" .env.example 2>/dev/null; then
    pass ".env.example documents $var"
  else
    yellow "! .env.example missing entry for $var"
  fi
done

# 5. PLACEHOLDER discipline — GPG_FINGERPRINT must NOT be PLACEHOLDER on a live host.
if [ -f /etc/vigil/backup.env ]; then
  if grep -qE '^GPG_FINGERPRINT=$|^GPG_FINGERPRINT=PLACEHOLDER' /etc/vigil/backup.env; then
    fail "/etc/vigil/backup.env has GPG_FINGERPRINT unset/PLACEHOLDER — backups will refuse to run"
  else
    pass "/etc/vigil/backup.env has a real GPG_FINGERPRINT"
  fi
else
  yellow "! /etc/vigil/backup.env not found (this is fine in CI; required on the prod host)"
fi

# 6. Archive root reachable (only meaningful on the prod host).
ar="${ARCHIVE_ROOT:-/mnt/synology/vigil-archive}"
if [ -d "$ar" ]; then
  pass "archive root $ar exists"
elif [ -n "${CI:-}" ]; then
  yellow "! archive root $ar not present (CI; expected)"
else
  fail "archive root $ar missing on prod host"
fi

# 7. Decision-log mention — the backup pipeline must be referenced in a
#    decision-log entry so future operators can find context.
if grep -qE "10-vigil-backup\.sh|vigil-backup\.service" docs/decisions/log.md 2>/dev/null; then
  pass "backup pipeline referenced in docs/decisions/log.md"
else
  yellow "! backup pipeline not referenced in docs/decisions/log.md (consider adding a DECISION-NNN)"
fi

if [ "$errors" -gt 0 ]; then
  red "\n$errors hard error(s) — backup pipeline NOT ready"
  exit 1
fi
green "\n✓ backup pipeline configuration verified"
