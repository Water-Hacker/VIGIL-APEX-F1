# VIGIL APEX Vault config — file backend with encrypted-at-rest at the host filesystem.
# Per SRD §17.6.

storage "file" {
  path = "/vault/file"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = "true"   # mTLS terminated at the app layer; internal Docker network only
}

api_addr     = "http://vigil-vault:8200"
cluster_addr = "http://vigil-vault:8201"

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
