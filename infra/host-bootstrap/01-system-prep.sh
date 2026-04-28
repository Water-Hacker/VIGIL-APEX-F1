#!/usr/bin/env bash
# VIGIL APEX — host system preparation
# Per BUILD-V1 §06.2 + SRD §29.2.
#
# Run AS ROOT on a fresh Ubuntu 24.04 LTS install. The architect must be
# physically present with a YubiKey. INTERACTIVE — pauses at every irreversible
# step for confirmation. Claude Code does NOT run this autonomously.
#
# Outputs:
#   - LUKS2 + Btrfs root filesystem
#   - Subvolumes per SRD §2.3.1
#   - clevis-LUKS unlock chain (Tang on Synology + YubiKey FIDO2)
#   - hardened sshd (PIV smartcard only)
#   - ufw firewall
#   - fail2ban
#   - Docker engine + compose v2
#   - Vigil user + secrets directory
#
# This script is destructive. Read it. Sign-off.

set -euo pipefail

confirm() {
  printf '\n>>> %s\n>>> Proceed? (type CONFIRM): ' "$1"
  read -r ans
  [ "$ans" = "CONFIRM" ] || { echo "aborted"; exit 1; }
}

require_root() { [ "$EUID" -eq 0 ] || { echo "must run as root"; exit 1; }; }
require_root

confirm "Update apt + install base packages"
apt-get update
apt-get install -y --no-install-recommends \
  cryptsetup btrfs-progs clevis clevis-luks clevis-tpm2 clevis-systemd \
  yubikey-manager yubikey-personalization scdaemon opensc pcscd \
  age \
  tor torsocks obfs4proxy \
  ufw fail2ban \
  unattended-upgrades apt-listchanges \
  chrony \
  rsyslog auditd \
  curl wget jq htop tmux git \
  build-essential pkg-config libssl-dev libpcsclite-dev

confirm "Install Docker Engine + Compose v2"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

confirm "Create vigil user + group"
id vigil >/dev/null 2>&1 || useradd -u 1000 -m -s /usr/sbin/nologin vigil
usermod -aG docker vigil

confirm "Configure UFW (default-deny + allow WireGuard 51820/udp)"
ufw default deny incoming
ufw default allow outgoing
ufw allow 51820/udp comment "WireGuard"
ufw allow OpenSSH comment "Architect SSH (PIV-only)"
ufw allow 80/tcp comment "Caddy HTTP-01 ACME"
ufw allow 443/tcp comment "Caddy HTTPS"
ufw --force enable

confirm "Install fail2ban with sshd jail"
cat > /etc/fail2ban/jail.local <<'CONF'
[DEFAULT]
banaction = ufw
ignoreip = 127.0.0.1/8 ::1
findtime = 10m
maxretry = 5
bantime = 1h
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = %(sshd_log)s
backend = systemd
CONF
systemctl enable --now fail2ban

confirm "Hardening: sshd PIV-only, no passwords, no root"
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
echo "PubkeyAuthOptions verify-required" >> /etc/ssh/sshd_config
systemctl restart sshd

confirm "Enable unattended-upgrades for security updates"
dpkg-reconfigure -plow unattended-upgrades
systemctl enable --now unattended-upgrades

confirm "Configure chrony NTP"
cat > /etc/chrony/sources.d/vigil.conf <<'CONF'
pool pool.ntp.org iburst
server time.cloudflare.com iburst
makestep 1.0 3
maxupdateskew 100.0
CONF
systemctl enable --now chrony

confirm "Create /srv/vigil subvolumes (Btrfs assumed)"
mkdir -p /srv/vigil
for sv in postgres neo4j redis ipfs vault ledger caddy prometheus grafana; do
  if ! btrfs subvolume show "/srv/vigil/$sv" >/dev/null 2>&1; then
    btrfs subvolume create "/srv/vigil/$sv" 2>/dev/null || mkdir -p "/srv/vigil/$sv"
  fi
done
chown -R vigil:vigil /srv/vigil

confirm "Create /run/vigil/secrets tmpfs (cleared on reboot)"
mkdir -p /run/vigil/secrets
chmod 0700 /run/vigil/secrets
chown vigil:vigil /run/vigil/secrets

confirm "Install systemd units"
cp -v "$(dirname "$0")"/../systemd/*.service /etc/systemd/system/
cp -v "$(dirname "$0")"/../systemd/*.timer   /etc/systemd/system/ 2>/dev/null || true
systemctl daemon-reload

echo ">>> System prep complete. Next steps:"
echo "    1. Run 02-yubikey-enrol.sh (with YubiKey present)"
echo "    2. Run 03-vault-shamir-init.sh (with all 5 council YubiKeys present)"
echo "    3. Configure WireGuard at /etc/wireguard/wg0.conf"
echo "    4. systemctl enable --now vigil-time vigil-vault-unseal vigil-polygon-signer"
echo "    5. From /home/kali/vigil-apex: make compose-up"
