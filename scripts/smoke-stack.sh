#!/usr/bin/env bash
# scripts/smoke-stack.sh — Block-D D.1 / C1 deliverable.
#
# Compose-stack smoke test. Brings the stack up, waits for every
# container that declares a healthcheck to report `healthy`, then
# hits the dashboard's public health + audit endpoints to confirm
# the edge surface is reachable.
#
# Designed to fail fast and loud:
#   - non-zero exit on first unhealthy container past timeout
#   - non-zero exit on any non-200 health probe
#   - per-stage status lines so a CI log walker sees what worked
#
# Default timeout: 5 minutes per container's healthcheck. Cold
# starts (postgres init scripts, vault unseal in dev mode) can be
# slow; the timeout matches the slowest bootstrap container.
#
# Usage:
#   ./scripts/smoke-stack.sh                    # full bring-up + verify
#   ./scripts/smoke-stack.sh --no-up            # assume stack already up; verify only
#   ./scripts/smoke-stack.sh --no-down          # leave stack running on success (default = teardown on success)
#   ./scripts/smoke-stack.sh --timeout-s=600    # extend per-container healthy wait
#
# REFUSES TO RUN if .env doesn't exist (compose needs it). Will
# log a warning if PLACEHOLDER values are detected for Tier-1
# critical secrets — workers may refuse to boot.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="infra/docker/docker-compose.yaml"
TIMEOUT_S=300
DO_UP=1
DO_DOWN=0  # default: leave stack running so the operator can inspect

for arg in "$@"; do
  case "$arg" in
    --no-up)              DO_UP=0 ;;
    --no-down)            DO_DOWN=0 ;;
    --down)               DO_DOWN=1 ;;
    --timeout-s=*)        TIMEOUT_S="${arg#--timeout-s=}" ;;
    -h|--help)
      grep '^# ' "$0" | sed 's/^# //'
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
blue()   { printf '\033[34m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

require() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    red "missing required command: $cmd"
    exit 2
  fi
}

require docker
require curl

if [ ! -f .env ]; then
  red ".env file missing — compose needs it for service env wiring."
  red "Copy .env.example → .env and populate the Tier-1 critical values."
  exit 2
fi

# Soft warning on PLACEHOLDER Tier-1 critical values. Workers refuse
# to boot with these (Block-A A9 / Block-B B.2) so the smoke test
# would fail at the per-container healthcheck stage anyway, but
# warning here gives a clearer cause-of-failure message.
TIER1_CRITICAL=(
  'GPG_FINGERPRINT'
  'TIP_OPERATOR_TEAM_PUBKEY'
  'AUDIT_PUBLIC_EXPORT_SALT'
  'POLYGON_ANCHOR_CONTRACT'
)
for var in "${TIER1_CRITICAL[@]}"; do
  val="$(grep -E "^${var}=" .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
  if [ -z "$val" ] || [[ "$val" =~ ^PLACEHOLDER ]]; then
    yellow "⚠ ${var} is unset or PLACEHOLDER — affected services will refuse to boot."
  fi
done

# ─── Stage 1: bring stack up ───────────────────────────────────
if [ "$DO_UP" = "1" ]; then
  blue "==> docker compose up -d"
  docker compose -f "$COMPOSE_FILE" up -d
  green "✓ compose up issued"
fi

# ─── Stage 2: wait for healthy on every container declaring a healthcheck ──
blue "==> waiting up to ${TIMEOUT_S}s for every healthcheck-declaring container to report healthy"

# List of services whose `healthcheck:` is declared in the compose file.
# `docker compose ps --format json` returns Health=running|healthy|unhealthy|starting
# (or "" if no healthcheck is declared; those are skipped).
deadline=$(( $(date +%s) + TIMEOUT_S ))
unhealthy=()
declare -A reported_healthy=()

while [ "$(date +%s)" -lt "$deadline" ]; do
  unhealthy=()
  # `docker compose ps --format json` emits one JSON object per line.
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    name="$(echo "$line" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("Service","?"))')"
    health="$(echo "$line" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("Health",""))')"
    state="$(echo "$line" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("State",""))')"

    # Containers without a healthcheck have Health="". Skip them
    # (the script's contract is to wait on declared healthchecks).
    if [ -z "$health" ]; then
      continue
    fi

    case "$health" in
      healthy)
        if [ -z "${reported_healthy[$name]+x}" ]; then
          green "  ✓ $name healthy"
          reported_healthy[$name]=1
        fi
        ;;
      starting)
        unhealthy+=("$name (starting)")
        ;;
      unhealthy)
        unhealthy+=("$name (unhealthy/$state)")
        ;;
      *)
        unhealthy+=("$name ($health)")
        ;;
    esac
  done < <(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null || true)

  if [ ${#unhealthy[@]} -eq 0 ]; then
    green "✓ all healthcheck-declaring containers report healthy"
    break
  fi

  sleep 5
done

if [ ${#unhealthy[@]} -ne 0 ]; then
  red "✗ TIMEOUT after ${TIMEOUT_S}s — these containers never reported healthy:"
  for c in "${unhealthy[@]}"; do
    red "    - $c"
  done
  red ""
  red "Diagnostic — show the unhealthy containers' last 50 log lines:"
  for c in "${unhealthy[@]}"; do
    name="${c%% *}"
    yellow "--- $name ---"
    docker compose -f "$COMPOSE_FILE" logs --tail=50 "$name" 2>&1 | tail -50 || true
  done
  exit 1
fi

# ─── Stage 3: edge surface health probes ───────────────────────
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"

probe() {
  local label="$1"
  local url="$2"
  local expected="${3:-200}"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo 000)"
  if [ "$code" = "$expected" ]; then
    green "  ✓ $label → $code"
    return 0
  fi
  red "  ✗ $label → $code (expected $expected)"
  return 1
}

blue "==> dashboard edge probes"
fail=0
probe '/api/health'                "$DASHBOARD_URL/api/health"             200 || fail=1
probe '/api/audit/public?limit=5'  "$DASHBOARD_URL/api/audit/public?limit=5" 200 || fail=1
probe '/public/audit'              "$DASHBOARD_URL/public/audit"           200 || fail=1
probe '/tip'                       "$DASHBOARD_URL/tip"                    200 || fail=1
probe '/verify'                    "$DASHBOARD_URL/verify"                 200 || fail=1

if [ "$fail" = "1" ]; then
  red "✗ one or more dashboard probes failed"
  exit 1
fi

green "✓ all dashboard probes 200"

# ─── Stage 4: tear down on request ─────────────────────────────
if [ "$DO_DOWN" = "1" ]; then
  blue "==> docker compose down"
  docker compose -f "$COMPOSE_FILE" down
  green "✓ stack torn down"
else
  yellow "stack left running (use --down to tear down on success; default leaves it up for inspection)"
fi

green ""
green "✓✓✓ smoke-stack passed"
