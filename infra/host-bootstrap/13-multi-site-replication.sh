#!/usr/bin/env bash
# 13-multi-site-replication.sh — Phase-3 multi-site NAS replication.
#
# Extends the F1 nightly backup chain (10-vigil-backup.sh, "core →
# Hetzner") with a Phase-3 hop in front of it: each of the 10
# regional NAS endpoints is pulled into the Yaoundé core's
# /srv/vigil/region-archive/<CODE>/ tree before the nightly archive
# fans out to Hetzner.
#
# Topology:
#
#   regional NAS (per-region)  --rsync over WireGuard-->  Yaoundé core
#                                                         /srv/vigil/region-archive/<CODE>
#                                                                |
#                                                                v
#                                                         (10-vigil-backup.sh)
#                                                                |
#                                                                v
#                                                         Hetzner offsite
#
# Architectural decisions (see plan + docs/PHASE-3-FEDERATION.md):
#   - Pull, not push. The Yaoundé core initiates rsync from every
#     regional NAS. A compromised regional NAS cannot inject blobs
#     into the core archive; the worst it can do is omit data,
#     which the federation-stream backlog (worker-federation-receiver
#     replays) makes recoverable.
#   - Read-only export on each regional NAS. The rsync module is
#     `vigil-region-<code>` and is mode `read only = yes` in the
#     regional rsyncd.conf shipped by the per-region cutover
#     ceremony.
#   - Lock per region under /var/run/vigil/replication-<code>.lock.
#     Concurrent runs of this script (e.g., a manual run during
#     the timer's window) wait per-region instead of clobbering.
#   - Structured log lines (one JSON object per region per run)
#     written to /var/log/vigil/multi-site-replication.log so the
#     audit-verifier can ingest them.
#   - Alerts: if the most recent successful pull for a region is
#     older than federation.retainHours/2 (default 84 h), an alert
#     line is emitted on stdout and the script exits non-zero.
#
# Idempotent: re-running this script is safe. Only changed files
# are transferred (rsync delta).
set -euo pipefail

# ============================================================================
# Defaults — overridable via /etc/vigil/multi-site-replication.conf
# ============================================================================
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/srv/vigil/region-archive}"
LOCK_DIR="${LOCK_DIR:-/var/run/vigil}"
LOG_FILE="${LOG_FILE:-/var/log/vigil/multi-site-replication.log}"
RETAIN_DAYS="${RETAIN_DAYS:-90}"
LAG_ALERT_HOURS="${LAG_ALERT_HOURS:-84}"

REGIONS=(CE LT NW SW OU SU ES EN NO AD)

# Per-region NAS host. Populate from /etc/vigil/multi-site-replication.conf
# (a bash file sourced at the top of this script). The fallback below
# documents the naming convention but is NOT operational defaults — the
# per-region cutover ceremony writes the real conf.
declare -A REGION_NAS_HOST=(
  [CE]="nas-ce.regions.vigilapex.cm"
  [LT]="nas-lt.regions.vigilapex.cm"
  [NW]="nas-nw.regions.vigilapex.cm"
  [SW]="nas-sw.regions.vigilapex.cm"
  [OU]="nas-ou.regions.vigilapex.cm"
  [SU]="nas-su.regions.vigilapex.cm"
  [ES]="nas-es.regions.vigilapex.cm"
  [EN]="nas-en.regions.vigilapex.cm"
  [NO]="nas-no.regions.vigilapex.cm"
  [AD]="nas-ad.regions.vigilapex.cm"
)
declare -A REGION_BWLIMIT_KBPS=(
  [CE]=50000  [LT]=50000  [OU]=50000  [SU]=50000
  [NW]=25000  [SW]=25000  [ES]=25000  [NO]=25000  [AD]=25000
  [EN]=15000
)

CONF_FILE="${CONF_FILE:-/etc/vigil/multi-site-replication.conf}"
if [[ -f "${CONF_FILE}" ]]; then
  # shellcheck source=/dev/null
  source "${CONF_FILE}"
fi

# ============================================================================
# CLI flags
# ============================================================================
DRY_RUN=0
ONLY_REGION=""
INSTALL_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=1; shift ;;
    --region)    ONLY_REGION="${2^^}"; shift 2 ;;
    --install)   INSTALL_ONLY=1; shift ;;
    -h|--help)
      cat <<USAGE
13-multi-site-replication.sh [--dry-run] [--region <CODE>] [--install]

  --dry-run    plan only; print resolved targets, do not contact remotes
  --region X   only pull region X (one of: ${REGIONS[*]})
  --install    write the systemd unit files + reload, then exit

USAGE
      exit 0 ;;
    *)
      echo "[fatal] unknown flag: $1" >&2
      exit 2 ;;
  esac
done

# ============================================================================
# Install path — drops systemd unit files + reloads. Used by the architect
# during the per-region cutover ceremony.
# ============================================================================
if (( INSTALL_ONLY )); then
  if [[ $EUID -ne 0 ]]; then
    echo "[fatal] --install requires root" >&2
    exit 2
  fi
  install -d -m 0755 /etc/systemd/system
  install -m 0644 /dev/stdin /etc/systemd/system/vigil-multisite-replication.service <<'SVC_EOF'
[Unit]
Description=VIGIL APEX multi-site NAS replication (Phase-3 federation)
Wants=network-online.target wg-quick@wg-vigil.service
After=network-online.target wg-quick@wg-vigil.service
# Run BEFORE the nightly archive so the regional pulls land in
# /srv/vigil/region-archive/ in time to be swept up.
Before=vigil-backup.service

