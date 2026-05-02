# VIGIL APEX — Disaster recovery (RESTORE)

**Phase F5 deliverable.** Target RTO 6 hours from intact backup → fully
operational stack. Tested quarterly (cron entry below); the most recent
test result is recorded in `docs/decisions/log.md`.

This is the document the on-call architect or backup architect follows
in the dark. Every step is concrete; every assumption is named.

---

## Pre-flight (5 min)

1. Identify the failure mode. RESTORE is for one of:
   - Total data-volume loss (`/srv/vigil` gone)
   - Corruption of `audit.actions` (hash chain broken)
   - Whole-host loss (new tin)

   For **partial outages** (one container down, one volume corrupted),
   skip RESTORE and use the relevant incident-response playbook in
   `docs/incident-response/`.

2. Identify the most recent intact archive on the Synology NAS:

   ```sh
   ssh nas@synology.vigilapex.cm \
       'ls -t /volume1/vigil-archive/ | head -1'
   ```

   Verify the manifest signature:

   ```sh
   ARCHIVE=/mnt/synology/vigil-archive/<DATE>
   gpg --verify "$ARCHIVE/MANIFEST.sha256.sig" "$ARCHIVE/MANIFEST.sha256"
   ```

   The signature MUST be from the architect's GPG key
   (`docs/source/HSK-v1.md` records the fingerprint). Anything else →
   STOP and escalate to the backup architect.

3. Verify every file's sha256:
   ```sh
   (cd "$ARCHIVE" && sha256sum -c MANIFEST.sha256)
   ```
   Any mismatch → STOP. Try the previous archive.

## Phase 0.5 — Decrypt the archive (Block-E E.14, 5-15 min)

Per Block-E E.14, every plaintext archive output is wrapped in
`.gpg` before landing on the NAS. Restoration therefore requires
the architect's GPG private-key passphrase + YubiKey present at
this step (the encrypt-subkey lives on the YubiKey per HSK-v1).

3a. Insert the architect's primary YubiKey + unlock GPG. Confirm
the encrypt-capable subkey is reachable:
`sh
    gpg --card-status   # confirms YubiKey is the active token
    gpg --list-keys --with-colons | grep -E '^(pub|sub):'
    # The encrypt-capable subkey (capability 'e') must be listed.
    `

3b. Decrypt every `.gpg` in the archive directory in-place. Each
invocation reverses an `encrypt_at_rest` call from
`infra/host-bootstrap/10-vigil-backup.sh`:
`sh
    cd "$ARCHIVE"
    for f in *.gpg; do
      gpg --batch --output "${f%.gpg}" --decrypt "$f"
      rm -f "$f"
    done
    # Untar any directories that were tar-then-encrypted
    # (postgres dir, neo4j dump dir).
    for t in *.tar; do
      tar -xf "$t" -C .
      rm -f "$t"
    done
    `
Any decryption failure → STOP and escalate. Common causes:
YubiKey not present, wrong PIN entered too many times (encrypt
subkey locked — recover via the master key per HSK-v1 §6.4),
wrong archive (encrypted by a key the operator does not hold).

3c. Cross-check the per-file detached signatures (architect-
authored over the plaintext) where present:
`sh
    if [ -f audit-chain.csv.sig ]; then
      gpg --verify audit-chain.csv.sig audit-chain.csv
    fi
    if [ -f audit-user-actions.csv.sig ]; then
      gpg --verify audit-user-actions.csv.sig audit-user-actions.csv
    fi
    `
A mismatch means the plaintext was altered between signing
and decryption — STOP and escalate.

3d. Run the offline hash-chain verifier (Block-E E.13) against
the decrypted CSV — proves chain internal integrity post-
decryption:
`sh
    pnpm tsx scripts/verify-hashchain-offline.ts audit-chain.csv > report.txt
    echo "verifier exit code: $?"
    # 0 = chain intact; 1 = divergences listed in report.txt;
    # 2 = input error (CSV malformed)
    `

## Phase 1 — Host & volumes (60 min)

4. Provision the host per `docs/source/HSK-v1.md` §03.
   - Btrfs subvolumes at `/srv/vigil/{postgres,neo4j,ipfs,ipfs2,vault,...}`.
   - LUKS bound to a Clevis-pinned TPM measurement (HSK §04).
   - WireGuard `wg0` up on `10.99.0.1/24`.
   - YubiKey enrolled in `pcscd` (architect ceremony).

5. Restore `/srv/vigil` from the Btrfs send-stream:
   ```sh
   zstd -d "$ARCHIVE/srv-vigil.btrfs.zst" -c | btrfs receive /srv/
   mv /srv/srv-vigil /srv/vigil
   ```

## Phase 2 — Postgres (30 min)

6. Stop the dashboard + worker stacks if running:

   ```sh
   docker compose -f infra/docker/docker-compose.yaml down dashboard \
       worker-pattern worker-entity worker-score worker-counter-evidence \
       worker-document worker-dossier worker-anchor worker-governance \
       worker-tip-triage worker-conac-sftp worker-minfi-api \
       worker-adapter-repair adapter-runner
   ```

