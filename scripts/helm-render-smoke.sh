#!/usr/bin/env bash
# helm-render-smoke.sh — chart-render regression gate.
#
# Renders the vigil-apex Helm chart in both modes (dev + HA cluster) and
# fails if either errors. Runs in CI as `chart-lint / render` job.
#
# Local usage:
#   scripts/helm-render-smoke.sh
#
# CI usage:
#   .github/workflows/chart-lint.yaml invokes this with helm v3.16+ on PATH.
set -euo pipefail

CHART_DIR="${CHART_DIR:-infra/k8s/charts/vigil-apex}"
RELEASE_NAME="${RELEASE_NAME:-vigil-apex}"

log() { printf '[helm-smoke] %s\n' "$*"; }
fail() { printf '[helm-smoke][FATAL] %s\n' "$*" >&2; exit 1; }

command -v helm >/dev/null 2>&1 || fail "helm not on PATH"
[[ -d "${CHART_DIR}" ]] || fail "chart dir ${CHART_DIR} not found"

# 1. Lint
log "lint (base values)"
helm lint "${CHART_DIR}" -f "${CHART_DIR}/values.yaml"
log "lint (base + cluster)"
helm lint "${CHART_DIR}" -f "${CHART_DIR}/values.yaml" -f "${CHART_DIR}/values-cluster.yaml"

# 2. Dev-mode render — must produce valid YAML with sane resource counts.
log "render (dev mode)"
DEV_OUT="$(helm template "${RELEASE_NAME}" "${CHART_DIR}" -f "${CHART_DIR}/values.yaml")"
DEV_KINDS="$(echo "${DEV_OUT}" | grep -c '^kind:' || true)"
log "  dev resources: ${DEV_KINDS}"
[[ "${DEV_KINDS}" -ge 30 ]] || fail "dev mode produced ${DEV_KINDS} resources (expected ≥ 30)"

# 3. Cluster-mode render — must produce significantly more resources because
#    every HA toggle turns on additional StatefulSets / PDBs / Services.
log "render (cluster mode)"
HA_OUT="$(helm template "${RELEASE_NAME}" "${CHART_DIR}" -f "${CHART_DIR}/values.yaml" -f "${CHART_DIR}/values-cluster.yaml")"
HA_KINDS="$(echo "${HA_OUT}" | grep -c '^kind:' || true)"
log "  cluster resources: ${HA_KINDS}"
[[ "${HA_KINDS}" -ge 80 ]] || fail "cluster mode produced ${HA_KINDS} resources (expected ≥ 80)"

# 4. HA mode MUST include each critical HA component.
REQUIRED_HA_NAMES=(
  "vigil-apex-etcd"
  "vigil-apex-postgres"          # Patroni statefulset
  "vigil-apex-vault"             # Raft statefulset
  "vigil-apex-redis"             # Sentinel statefulset
  "vigil-apex-ipfs"
  "vigil-apex-neo4j"
  "vigil-apex-fabric-orderer"
  "vigil-apex-fabric-peer"
  "vigil-apex-tor"
  "vigil-apex-keycloak"
  "vigil-apex-prometheus"
  "vigil-apex-alertmanager"
  "vigil-apex-grafana"
  "vigil-apex-falco"
)
for name in "${REQUIRED_HA_NAMES[@]}"; do
  if ! echo "${HA_OUT}" | grep -q "name: ${name}"; then
    fail "HA render missing required component: ${name}"
  fi
done
log "  all 14 HA components present"

# 5. PodDisruptionBudgets — every multi-replica stateful service must have one.
REQUIRED_PDBS=("etcd" "vault-raft" "redis" "ipfs" "fabric-orderer" "keycloak" "alertmanager")
for pdb in "${REQUIRED_PDBS[@]}"; do
  if ! echo "${HA_OUT}" | grep -B1 "kind: PodDisruptionBudget" | grep -q "vigil-apex-${pdb}"; then
    fail "HA render missing PodDisruptionBudget for: ${pdb}"
  fi
done
log "  all 7 required PDBs present"

# 6. Confirm the dev mode does NOT include HA-only services.
DEV_ONLY_FORBIDDEN=("vigil-apex-etcd-0" "vigil-apex-fabric-orderer-0" "vigil-apex-falco")
for forb in "${DEV_ONLY_FORBIDDEN[@]}"; do
  if echo "${DEV_OUT}" | grep -q "${forb}"; then
    fail "dev mode unexpectedly contains HA-only component: ${forb}"
  fi
done
log "  dev mode correctly excludes HA-only services"

log "OK — chart renders cleanly in both modes"
