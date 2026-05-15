#!/usr/bin/env bash
# 14-patroni-init.sh — bootstrap the Patroni Postgres HA cluster across the
# 3-node DL380 Gen11 cluster. Phase 5 of the cluster migration plan.
#
# Patroni is the leader-election + auto-failover wrapper around Postgres.
# It uses etcd as its distributed configuration store (DCS). The etcd
# ensemble runs as a sibling cluster on the same 3 nodes (separate from the
# embedded k3s etcd) — Patroni-only DCS, port 2379 cluster-local.
#
# Topology:
#   Node A: Patroni-A + etcd-A + Postgres-A (initially primary)
#   Node B: Patroni-B + etcd-B + Postgres-B (sync standby)
#   Node C: Patroni-C + etcd-C + Postgres-C (sync standby)
#
# Idempotent. Re-runs simply re-assert the configuration. Initial cluster
# bootstrap (creating /var/lib/postgresql/14) only happens once per node;
# subsequent runs update Patroni configuration and reload.
#
# Required env (defaults if unset):
#   NODE_NAME       — vigil_postgres_a | vigil_postgres_b | vigil_postgres_c
#   NODE_IP         — this node's interconnect IP (10.50.0.{1,2,3})
#   ETCD_PEERS      — comma-separated list of etcd peer URLs
#   CLUSTER_NAME    — defaults to 'vigil-postgres-ha'
#   POSTGRES_VERSION— defaults to 16
#
# Per-node identity is materialised from env vars set in
# /etc/vigil/cluster-node.env (one file per host, populated during
# infra/host-bootstrap/01-system-prep.sh).
#
# Smoke test after bootstrap: `patronictl -c /etc/patroni/patroni.yml list`
# should show 1 Leader + 2 Sync standbys within 60s of the third node
# joining.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "[fatal] must run as root" >&2
  exit 2
fi

# Load per-node identity. /etc/vigil/cluster-node.env is the canonical
# source — it's set during system prep and never edited by hand.
if [[ -r /etc/vigil/cluster-node.env ]]; then
  # shellcheck disable=SC1091
  source /etc/vigil/cluster-node.env
fi

NODE_NAME="${NODE_NAME:?NODE_NAME required — set in /etc/vigil/cluster-node.env}"
NODE_IP="${NODE_IP:?NODE_IP required — set in /etc/vigil/cluster-node.env}"
ETCD_PEERS="${ETCD_PEERS:?ETCD_PEERS required (comma-separated http URLs on :2379)}"
CLUSTER_NAME="${CLUSTER_NAME:-vigil-postgres-ha}"
POSTGRES_VERSION="${POSTGRES_VERSION:-16}"
PATRONI_RESTAPI_PORT="${PATRONI_RESTAPI_PORT:-8008}"

log()  { printf '[patroni-init] %s\n' "$*"; }
fail() { printf '[patroni-init][FATAL] %s\n' "$*" >&2; exit 1; }

# ──────────────────────────────────────────────────────────────────────────
# 1. Install prerequisites (idempotent)
# ──────────────────────────────────────────────────────────────────────────
log "installing patroni + etcd-client + postgres-${POSTGRES_VERSION} packages"
DEBIAN_FRONTEND=noninteractive apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  postgresql-"${POSTGRES_VERSION}" \
  postgresql-contrib-"${POSTGRES_VERSION}" \
  postgresql-"${POSTGRES_VERSION}"-pgvector \
  patroni \
  etcd-client \
  python3-psycopg2 \
  python3-etcd3

# Disable the upstream postgresql.service — Patroni manages it instead.
systemctl disable --now postgresql || true

# ──────────────────────────────────────────────────────────────────────────
# 2. Read Postgres replication password from Vault (already materialised
#    by 05-secret-materialisation.sh into /run/vigil/secrets/).
# ──────────────────────────────────────────────────────────────────────────
PG_SUPERUSER_PW_FILE="/run/vigil/secrets/postgres_superuser_password"
PG_REPL_PW_FILE="/run/vigil/secrets/postgres_replication_password"
[[ -r "${PG_SUPERUSER_PW_FILE}" ]] || fail "missing ${PG_SUPERUSER_PW_FILE}"
[[ -r "${PG_REPL_PW_FILE}" ]] || fail "missing ${PG_REPL_PW_FILE}"
PG_SUPERUSER_PW="$(< "${PG_SUPERUSER_PW_FILE}")"
PG_REPL_PW="$(< "${PG_REPL_PW_FILE}")"

# ──────────────────────────────────────────────────────────────────────────
# 3. Render /etc/patroni/patroni.yml
#
# Patroni schema is documented at https://patroni.readthedocs.io.
# Notable choices:
#   - DCS: etcd3 (modern API). 3-peer ensemble runs alongside Patroni.
#   - synchronous_mode: enables sync replication; one of two standbys must
#     ACK before the primary considers a commit durable.
#   - synchronous_node_count: 1 — ANY 1 of 2 must ack (matches the
#     synchronous_standby_names directive in postgresql.conf).
#   - maximum_lag_on_failover: 16 MB — never promote a standby that's more
#     than 16 MB of WAL behind. Prevents data loss windows.
#   - master_start_timeout: 30s — fail over within 30s of primary outage.
# ──────────────────────────────────────────────────────────────────────────
install -d -m 0750 -o postgres -g postgres /etc/patroni /var/lib/patroni

