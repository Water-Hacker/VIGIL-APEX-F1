#!/usr/bin/env bash
# 10-vigil-backup.sh — install /usr/local/bin/vigil-backup and the systemd
# timer that runs it nightly. The binary itself is below; this installer
# script lives under infra/host-bootstrap so it ships with the repo and
# can be re-run on a fresh host.
#
# Phase F1 — RTO 6h target (per docs/SLOs.md). The backup is:
#   - pg_basebackup of vigil-postgres
#   - Btrfs read-only snapshot of /srv/vigil
#   - Neo4j `neo4j-admin database dump` (vigil DB)
#   - IPFS `ipfs repo gc + ipfs-cluster export`
#   - signed manifest (architect's GPG key) listing every file's sha256
# All of it lands at /mnt/synology/vigil-archive/<UTC-date>/ which the
# Synology rclone job ships off-host.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "[fatal] must run as root" >&2
  exit 2
fi

install -m 0755 -o root -g root /dev/stdin /usr/local/bin/vigil-backup <<'BACKUP_EOF'
#!/usr/bin/env bash
# vigil-backup — see infra/host-bootstrap/10-vigil-backup.sh for context.
set -euo pipefail

ARCHIVE_ROOT="${ARCHIVE_ROOT:-/mnt/synology/vigil-archive}"
DATE_TAG="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DEST="${ARCHIVE_ROOT}/${DATE_TAG}"
GPG_FP="${GPG_FINGERPRINT:?GPG_FINGERPRINT not set}"

log() { printf '[%s] %s\n' "$(date -uIs)" "$*"; }

mkdir -p "${DEST}"
chmod 0700 "${DEST}"

# 1. Postgres physical backup
log "pg_basebackup → ${DEST}/postgres"
docker exec vigil-postgres pg_basebackup \
  -D /tmp/basebackup -F tar -z -P -U vigil
docker cp vigil-postgres:/tmp/basebackup "${DEST}/postgres"
docker exec vigil-postgres rm -rf /tmp/basebackup

# 2. Btrfs snapshot of /srv/vigil — read-only, hard-linked into archive.
log "btrfs snapshot → ${DEST}/srv-vigil"
btrfs subvolume snapshot -r /srv/vigil "${DEST}/srv-vigil.snapshot"
btrfs send "${DEST}/srv-vigil.snapshot" | zstd -9 > "${DEST}/srv-vigil.btrfs.zst"
btrfs subvolume delete "${DEST}/srv-vigil.snapshot"

# 3. Neo4j dump
log "neo4j-admin database dump"
docker exec vigil-neo4j neo4j-admin database dump \
  --to-path=/tmp/neo4j-dump vigil
docker cp vigil-neo4j:/tmp/neo4j-dump "${DEST}/neo4j"
docker exec vigil-neo4j rm -rf /tmp/neo4j-dump

# 4. IPFS export — pinset only; CIDs themselves resolve from any cluster peer.
log "ipfs cluster pin export"
docker exec vigil-ipfs-cluster ipfs-cluster-ctl pin ls --enc=json \
  > "${DEST}/ipfs-pinset.json"

# 4b. Vault raft snapshot (Block-E E.12 / C9 backup gap 1).
#     Btrfs-of-/srv/vigil/vault captures the on-disk raft data, but a
#     `vault operator raft snapshot save` produces the canonical
#     restore artefact (consistent point-in-time across all raft peers,
#     restorable via `vault operator raft snapshot restore`).
#     Token custody: VAULT_BACKUP_TOKEN is a scoped token with the
#     SINGLE policy `vigil-backup-snapshot` — read-only access to
#     `sys/storage/raft/snapshot` and nothing else. Quarterly rotation
#     per docs/runbooks/backup.md §"Vault snapshot token rotation".
#     If the token isn't provisioned, log a warning and continue —
#     the btrfs snapshot is still useful, just not the canonical
#     restore artefact.
log "vault operator raft snapshot save"
if [ -n "${VAULT_BACKUP_TOKEN:-}" ]; then
  if VAULT_TOKEN="${VAULT_BACKUP_TOKEN}" \
     docker exec -e VAULT_TOKEN="${VAULT_BACKUP_TOKEN}" vigil-vault \
       vault operator raft snapshot save - > "${DEST}/vault-raft.snap"; then
    log "vault snapshot OK ($(stat -c%s "${DEST}/vault-raft.snap") bytes)"
  else
    log "[warn] vault snapshot failed — token may be expired or revoked; archive continues"
    rm -f "${DEST}/vault-raft.snap"
  fi
else
  log "[warn] VAULT_BACKUP_TOKEN unset — skipping canonical raft snapshot (btrfs covers the on-disk data); see docs/runbooks/backup.md"
fi

# 5. Signed manifest — sha256 of every file, then architect-GPG signature.
log "manifest + signature"
(cd "${DEST}" && find . -type f ! -name MANIFEST.sha256 \
   -exec sha256sum {} +) > "${DEST}/MANIFEST.sha256"
gpg --batch --yes --local-user "${GPG_FP}" \
    --output "${DEST}/MANIFEST.sha256.sig" \
    --detach-sign "${DEST}/MANIFEST.sha256"

# 6. Atomic completion marker — `vigil-backup --verify` checks this.
echo "${DATE_TAG}" > "${DEST}/.complete"
log "backup complete: ${DEST}"
BACKUP_EOF

# systemd timer — runs at 02:30 Africa/Douala every night.
install -m 0644 /dev/stdin /etc/systemd/system/vigil-backup.service <<'UNIT_EOF'
[Unit]
Description=VIGIL APEX nightly archive
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
EnvironmentFile=/etc/vigil/backup.env
ExecStart=/usr/local/bin/vigil-backup
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
UNIT_EOF

install -m 0644 /dev/stdin /etc/systemd/system/vigil-backup.timer <<'TIMER_EOF'
[Unit]
Description=Nightly VIGIL APEX backup

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
TIMER_EOF

systemctl daemon-reload
systemctl enable --now vigil-backup.timer
echo "[ok] vigil-backup installed; timer enabled"
