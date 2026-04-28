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
log "flipping DNS"
TOKEN="$(cat "${CF_TOKEN_FILE}")"
for record in "vigilapex.cm" "verify.vigilapex.cm" "tip.vigilapex.cm" "kc.vigilapex.cm"; do
  rid="$(curl -fsSL -H "authorization: Bearer ${TOKEN}" \
       "https://api.cloudflare.com/client/v4/zones/${DNS_ZONE_ID}/dns_records?name=${record}" \
       | jq -r .result[0].id)"
  curl -fsSL -X PUT \
       -H "authorization: Bearer ${TOKEN}" \
       -H 'content-type: application/json' \
       -d "{\"type\":\"A\",\"name\":\"${record}\",\"content\":\"${REPLICA_HOST}\",\"ttl\":60,\"proxied\":true}" \
       "https://api.cloudflare.com/client/v4/zones/${DNS_ZONE_ID}/dns_records/${rid}" >/dev/null
  log "flipped ${record} → ${REPLICA_HOST}"
done

# 5. Replica-side: unseal Vault, materialise secrets, start workers.
log "unsealing Vault on replica"
ssh "${REPLICA_HOST}" 'sudo /usr/local/bin/vigil-vault-unseal --auto'
ssh "${REPLICA_HOST}" 'sudo /usr/local/bin/vigil-secret-materialisation'
ssh "${REPLICA_HOST}" 'cd /opt/vigil && docker compose up -d'

# 6. Audit row so the transition is itself part of the chain.
log "appending failover audit row"
ssh "${REPLICA_HOST}" \
  "docker exec -i vigil-postgres psql -U vigil -d vigil -v ON_ERROR_STOP=1" <<SQL
INSERT INTO audit.actions
  (id, seq, action, actor, subject_kind, subject_id, occurred_at, payload, prev_hash, body_hash)
SELECT
  gen_random_uuid(),
  COALESCE((SELECT MAX(seq) FROM audit.actions), 0) + 1,
  'system.failover.activated',
  '${USER}',
  'system',
  'replica:${REPLICA_HOST}',
  NOW(),
  '{"primary":"${PRIMARY_HEALTH}","replica":"${REPLICA_HEALTH}","reason":"primary unreachable >30m"}'::jsonb,
  (SELECT body_hash FROM audit.actions ORDER BY seq DESC LIMIT 1),
  digest(NOW()::text || 'failover', 'sha256');
SQL

log "✓ failover complete; replica is now serving"
log "next steps:"
log "  1. open IR-05 / IR-* playbook for the underlying primary issue"
log "  2. tag this event in docs/decisions/log.md"
log "  3. plan failback before NAS-replica delta exceeds 24 h"
