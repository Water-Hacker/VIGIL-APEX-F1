#!/usr/bin/env bash
# scripts/setup-system-tooling.sh
# Install system-level tools that require sudo. Run once, manually, by the architect.
# Verifies and is idempotent.
set -euo pipefail

echo ">>> VIGIL APEX system tooling install"
echo ">>> This requires sudo. The agent cannot run this autonomously."
echo

# YubiKey tooling (HSK ops)
sudo apt-get update
sudo apt-get install -y \
  yubikey-manager \
  yubikey-personalization \
  scdaemon \
  opensc \
  pcscd \
  libpam-u2f

# Tor (W-09 .onion tip portal + adapter egress)
sudo apt-get install -y tor torsocks obfs4proxy

# age + age-plugin-yubikey (W-12 fix for Shamir share storage)
sudo apt-get install -y age
# age-plugin-yubikey is shipped via cargo or upstream release; install:
if ! command -v age-plugin-yubikey >/dev/null; then
  echo ">>> Install age-plugin-yubikey from upstream:"
  echo "    https://github.com/str4d/age-plugin-yubikey/releases"
  echo "    (or 'cargo install age-plugin-yubikey' if rustup is set up)"
fi

# Document conversion (pandoc + libreoffice for SRD §24.10 reproducibility)
sudo apt-get install -y pandoc libreoffice-core

# Smartcard daemon must be running for ykman PIV ops
sudo systemctl enable --now pcscd

echo
echo ">>> System tooling install complete. Verify:"
ykman --version || true
tor --version | head -1 || true
age --version || true
pandoc --version | head -1 || true
libreoffice --version || true
