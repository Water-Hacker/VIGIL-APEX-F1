# R8 — Kubernetes cutover (Phase-2 deferred)

**When to run:** Phase-2 ops team has been onboarded, the architect
has signed `docs/decisions/log.md` for the K8s migration, and a
target cluster is provisioned. **Not** during Phase-1 single-architect
operations — Compose stays the deployment of record there.

**Status:** the chart at `infra/k8s/charts/vigil-apex/` covers the
critical-path subset (Postgres + Redis + Vault + one worker +
dashboard + caddy + cross-cutting). The remaining ~25 services land
in follow-up PRs by the ops team, copying the patterns established
here. Only proceed with cutover once the follow-ups are in tree
or the gap is acceptable for a partial deployment.

---

## Prerequisites

| Requirement | Why |
|---|---|
| Kubernetes ≥ 1.28 | PSS `restricted` + ServerSideApply maturity |
| `helm` ≥ 3.13 | Chart format v2, `--set-string` correctness |
| `kubectl` ≥ 1.28 | matches cluster |
| **cert-manager** ≥ 1.14 (cluster-installed) | Caddy TLS for the LoadBalancer |
| **External Secrets Operator** ≥ 0.9 (cluster-installed) | Vault sync |
| **Argo CD** ≥ 2.10 (cluster-installed) | optional but recommended |
| Vault unsealed and reachable inside the target cluster | ESO needs it |
| Storage class with the read-write-once + dynamic-provisioning capability | StatefulSets |

## 1. Bootstrap dependencies

```sh
# cert-manager
kubectl create namespace cert-manager
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
    --namespace cert-manager --version v1.14.5 \
    --set installCRDs=true

# external-secrets-operator
kubectl create namespace external-secrets
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
    --namespace external-secrets --version 0.9.20

# argo-cd (optional)
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.10.7/manifests/install.yaml
```

## 2. Mirror the Compose state into the cluster

Cutover is a one-shot migration of stateful data. The dataset on the
Phase-1 host is the source of truth.

### Postgres
```sh
# On the Phase-1 host:
docker exec vigil-postgres pg_dump -U vigil -d vigil -F c -Z 9 > /tmp/vigil.dump
scp /tmp/vigil.dump <jumphost>:/tmp/vigil.dump

# In the target cluster (after `helm install` from §4):
kubectl -n vigil cp /tmp/vigil.dump vigil-postgres-0:/tmp/vigil.dump
kubectl -n vigil exec -it vigil-postgres-0 -- \
    pg_restore -U vigil -d vigil -j 4 /tmp/vigil.dump
```

### Redis
Redis carries only stream state + dedup keys. Do NOT migrate — let
the new cluster build its own stream offsets by replaying from
adapter sources (run-once mode). Compose-side ACL configuration is
re-rendered from the in-cluster ESO sync; no key import.

### Vault
Vault file backend → cluster-side Vault: copy the unsealed-state
files via Btrfs snapshot, restore inside the StatefulSet's PVC.
Detailed steps in `docs/RESTORE.md` Phase 4 — same procedure.
**Don't forget to re-unseal after the move.**

### Hyperledger Fabric
Out of scope for this PR. Fabric peer + orderer charts land in a
follow-up PR; until then keep Fabric on the Phase-1 host with a
WireGuard tunnel into the cluster so worker-fabric-bridge in the
cluster can reach it.

## 3. Provision the Vault Kubernetes-auth role

```sh
vault auth enable kubernetes
vault write auth/kubernetes/config \
    kubernetes_host="https://kubernetes.default.svc"

vault write auth/kubernetes/role/vigil-eso \
    bound_service_account_names=vigil-worker,vigil-dashboard,vigil-postgres \
    bound_service_account_namespaces=vigil \
    policies=worker,dashboard \
    ttl=24h
```

Naming matches the helpers in `templates/_helpers.tpl` —
`vigil-<component>` after `helm install vigil` runs in the `vigil`
namespace.

## 4. Install the chart

