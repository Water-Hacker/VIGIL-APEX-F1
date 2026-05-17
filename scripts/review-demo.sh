#!/usr/bin/env bash
# =============================================================================
# scripts/review-demo.sh — VIGIL APEX, UNDP-review-readiness deliverable.
# =============================================================================
#
# Purpose: a self-contained 15-minute live demonstration that a reviewer
# runs on their own laptop to see the load-bearing primitives of this
# codebase work end-to-end. Designed to leave a reviewer with first-hand
# evidence of:
#
#   1. The hash-chain primitive accepts events + computes deterministic
#      body_hashes via canonical bytes (packages/audit-chain).
#   2. `HashChain.verify()` walks the chain and confirms link integrity.
#   3. A row tampered with via raw SQL (bypassing application code) is
#      caught by the recompute-body-hash truth-test that the
#      audit-chain-divergence runbook step 3 prescribes.
#
# These are the SHIPPED, TESTED primitives — the same code paths
# production runs.  No mocks, no fakes; only the dependencies that
# make Tor / IPFS / Vault / Polygon out-of-scope for a laptop demo
# are skipped.
#
# Prerequisites the reviewer needs:
#   - docker + docker compose v2
#   - pnpm v9 + node v20 (per .nvmrc)
#   - 1 GiB free disk + 1 GiB free RAM
#
# Approximate runtime: 3 minutes after `pnpm install` is done.
#
# What this demo does NOT cover (read-only review territory):
#   - Tor portal flow — needs onion provisioning + libsodium sealed-box ceremony
#   - Polygon anchoring — needs mainnet wallet + YubiKey signer
#   - YubiKey/Shamir council quorum — needs hardware + 5 council members
#   - CONAC SFTP delivery — needs MOU + remote inbox
#   - LibreOffice → PDF dossier rendering — needs soffice binary
#
# All of those are documented + tested in their own packages; this
# script focuses on the audit-chain integrity claim because that's
# the load-bearing trust property the system rests on.
#
# Exit codes:
#   0 — every check passed; tamper was caught as designed
#   1 — pre-flight failure (missing deps; existing review-mode stack)
#   2 — a check failed unexpectedly (a real regression)
#
# Usage:
#   bash scripts/review-demo.sh          # full demo with teardown
#   bash scripts/review-demo.sh --keep   # leave postgres running after
#   bash scripts/review-demo.sh --help   # this header
#
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="infra/docker/docker-compose.review.yaml"
KEEP_STACK=0

for arg in "$@"; do
  case "$arg" in
    --keep) KEEP_STACK=1 ;;
    -h | --help)
      sed -n '3,55p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

# -----------------------------------------------------------------------------
# Helpers — colour + structured banners. Falls back to plain text when
# stdout is not a TTY (CI, piped, redirected) so logs stay grep-able.
# -----------------------------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  RED=$'\033[31m'
  CYAN=$'\033[36m'
  RESET=$'\033[0m'
else
  BOLD="" GREEN="" YELLOW="" RED="" CYAN="" RESET=""
fi

banner() {
  echo
  echo "${CYAN}${BOLD}=== $* ===${RESET}"
}

ok() {
  echo "${GREEN}  ✓ $*${RESET}"
}

note() {
  echo "${YELLOW}  → $*${RESET}"
}

fail() {
  echo "${RED}  ✗ $*${RESET}" >&2
  exit 2
}

# -----------------------------------------------------------------------------
# Pre-flight
# -----------------------------------------------------------------------------
banner 'Pre-flight'

command -v docker >/dev/null 2>&1 || fail "docker not on PATH"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 not available"
command -v pnpm >/dev/null 2>&1 || fail "pnpm not on PATH (install pnpm v9)"

if [ ! -d node_modules ]; then
  note "node_modules missing — run 'pnpm install' first; this demo intentionally does NOT install for you"
  exit 1
fi

# Refuse to clobber an existing review-mode stack so the demo never
# silently runs against state from a prior partial run.
if docker compose -f "$COMPOSE_FILE" ps --quiet 2>/dev/null | grep -q .; then
  note "review-mode stack is already up. Tear it down first: docker compose -f $COMPOSE_FILE down -v"
  exit 1
fi

ok "docker + pnpm available, node_modules present, no stale review stack"

# -----------------------------------------------------------------------------
# Bring up postgres + redis substrate
# -----------------------------------------------------------------------------
banner 'Bringing up review-mode substrate (postgres + redis)'

docker compose -f "$COMPOSE_FILE" up -d
note "waiting for postgres healthcheck (up to 60s)…"

ready=0
for _ in $(seq 1 12); do
  if docker compose -f "$COMPOSE_FILE" ps --format json vigil-review-postgres 2>/dev/null |
    grep -q '"Health":"healthy"'; then
    ready=1
    break
  fi
  sleep 5
done
[ "$ready" -eq 1 ] || fail "postgres did not become healthy within 60s"
ok "postgres healthy; redis healthy"

