# Runbook — hardware swap on the DL380 Gen11 cluster

> DL380 Gen11 cluster migration plan, §"Failure points + self-healing".
> Triage and procedure for failed components on any of the 3 cluster
> nodes (vigil-node-a, vigil-node-b, vigil-node-c). Read this BEFORE
> dispatching an HPE Foundation Care 4-hour onsite call so the engineer
> arrives with the right part and you arrive with the right context.

---

## Description

### 🇫🇷

Procédure de remplacement d'un composant sur un nœud DL380 Gen11
(disque, alimentation, DIMM, ventilateur). HPE Foundation Care 24×7
fournit une intervention sur site dans les 4 heures ; ce runbook
décrit comment préparer le nœud avant l'arrivée du technicien et
comment vérifier l'état du cluster après.

### 🇬🇧

Procedure to replace a single hardware component on one DL380 Gen11
node (drive, PSU, DIMM, fan). HPE Foundation Care 24×7 provides
on-site engineer dispatch within 4 hours; this runbook covers
pre-arrival cluster preparation and post-swap verification.

---

## Triage matrix

| iLO alert                                   | Component      | Cluster impact                                                     | Operator action                                            |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `Drive (Bay N): Predictive Failure`         | NVMe / SAS HDD | None (RAID-10 covers single-drive loss)                            | Schedule hot-swap; HPE 4h SLA                              |
| `Drive (Bay N): Failed`                     | NVMe / SAS HDD | Degraded RAID; second failure in same RAID-10 mirror would corrupt | URGENT hot-swap; do NOT drain the node first               |
| `Power Supply Bay 1/2: Failed`              | PSU            | None if A+B feeds intact                                           | Hot-swap PSU; verify upstream PDU                          |
| `Memory: Correctable error count threshold` | DIMM           | None (ECC absorbs)                                                 | Schedule replacement during next maintenance window        |
| `Memory: Uncorrectable error`               | DIMM           | Node panics → pods reschedule                                      | Drain node, replace DIMM, re-attach                        |
| `Fan: Failed`                               | Chassis fan    | Degraded cooling; remaining fans speed up                          | Hot-swap within 1 hour to avoid thermal throttle           |
| `Processor: Thermal critical`               | CPU            | Node throttling                                                    | Investigate airflow; do NOT replace CPU until HPE confirms |
| `Network port: Link down on bond member`    | NIC port       | None (LACP bond continues on surviving port)                       | Replace SFP / patch cable                                  |

---

## Pre-swap checklist (for any component requiring node downtime)

If the component swap requires the node to be powered off (DIMM, CPU,
mainboard), drain the node first so the cluster has time to migrate
state before you cut power:

```bash
# 1. Cordon the node (no new pods will schedule here)
kubectl cordon vigil-node-X

# 2. Drain workloads. --delete-emptydir-data is safe because every
#    stateful workload (Postgres / Vault / IPFS) uses persistent volumes,
#    NOT emptyDir.
kubectl drain vigil-node-X --ignore-daemonsets --delete-emptydir-data --timeout=10m

# 3. If this node currently holds the Patroni leader OR is the Raft
#    leader for Vault / Fabric / etcd, demote it manually so the
#    failover happens during your maintenance window, not when you
#    power off:
patronictl -c /etc/patroni/patroni.yml switchover --master vigil_postgres_X
vault operator step-down                # if vigil-node-X is Vault leader
etcdctl move-leader <other-node-id>     # if vigil-node-X is etcd leader

# 4. Confirm cluster health BEFORE power-down:
patronictl -c /etc/patroni/patroni.yml list      # expect: 1 Leader + 1 Sync + 1 Replica
vault operator raft list-peers                    # expect: 3 voters, this node is follower
ipfs-cluster-ctl peers ls                         # expect: 3 peers, all reachable
kubectl get nodes                                 # expect: 2 Ready + 1 SchedulingDisabled
```

For hot-swappable components (drive, PSU, fan) — no drain needed. The
node stays in the cluster throughout.

---

## During the swap

The HPE engineer handles the physical work. Stay on-site for:

- Visual confirmation of the part replaced (photograph the serial
  number of the failed part before they take it away — audit trail
  for HPE warranty return).
- Confirmation that iLO clears the alert after the swap.
- For drive swaps: confirm RAID rebuild starts automatically. The
  HPE MR416i-o Tri-Mode controller's auto-rebuild is enabled by
  default; iLO will show `Rebuilding` status under `Storage` →
  `Logical Drives`.

---

## Post-swap verification

```bash
# Hardware health
ssh -i ~/.ssh/vigil-ilo vigil-ilo-X "show system1 -all"      # iLO CLI
# Or via iLO web UI: System Information → Health Summary should be GREEN.

# OS sees the new part
lsblk                                # for drive swaps; new drive should appear
dmesg -T | tail -50                  # check for any new error events
free -h                              # for DIMM swaps; expected total memory

# Cluster re-attach (only if node was drained)
kubectl uncordon vigil-node-X
patronictl -c /etc/patroni/patroni.yml reinit vigil_postgres_X      # if Postgres data dir was wiped
# Otherwise Patroni auto-rejoins on systemctl start patroni.service

# Verify cluster is back to full health
patronictl -c /etc/patroni/patroni.yml list      # expect: 1 Leader + 2 Sync
vault operator raft list-peers                    # expect: 3 voters
ipfs-cluster-ctl peers ls                         # expect: 3 peers
kubectl get nodes                                 # expect: 3 Ready
```

---

## Audit-chain note

Every hardware swap MUST be recorded as a `cluster.hardware_swap` audit
row. The keepalived notify script captures VIP transitions automatically;
hardware swaps require a manual entry:

```bash
psql -h localhost -U postgres -d vigil <<'SQL'
INSERT INTO audit.actions
  (id, seq, action, actor, subject_kind, subject_id, occurred_at, payload, prev_hash, body_hash)
SELECT
  gen_random_uuid(),
  COALESCE((SELECT MAX(seq) FROM audit.actions), 0) + 1,
  'cluster.hardware_swap',
  '<operator-username>',
  'cluster',
  'vigil-node-X',
  now(),
  jsonb_build_object(
    'component', 'nvme-bay-3',
    'old_serial', 'S/N-FROM-FAILED-PART',
    'new_serial', 'S/N-OF-REPLACEMENT',
    'hpe_case_id', 'HPE-CASE-NNNNN',
    'engineer', 'engineer-name'
  ),
  (SELECT body_hash FROM audit.actions ORDER BY seq DESC LIMIT 1),
  digest('cluster-hardware-swap-' || now()::text, 'sha256');
SQL
```

---

## When NOT to swap

- **Single ECC correctable error**: not yet — ECC is doing its job. Replace only when correctable count exceeds 100/day or any uncorrectable event occurs.
- **NIC port flapping**: try replacing the SFP first; full NIC card swap is rarely needed.
- **Drive shows "Predictive Failure" on a node that's been online > 2 years**: replace the drive on the same maintenance window as a scheduled firmware update so you only drain the node once.

---

## Cross-links

- HPE iLO 6 user guide — out-of-band management
- HPE Foundation Care SLA — 4-hour onsite, 24×7
- AUDIT-051 — round-trip migration discipline (do not skip the audit row)
- W-27 — decision-log / migration discipline CI-enforced
