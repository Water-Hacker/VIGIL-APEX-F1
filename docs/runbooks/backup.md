# Backup runbook

**Block-D D.9 / 2026-05-01.** Operator-facing description of the
nightly backup pipeline, what it covers, what it does NOT cover, and
how to verify a given archive. Restoration is a separate procedure —
see [docs/RESTORE.md](../RESTORE.md).

---

## What the pipeline does

`/usr/local/bin/vigil-backup` runs every night at **02:30
Africa/Douala** under systemd timer `vigil-backup.timer` (installed by
[infra/host-bootstrap/10-vigil-backup.sh](../../infra/host-bootstrap/10-vigil-backup.sh)).
The unit is `Type=oneshot`, niced to background priority, randomised
±10 min so 30 hosts in the future don't stampede the same NAS.

Each run lands at `/mnt/synology/vigil-archive/<UTC-date>/` and
writes:

| Step | Source                      | How                                                 | Output file                  |
| ---- | --------------------------- | --------------------------------------------------- | ---------------------------- |
| 1    | `vigil-postgres` cluster    | `pg_basebackup -F tar -z -P -U vigil`               | `postgres/base.tar.gz` + WAL |
| 2    | `/srv/vigil` Btrfs subvol   | read-only snapshot → `btrfs send` → `zstd -9`       | `srv-vigil.btrfs.zst`        |
| 3    | `vigil-neo4j` graph DB      | `neo4j-admin database dump --to-path=…`             | `neo4j/<dbname>.dump`        |
| 4    | `vigil-ipfs-cluster` pinset | `ipfs-cluster-ctl pin ls --enc=json`                | `ipfs-pinset.json`           |
| 5    | All files in archive dir    | `find … -exec sha256sum`                            | `MANIFEST.sha256`            |
| 5b   | Manifest above              | `gpg --local-user "$GPG_FINGERPRINT" --detach-sign` | `MANIFEST.sha256.sig`        |
| 6    | Atomic completion marker    | `echo "$DATE_TAG" > .complete`                      | `.complete`                  |

Step 2 (Btrfs snapshot) covers Vault's on-disk state, IPFS data, the
worker secret-materialisation outputs, and every other file under
`/srv/vigil/`. Step 5b is a **detached signature** — the archive
contents themselves are stored in plaintext on the NAS; the signature
lets the operator detect tampering, not eavesdropping.

The NAS-side rclone job (operator-managed, not part of this repo)
ships `/volume1/vigil-archive/` off-site nightly.

---

## Pre-flight verification

Before relying on a given archive — for routine spot-checks, before a
DR drill, or when an operator suspects tampering — run from any host:

```sh
ARCHIVE=/mnt/synology/vigil-archive/<DATE>
gpg --verify "$ARCHIVE/MANIFEST.sha256.sig" "$ARCHIVE/MANIFEST.sha256"
(cd "$ARCHIVE" && sha256sum -c MANIFEST.sha256)
```

Both must succeed. Signature failure → STOP, escalate to backup
architect; checksum failure → STOP, retry the previous archive.

The `.complete` file is the atomic marker — if it's missing or empty,
the backup either crashed mid-run or is currently in flight. Check
`journalctl -u vigil-backup.service` for the most recent run.

To audit the pipeline configuration without taking the host offline:

```sh
./scripts/verify-backup-config.sh
```

This is also runnable from CI (sets `CI=1`) — it skips the prod-host-
only checks (presence of `/etc/vigil/backup.env`, presence of
`/mnt/synology/vigil-archive/`) and exits 0 if the script + systemd
units + .env documentation + decision-log reference + the architect-
spec coverage line items are all coherent.

---

## Architect-spec coverage gaps (PHASE-1-COMPLETION C9)

The architect's spec for C9 enumerates: "backs up Postgres + Vault
snapshot + IPFS pinset + git repo + audit-chain export, all encrypted
with the architect's GPG key, all mirrored to NAS-replica + Hetzner
archive."

The current `vigil-backup` delivers Postgres + Btrfs-of-`/srv/vigil`
(which transitively covers Vault's on-disk data, secrets, materialised
secret files) + Neo4j dump + IPFS pinset + GPG-signed manifest +
Synology destination. Five spec items are NOT yet implemented; the
verifier surfaces them as warnings, and the table below records each
with an architect-decision pointer.

| Spec item                   | Current state                       | Gap                                                                | Architect-action   |
| --------------------------- | ----------------------------------- | ------------------------------------------------------------------ | ------------------ |
| Vault snapshot              | btrfs-of-`/srv/vigil/vault`         | no `vault operator raft snapshot save` (raft-aware export)         | M0c hardening week |
| Git repo backup             | none on backup host                 | source resides on github + the architect's working tree only       | M0c hardening week |
| Audit-chain explicit export | inside Postgres dump only           | no separate signed CSV/JSONL of `audit.actions` for offline verify | M0c hardening week |
| Encrypted-at-rest archive   | manifest signed, contents plaintext | NAS stores plaintext basebackup + dumps                            | M0c hardening week |
| Hetzner archive mirror      | only Synology rclone target         | no second-region mirror; Synology loss = total backup loss         | Phase-2 (post-MOU) |

**These are gaps, not blockers.** The current pipeline meets the
6-hour RTO target for the failure modes RESTORE.md is written for
(host loss, btrfs corruption, Postgres corruption); the gaps above are
defence-in-depth additions the architect resolves during M0c week +
Phase-2 onwards. None can be silently extended by the build agent —
each touches a key (Vault root token / GPG passphrase) or a paid
resource (Hetzner Storage Box) the architect controls.

When a gap is closed, update the table above and move the warning
from the verifier into a hard-error check.

---

## What this runbook does NOT cover

- **Full restore.** [docs/RESTORE.md](../RESTORE.md) — Phase 1..7 with
  per-phase RTO, GPG-signature verification, hash-chain integrity
  check, sign-off into `docs/decisions/log.md`.
- **DR rehearsal cadence.** [docs/runbooks/dr-rehearsal.md](dr-rehearsal.md)
  — quarterly drill spec; the operator-facing R6 runbook is
  [R6-dr-rehearsal.md](R6-dr-rehearsal.md).
- **Compromised architect YubiKey** (incapacitated-architect playbook,
  Phase F6 — separate document).
- **Cameroonian regulatory takedown.** EXEC §34.6 covers; not a
  technical RESTORE.
- **Polygon mainnet rollback.** A new finding "Polygon fork detected
  at block X" is opened and routed through the council; the chain is
  not rolled back.
