#!/usr/bin/env bash
# 07-vault-audit-enable.sh — enable the Vault file audit backend after unseal.
# Idempotent: re-running on an already-enabled backend is a no-op (Vault
# returns 400 "path already in use", which we silence specifically).
#
# Per SRD §17.13: every Vault API operation produces a JSON audit record.
# Filebeat tails /vault/logs/audit.log and ships records to Postgres
# `audit.vault_log` for cross-correlation with the hash-chain.
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-https://127.0.0.1:8200}"
VAULT_BIN="${VAULT_BIN:-/usr/local/bin/vault}"
AUDIT_LOG="${AUDIT_LOG:-/vault/logs/audit.log}"
AUDIT_PATH="${AUDIT_PATH:-file}"

if [[ -z "${VAULT_TOKEN:-}" ]]; then
  echo "[fatal] VAULT_TOKEN not set — login as architect before running" >&2
  exit 2
fi

if ! "${VAULT_BIN}" status -address="${VAULT_ADDR}" >/dev/null 2>&1; then
  echo "[fatal] Vault is sealed or unreachable at ${VAULT_ADDR}" >&2
  exit 3
fi

# Already enabled?
if "${VAULT_BIN}" audit list -address="${VAULT_ADDR}" -format=json \
   2>/dev/null | grep -q "\"${AUDIT_PATH}/\""; then
  echo "[ok] audit backend ${AUDIT_PATH}/ already enabled"
  exit 0
fi

# Path inside the vigil-vault container; the host bind-mounts
# /srv/vigil/vault/logs into /vault/logs.
"${VAULT_BIN}" audit enable -address="${VAULT_ADDR}" \
  -path="${AUDIT_PATH}" \
  file file_path="${AUDIT_LOG}"

echo "[ok] Vault audit log enabled at ${AUDIT_LOG}"
