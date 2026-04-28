#!/usr/bin/env bash
# 05-secret-materialisation.sh — provision Vault `secret/vigil/*` paths and
# render the host-side /run/vigil/secrets/* files that docker-compose's
# `secrets:` blocks bind-mount into containers.
#
# Runs as a one-shot architect ceremony (Yubikey-touched) at provisioning
# time, then again on every host boot via the systemd unit
# `vigil-secret-materialisation.service` to keep the tmpfs files current
# after a reboot. Vault MUST already be unsealed (03-vault-shamir-init.sh +
# vigil-vault-unseal.service must have run).
#
# Per SRD §17.5 and W-13 / W-14: secret material lives in tmpfs at
# /run/vigil/secrets, mode 0600 root:root. Containers receive the file via
# Docker secret mounts at /run/secrets/<name> (read-only).
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-https://127.0.0.1:8200}"
SECRET_ROOT="${SECRET_ROOT:-/run/vigil/secrets}"
VAULT_BIN="${VAULT_BIN:-/usr/local/bin/vault}"

if [[ $EUID -ne 0 ]]; then
  echo "[fatal] must run as root (writes to ${SECRET_ROOT})" >&2
  exit 2
fi

if ! "${VAULT_BIN}" status -address="${VAULT_ADDR}" >/dev/null 2>&1; then
  echo "[fatal] Vault is sealed or unreachable at ${VAULT_ADDR}" >&2
  exit 3
fi

# tmpfs mount for secrets — exists from systemd-tmpfiles, but we re-assert.
mkdir -p "${SECRET_ROOT}"
chmod 0700 "${SECRET_ROOT}"
chown root:root "${SECRET_ROOT}"

# Helper: read a Vault secret field and write it to a 0600 file. Bails with
# a clear error if the path is missing — never leaves a half-populated file.
materialise() {
  local vault_path="$1"   # e.g. secret/vigil/postgres
  local vault_field="$2"  # e.g. password
  local out_file="$3"     # e.g. /run/vigil/secrets/pg_password

  local value
  if ! value="$("${VAULT_BIN}" kv get -address="${VAULT_ADDR}" \
                  -field="${vault_field}" "${vault_path}" 2>/dev/null)"; then
    echo "[fatal] Vault path missing: ${vault_path}#${vault_field}" >&2
    exit 4
  fi

  local tmp
  tmp="$(mktemp -p "${SECRET_ROOT}" .stage.XXXXXX)"
  printf '%s' "${value}" > "${tmp}"
  chmod 0600 "${tmp}"
  chown root:root "${tmp}"
  mv -f "${tmp}" "${out_file}"
}

# Map: every Docker secret declared in infra/docker/docker-compose.yaml
# must appear here. Unlisted entries are intentional — failure is louder
# than a silent missing file.
materialise secret/vigil/postgres                password    "${SECRET_ROOT}/pg_password"
materialise secret/vigil/redis                   password    "${SECRET_ROOT}/redis_password"
materialise secret/vigil/neo4j                   password    "${SECRET_ROOT}/neo4j_password"
materialise secret/vigil/keycloak                admin       "${SECRET_ROOT}/keycloak_admin"
materialise secret/vigil/anthropic               api_key     "${SECRET_ROOT}/anthropic_api_key"
materialise secret/vigil/sentinelhub             client_id   "${SECRET_ROOT}/sentinelhub_client_id"
materialise secret/vigil/sentinelhub             client_sec  "${SECRET_ROOT}/sentinelhub_client_secret"
materialise secret/vigil/turnstile               secret_key  "${SECRET_ROOT}/turnstile_secret_key"
materialise secret/vigil/conac-sftp              private_key "${SECRET_ROOT}/conac_sftp_privkey"

# Phase G5 — Hyperledger Fabric MSP material. Org1 only at Phase-2-prep;
# CONAC + Cour des Comptes paths added at Phase-2-entry enrolment.
materialise secret/vigil/fabric/org1/tls_root    pem  "${SECRET_ROOT}/fabric_tls_root"
materialise secret/vigil/fabric/org1/client_cert pem  "${SECRET_ROOT}/fabric_client_cert"
materialise secret/vigil/fabric/org1/client_key  pem  "${SECRET_ROOT}/fabric_client_key"

# Per-worker Vault tokens — one short-lived AppRole-derived token each.
# `vault token create` is invoked separately by 06-vault-policies.sh; this
# script consumes the result.
materialise secret/vigil/vault-tokens/worker     token "${SECRET_ROOT}/vault_token_worker"
materialise secret/vigil/vault-tokens/dashboard  token "${SECRET_ROOT}/vault_token_dashboard"
materialise secret/vigil/vault-tokens/minfi-api  token "${SECRET_ROOT}/vault_token_minfi_api"

echo "[ok] /run/vigil/secrets materialised ($(ls -1 "${SECRET_ROOT}" | wc -l) files)"
