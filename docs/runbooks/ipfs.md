# Runbook — ipfs (vigil-ipfs)

> Infra-plane service. Docker-compose-managed. IPFS Kubo 0.27 +
> Synology rclone hourly mirror per TRUTH §C / SRD §14.
>
> **Service:** docker-compose service `vigil-ipfs`. Document store
> (dossier PDFs, source HTML snapshots, public CSV exports).

---

## Description

### 🇫🇷

Stockage de documents par CID. Dossiers PDF (worker-dossier),
captures HTML (adapter-runner first-contact), exports CSV publics
(quarterly-audit-export). Réplication horaire vers Synology NAS
via rclone. Pas système d'enregistrement — les CIDs sont
référencés depuis Postgres ; la perte d'un fichier IPFS est
récupérable depuis le NAS.

### 🇬🇧

CID-keyed document store. Dossier PDFs (worker-dossier), HTML
snapshots (adapter-runner first-contact), public CSV exports
(quarterly-audit-export). Hourly replication to Synology NAS via
rclone. Not a system of record — CIDs are referenced from
postgres; an IPFS file loss is recoverable from the NAS.

---

## Boot sequence

1. Docker compose pulls Kubo image.
2. Volume `ipfs_data` mounted (persistent).
3. Workers connect via `IPFS_API_URL` (default `http://vigil-ipfs:5001`).
4. `kubo-rpc-client` connects on first `add` / `cat` call.

---

## Health-check signals

| Metric                                     | Healthy              | Unhealthy → action              |
| ------------------------------------------ | -------------------- | ------------------------------- |
| `kubo_swarm_peers_total`                   | > 0                  | `0` for > 5 min → P1 (no peers) |
| Docker healthcheck `/api/v0/version`       | 200                  | non-200 > 60 s → P1             |
| `vigil_ipfs_pins_total{outcome="ok"}` rate | matches dossier rate | rate < expected → pin failures  |

## SLO signals

| Metric                                      | SLO target | Investigate-worthy          |
| ------------------------------------------- | ---------- | --------------------------- |
| Pin latency (worker-dossier `kubo.add` p99) | < 5 s      | > 30 s → IPFS slow          |
| Disk usage on `ipfs_data`                   | < 70 %     | > 85 % → page on-call       |
| NAS rclone mirror lag                       | < 1 h      | > 2 h → rclone cron failing |

---

## Common failures

| Symptom                                  | Likely cause                        | Mitigation                                                                |
| ---------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| `worker-dossier` logs `kubo.add failed`  | IPFS down or API unreachable        | `docker compose logs vigil-ipfs --tail=200`; restart container if needed. |
| `kubo cat <cid>` returns 404 (file gone) | local pin lost                      | Re-pull from NAS rclone mirror; re-pin: `kubo pin add <cid>`.             |
| Disk full                                | accumulated pins / unpurged garbage | `kubo repo gc` + check pin set; archive old snapshots to NAS only.        |
| 0 swarm peers                            | network partition or NAT issue      | Operator triages bootstrap peer list; restart for fresh DHT.              |

---

## R1 — Routine deploy

```sh
docker compose pull vigil-ipfs
docker compose up -d vigil-ipfs
```

Workers retry on the first failed `kubo.add` after restart.

---

## R2 — Restore from backup

Per SRD §31.2.

Hourly NAS rclone mirror is the recovery source. Procedure:

1. Bring `vigil-ipfs` up fresh.
2. Restore from NAS: `rclone copy synology:/vigil-ipfs/ /local/ipfs_data/blocks/`.
3. Re-build pin set: walk `dossier.dossier.pdf_cid` +
   `audit.public_export.csv_cid` and re-pin each: `kubo pin add <cid>`.
4. Verify: random sample of CIDs round-trip via `kubo cat`.

Phase-1 RPO: ≤ 1 h (rclone cadence).

---

## R3 — Credential rotation

Kubo's local API has no auth in the Phase-1 single-host topology
(`http://vigil-ipfs:5001` is bound to the docker network only).
No rotatable credential.

Phase-2 federation introduces a Cluster-pin authenticated path;
rotation cadence will be added when that lands.

---

## R5 — Incident response

| Severity | Trigger                                     | Action                                                                                              |
| -------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **P1**   | IPFS down + dossier render queue backing up | Page on-call. Restart container; if persistent, route dossiers to a write-then-deliver-later state. |
| **P1**   | NAS rclone mirror failing > 2 h             | Page on-call. Risk: a host-loss in this window loses up to 2 h of new pins.                         |
| **P2**   | Disk usage > 85 %                           | Schedule `kubo repo gc` + archive old snapshots.                                                    |
| **P3**   | Single CID 404 (specific file lost)         | Re-pull from NAS; investigate root cause.                                                           |

---

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md). IPFS
re-pin walks contribute ~15 min to the 6-h SLA at Phase-1 scale.

---

## Cross-references

### Code

- [`apps/worker-dossier/src/index.ts`](../../apps/worker-dossier/src/index.ts) — primary IPFS writer.
- [`apps/adapter-runner/src/triggers/quarterly-audit-export.ts`](../../apps/adapter-runner/src/triggers/quarterly-audit-export.ts) — quarterly CSV pin.

### Binding spec

- **TRUTH §C** — IPFS Kubo 0.27 + NAS rclone mirror.
- **SRD §14** — document pipeline.
- **SRD §31.2** — R2 restore template.
