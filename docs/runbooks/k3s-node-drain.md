# Runbook — k3s node drain & uncordon

> DL380 Gen11 cluster migration plan, §"Failure-mode catalogue" (k3s node
> not-ready row) and the pre-swap checklist in [hardware-swap.md](hardware-swap.md).
>
> Draining a k3s node evacuates workloads so the node can be safely taken
> offline for maintenance (OS upgrade, hardware swap, firmware update).
> Uncordoning brings it back into the scheduling pool. This runbook covers
> both directions and the gotchas specific to VIGIL APEX's mix of
> stateless workers and per-node-pinned stateful pods.

---

## Description

### 🇫🇷

Procédure pour retirer (drain) ou réintégrer (uncordon) un nœud du
plan d'ordonnancement Kubernetes. Crucial avant tout arrêt planifié
ou mise à niveau, car les services apatrides peuvent migrer ailleurs
en quelques secondes ; les services à état (Postgres / Vault / IPFS /
Fabric) doivent être basculés manuellement d'abord.

### 🇬🇧

Procedure to remove (drain) or re-add (uncordon) a node from the k3s
scheduling pool. Required before any planned downtime — stateless
services migrate to other nodes in seconds; stateful services
(Postgres / Vault / IPFS / Fabric) must be hand-failed-over first.

---

## What lives on each node

| Workload                                                                              | Type                                          | Drain behaviour                                                                                                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Postgres (Patroni)**                                                                | StatefulSet, nodeAffinity-pinned              | Will NOT migrate. Switch over via Patroni FIRST, then drain. See [patroni-failover.md](patroni-failover.md).                                   |
| **Vault (Raft)**                                                                      | StatefulSet, nodeAffinity-pinned              | Will NOT migrate. Step-down via `vault operator step-down` if this is the leader. See [vault-raft-reattach.md](vault-raft-reattach.md).        |
| **Redis (Sentinel)**                                                                  | StatefulSet, nodeAffinity-pinned              | Will NOT migrate. Sentinel auto-promotes a replica if you drain the primary node.                                                              |
| **Neo4j**                                                                             | StatefulSet, pinned to vigil-node-b           | Will NOT migrate. Tolerated: workers fall back to Postgres if Neo4j is briefly down.                                                           |
| **IPFS + ipfs-cluster**                                                               | StatefulSet (3 replicas)                      | Will NOT migrate. Cluster reduces to 2 peers until you bring this one back.                                                                    |
| **Fabric orderer + peer**                                                             | StatefulSet, pinned                           | Orderer will NOT migrate (Raft membership is fixed). Other 2 orderers maintain quorum.                                                         |
| **etcd (Patroni DCS)**                                                                | StatefulSet, pinned                           | Will NOT migrate. Remaining 2-of-3 keeps quorum.                                                                                               |
| **Tor**                                                                               | StatefulSet, pinned to vigil-node-a only      | Will NOT migrate (single instance — multiple .onion listeners would re-key). Tor service is interrupted for the drain duration.                |
| **Caddy**                                                                             | DaemonSet                                     | One pod per node; the node-A pod stops; keepalived migrates the VIP to whichever pod is healthy.                                               |
| **Keycloak**                                                                          | Deployment (3 replicas, anti-affinity)        | Pod on this node terminates; the other 2 pods continue.                                                                                        |
| **Workers** (all 20+)                                                                 | Deployment (≥ 2 replicas each, anti-affinity) | Pods terminate; replacements schedule on remaining nodes within 30s. Consumer-group semantics rebalance message work.                          |
| **Dashboard**                                                                         | Deployment (3 replicas, anti-affinity)        | One pod terminates; 2 remaining serve traffic.                                                                                                 |
| **Observability** (Prometheus / Grafana / Alertmanager / Falco / Logstash / Filebeat) | StatefulSet / DaemonSet                       | Falco is DaemonSet — pod on this node stops. Prometheus is pinned to one node; if that's the draining node, history is paused until re-attach. |

---

## Drain procedure

