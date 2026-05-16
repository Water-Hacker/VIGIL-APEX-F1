#!/usr/bin/env bash
# VIGIL APEX — Vault Shamir initialisation ceremony.
# Per SRD §17.6.1 + W-12 fix.
#
# 5 Shamir shares, threshold 3:
#   1, 2, 3 → architect (encrypted to YK-01 PIV slot 9d via age-plugin-yubikey)
#   4       → backup architect (paper + their YubiKey)
#   5       → institutional partner (paper)
#
# Run AFTER 02-yubikey-enrol.sh has succeeded.

set -euo pipefail

# Tier-22 audit closure: default to HTTPS. 05-secret-materialisation.sh
# already uses `https://127.0.0.1:8200` — keeping the two scripts on
# different schemes invites operator confusion where an HTTPS-only
# Vault gets initialised over an HTTP listener that doesn't exist.
# The development override still works via the env var.
VAULT_ADDR="${VAULT_ADDR:-https://vigil-vault:8200}"
SHARE_DIR="${SHARE_DIR:-/run/vigil/shamir}"

mkdir -p "$SHARE_DIR"
chmod 0700 "$SHARE_DIR"

# Tier-22 audit closure: install a trap that wipes the share dir on
# ANY non-success exit. Pre-fix, if `vault operator init` succeeded
# but the script aborted before the architect-side encryption
# ceremony, plaintext unseal shares + root token sat in tmpfs at
# /run/vigil/shamir until manual cleanup. tmpfs survives until reboot.
# The wipe uses `shred -u` so a recovered tmpfs page cannot reveal
# share material.
cleanup_on_error() {
  local rc=$?
  if [[ $rc -ne 0 && -d "${SHARE_DIR}" ]]; then
    echo "[fatal] script aborted (rc=$rc) — shredding ${SHARE_DIR}/* to prevent share leakage" >&2
    find "${SHARE_DIR}" -maxdepth 1 -type f -exec shred -u {} +
  fi
}
trap cleanup_on_error EXIT

echo "Initialising Vault: 5 shares, threshold 3..."
INIT_OUT=$(vault operator init -key-shares=5 -key-threshold=3 -format=json)
echo "$INIT_OUT" | jq '.unseal_keys_b64' > "$SHARE_DIR/unseal-shares.json"
echo "$INIT_OUT" | jq -r '.root_token' > "$SHARE_DIR/root-token"
chmod 0600 "$SHARE_DIR"/*

echo
echo "Now encrypt each share to its holder's age recipient:"
echo
echo "1. Run on architect's machine (YK-01 inserted):"
echo "     age-plugin-yubikey --identity --slot 9d > yk01-identity.txt"
echo "     age -R yk01-recipient.txt < <(jq -r '.[0]' $SHARE_DIR/unseal-shares.json) > $SHARE_DIR/share-1.age"
echo "     age -R yk01-recipient.txt < <(jq -r '.[1]' $SHARE_DIR/unseal-shares.json) > $SHARE_DIR/share-2.age"
echo "     age -R yk01-recipient.txt < <(jq -r '.[2]' $SHARE_DIR/unseal-shares.json) > $SHARE_DIR/share-3.age"
echo
echo "2. Run on backup architect's machine (YK-03 inserted):"
echo "     age -R yk03-recipient.txt < <(jq -r '.[3]' $SHARE_DIR/unseal-shares.json) > $SHARE_DIR/share-4.age"
echo
echo "3. Print share 5 on paper, deliver to institutional partner under sealed envelope."
echo "     jq -r '.[4]' $SHARE_DIR/unseal-shares.json"
echo
echo "4. Test unseal:"
echo "     vault operator unseal \$(age -d -i yk01-identity.txt < $SHARE_DIR/share-1.age)"
echo "     vault operator unseal \$(age -d -i yk01-identity.txt < $SHARE_DIR/share-2.age)"
echo "     vault operator unseal \$(age -d -i yk01-identity.txt < $SHARE_DIR/share-3.age)"
echo
echo "5. Configure auto-unseal as systemd unit: vigil-vault-unseal.service"
echo
echo "After ceremony: SECURELY ERASE $SHARE_DIR/unseal-shares.json"
