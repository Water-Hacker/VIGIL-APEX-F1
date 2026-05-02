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

| Spec item                   | Current state                                                                                                                                                                                                                                           | Gap                                                          | Architect-action            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------- |
| Vault snapshot              | 🟩 `vault operator raft snapshot save` step + scoped policy [`infra/vault-policies/backup-snapshot.hcl`](../../infra/vault-policies/backup-snapshot.hcl) (Block-E E.12)                                                                                 | n/a                                                          | quarterly token rotation    |
| Git repo backup             | 🟡 (Block-E E.15 — landing)                                                                                                                                                                                                                             | source resides on github + the architect's working tree only | Block-E E.15 (low-priority) |
| Audit-chain explicit export | 🟩 `audit-chain.csv` + `audit-user-actions.csv` GPG-signed + offline verifier ([`scripts/verify-hashchain-offline.ts`](../../scripts/verify-hashchain-offline.ts)) per [`dossier-evidence-chain.md`](dossier-evidence-chain.md) (Block-E E.13)          | n/a                                                          | quarterly review            |
| Encrypted-at-rest archive   | 🟩 every plaintext output wrapped via `gpg --encrypt --recipient $GPG_ENCRYPT_RECIPIENT` (architect encrypt-subkey per HSK-v1); plaintext removed; restore requires YubiKey + GPG passphrase per [`RESTORE.md` Phase 0.5](../RESTORE.md) (Block-E E.14) | n/a                                                          | quarterly review            |
| Hetzner archive mirror      | only Synology rclone target                                                                                                                                                                                                                             | no second-region mirror; Synology loss = total backup loss   | Phase-2 (post-MOU)          |

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

## Vault snapshot token rotation (Block-E E.12)

The nightly archive's `vault operator raft snapshot save` step
authenticates with `VAULT_BACKUP_TOKEN` — a scoped, single-policy
token attached to `vigil-backup-snapshot`
([`infra/vault-policies/backup-snapshot.hcl`](../../infra/vault-policies/backup-snapshot.hcl)).
The policy grants `read` on `sys/storage/raft/snapshot` and
nothing else.

**Custody:**

- Token lives in `/etc/vigil/backup.env` on the host running the
  systemd `vigil-backup.timer`. Mode 0600, owner root.
- The architect's YubiKey-PIV-protected Vault root token is the
  only thing that can mint a new `VAULT_BACKUP_TOKEN`.
- The token is **non-orphan** (parented to the architect token at
  creation) — if the architect token is revoked, the backup token
  cascades. This is intentional: a compromised architect must
  invalidate downstream credentials in one step.

**Rotation cadence:** quarterly (March / June / September /
December, week 2). Rotation procedure:

1. Open a Vault session with the architect token (YubiKey-PIV
   unlock).
2. Verify the policy still matches the file:
   ```
   diff <(vault policy read vigil-backup-snapshot) \
        infra/vault-policies/backup-snapshot.hcl
   ```
   Any divergence is a halt-for-review event — the policy must
   never accumulate capabilities.
3. Mint a new token:
   ```
   vault token create -policy=vigil-backup-snapshot \
     -ttl=2160h -period=2160h \
     -display-name="vigil-backup-snapshot-$(date -u +%Y-Q%q)"
   ```
4. Update `/etc/vigil/backup.env`:
   ```
   VAULT_BACKUP_TOKEN=<new-token>
   ```
   Mode stays 0600, owner root.
5. Run `vigil-backup` once manually to verify the new token works
   (`vault-raft.snap` non-empty in the new archive directory).
6. Revoke the prior token: `vault token revoke <old-token>`.
7. Audit-of-audit log entry: `audit.security_decision` with
   action `vault_backup_token_rotated`, the new
   `display_name`, and the architect's signing-key id (TAL-PA
   category J).

**Failure modes:**

| Symptom                                            | Likely cause                                      | Recovery                                                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault snapshot failed — token may be expired`     | quarterly rotation missed                         | Mint a new token immediately; the btrfs snapshot continues to cover on-disk data so RTO is not impacted by one missed snapshot.                                                                       |
| `[warn] VAULT_BACKUP_TOKEN unset`                  | `/etc/vigil/backup.env` missing or unreadable     | Check `/etc/vigil/backup.env` exists, mode 0600, owner root. Re-run `vault token create` if needed.                                                                                                   |
| Snapshot file 0 bytes                              | docker exec succeeded but Vault returned an error | Check `vigil-vault` container logs for the timestamp of the failed call. Common causes: Vault sealed, raft cluster lost quorum.                                                                       |
| Policy diverges from `infra/vault-policies/...hcl` | unauthorised in-Vault edit                        | This is a security event — investigate via Vault audit log (`vault audit list`); the in-file policy is the single source of truth, restore it via `vault policy write`. Do NOT proceed with rotation. |

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
