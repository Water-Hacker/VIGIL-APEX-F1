# Mode 6.2 — Silent failure of backup operation

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 7 / Category 6
**Branch:** `hardening/phase-1-orientation`

## The failure mode

The nightly backup runs at 02:30 Africa/Douala. Pre-closure:

- If Vault snapshot fails (token expired/revoked), the script logs `[warn]` and continues. Operator-readable log; not operator-visible without log monitoring.
- If `VAULT_BACKUP_TOKEN` is unset, the script logs the same `[warn]` and skips. Same problem.
- If the script aborts partway (Postgres down during pg_basebackup, btrfs send out of disk, neo4j dump timeout), `set -e` exits without summary state — only the log captures which step failed, and the operator may not notice until a disaster-recovery scenario needs the missing artefact.

The orientation flagged this as "partially closed" because the script DOES fail loudly via `set -e` for most steps, but operator visibility relies entirely on log-monitoring discipline.

## What was added

### 1. Per-component status array

`infra/host-bootstrap/10-vigil-backup.sh` — declared an associative array `BACKUP_RESULTS` with one entry per backup component, all pre-initialised to `fail`:

```bash
declare -A BACKUP_RESULTS=(
  [pg_basebackup]=fail
  [btrfs_snapshot]=fail
  [neo4j_dump]=fail
  [ipfs_export]=fail
  [vault_snapshot]=skip
  [audit_csv_actions]=fail
  [audit_csv_user_action_event]=fail
  [encryption]=fail
  [manifest]=fail
)
```

Each component, after successful completion, sets its key to `ok`. The vault snapshot has explicit branches for `ok` / `fail` / `skip` (matching its three runtime paths).

### 2. EXIT trap that emits Prometheus textfile

`emit_metrics()` writes `vigil_backup_component_status{component}` to `/var/lib/node_exporter/textfile/vigil-backup.prom` (configurable via `VIGIL_BACKUP_TEXTFILE_PATH`). Values:

- `1` = ok
- `0` = fail
- `-1` = skip

Plus `vigil_backup_last_run_timestamp_seconds` (Unix time of the run) and `vigil_backup_duration_seconds` (wall-clock).

Crucially, the function is wired via `trap emit_metrics EXIT` so it runs on:

- Normal completion (every component marked ok).
- Partial completion (`set -e` aborts midway; un-reached components remain at their pre-initialised `fail`).
- Signal-induced exit (SIGTERM from systemd, SIGKILL on OOM).

Atomic write: writes to `<path>.tmp`, then `mv`. node_exporter never sees a half-written file.

### 3. Three Prometheus alerts

`infra/docker/prometheus/alerts/vigil.yml`:

- **`BackupComponentFailed`** — `vigil_backup_component_status == 0 for 5m`, severity critical. Per-component fail signal.
- **`BackupComponentSkipped`** — `vigil_backup_component_status == -1 for 24h`, severity warning. Catches "operator forgot to restore VAULT_BACKUP_TOKEN after rotation."
- **`BackupNotRunRecently`** — `time() - vigil_backup_last_run_timestamp_seconds > 86400*2 for 1h`, severity critical. Catches the cron-didn't-fire case (host down, timer disabled, systemd cron failure) where the backup never even started.

## The invariant

Three layers:

1. **Per-component status metric** — operator sees exactly which component failed without reading logs.
2. **EXIT trap** — guarantees metric emission even on abnormal exit, leaving un-reached components flagged.
3. **Three alerts** — catch (a) per-component failure, (b) sustained skip state, (c) entire-run absence.

## What this closure does NOT include

- **A test of the bash trap path against a synthetic partial-failure scenario**. The script runs in a real cluster (Postgres, Vault, Neo4j, IPFS all running) and the failure modes are highly host-specific. The script is exercised at every nightly run; observability gives operators a fast signal on the next failure. A synthetic test would need docker-compose-of-the-whole-stack, which is the DR rehearsal territory.

- **Backup-restore validation** — the orientation called out that "the backup writes complete; can we ACTUALLY restore from them?" is a separate failure mode that lives under the existing DR rehearsal at `scripts/dr-rehearsal.ts`. Out of scope for mode 6.2 (which is about emission visibility).

- **Per-host textfile sharding** — currently every host writes to its own `vigil-backup.prom` and Prometheus aggregates via `instance` label. Sufficient for a 3-node cluster; if the architect wants per-component aggregation across hosts, a relabel rule in Prometheus is the right place.

## Files touched

- `infra/host-bootstrap/10-vigil-backup.sh` (~60 lines: BACKUP_RESULTS array + emit_metrics + 9 ok-markers + EXIT trap)
- `infra/docker/prometheus/alerts/vigil.yml` (+30 lines: 3 alerts)
- `docs/audit/evidence/hardening/category-6/mode-6.2/CLOSURE.md` (this file)

## Verification

- `bash -n infra/host-bootstrap/10-vigil-backup.sh` — syntax clean.
- The Prometheus alerts pass YAML validation (existing alerts in the same file pass; the new ones follow identical syntax).
- Manual review of the per-component `BACKUP_RESULTS[X]=ok` markers confirms they sit immediately after the corresponding operation, before `set -e` can abort a downstream step and leave the marker un-set.
