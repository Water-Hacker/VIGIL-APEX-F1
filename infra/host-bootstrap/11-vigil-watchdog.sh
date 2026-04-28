#!/usr/bin/env bash
# 11-vigil-watchdog.sh — install /usr/local/bin/vigil-watchdog and the
# systemd timer that runs it every 5 minutes.
#
# Phase F2 — health-probe sweep that records a row in audit.actions
# every cycle so the operator dashboard can prove the watchdog itself
# is alive (a silent watchdog is worse than no watchdog).
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "[fatal] must run as root" >&2
  exit 2
fi

install -m 0755 -o root -g root /dev/stdin /usr/local/bin/vigil-watchdog <<'WD_EOF'
#!/usr/bin/env bash
# vigil-watchdog — sweep core service health and write an audit row.
set -euo pipefail

PROBE_TARGETS=(
  "vigil-postgres:5432"
  "vigil-redis:6379"
  "vigil-neo4j:7474"
  "vigil-ipfs:5001"
  "vigil-vault:8200"
  "vigil-keycloak:8080"
  "vigil-caddy:80"
)

results=()
all_ok=1
for t in "${PROBE_TARGETS[@]}"; do
  host="${t%%:*}"; port="${t##*:}"
  if docker exec vigil-prometheus sh -c "nc -zw3 ${host} ${port}" >/dev/null 2>&1; then
    results+=("\"${host}\":\"ok\"")
  else
    results+=("\"${host}\":\"down\"")
    all_ok=0
  fi
done

# Write a watchdog event to audit.actions via psql. The audit-immutability
# trigger ensures these can never be deleted.
docker exec -i vigil-postgres psql -U vigil -d vigil -v ON_ERROR_STOP=1 <<SQL
INSERT INTO audit.actions
  (id, seq, action, actor, subject_kind, subject_id, occurred_at, payload, prev_hash, body_hash)
SELECT
  gen_random_uuid(),
  COALESCE((SELECT MAX(seq) FROM audit.actions), 0) + 1,
  'health.watchdog',
  'vigil-watchdog',
  'system',
  'host',
  NOW(),
  '{$(IFS=,; echo "${results[*]}")}'::jsonb,
  (SELECT body_hash FROM audit.actions ORDER BY seq DESC LIMIT 1),
  digest(NOW()::text || '${all_ok}', 'sha256');
SQL

if [[ ${all_ok} -eq 0 ]]; then
  exit 1
fi
WD_EOF

install -m 0644 /dev/stdin /etc/systemd/system/vigil-watchdog.service <<'UNIT_EOF'
[Unit]
Description=VIGIL APEX 5-minute service-health sweep
Wants=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/vigil-watchdog
StandardOutput=journal
StandardError=journal
UNIT_EOF

install -m 0644 /dev/stdin /etc/systemd/system/vigil-watchdog.timer <<'TIMER_EOF'
[Unit]
Description=VIGIL watchdog every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s

[Install]
WantedBy=timers.target
TIMER_EOF

systemctl daemon-reload
systemctl enable --now vigil-watchdog.timer
echo "[ok] vigil-watchdog installed; timer enabled"