7. Restore Postgres from the basebackup:

   ```sh
   docker compose -f infra/docker/docker-compose.yaml up -d vigil-postgres
   docker exec -i vigil-postgres bash -c '
     pg_ctl stop -m fast
     rm -rf /var/lib/postgresql/data/*
     tar -xzf /tmp/postgres/base.tar.gz -C /var/lib/postgresql/data/
     tar -xzf /tmp/postgres/pg_wal.tar.gz -C /var/lib/postgresql/data/pg_wal/
     pg_ctl start
   '
   ```

   _(Copy the basebackup tarball into the container first via `docker cp
"$ARCHIVE/postgres" vigil-postgres:/tmp/postgres`.)_

8. Verify the audit chain end-to-end:
   ```sh
   make verify-hashchain
   ```
   This is the **most important** check in the entire procedure. If
   `vigil_errors_total{code="AUDIT_HASH_CHAIN_BROKEN"}` is non-zero,
   STOP and escalate. The `HashChainBreak` AlertManager rule will also
   fire automatically.

## Phase 3 — Neo4j + IPFS (30 min)

9. Restore Neo4j:

   ```sh
   docker compose up -d vigil-neo4j
   docker cp "$ARCHIVE/neo4j" vigil-neo4j:/tmp/neo4j-dump
   docker exec vigil-neo4j neo4j-admin database load \
       --from-path=/tmp/neo4j-dump vigil
   ```

10. The IPFS data lives inside `/srv/vigil/ipfs` and `/srv/vigil/ipfs2`,
    already restored in Phase 1. Restore the cluster pinset:
    ```sh
    docker compose up -d vigil-ipfs vigil-ipfs-2 vigil-ipfs-cluster
    docker exec vigil-ipfs-cluster ipfs-cluster-ctl \
        pin add --no-status $(jq -r '.[].cid["/"]' "$ARCHIVE/ipfs-pinset.json")
    ```

## Phase 4 — Vault & secrets (30 min)

11. Bring up Vault and unseal interactively (3 of 5 council members
    present + their YubiKeys, OR the architect with their cold-storage
    Shamir shares from the lawyer-held envelope per EXEC §34.5):

    ```sh
    docker compose up -d vigil-vault
    /usr/local/bin/vigil-vault-unseal --interactive
    ```

12. Re-materialise `/run/vigil/secrets`:
    ```sh
    sudo /usr/local/bin/vigil-secret-materialisation   # i.e. 05-…sh
    ```
    Bring up the secret-init Compose service to verify:
    ```sh
    docker compose up vigil-secret-init
    ```

## Phase 5 — Bring up the rest (30 min)

13. Start observability + edge services first; they stabilise before
    the data plane attaches:

    ```sh
    docker compose up -d vigil-redis vigil-keycloak vigil-prometheus \
        vigil-alertmanager vigil-grafana vigil-logstash vigil-filebeat \
        vigil-caddy vigil-tor
    ```

14. Then the data-plane workers + dashboard + MINFI API:

    ```sh
    docker compose up -d
    ```

15. Wait for **all** healthchecks to pass (typically 90 s):
    ```sh
    docker compose ps
    ```

## Phase 6 — Verify (15 min)

16. Run the post-restore smoke suite:

    ```sh
    ./tools/e2e-smoke.sh
    make verify-hashchain
    make verify-ledger
    ```

17. Trigger the watchdog manually so the archive's last-known-good is
    visible in the audit log:

    ```sh
    sudo /usr/local/bin/vigil-watchdog
    ```

18. Confirm in Grafana → VIGIL → Overview that:
    - `vigil_audit_chain_seq` matches what was at backup time (within
      epsilon — anchor commits between backup and crash are gone, but
      the chain itself is intact).
    - All worker P99 latency curves return to baseline.
    - Polygon anchor outcome timeseries shows fresh `ok` events.

## Phase 7 — Sign off

19. Append a row to `docs/decisions/log.md`:

    > YYYY-MM-DD — Restore from `<ARCHIVE>` completed in `<MM>` minutes.
    > RTO observed: `<MM>m`. Hash-chain integrity: ✓. Sign-off: <name>.

20. If RTO exceeded 6 h, open an incident in `docs/incident-response/`
    and schedule a postmortem within 14 days.

---

## Quarterly drill

The Phase F10 timer fires a calendar reminder; the actual procedure is
a `vigil-restore-drill.sh` script under `tools/` (TODO post-Phase-F).
The drill restores into a parallel Btrfs subvolume and runs Phase 6
checks without disturbing production.

## What this procedure does NOT cover

- **Polygon mainnet rollback.** If the chain forks past our last
  `polygon_confirmed_at`, we do not roll back the chain — we open a new
  finding "Polygon fork detected at block X" and route it through the
  council under the standard procedure.
- **Compromised architect YubiKey.** That's the
  `architect-incapacitated.md` playbook (F6).
- **Cameroonian regulatory takedown order.** EXEC §34.6 covers; this is
  not a technical RESTORE.
