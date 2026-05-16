#!/usr/bin/env bash
# vigil-vault-unseal — unseal Vault using age-encrypted Shamir shares.
# Phase F4. Each architect/council member's share is encrypted with
# `age-plugin-yubikey` to a recipient bound to their YubiKey; running
# this script touches each YubiKey in turn (or pulls from the local
# unattended cache for boot-time auto-unseal).
#
# Modes:
#   --interactive   prompt the operator for which YubiKey shares to read
#                   (used when staffing the system)
#   --auto          read the age-encrypted shares from
#                   /etc/vigil/shamir-shares/ and decrypt with whichever
#                   YubiKey is currently inserted (boot-time unseal)
#
# The Vault root token + recovery shares are NEVER stored in plaintext;
# even the unsealed root token is held only in memory by the systemd
# unit and forwarded to subsequent bootstrap scripts via `EnvironmentFile=`.
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-https://127.0.0.1:8200}"
VAULT_BIN="${VAULT_BIN:-/usr/local/bin/vault}"
SHARES_DIR="${SHARES_DIR:-/etc/vigil/shamir-shares}"
THRESHOLD="${SHAMIR_THRESHOLD:-3}"

mode="${1:---interactive}"

# Probe Vault. vault status exits with documented codes:
#   0 — unsealed and healthy
#   1 — error (CLI / RPC / network failure)
#   2 — sealed (still healthy at the API level)
#
# The PRIOR check used `if ! cmd; then [[ "$?" -ne 2 ]] ...` — but
# inside the then-branch of `if ! cmd`, $? is ALWAYS 0 (the exit code
# of the negation), not the command's. The check therefore always
# triggered "Vault unreachable; exit 3" on a sealed Vault, so this
# script never actually performed an unseal at boot.
#
# Capture the real rc explicitly with `|| rc=$?` and switch on it.
rc=0
"${VAULT_BIN}" status -address="${VAULT_ADDR}" >/dev/null 2>&1 || rc=$?
if [[ ${rc} -ne 0 && ${rc} -ne 2 ]]; then
  echo "[fatal] Vault is unreachable at ${VAULT_ADDR} (vault status rc=${rc})" >&2
  exit 3
fi

# Already unsealed?
sealed="$("${VAULT_BIN}" status -address="${VAULT_ADDR}" -format=json 2>/dev/null \
  | jq -r .sealed || echo unknown)"
if [[ "${sealed}" == "false" ]]; then
  echo "[ok] Vault already unsealed"
  exit 0
fi

unseal_with_share() {
  local share="$1"
  echo "[unseal] applying share"
  "${VAULT_BIN}" operator unseal -address="${VAULT_ADDR}" "${share}" >/dev/null
}

case "${mode}" in
  --auto)
    if [[ ! -d "${SHARES_DIR}" ]]; then
      echo "[fatal] ${SHARES_DIR} missing" >&2
      exit 4
    fi
    applied=0
    skipped=0
    for f in "${SHARES_DIR}"/share-*.age; do
      [[ -f "${f}" ]] || continue
      # age-plugin-yubikey decrypts only if the matching YubiKey is
      # plugged in. Other shares fail "expected"-ly and we move on —
      # but log the filename so an operator debugging a boot-time
      # auto-unseal failure can see exactly which YubiKeys were
      # detected vs which were absent. Pre-fix, the silent move-on
      # left "only N/M shares applied" with no signal as to which.
      if share="$(age --decrypt "${f}" 2>/dev/null)"; then
        unseal_with_share "${share}"
        applied=$((applied + 1))
        unset share
        if [[ ${applied} -ge ${THRESHOLD} ]]; then break; fi
      else
        skipped=$((skipped + 1))
        echo "[skip] $(basename "${f}") — YubiKey for this share not present (or decrypt failed)" >&2
      fi
    done
    echo "[info] auto-unseal: ${applied} share(s) applied, ${skipped} share(s) skipped" >&2
    if [[ ${applied} -lt ${THRESHOLD} ]]; then
      echo "[fatal] only ${applied}/${THRESHOLD} shares applied — Vault still sealed" >&2
      exit 5
    fi
    ;;
  --interactive)
    for ((i=1; i<=THRESHOLD; i++)); do
      read -rsp "Share ${i}/${THRESHOLD} (paste base64; YubiKey will prompt): " share
      echo
      unseal_with_share "${share}"
      unset share
    done
    ;;
  *)
    echo "Usage: $0 [--interactive|--auto]" >&2
    exit 64
    ;;
esac

echo "[ok] Vault unsealed"