```sh
helm dependency update infra/k8s/charts/vigil-apex
helm lint infra/k8s/charts/vigil-apex --strict

# Dev cluster
helm install vigil infra/k8s/charts/vigil-apex \
    -f infra/k8s/charts/vigil-apex/values-dev.yaml \
    -n vigil --create-namespace

# Or Prod cluster
helm install vigil infra/k8s/charts/vigil-apex \
    -f infra/k8s/charts/vigil-apex/values-prod.yaml \
    -n vigil --create-namespace
```

## 5. Verify

```sh
# Pods come up in dependency order. Wait for the data plane first.
kubectl -n vigil rollout status statefulset/vigil-postgres --timeout=300s
kubectl -n vigil rollout status statefulset/vigil-redis    --timeout=300s
kubectl -n vigil rollout status statefulset/vigil-vault    --timeout=300s

# Then workers + dashboard
kubectl -n vigil rollout status deployment/vigil-worker-pattern --timeout=300s
kubectl -n vigil rollout status deployment/vigil-dashboard      --timeout=300s

# Smoke
kubectl -n vigil port-forward svc/vigil-dashboard 3000:3000 &
curl -fsS http://localhost:3000/api/health

# Audit chain check (Phase E2 verifier still works)
kubectl -n vigil exec -it deployment/vigil-worker-pattern -- \
    node /app/apps/audit-verifier/dist/index.js --once
```

## 6. Cutover external traffic

DNS flip from the Phase-1 host's IP to the LoadBalancer IP.
Cloudflare TTL 60s, do it in a maintenance window.

```sh
# Get the LB IP
kubectl -n vigil get svc vigil-caddy

# Update Cloudflare via API (same call as F11 failover)
curl -X PUT -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$RECORD_ID" \
    -d '{"type":"A","name":"vigilapex.cm","content":"<LB IP>","ttl":60,"proxied":true}'
```

## 7. Switch GitOps on

```sh
kubectl apply -f infra/k8s/argocd/repository.yaml
kubectl apply -f infra/k8s/argocd/vigil-apex.application.yaml
```

Argo CD's `automated.prune: false` means the architect approves every
sync until the Phase-2 ops team builds confidence. Bump to `true`
in the Application spec when ready.

## 8. Decommission Compose (one week later)

After 7 days of stable cluster-side operation:

```sh
# On the Phase-1 host:
docker compose -f infra/docker/docker-compose.yaml down
# DON'T delete /srv/vigil yet — keep until 30 days of cluster ops.
```

The Compose stack stays in tree. If the cluster fails over to the
host, `docker compose up` still works.

## Rollback

If the cluster shows divergent audit-chain state, missing rows, or
hash-chain breaks within the first 24 hours:

```sh
# 1. Stop new writes — pause the workers
kubectl -n vigil scale deployment/vigil-worker-pattern --replicas=0
kubectl -n vigil scale deployment/vigil-worker-anchor --replicas=0
# (repeat for any other workers)

# 2. DNS flip back to Phase-1 host
# (same Cloudflare API call, host IP)

# 3. Restart Compose
ssh phase1-host
sudo docker compose -f /opt/vigil/infra/docker/docker-compose.yaml up -d

# 4. Re-run audit-verifier on the host to confirm chain integrity
make verify-hashchain
make verify-cross-witness

# 5. Open an incident in docs/incident-response/ and root-cause the
#    cluster divergence before retrying.
```

The cluster's persistent volumes are NOT deleted in rollback — keep
them for forensics.

## Follow-up PRs (deferred)

- Neo4j chart
- IPFS×2 + ipfs-cluster charts
- Fabric peer/orderer/CA charts
- Prometheus + Grafana + AlertManager + Logstash + Filebeat (one
  observability subchart, or pivot to `kube-prometheus-stack`)
- Tor + Keycloak charts
- Remaining 11 worker entries in `values-prod.yaml#workers`
- HPA tuning + PodDisruptionBudgets per service
- Velero install for backup/restore
- Per-env GitOps repos (dev / stage / prod)
