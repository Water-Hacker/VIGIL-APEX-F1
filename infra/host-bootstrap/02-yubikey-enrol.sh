#!/usr/bin/env bash
# VIGIL APEX — YubiKey enrolment ceremony.
# HSK §05 + EXEC §13. Run once per provisioning event.
#
# This script is INTERACTIVE; it pauses for the architect's input at each step.
# Two YubiKeys are enrolled together so the pair is provably identical.

set -euo pipefail

confirm() { read -rp ">>> $1 (CONFIRM): " a; [ "$a" = CONFIRM ] || { echo aborted; exit 1; }; }

command -v ykman >/dev/null || { echo "yubikey-manager not installed"; exit 1; }
command -v gpg   >/dev/null || { echo "gpg not installed"; exit 1; }
command -v age   >/dev/null || { echo "age not installed"; exit 1; }

confirm "Insert YubiKey #1 only. Verify firmware ≥ 5.7.x"
ykman info
serial1=$(ykman list --serials | head -1)
echo "YubiKey #1 serial: $serial1"

confirm "Disable Yubico OTP + Static Password applets on Key #1"
ykman config usb -d OTP -d HOTP -f
ykman config nfc -d OTP -d HOTP -f

confirm "Set PIV PIN, PUK, Management Key on Key #1"
ykman piv access change-pin
ykman piv access change-puk
ykman piv access change-management-key --algorithm AES256

confirm "Generate OpenPGP master key on Key #1 (gpg --card-edit)"
gpg --card-edit
echo "Record the OpenPGP fingerprint to safe."

confirm "Now insert YubiKey #2. Repeat the disable + PIN steps."
ykman config usb -d OTP -d HOTP -f
ykman config nfc -d OTP -d HOTP -f
ykman piv access change-pin
ykman piv access change-puk
ykman piv access change-management-key --algorithm AES256

confirm "Transfer OpenPGP subkeys to Key #2 via gpg --card-edit (admin → fetch → keytocard)"
gpg --card-edit

confirm "Generate Vault Shamir share encryption identities (W-12: age-plugin-yubikey)"
echo "On each YubiKey, run:"
echo "  age-plugin-yubikey --identity --slot 9d --pin-policy once --touch-policy cached"
echo "Save the resulting recipient strings; they replace the PIN-only HSK §5.10 step."

confirm "Provision attestation document"
fp=$(gpg --list-keys --with-colons | awk -F: '/^fpr:/ {print $10; exit}')
{
  printf "VIGIL APEX YubiKey provisioning — attestation\n"
  printf "==============================================\n\n"
  printf "Date            : %s\n" "$(date -Is)"
  printf "Architect       : %s\n" "${VIGIL_ARCHITECT:-Junior Thuram Nana}"
  printf "Key #1 serial   : %s\n" "$serial1"
  printf "Key #2 serial   : (record by hand)\n"
  printf "OpenPGP FP      : %s\n" "$fp"
  printf "\nSigned at the ceremony by the architect.\n"
} > /run/vigil/secrets/attestation-$(date +%F).txt

echo ">>> Done. Lock Key #2 in the safe; carry Key #1."
