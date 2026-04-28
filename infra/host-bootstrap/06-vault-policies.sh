#!/usr/bin/env bash
# 06-vault-policies.sh — apply HCL policy files at infra/vault-policies/
# and (re)mint AppRole credentials for each non-architect role.
#
# Idempotent: re-running rewrites the policies and rotates worker tokens.
# Run as the architect (Vault root token) after Shamir unseal. The output
# token files land at /run/vigil/secrets/vault_token_<role> with mode
# 0600 — these are the tokens 05-secret-materialisation.sh references.
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-https://127.0.0.1:8200}"
VAULT_BIN="${VAULT_BIN:-/usr/local/bin/vault}"
POLICY_DIR="${POLICY_DIR:-$(dirname "$0")/../vault-policies}"
SECRET_ROOT="${SECRET_ROOT:-/run/vigil/secrets}"

if [[ -z "${VAULT_TOKEN:-}" ]]; then
  echo "[fatal] VAULT_TOKEN not set — login as architect before running" >&2
  exit 2
fi

if ! "${VAULT_BIN}" status -address="${VAULT_ADDR}" >/dev/null 2>&1; then
  echo "[fatal] Vault is sealed or unreachable at ${VAULT_ADDR}" >&2
  exit 3
fi

# Apply every .hcl file as a policy named after the file.
for hcl in "${POLICY_DIR}"/*.hcl; do
  [[ -f "${hcl}" ]] || continue
  name="$(basename "${hcl}" .hcl)"
  echo "[apply] policy ${name}"
  "${VAULT_BIN}" policy write -address="${VAULT_ADDR}" "${name}" "${hcl}"
done

# Enable AppRole if not already enabled (idempotent — Vault returns 400
# on duplicate enable; we swallow that case only).
if ! "${VAULT_BIN}" auth list -address="${VAULT_ADDR}" -format=json \
     | grep -q '"approle/"'; then
  "${VAULT_BIN}" auth enable -address="${VAULT_ADDR}" approle
fi

# Mint short-lived tokens for the three non-architect roles. TTL 24h
# with renewal up to 30d — re-rotated by the F10 quarterly key timer
# or any time this script is re-run.
mint_token() {
  local role="$1"
  local policy="$1"
  local out_file="${SECRET_ROOT}/vault_token_${role//-/_}"
  local token
  token="$("${VAULT_BIN}" token create \
              -address="${VAULT_ADDR}" \
              -policy="${policy}" \
              -ttl=24h \
              -explicit-max-ttl=720h \
              -renewable=true \
              -display-name="vigil-${role}" \
              -format=json | jq -r .auth.client_token)"
  if [[ -z "${token}" || "${token}" == "null" ]]; then
    echo "[fatal] empty token for role ${role}" >&2
    exit 4
  fi
  install -m 0600 -o root -g root /dev/null "${out_file}"
  printf '%s' "${token}" > "${out_file}"
  echo "[mint] ${role} -> ${out_file}"
}

mint_token worker
mint_token dashboard
mint_token minfi-api

echo "[ok] policies applied and tokens minted ($(ls -1 "${SECRET_ROOT}"/vault_token_* | wc -l))"
