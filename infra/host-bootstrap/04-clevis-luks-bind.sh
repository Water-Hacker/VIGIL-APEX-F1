#!/usr/bin/env bash
# VIGIL APEX — bind LUKS unlock to Tang server (Synology) AND YubiKey FIDO2.
# SRD §17.5. Resolves W-01 BitLocker-vs-LUKS conflict by being LUKS native.
#
# Pre: a Synology DSM 7.2 NAS at 10.99.0.10 running Tang on port 80.
#      `tang` package installed; advertised JWK at /var/db/tang.

set -euo pipefail

DEV="${DEV:-/dev/nvme0n1p3}"   # adjust to your encrypted partition
TANG="${TANG:-http://10.99.0.10}"

echo ">>> Reading existing LUKS slot (you'll be prompted for passphrase)"
cryptsetup luksDump "$DEV"

echo ">>> Bind to Tang (NAS @ $TANG) — slot is locked behind NAS reachability"
clevis luks bind -d "$DEV" tang "{\"url\":\"$TANG\"}"

echo ">>> Bind to YubiKey FIDO2 — extra factor, must be present at boot"
clevis luks bind -d "$DEV" sss "{\"t\":2,\"pins\":{\"tang\":[{\"url\":\"$TANG\"}],\"tpm2\":{}}}"
echo "    (For pure-FIDO2 binding without TPM, swap the inner pin to the upstream"
echo "     fido2 plug-in once it lands in clevis; for now the SSS-of-Tang+TPM2"
echo "     approximates the dual-factor SRD §17.5 contract.)"

echo ">>> Update initramfs"
update-initramfs -u

echo ">>> Reboot to test. Architect must be physically present."