```bash
# Pick the node to drain. Decide which roles it currently holds so you
# can fail those over BEFORE the drain triggers a service interruption.

NODE=vigil-node-a   # example

# 1. Inventory the stateful workloads on this node:
kubectl get pods --all-namespaces \
  --field-selector spec.nodeName=$NODE \
  -o=custom-columns='NAMESPACE:.metadata.namespace,NAME:.metadata.name,READY:.status.containerStatuses[*].ready'

# 2. Hand off stateful leaders FIRST:
patronictl -c /etc/patroni/patroni.yml switchover --master vigil_postgres_a   # if Postgres leader is here
vault operator step-down                                                       # if Vault leader is here
# Redis Sentinel will auto-failover when the primary pod dies; no manual step.
# Fabric orderer Raft will auto-elect; no manual step.
# IPFS Cluster handles 2/3 peers gracefully; no manual step.

# 3. Cordon (mark unschedulable) — no new pods will land here, but
# existing ones keep running:
kubectl cordon $NODE

# 4. Drain (evict pods that CAN move). DaemonSet pods are excluded by
# --ignore-daemonsets; persistent-volume pods will be evicted only with
# --delete-emptydir-data, which is safe because VIGIL APEX does not
# use emptyDir for any data we care about:
kubectl drain $NODE \
  --ignore-daemonsets \
  --delete-emptydir-data \
  --grace-period=60 \
  --timeout=10m

# 5. Wait for drain to complete. Watch progress:
kubectl get pods --all-namespaces --field-selector spec.nodeName=$NODE -w
# Pods will go Terminating → Pending (rescheduled elsewhere). DaemonSet
# pods stay on the cordoned node — that's correct.

# 6. Confirm the cluster is healthy WITHOUT this node:
kubectl get nodes                       # $NODE shows Ready,SchedulingDisabled
patronictl -c /etc/patroni/patroni.yml list   # 1 Leader + 1 Sync (the third is on $NODE — paused)
vault operator raft list-peers                # 3 voters, $NODE may show as candidate/follower
ipfs-cluster-ctl peers ls                     # 3 peers, the one on $NODE may show as unreachable
kubectl get pods -n vigil --field-selector=status.phase!=Running   # should be empty
```

---

## Uncordon procedure (returning the node to service)

After the maintenance is complete and the node has rebooted:

```bash
# 1. Verify the node is Ready:
kubectl get nodes $NODE
# Should show: Ready (not Ready,SchedulingDisabled — that's the cordoned state).

# 2. Restart the stateful workloads pinned to this node. They are
# launched by k3s automatically once the kubelet reports Ready, but
# they need their backing services healthy too:
ssh $NODE "systemctl status patroni etcd ipfs-cluster"

# 3. Once everything on the node is healthy, uncordon to re-enable
# scheduling:
kubectl uncordon $NODE

# 4. Workloads from OTHER nodes will gradually rebalance back as pods
# are restarted or new ones scheduled. Force rebalancing immediately
# if you want via:
kubectl rollout restart deployment -n vigil   # all stateless deploys
# Patroni / Vault Raft re-attach automatically per their own runbooks.

# 5. Verify the cluster is back to full health:
kubectl get nodes                          # 3 Ready, none SchedulingDisabled
patronictl -c /etc/patroni/patroni.yml list # 1 Leader + 2 Sync standbys
vault operator raft list-peers              # 3 voters
ipfs-cluster-ctl peers ls                   # 3 peers, all reachable
kubectl get pods -n vigil | grep -v Running # should be empty
```

---

## Common failure modes during drain

### "evicting pod" stuck on a PDB violation

A PodDisruptionBudget (PDB) prevents the drain from violating the
chart's `minAvailable`. If you see:

```
error when evicting pods/"vigil-dashboard-..." -n vigil
Cannot evict pod as it would violate the pod's disruption budget.
```

The PDB is doing its job — you have only N pods and removing this one
would take you below the minimum. Solutions in order of preference:

1. Wait for the rescheduled replica on another node to become Ready
   (the drain command auto-retries every few seconds).
2. Temporarily scale up the deployment: `kubectl scale deploy vigil-dashboard -n vigil --replicas=4`. After the drain completes, scale back.
3. If urgent and you accept the brief reduced-availability: `kubectl drain --disable-eviction $NODE` (uses kubectl delete instead of eviction). **Do not do this for stateful pods.**

### Pods stuck Terminating

```bash
# Find them:
kubectl get pods --all-namespaces --field-selector spec.nodeName=$NODE | grep Terminating

# If a pod is stuck > 5 minutes, force-delete:
kubectl delete pod <name> -n <ns> --grace-period=0 --force
```

This is safe for stateless workers — the consumer-group rebalance
will re-deliver any in-flight message. It is NOT safe for stateful
pods; investigate the volume / pre-stop hook first.

### Patroni won't switch over

See [patroni-failover.md](patroni-failover.md), Scenario 3.

---

## Cross-links

- [hardware-swap.md](hardware-swap.md) — what triggers a drain
- [patroni-failover.md](patroni-failover.md) — Postgres-specific handoff
- [vault-raft-reattach.md](vault-raft-reattach.md) — Vault-specific re-attach
- [docs/runbooks/dr-rehearsal.md](dr-rehearsal.md) — quarterly drill exercises drain + uncordon
