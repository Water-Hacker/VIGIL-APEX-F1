# VIGIL APEX Vault config — Raft integrated storage for 3-node HA cluster.
# DL380 Gen11 migration plan, §"Replication / quorum rules".
# Per SRD §17.6.
#
# The Raft backend gives us:
#   - 3-voter consensus (tolerates loss of any 1 node)
#   - No external dependency (no Consul, no etcd)
#   - Built-in snapshot/restore via `vault operator raft snapshot`
#
# Auto-unseal via Vault Transit on the Hetzner CPX31 (N02, Falkenstein DE)
# so a 3-node power cycle does not require a 5-of-5 Shamir ceremony at every
# boot. Initial provisioning still uses Shamir; rotation is annual.
#
# The VAULT_NODE_ID + VAULT_NODE_HOSTNAME env vars are set per-node by the
# k3s StatefulSet (or by infra/host-bootstrap/05-secret-materialisation.sh
# when running docker-compose). Retry-join entries point at the other two
# nodes so any node can rejoin the cluster on restart.

storage "raft" {
  path    = "/vault/file"
  node_id = "VAULT_NODE_ID"

  # Phase-1 (3-node HA): retry-join points at all 3 nodes. Each node skips its
  # own entry at runtime (Vault tolerates self-references in retry_join).
  retry_join {
    leader_api_addr = "https://vigil-vault-a:8200"
    leader_ca_cert_file = "/vault/tls/ca.crt"
  }
  retry_join {
    leader_api_addr = "https://vigil-vault-b:8200"
    leader_ca_cert_file = "/vault/tls/ca.crt"
  }
  retry_join {
    leader_api_addr = "https://vigil-vault-c:8200"
    leader_ca_cert_file = "/vault/tls/ca.crt"
  }

  # Performance multiplier: 5 is the default; cluster operators on commodity
  # hardware should tune to 1-2 only after measuring (lower values reduce
  # tolerance for slow disks / network).
  performance_multiplier = 5
}

# Transit auto-unseal — the unsealing key lives on the Hetzner N02 Vault
# instance (different jurisdiction, different operator, different power
# grid). N02 itself unseals via Shamir (the architect performs the ceremony
# quarterly). VAULT_TRANSIT_TOKEN is projected from the host's
# /run/vigil/secrets/vault_transit_token (initialised by the host-bootstrap
# script).
seal "transit" {
  address            = "https://n02.vigilapex.cm:8200"
  token              = "VAULT_TRANSIT_TOKEN"
  disable_renewal    = "false"
  key_name           = "vigil-unseal"
  mount_path         = "transit/"
  tls_ca_cert        = "/vault/tls/n02-ca.crt"
  # `tls_skip_verify` MUST remain false in production. The n02-ca.crt is the
  # architect-issued root that signed Hetzner N02's server cert.
  tls_skip_verify    = "false"
}

listener "tcp" {
  address       = "0.0.0.0:8200"
  cluster_address = "0.0.0.0:8201"
  # TLS terminated at the Vault listener now (Raft cluster traffic between
  # nodes traverses the 25 GbE LACP interconnect; mTLS-at-app-layer is no
  # longer sufficient because Raft itself is a separate protocol).
  tls_disable                = "false"
  tls_cert_file              = "/vault/tls/server.crt"
  tls_key_file               = "/vault/tls/server.key"
  tls_client_ca_file         = "/vault/tls/ca.crt"
  tls_require_and_verify_client_cert = "true"
  tls_min_version            = "tls13"
}

api_addr     = "https://VAULT_NODE_HOSTNAME:8200"
cluster_addr = "https://VAULT_NODE_HOSTNAME:8201"

ui = false
disable_mlock = false
log_level = "info"
log_format = "json"

# Audit log shipped to Postgres via Filebeat (defence in depth, SRD §17.13).
# The bootstrap script 07-vault-audit-enable.sh runs after unseal and
# enables the file backend at /vault/logs/audit.log; rotation is handled
# by logrotate on the host. Audit directives can NOT live in config.hcl —
# Vault rejects them; they must be issued via the API after unseal.
raw_storage_endpoint = false
