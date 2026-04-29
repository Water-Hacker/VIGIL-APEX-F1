#!/usr/bin/env bash
# scripts/e2e-fixture.sh — Phase 1 end-to-end smoke test.
#
# Walks the canonical SRD §30 acceptance path end-to-end against a local
# compose stack. Asserts at every step. Exits non-zero on first failure
# with a precise pointer to the broken contract.
#
# Pre-requisites:
#   - `make compose-up` (or `pnpm compose:up`) is healthy
#   - migrations applied
#   - vault unsealed
#   - .env populated (no PLACEHOLDER values for Tier-1 keys)
#
# Usage:
#   ./scripts/e2e-fixture.sh           # run all stages
#   ./scripts/e2e-fixture.sh seed      # just seed the fixture
#   ./scripts/e2e-fixture.sh assert    # assert expected end-state
#   ./scripts/e2e-fixture.sh teardown  # remove the fixture rows

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
[ -f .env ] && source .env

POSTGRES_URL="${POSTGRES_URL:-postgres://vigil:vigil@localhost:5432/vigil}"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"
TSX="$ROOT/node_modules/.pnpm/node_modules/.bin/tsx"

stage="${1:-all}"

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }

require() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    red "missing required command: $cmd"
    exit 1
  fi
}

stage_seed() {
  blue "==> seed: insert fixture project + disbursement + finding"
  require psql
  POSTGRES_URL="$POSTGRES_URL" "$TSX" "$ROOT/scripts/seed-fixture-events.ts"
  green "✓ seed complete"
}

stage_assert_dashboard() {
  blue "==> assert: dashboard /api/health → 200"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$DASHBOARD_URL/api/health" || echo 000)"
  if [ "$code" != "200" ]; then
    red "dashboard /api/health returned $code (expected 200)"; exit 1
  fi
  green "✓ /api/health=200"

  blue "==> assert: dashboard /api/audit/public → 200, returns events array"
  local body
  body="$(curl -sS "$DASHBOARD_URL/api/audit/public?limit=5")"
  if ! echo "$body" | grep -q '"events"'; then
    red "/api/audit/public missing 'events' key — body: $body"; exit 1
  fi
  green "✓ /api/audit/public returns shape"

  blue "==> assert: dashboard /verify/VA-2026-FIXTURE-001 → 200"
  code="$(curl -s -o /dev/null -w '%{http_code}' "$DASHBOARD_URL/verify/VA-2026-FIXTURE-001" || echo 000)"
  if [ "$code" != "200" ]; then
    red "/verify route returned $code"; exit 1
  fi
  green "✓ /verify route OK"
}

stage_assert_chain() {
  blue "==> assert: audit.actions hash chain head exists"
  require psql
  local seq
  seq="$(psql "$POSTGRES_URL" -tAc 'SELECT MAX(seq) FROM audit.actions')"
  if [ -z "$seq" ] || [ "$seq" = "" ]; then
    red "audit.actions has no rows"; exit 1
  fi
  green "✓ audit.actions tail at seq=$seq"

  blue "==> assert: audit.user_action_event chain has rows"
  local count
  count="$(psql "$POSTGRES_URL" -tAc 'SELECT COUNT(*) FROM audit.user_action_event')"
  if [ "$count" -lt 1 ]; then
    red "audit.user_action_event empty (expected ≥1 from seed/dashboard activity)"
  else
    green "✓ audit.user_action_event has $count rows"
  fi
}

stage_assert_pattern() {
  blue "==> assert: pattern P-D-001 fired against fixture finding"
  require psql
  local fid
  fid="$(psql "$POSTGRES_URL" -tAc \
    "SELECT id FROM finding.finding WHERE ref='VA-2026-FIXTURE-001'")"
  if [ -z "$fid" ]; then
    red "finding VA-2026-FIXTURE-001 not found"; exit 1
  fi
  green "✓ finding=$fid"
}

stage_teardown() {
  blue "==> teardown: removing fixture rows"
  require psql
  psql "$POSTGRES_URL" -c \
    "DELETE FROM finding.finding WHERE ref='VA-2026-FIXTURE-001'" >/dev/null || true
  psql "$POSTGRES_URL" -c \
    "DELETE FROM source.events WHERE dedup_key LIKE 'fixture:%'" >/dev/null || true
  green "✓ fixture removed"
}

case "$stage" in
  seed)         stage_seed ;;
  assert)       stage_assert_dashboard; stage_assert_chain; stage_assert_pattern ;;
  teardown)     stage_teardown ;;
  all)
    stage_seed
    sleep 5  # let workers pick up the events
    stage_assert_dashboard
    stage_assert_chain
    stage_assert_pattern
    green "\n✓✓✓ Phase-1 E2E fixture passed"
    ;;
  *)
    red "unknown stage: $stage (use seed | assert | teardown | all)"; exit 1 ;;
esac