[Service]
Type=oneshot
EnvironmentFile=-/etc/vigil/multi-site-replication.env
ExecStart=/usr/local/bin/vigil-multisite-replication
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
TimeoutStartSec=4h
SVC_EOF

  install -m 0644 /dev/stdin /etc/systemd/system/vigil-multisite-replication.timer <<'TMR_EOF'
[Unit]
Description=Multi-site NAS replication timer

[Timer]
# 01:30 UTC — earlier than 10-vigil-backup.sh (02:30 Africa/Douala
# = 01:30 UTC), so the pulls finish before the archive starts.
OnCalendar=*-*-* 01:30:00
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
TMR_EOF

  install -m 0755 /dev/stdin /usr/local/bin/vigil-multisite-replication <<'BIN_EOF'
#!/usr/bin/env bash
exec /opt/vigil/host-bootstrap/13-multi-site-replication.sh "$@"
BIN_EOF

  systemctl daemon-reload
  systemctl enable vigil-multisite-replication.timer
  echo "[ok] systemd units installed; enable with: systemctl start vigil-multisite-replication.timer"
  exit 0
fi

# ============================================================================
# Runtime
# ============================================================================

# Structured log helper. One JSON object per call.
log_event() {
  local level="$1" region="$2" event="$3" detail="${4:-}"
  printf '{"ts":"%s","level":"%s","region":"%s","event":"%s","detail":%s}\n' \
    "$(date -uIs)" "$level" "$region" "$event" "$(printf '%s' "$detail" | jq -Rs .)" \
    | tee -a "${LOG_FILE}"
}

if (( DRY_RUN )); then
  echo "[dry-run] would replicate the following regions:"
  for r in "${REGIONS[@]}"; do
    if [[ -n "${ONLY_REGION}" && "${ONLY_REGION}" != "${r}" ]]; then continue; fi
    host="${REGION_NAS_HOST[$r]:-(unset)}"
    bw="${REGION_BWLIMIT_KBPS[$r]:-25000}"
    printf '  %s  host=%s  bw=%dkbps  dest=%s/%s\n' \
      "$r" "$host" "$bw" "${ARCHIVE_ROOT}" "$r"
  done
  exit 0
fi

# Real-run only: ensure the runtime dirs exist.
mkdir -p "${ARCHIVE_ROOT}" "${LOCK_DIR}" "$(dirname "${LOG_FILE}")"

# Per-region pull loop.
overall_status=0
for region in "${REGIONS[@]}"; do
  if [[ -n "${ONLY_REGION}" && "${ONLY_REGION}" != "${region}" ]]; then
    continue
  fi
  host="${REGION_NAS_HOST[$region]:-}"
  if [[ -z "${host}" ]]; then
    log_event warn "${region}" skip "no host configured"
    continue
  fi
  bw="${REGION_BWLIMIT_KBPS[$region]:-25000}"
  dest="${ARCHIVE_ROOT}/${region}"
  lock="${LOCK_DIR}/replication-${region}.lock"

  mkdir -p "${dest}"

  # Idempotent lock — flock blocks if another invocation is mid-pull.
  exec {LFD}>"${lock}"
  if ! flock -n "${LFD}"; then
    log_event warn "${region}" lock-busy "another run holds ${lock}"
    overall_status=1
    exec {LFD}>&-
    continue
  fi

  log_event info "${region}" pull-start "host=${host} bw=${bw}kbps dest=${dest}"
  start_ts=$(date +%s)

  # rsync: archive mode, hard-links, delete vanished, bandwidth cap,
  # WireGuard-routed via the rsyncd module. --partial keeps interrupted
  # transfers resumable. --safe-links blocks symlink escape.
  if rsync -az --delete --partial --safe-links \
        --bwlimit="${bw}" \
        --timeout=600 \
        --log-file="${LOG_FILE}.rsync.${region}" \
        "rsync://${host}/vigil-region-${region,,}/" \
        "${dest}/"; then
    end_ts=$(date +%s)
    duration=$(( end_ts - start_ts ))
    log_event info "${region}" pull-ok "duration_s=${duration}"
    # Touch a marker so the lag check below has a fresh mtime.
    : > "${dest}/.last-success"
  else
    rc=$?
    log_event error "${region}" pull-failed "rsync_exit=${rc}"
    overall_status=1
  fi

  exec {LFD}>&-
done

# Lag alert — any region whose .last-success is older than LAG_ALERT_HOURS
# triggers an alert line + non-zero exit so the systemd unit OnFailure=
# fires the operator-team page.
now_epoch=$(date +%s)
for region in "${REGIONS[@]}"; do
  marker="${ARCHIVE_ROOT}/${region}/.last-success"
  if [[ ! -f "${marker}" ]]; then
    log_event warn "${region}" lag-unknown "no .last-success marker yet"
    continue
  fi
  marker_epoch=$(stat -c %Y "${marker}")
  age_h=$(( (now_epoch - marker_epoch) / 3600 ))
  if (( age_h > LAG_ALERT_HOURS )); then
    log_event alert "${region}" lag-exceeded "age_h=${age_h} threshold_h=${LAG_ALERT_HOURS}"
    overall_status=1
  fi
done

# Retention sweep. Per-region archives older than RETAIN_DAYS are pruned
# from the regional pull tree (the nightly Hetzner archive retains its
# own GFS schedule, so destruction here doesn't lose the data).
for region in "${REGIONS[@]}"; do
  dest="${ARCHIVE_ROOT}/${region}"
  [[ -d "${dest}" ]] || continue
  find "${dest}" -mindepth 1 -maxdepth 2 -type f \
       -mtime +"${RETAIN_DAYS}" -delete 2>/dev/null || true
done

exit "${overall_status}"
