#!/usr/bin/env bash
# 12-failover-to-replica.sh — Phase F11. Hot-fail VIGIL APEX from the
# primary node (Cameroun) to the Hetzner DC replica when the primary is
# unreachable for > 30 min. This is invoked manually by the architect or
# (per IR-05 architect-incapacitated) by the backup architect.
#
# Idempotent — re-runs simply re-assert the new state.
#
# Steps:
#   1. Confirm primary down + replica healthy
#   2. Promote NAS replica (Synology Hyper Backup)
#   3. DNS alias flip via Cloudflare API
#   4. Vault re-unseal at the replica site
#   5. Resume worker stack at replica
#   6. Anchor a "failover" audit row so the chain reflects the cutover
set -euo pipefail

PRIMARY_HEALTH="${PRIMARY_HEALTH_URL:-https://vigilapex.cm/api/health}"
REPLICA_HEALTH="${REPLICA_HEALTH_URL:-https://replica.vigilapex.cm/api/health}"
DNS_ZONE_ID="${CLOUDFLARE_ZONE_ID:?CLOUDFLARE_ZONE_ID required}"
CF_TOKEN_FILE="${CF_TOKEN_FILE:-/run/vigil/secrets/cloudflare_token}"
NAS_HOST="${NAS_HOST:-synology.vigilapex.cm}"
REPLICA_HOST="${REPLICA_HOST:-replica.vigilapex.cm}"

log() { printf '[failover] %s\n' "$*"; }
fail() { printf '[failover][FATAL] %s\n' "$*" >&2; exit 1; }

