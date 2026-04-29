#!/usr/bin/env bash
# scripts/dr-restore-test.sh — Companion to docs/runbooks/dr-rehearsal.md.
#
# Each subcommand is a single rehearsal stage. Idempotent so a stage can
# be re-run after a failure without re-doing earlier stages.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }

cmd="${1:-help}"; shift || true

restore_postgres() {
  local snapshot="" target=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --snapshot) snapshot="$2"; shift 2 ;;
      --target)   target="$2"; shift 2 ;;
      *) red "unknown arg: $1"; exit 2 ;;
    esac
  done
  [ -f "$snapshot" ] || { red "snapshot not found: $snapshot"; exit 1; }
  [ -n "$target" ]  || { red "--target required"; exit 1; }
  blue "==> restoring postgres from $snapshot → $target"
  zstd -dc "$snapshot" | psql "postgres://vigil:vigil@$target/vigil" -v ON_ERROR_STOP=1
  blue "==> verifying chain integrity"
  pnpm exec turbo run --filter=audit-verifier exec -- node dist/index.js verify-chain || \
    { red "hash chain walk failed"; exit 1; }
  green "✓ postgres restored + chain verified"
}

restore_redis() {
  local rdb="" target=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --rdb)    rdb="$2"; shift 2 ;;
      --target) target="$2"; shift 2 ;;
      *) red "unknown arg: $1"; exit 2 ;;
    esac
  done
  [ -f "$rdb" ] || { red "rdb not found: $rdb"; exit 1; }
  blue "==> restoring redis $rdb → $target"
  # Stop redis at target, replace dump.rdb, restart.
  redis-cli -h "${target%:*}" -p "${target#*:}" SHUTDOWN NOSAVE || true
  scp "$rdb" "${target%:*}:/var/lib/redis/dump.rdb"
  ssh "${target%:*}" "systemctl start redis"
  sleep 5
  redis-cli -h "${target%:*}" -p "${target#*:}" XLEN vigil:audit:emit
  green "✓ redis restored"
}

restore_ipfs() {
  local pinset="" target=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --pinset) pinset="$2"; shift 2 ;;
      --target) target="$2"; shift 2 ;;
      *) red "unknown arg: $1"; exit 2 ;;
    esac
  done
  [ -f "$pinset" ] || { red "pinset not found: $pinset"; exit 1; }
  blue "==> re-pinning ${pinset} on ${target}"
  local total ok fail=0
  total="$(wc -l < "$pinset")"
  ok=0
  while IFS= read -r cid; do
    [ -z "$cid" ] && continue
    if curl -sSf -X POST "http://${target}/api/v0/pin/add?arg=${cid}" >/dev/null 2>&1; then
      ok=$((ok + 1))
    else
      fail=$((fail + 1))
      echo "  ! pin failed: $cid"
    fi
  done < "$pinset"
  echo "pin results: $ok ok / $fail fail / $total total"
  if [ "$fail" -gt $((total / 20)) ]; then
    red "more than 5% pins failed"; exit 1
  fi
  green "✓ ipfs pinset rebuilt"
}

restore_vault() {
  local snapshot="" target=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --snapshot) snapshot="$2"; shift 2 ;;
      --target)   target="$2"; shift 2 ;;
      *) red "unknown arg: $1"; exit 2 ;;
    esac
  done
  [ -f "$snapshot" ] || { red "snapshot not found: $snapshot"; exit 1; }
  blue "==> restoring vault snapshot to ${target}"
  curl -sk --request POST --header "X-Vault-Token: ${VAULT_TOKEN:-}" \
    --data-binary @"$snapshot" "https://${target}/v1/sys/storage/raft/snapshot" || \
    { red "snapshot upload failed (operator must unseal manually)"; exit 1; }
  green "✓ vault snapshot uploaded; UNSEAL MANUALLY (3-of-5 Shamir quorum)"
}

verify_cross_witness() {
  blue "==> running cross-witness verifier (Postgres ↔ Polygon ↔ Fabric)"
  pnpm exec turbo run --filter=audit-verifier exec -- node dist/cross-witness-cli.js \
    || { red "cross-witness verifier reported divergence"; exit 1; }
  green "✓ all three witnesses agree on every audit row"
}

case "$cmd" in
  restore-postgres)     restore_postgres "$@" ;;
  restore-redis)        restore_redis "$@" ;;
  restore-ipfs)         restore_ipfs "$@" ;;
  restore-vault)        restore_vault "$@" ;;
  verify-cross-witness) verify_cross_witness ;;
  help|*)
    cat <<USAGE
DR rehearsal helper

Usage:
  $0 restore-postgres     --snapshot <path> --target <host:port>
  $0 restore-redis        --rdb <path>      --target <host:port>
  $0 restore-ipfs         --pinset <path>   --target <host:port>
  $0 restore-vault        --snapshot <path> --target <host:port>
  $0 verify-cross-witness
USAGE
    ;;
esac
