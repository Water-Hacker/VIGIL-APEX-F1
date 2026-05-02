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

# Block-E E.14 / C9 backup gap 4 — encrypted-at-rest archive.
# Architect-confirmed encrypt-subkey fingerprint: 0F8B9DEA4366A7880CFE76D4232E1B0F846B6151
# (HSK-v1 estate; long-form fingerprint required so gpg picks the
# encrypt subkey, not the master signing key). Each archive output
# file is wrapped via `gpg --encrypt --recipient $GPG_ENCRYPT_RECIPIENT`
# before manifest computation; the plaintext is removed from disk so
# the NAS never holds unencrypted state. The manifest signature still
# attests "the architect's hardware key authored this archive at
# this time"; the chain integrity is provable post-decryption via
# scripts/verify-hashchain-offline.ts (Block-E E.13).
GPG_ENCRYPT_RECIPIENT="${GPG_ENCRYPT_RECIPIENT:?GPG_ENCRYPT_RECIPIENT not set — refusing to write plaintext to NAS (Block-E E.14)}"

log() { printf '[%s] %s\n' "$(date -uIs)" "$*"; }

# Encrypt a single file in-place: <file> → <file>.gpg, then unlink
# the plaintext. Aborts the whole backup on encryption failure (the
# alternative — silent skip — would land plaintext on the NAS,
# defeating the contract).
encrypt_at_rest() {
  local f="$1"
  if [ ! -f "$f" ] && [ ! -d "$f" ]; then
    log "[warn] encrypt_at_rest: $f not present, skipping"
    return 0
  fi
  if [ -d "$f" ]; then
    # Tar the directory first so gpg has a single input. Removes the
    # directory tree on success.
    log "tar $f → $f.tar"
    tar -cf "$f.tar" -C "$(dirname "$f")" "$(basename "$f")"
    rm -rf "$f"
    f="$f.tar"
  fi
  log "gpg --encrypt → $f.gpg"
  gpg --batch --yes --trust-model always \
      --recipient "${GPG_ENCRYPT_RECIPIENT}" \
      --output "$f.gpg" \
      --encrypt "$f"
  rm -f "$f"
}

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

# 4c. Audit-chain explicit export (Block-E E.13 / C9 backup gap 3).
#     The Postgres basebackup at step 1 already includes `audit.actions`
#     + `audit.user_action_event` inside the cluster snapshot, but that
#     form requires a working Postgres to inspect. The court-defensible
#     artefact-of-record convention says you produce the document
#     itself, not the means of producing it — i.e. a plaintext CSV
#     that any reviewer can hash-walk WITHOUT a running database.
#
#     The COPY format is the bit-identical-parity input that
#     `scripts/verify-hashchain-offline.ts` consumes. The timestamp
#     is forced to ISO-8601 millisecond precision via `to_char` so
#     the recomputed body_hash matches the one a JS Date.toISOString()
#     would have produced at write time (architect E.13 hold-point
#     option (a) — strict bit-identical parity).
#
#     Both files get the same GPG detach-sign treatment as the
#     manifest; the manifest itself records each .csv's sha256 too,
#     so tampering at the NAS layer is visible at multiple
#     overlapping levels.
log "audit-chain CSV export (audit.actions)"
docker exec vigil-postgres psql -U vigil -d vigil -At -X -c "\\copy (
  SELECT
    id::text,
    seq::text,
    action,
    actor,
    subject_kind,
    subject_id,
    to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS occurred_at,
    payload::text AS payload,
    encode(prev_hash, 'hex') AS prev_hash,
    encode(body_hash, 'hex') AS body_hash
  FROM audit.actions
  ORDER BY seq
) TO STDOUT WITH CSV HEADER" > "${DEST}/audit-chain.csv"

log "audit-chain CSV export (audit.user_action_event)"
docker exec vigil-postgres psql -U vigil -d vigil -At -X -c "\\copy (
  SELECT
    event_id::text,
    global_audit_id::text,
    event_type,
    category,
    to_char(timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS timestamp_utc,
    actor_id,
    actor_role,
    coalesce(actor_yubikey_serial, '') AS actor_yubikey_serial,
    coalesce(actor_ip, '') AS actor_ip,
    coalesce(actor_device_fingerprint, '') AS actor_device_fingerprint,
    coalesce(session_id::text, '') AS session_id,
    target_resource,
    action_payload::text AS action_payload,
    result_status,
    coalesce(prior_event_id::text, '') AS prior_event_id,
    coalesce(correlation_id::text, '') AS correlation_id,
    coalesce(digital_signature, '') AS digital_signature,
    coalesce(chain_anchor_tx, '') AS chain_anchor_tx,
    record_hash,
    high_significance::text AS high_significance
  FROM audit.user_action_event
  ORDER BY timestamp_utc, event_id
) TO STDOUT WITH CSV HEADER" > "${DEST}/audit-user-actions.csv"

# Sign each audit-chain CSV separately so a court reviewer can verify
# either file in isolation without trusting the manifest. The detached
# signatures are produced over the PLAINTEXT (before encryption), so a
# reviewer who decrypts the .gpg can verify the architect-authored
# plaintext directly via the .sig.
gpg --batch --yes --local-user "${GPG_FP}" \
    --output "${DEST}/audit-chain.csv.sig" \
    --detach-sign "${DEST}/audit-chain.csv"
gpg --batch --yes --local-user "${GPG_FP}" \
    --output "${DEST}/audit-user-actions.csv.sig" \
    --detach-sign "${DEST}/audit-user-actions.csv"
log "audit-chain CSVs signed"

# 4d. Encrypt every plaintext archive output IN-PLACE before the
#     manifest step (Block-E E.14 / C9 backup gap 4). The .gpg
#     extension is what lands on the NAS; plaintext is removed.
#     `.sig` files (architect-authored signatures over plaintext)
#     stay in place — they're already-public attestations, not
#     content secrets, and the reviewer needs them to verify the
#     plaintext authenticity after decryption.
encrypt_at_rest "${DEST}/postgres"
encrypt_at_rest "${DEST}/srv-vigil.btrfs.zst"
encrypt_at_rest "${DEST}/neo4j"
encrypt_at_rest "${DEST}/ipfs-pinset.json"
encrypt_at_rest "${DEST}/audit-chain.csv"
encrypt_at_rest "${DEST}/audit-user-actions.csv"
if [ -f "${DEST}/vault-raft.snap" ]; then
  encrypt_at_rest "${DEST}/vault-raft.snap"
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
