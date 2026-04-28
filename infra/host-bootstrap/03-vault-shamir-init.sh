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

VAULT_ADDR="${VAULT_ADDR:-http://vigil-vault:8200}"
SHARE_DIR="${SHARE_DIR:-/run/vigil/shamir}"

mkdir -p "$SHARE_DIR"
chmod 0700 "$SHARE_DIR"

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
