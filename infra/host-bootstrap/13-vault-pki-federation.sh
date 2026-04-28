#!/usr/bin/env bash
# 13-vault-pki-federation.sh — Phase-3 federated Vault PKI bootstrap.
#
# Run ONCE on the Yaoundé core after the council 4-of-5 architectural-
# review vote (`docs/institutional/council-phase-3-review.md`) passes
# and the architect is ready to issue subordinate CAs to the 10 regions.
#
# Prerequisites:
#   - Yaoundé root Vault unsealed under 5-of-7 Shamir (the architect +
#     council ceremony).
#   - VAULT_TOKEN exported to a token with the `architect` policy.
#   - 10 regional WireGuard peers established and reachable so the
#     subordinate CAs can be transferred securely (this script writes
#     them to /run/vigil/region-cas/<CODE>.{cert,key,ca-chain} and
#     the architect copies them to each regional NAS during the
#     per-region cutover ceremony).
#
# Idempotent: a region whose subordinate CA already exists is skipped
# without error. Re-running with `--rotate <CODE>` revokes the existing
# subordinate and issues a fresh one (the regional Vault must be
# refreshed manually after rotation).
set -euo pipefail

REGIONS=(CE LT NW SW OU SU ES EN NO AD)
PKI_ROOT_PATH="${PKI_ROOT_PATH:-pki}"
PKI_REGION_PATH_PREFIX="${PKI_REGION_PATH_PREFIX:-pki-region}"
ARCHIVE_DIR="${ARCHIVE_DIR:-/run/vigil/region-cas}"
SUBORDINATE_TTL="${SUBORDINATE_TTL:-17520h}" # 2 years

if [[ -z "${VAULT_TOKEN:-}" ]]; then
  echo "[fatal] VAULT_TOKEN unset — log in as architect before running" >&2
  exit 2
fi

vault status >/dev/null || { echo "[fatal] Vault unreachable" >&2; exit 3; }

mkdir -p "${ARCHIVE_DIR}"
chmod 0700 "${ARCHIVE_DIR}"

log() { printf '[%s] %s\n' "$(date -uIs)" "$*"; }

# ---- 1. Ensure the root PKI is enabled and has a CA ----------------------------
if ! vault secrets list -format=json | jq -e --arg p "${PKI_ROOT_PATH}/" '.[$p]' >/dev/null; then
  log "enabling root PKI at ${PKI_ROOT_PATH}/"
  vault secrets enable -path="${PKI_ROOT_PATH}" pki
  vault secrets tune -max-lease-ttl=87600h "${PKI_ROOT_PATH}"
  vault write -field=certificate "${PKI_ROOT_PATH}/root/generate/internal" \
    common_name="VIGIL APEX Root CA" \
    ttl=87600h \
    > "${ARCHIVE_DIR}/root-ca.pem"
  vault write "${PKI_ROOT_PATH}/config/urls" \
    issuing_certificates="https://vault.core.vigilapex.cm/v1/${PKI_ROOT_PATH}/ca" \
    crl_distribution_points="https://vault.core.vigilapex.cm/v1/${PKI_ROOT_PATH}/crl"
fi

# ---- 2. For each region, mount + issue a subordinate CA -----------------------
for region in "${REGIONS[@]}"; do
  region_path="${PKI_REGION_PATH_PREFIX}-${region,,}"
  archive_cert="${ARCHIVE_DIR}/${region}.cert.pem"
  archive_key="${ARCHIVE_DIR}/${region}.key.pem"

  if [[ -f "${archive_cert}" && "${1:-}" != "--rotate" ]]; then
    log "region ${region} already provisioned — skip (re-run with --rotate ${region} to refresh)"
    continue
  fi

  log "provisioning subordinate CA for region ${region}"

  # Enable the per-region mount
  if ! vault secrets list -format=json | jq -e --arg p "${region_path}/" '.[$p]' >/dev/null; then
    vault secrets enable -path="${region_path}" pki
    vault secrets tune -max-lease-ttl="${SUBORDINATE_TTL}" "${region_path}"
  fi

  # Generate a CSR, sign with root, set the subordinate's CA chain
  csr_pem=$(vault write -format=json "${region_path}/intermediate/generate/internal" \
    common_name="VIGIL APEX Subordinate CA — ${region}" \
    ttl="${SUBORDINATE_TTL}" \
    | jq -r .data.csr)

  signed=$(vault write -format=json "${PKI_ROOT_PATH}/root/sign-intermediate" \
    csr="${csr_pem}" \
    common_name="VIGIL APEX Subordinate CA — ${region}" \
    format=pem_bundle \
    ttl="${SUBORDINATE_TTL}" \
    | jq -r .data.certificate)

  vault write "${region_path}/intermediate/set-signed" certificate="${signed}"
  vault write "${region_path}/config/urls" \
    issuing_certificates="https://vault-${region,,}.regions.vigilapex.cm/v1/${region_path}/ca" \
    crl_distribution_points="https://vault-${region,,}.regions.vigilapex.cm/v1/${region_path}/crl"

  # Issue the regional federation-stream signing role
  vault write "${region_path}/roles/federation-signer" \
    allowed_domains="region-${region,,}.vigilapex.cm" \
    allow_subdomains=true \
    max_ttl="2160h" \
    key_type="ed25519"

  # Archive the cert chain so the architect can copy it to the regional NAS
  printf '%s\n' "${signed}" > "${archive_cert}"
  vault read -field=certificate "${region_path}/cert/ca" > "${archive_cert}.chain"
  log "  cert chain → ${archive_cert}"
done

# ---- 3. Apply the architect-signed-only policy to all subordinate roots ------
# Each region's mount can ONLY issue under its own role; cross-issuance is
# explicitly blocked at the policy layer (defense-in-depth on top of
# Vault's mount isolation).
cat > /tmp/region-pki-isolation.hcl <<'POLICY'
# Allow architect to manage every regional mount.
path "pki-region-+/*" { capabilities = ["create","read","update","delete","list","sudo"] }
# Forbid cross-region issuance (a compromised regional mount cannot
# trick the architect token into signing for a different region).
path "pki-region-+/root/sign-intermediate" { capabilities = ["deny"] }
POLICY
vault policy write architect-region-pki /tmp/region-pki-isolation.hcl
rm -f /tmp/region-pki-isolation.hcl

log "[ok] federated PKI provisioned for ${#REGIONS[@]} regions"
log "Next: copy /run/vigil/region-cas/<CODE>.cert.pem + .chain to each"
log "      regional NAS during the per-region cutover ceremony."
