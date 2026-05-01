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

# 8. Architect-spec coverage gap surface (Block-D D.9 / C9).
#    PHASE-1-COMPLETION C9 calls for "backs up Postgres + Vault snapshot
#    + IPFS pinset + git repo + audit-chain export, all encrypted with
#    the architect's GPG key, all mirrored to NAS-replica + Hetzner
#    archive." The current script delivers Postgres + IPFS pinset +
#    Btrfs-of-/srv/vigil (which covers vault data on disk) + Neo4j +
#    GPG signature on the manifest. The five items below are
#    architect-spec items the script does NOT yet implement; surfaced
#    here as WARN so the gap is visible in CI without blocking. See
#    docs/runbooks/backup.md for the architect-action items.
warn() { yellow "! $*"; }
if grep -qE 'vault operator raft snapshot save' "$script" 2>/dev/null; then
  pass "[architect-spec] vault operator raft snapshot save"
else
  warn "[architect-spec] no vault operator raft snapshot save (only btrfs-of-/srv/vigil/vault); see docs/runbooks/backup.md"
fi
if grep -qE 'git clone --bare|git bundle' "$script" 2>/dev/null; then
  pass "[architect-spec] git repo backup"
else
  warn "[architect-spec] no git repo backup (source resides on github + architect's working tree); see docs/runbooks/backup.md"
fi
if grep -qE 'verify-hashchain|audit-chain.*export|verify:ledger' "$script" 2>/dev/null; then
  pass "[architect-spec] audit-chain explicit export"
else
  warn "[architect-spec] no audit-chain explicit export (chain lives inside Postgres dump); see docs/runbooks/backup.md"
fi
if grep -qE 'gpg --encrypt|gpg --symmetric' "$script" 2>/dev/null; then
  pass "[architect-spec] backup content encrypted (not just signed)"
else
  warn "[architect-spec] backup content is signed but NOT encrypted — Synology stores plaintext; see docs/runbooks/backup.md"
fi
if grep -qE 'hetzner|HETZNER' "$script" 2>/dev/null; then
  pass "[architect-spec] Hetzner mirror destination"
else
  warn "[architect-spec] no Hetzner mirror destination (only Synology rclone is named); see docs/runbooks/backup.md"
fi

if [ "$errors" -gt 0 ]; then
  red "\n$errors hard error(s) — backup pipeline NOT ready"
  exit 1
fi
green "\n✓ backup pipeline configuration verified (warnings above are architect-action items, not blockers)"