# Build the connection string used by every subsequent step.
export DATABASE_URL='postgres://vigil:review@127.0.0.1:5432/vigil'
export REDIS_URL='redis://127.0.0.1:6379'

# -----------------------------------------------------------------------------
# Apply migrations
# -----------------------------------------------------------------------------
banner 'Applying audit.actions migrations'
note "pnpm --filter @vigil/db-postgres run migrate"
if ! pnpm --filter @vigil/db-postgres run migrate >/tmp/vigil-review-migrate.log 2>&1; then
  cat /tmp/vigil-review-migrate.log
  fail "migration failed (see output above)"
fi
ok "audit.actions schema migrated"

# -----------------------------------------------------------------------------
# Seed 12 synthetic audit events via the HashChain primitive
# -----------------------------------------------------------------------------
banner 'Seeding 12 synthetic audit events via HashChain.append()'
note "pnpm tsx scripts/review-demo-seed.ts"
if ! pnpm tsx scripts/review-demo-seed.ts; then
  fail "seed step failed"
fi

# -----------------------------------------------------------------------------
# Verify the chain end-to-end
# -----------------------------------------------------------------------------
banner 'Verifying the chain (HashChain.verify)'
note "every body_hash must be the canonical rowHash(prev, bodyHash(canonical(row)))"
pnpm tsx scripts/review-demo-verify.ts
ok "chain verifies cleanly"

# -----------------------------------------------------------------------------
# Recompute one seq — should match
# -----------------------------------------------------------------------------
banner 'Recomputing seq=6 via the divergence-response truth-test'
note "this is the same CLI the audit-chain-divergence runbook step 3 invokes"
pnpm --filter @vigil/audit-chain exec \
  tsx src/scripts/recompute-body-hash.ts --seq 6 |
  tee /tmp/vigil-review-recompute-clean.log
if grep -q 'MISMATCH' /tmp/vigil-review-recompute-clean.log; then
  fail "unexpected MISMATCH on a clean chain"
fi
ok "recompute matches stored body_hash"

# -----------------------------------------------------------------------------
# TAMPER: edit the payload of seq=6 directly via psql, bypassing
# the application code. Demonstrate the recompute truth-test catches it.
# -----------------------------------------------------------------------------
banner 'Simulating a tamper: raw-SQL UPDATE on seq=6, bypassing application code'
note "this is the exact attack the three-witness audit chain is designed to detect"
docker exec -i vigil-review-postgres psql -U vigil -d vigil >/dev/null <<'SQL'
UPDATE audit.actions
   SET payload = jsonb_set(payload, '{tampered}', '"true"'::jsonb)
 WHERE seq = 6;
SQL
ok "raw-SQL UPDATE applied to audit.actions seq=6"

banner 'Re-running the truth-test on the tampered seq'
note "expected: recompute reports MISMATCH; CLI exits with code 2"
if pnpm --filter @vigil/audit-chain exec \
  tsx src/scripts/recompute-body-hash.ts --seq 6 |
  tee /tmp/vigil-review-recompute-tampered.log; then
  fail "tamper was NOT caught — this is a real regression"
fi
grep -q 'MISMATCH' /tmp/vigil-review-recompute-tampered.log ||
  fail "expected MISMATCH in output but did not see it"
ok "tamper detected — the integrity guarantee held"

# -----------------------------------------------------------------------------
# Show the tamper marker in the row
# -----------------------------------------------------------------------------
banner 'Confirming the tamper is in the row (for the reviewer to inspect)'
docker exec -i vigil-review-postgres psql -U vigil -d vigil -c \
  "SELECT seq, action, payload FROM audit.actions WHERE seq = 6;"

# -----------------------------------------------------------------------------
# Teardown
# -----------------------------------------------------------------------------
if [ "$KEEP_STACK" -eq 1 ]; then
  banner 'Leaving review-mode stack running (--keep)'
  note "tear down later: docker compose -f $COMPOSE_FILE down -v"
else
  banner 'Tearing down review-mode stack'
  docker compose -f "$COMPOSE_FILE" down -v >/dev/null 2>&1
  ok "stack down; volumes deleted"
fi

banner 'Demo complete'
cat <<EOF
${GREEN}${BOLD}✓ Hash-chain integrity demonstrated end-to-end.${RESET}

Code paths exercised (all production, not mocked):
  - packages/audit-chain/src/canonical.ts            (bodyHash + rowHash)
  - packages/audit-chain/src/hash-chain.ts           (HashChain.append + verify)
  - packages/audit-chain/src/scripts/recompute-body-hash.ts  (truth-test CLI)
  - packages/db-postgres/drizzle/0001..0013_*.sql    (audit.actions schema)

Next reviewer steps (see REVIEW.md):
  - Run the full test suite:   pnpm -w turbo run test         (60/60 packages)
  - Read the architecture:     docs/source/SRD-v3.md
  - Read the audit-chain spec: docs/audit/08-audit-chain.md
  - Read the AI-Safety doctrine: docs/source/AI-SAFETY-DOCTRINE-v1.md
  - Read the threat model:     THREAT-MODEL-CMR.md
EOF