cat >/etc/patroni/patroni.yml <<EOF
scope: ${CLUSTER_NAME}
namespace: /vigil/
name: ${NODE_NAME}

restapi:
  listen: 0.0.0.0:${PATRONI_RESTAPI_PORT}
  connect_address: ${NODE_IP}:${PATRONI_RESTAPI_PORT}

etcd3:
  hosts: ${ETCD_PEERS}
  protocol: http

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 16777216
    master_start_timeout: 30
    synchronous_mode: true
    synchronous_node_count: 1
    postgresql:
      use_pg_rewind: true
      use_slots: true
      parameters:
        # These mirror infra/docker/postgres/postgresql.conf — Patroni
        # writes them into postgresql.conf on every node so the cluster is
        # self-consistent even if someone edits one node by hand.
        wal_level: replica
        max_wal_senders: 10
        max_replication_slots: 10
        wal_keep_size: 8GB
        wal_compression: lz4
        hot_standby: 'on'
        hot_standby_feedback: 'on'
        archive_mode: 'on'
        archive_command: 'test ! -f /var/lib/postgresql/wal-archive/%f && cp %p /var/lib/postgresql/wal-archive/%f'
        checkpoint_timeout: '10min'
        checkpoint_completion_target: 0.9
        password_encryption: scram-sha-256
        synchronous_commit: 'on'
        synchronous_standby_names: 'ANY 1 (vigil_postgres_b, vigil_postgres_c)'

  initdb:
    - encoding: UTF8
    - data-checksums

  pg_hba:
    - host  replication replicator    10.50.0.0/24      scram-sha-256
    - host  all         all           10.50.0.0/24      scram-sha-256
    - host  all         all           172.20.0.0/16     scram-sha-256
    - local all         postgres                        trust

  users:
    admin:
      password: ${PG_SUPERUSER_PW}
      options:
        - createrole
        - createdb

postgresql:
  listen: 0.0.0.0:5432
  connect_address: ${NODE_IP}:5432
  data_dir: /var/lib/postgresql/${POSTGRES_VERSION}/main
  bin_dir: /usr/lib/postgresql/${POSTGRES_VERSION}/bin
  pgpass: /tmp/pgpass-${NODE_NAME}
  authentication:
    replication:
      username: replicator
      password: ${PG_REPL_PW}
    superuser:
      username: postgres
      password: ${PG_SUPERUSER_PW}
  parameters:
    unix_socket_directories: '/var/run/postgresql'

tags:
  nofailover: false
  noloadbalance: false
  clonefrom: false
  nosync: false
EOF
chmod 0640 /etc/patroni/patroni.yml
chown root:postgres /etc/patroni/patroni.yml

# ──────────────────────────────────────────────────────────────────────────
# 4. systemd unit (Patroni doesn't ship one on Ubuntu).
# ──────────────────────────────────────────────────────────────────────────
cat >/etc/systemd/system/patroni.service <<'UNIT'
[Unit]
Description=Patroni — VIGIL APEX Postgres HA orchestrator
After=etcd.service syslog.target network.target
Wants=etcd.service

[Service]
Type=simple
User=postgres
Group=postgres
ExecStart=/usr/bin/patroni /etc/patroni/patroni.yml
KillMode=process
Restart=on-failure
RestartSec=10
TimeoutSec=30
LimitNOFILE=131072
StandardOutput=journal
StandardError=journal
SyslogIdentifier=patroni

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable patroni.service

# ──────────────────────────────────────────────────────────────────────────
# 5. Start Patroni — it brings Postgres up.
#    The FIRST node to start initdb's the cluster; subsequent nodes
#    pg_basebackup from the current leader.
# ──────────────────────────────────────────────────────────────────────────
systemctl start patroni.service

# Wait for the REST API to respond.
log "waiting for Patroni REST API on :${PATRONI_RESTAPI_PORT}"
for _ in $(seq 1 60); do
  if curl -fsSL --max-time 3 "http://${NODE_IP}:${PATRONI_RESTAPI_PORT}/health" >/dev/null 2>&1; then
    log "patroni REST API is up"
    break
  fi
  sleep 2
done

# ──────────────────────────────────────────────────────────────────────────
# 6. Verification
# ──────────────────────────────────────────────────────────────────────────
log "cluster state:"
patronictl -c /etc/patroni/patroni.yml list || true

log "patroni init complete on node ${NODE_NAME} (${NODE_IP})"
log "next steps:"
log "  - on all 3 nodes run this script; the first to start becomes Leader"
log "  - verify with: patronictl -c /etc/patroni/patroni.yml list"
log "  - smoke-test failover: patronictl -c /etc/patroni/patroni.yml failover"