# Tier-22 audit closure: validate hostname-shaped env vars before they
# reach `ssh` / SQL / DNS records. A REPLICA_HOST containing shell
# metacharacters or SQL fragments would otherwise propagate into the
# heredoc-interpolated INSERT below (pre-fix this was a clean SQLi
# vector for any operator who could set environment variables).
is_dns_hostname() {
  # RFC1123-ish: labels of 1..63 LDH chars, joined by dots, total <=253.
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$ ]] \
    && [[ ${#1} -le 253 ]]
}
for var in NAS_HOST REPLICA_HOST; do
  val="${!var}"
  if ! is_dns_hostname "${val}"; then
    fail "refusing to proceed — ${var}=${val} is not a valid DNS hostname"
  fi
done

# 1. Confirm primary is genuinely down (avoid split-brain).
log "checking primary at ${PRIMARY_HEALTH}"
if curl -fsSL --max-time 30 "${PRIMARY_HEALTH}" >/dev/null 2>&1; then
  fail "primary is responding — refuse to fail over (split-brain risk)"
fi
log "✓ primary unreachable"

# 2. Replica must be ready to take traffic.
log "checking replica at ${REPLICA_HEALTH}"
curl -fsSL --max-time 30 "${REPLICA_HEALTH}" >/dev/null \
  || fail "replica also unreachable — escalate to RESTORE.md instead"
log "✓ replica healthy"

# 3. Promote the NAS replica's most recent archive so the replica's
#    `/srv/vigil` is at most 24 h stale.
log "promoting NAS replica"
ssh "${NAS_HOST}" "/usr/local/bin/nas-replica-promote --target=${REPLICA_HOST}"

# 4. Cloudflare DNS — point vigilapex.cm + sub-zones to the replica IP.
#
# Tier-22 audit closure: pre-fix the CF token appeared in the curl
# argv (`-H "authorization: Bearer ${TOKEN}"`) so any sidecar with
# `/proc/<pid>/cmdline` read access could harvest it. curl's `-K -`
# reads its options from stdin (which is NOT in /proc/cmdline), so
# the token never enters a process arglist. The token is stored
# in a here-document piped to each curl invocation.
log "flipping DNS"
if [[ ! -r "${CF_TOKEN_FILE}" ]]; then
  fail "Cloudflare token file unreadable: ${CF_TOKEN_FILE}"
fi
TOKEN="$(cat "${CF_TOKEN_FILE}")"

# Helper that emits the curl config-file fragment with the bearer
# header so callers never need to embed the token in argv.
cf_curl() {
  curl -fsSL -K - "$@" <<EOF
header = "authorization: Bearer ${TOKEN}"
EOF
}

for record in "vigilapex.cm" "verify.vigilapex.cm" "tip.vigilapex.cm" "kc.vigilapex.cm"; do
  if ! is_dns_hostname "${record}"; then
    fail "invalid DNS record name: ${record}"
  fi
  rid="$(cf_curl \
       "https://api.cloudflare.com/client/v4/zones/${DNS_ZONE_ID}/dns_records?name=${record}" \
       | jq -r .result[0].id)"
  cf_curl -X PUT \
       -H 'content-type: application/json' \
       -d "$(jq -nc \
              --arg name "${record}" --arg content "${REPLICA_HOST}" \
              '{type:"A", name:$name, content:$content, ttl:60, proxied:true}')" \
       "https://api.cloudflare.com/client/v4/zones/${DNS_ZONE_ID}/dns_records/${rid}" >/dev/null
  log "flipped ${record} → ${REPLICA_HOST}"
done

# 5. Replica-side: unseal Vault, materialise secrets, start workers.
log "unsealing Vault on replica"
ssh "${REPLICA_HOST}" 'sudo /usr/local/bin/vigil-vault-unseal --auto'
ssh "${REPLICA_HOST}" 'sudo /usr/local/bin/vigil-secret-materialisation'
ssh "${REPLICA_HOST}" 'cd /opt/vigil && docker compose up -d'

# 6. Audit row so the transition is itself part of the chain.
#
# Tier-22 audit closure: the pre-fix path interpolated `${USER}` and
# `${REPLICA_HOST}` directly into the SQL heredoc (clean SQLi if any
# operator could shell those env vars), AND emitted
# `digest(NOW()::text || 'failover', 'sha256')` as the row's body_hash —
# which does NOT match the canonical |-delimited form that the
# HashChain primitive in packages/audit-chain/src/canonical.ts produces.
# A row with a non-canonical body_hash poisons the chain: the very
# next legitimate `chain.append()` reads the broken row's body_hash
# as its `prev_hash`, propagating the corruption. `verify()` (T20)
# would throw HashChainBrokenError on the next sweep.
#
# Two fixes:
#   1. Use psql `-v` parameters (NOT heredoc interpolation) so the
#      env-var values are SQL-quoted by psql, not by bash.
#   2. Refuse to write the audit row unless `--canonical-hash-broken`
#      is explicitly passed. The architect must replumb this step
#      through a HashChain-aware CLI (planned: tools/vigil-audit-cli)
#      before the chain is trustworthy again post-failover.
log "appending failover audit row"
if [[ "${1:-}" != "--canonical-hash-broken" ]]; then
  log "WARNING — failover audit-row write is gated."
  log "         pre-T22 the SQL emitted a non-canonical body_hash that"
  log "         poisons the hash chain. The proper path is to replumb"
  log "         this step through tools/vigil-audit-cli (not yet built)."
  log "         To proceed anyway and accept the chain break, re-run"
  log "         with --canonical-hash-broken as the first arg. The"
  log "         resulting row WILL trip the cross-witness verifier"
  log "         (apps/audit-verifier) and require operator-side"
  log "         hash-chain repair via the planned canonical-v2"
  log "         migration."
  log "skipping audit-row write"
else
  log "WARNING: writing failover audit row with non-canonical body_hash (chain break)"
  ssh "${REPLICA_HOST}" \
    "docker exec -i vigil-postgres psql -U vigil -d vigil -v ON_ERROR_STOP=1 \
       -v actor=$(printf %q "${USER}") \
       -v subject_id=$(printf %q "replica:${REPLICA_HOST}") \
       -v primary_url=$(printf %q "${PRIMARY_HEALTH}") \
       -v replica_url=$(printf %q "${REPLICA_HEALTH}")" <<'SQL'
INSERT INTO audit.actions
  (id, seq, action, actor, subject_kind, subject_id, occurred_at, payload, prev_hash, body_hash)
SELECT
  gen_random_uuid(),
  COALESCE((SELECT MAX(seq) FROM audit.actions), 0) + 1,
  'system.failover.activated',
  :'actor',
  'system',
  :'subject_id',
  NOW(),
  jsonb_build_object('primary', :'primary_url', 'replica', :'replica_url',
                     'reason', 'primary unreachable >30m'),
  (SELECT body_hash FROM audit.actions ORDER BY seq DESC LIMIT 1),
  digest(NOW()::text || 'failover', 'sha256');
SQL
fi

log "✓ failover complete; replica is now serving"
log "next steps:"
log "  1. open IR-05 / IR-* playbook for the underlying primary issue"
log "  2. tag this event in docs/decisions/log.md"
log "  3. plan failback before NAS-replica delta exceeds 24 h"
