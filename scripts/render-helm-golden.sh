#!/usr/bin/env bash
# Mode 9.1 Tier 2 — render the canonical helm-template output for each
# environment + commit as a "golden" reference manifest. CI's
# `helm-golden-drift` job diffs the live `helm template` output against
# these goldens; any drift fails the job until the architect
# re-renders + commits.
#
# Usage:
#   scripts/render-helm-golden.sh           # render all envs to infra/k8s/charts/vigil-apex/golden/
#   scripts/render-helm-golden.sh dev       # render only the dev golden
#   scripts/render-helm-golden.sh --verify  # render in-memory + diff against committed golden (CI mode)
#
# Activation status (Phase 12a → Phase 12b transition):
#   The script is committed now; goldens are NOT committed yet.
#   The first architect-run of this script (with no --verify) produces
#   the goldens that ground the CI diff. Until that run lands, the
#   helm-golden-drift CI job skips with a notice.
#
# Requires: helm v3.x on PATH. The CI job installs it via a
# SHA-pinned action.

set -euo pipefail

CHART_DIR="infra/k8s/charts/vigil-apex"
GOLDEN_DIR="${CHART_DIR}/golden"

if ! command -v helm >/dev/null 2>&1; then
  echo "[render-helm-golden] FAIL: helm not on PATH. Install helm v3.x first." >&2
  exit 2
fi

mkdir -p "${GOLDEN_DIR}"

# Each env's golden = `helm template` output with that env's values.
declare -A ENV_VALUES=(
  [dev]="${CHART_DIR}/values.yaml ${CHART_DIR}/values-dev.yaml"
  [prod]="${CHART_DIR}/values.yaml ${CHART_DIR}/values-prod.yaml"
  [cluster]="${CHART_DIR}/values.yaml ${CHART_DIR}/values-prod.yaml ${CHART_DIR}/values-cluster.yaml"
)

verify_mode=0
single_env=""
if [ "${1:-}" = "--verify" ]; then
  verify_mode=1
elif [ -n "${1:-}" ]; then
  single_env="$1"
fi

drift=0
for env in "${!ENV_VALUES[@]}"; do
  if [ -n "${single_env}" ] && [ "${single_env}" != "${env}" ]; then
    continue
  fi
  golden_file="${GOLDEN_DIR}/${env}.yaml"
  # Build the helm-template invocation. Each value file becomes a `-f`.
  args=()
  for f in ${ENV_VALUES[$env]}; do
    args+=(-f "$f")
  done
  rendered=$(helm template vigil "${CHART_DIR}" "${args[@]}" 2>&1)
  if [ "${verify_mode}" = "1" ]; then
    if [ ! -f "${golden_file}" ]; then
      echo "::notice::No golden at ${golden_file}; skipping ${env}. Run scripts/render-helm-golden.sh (no --verify) to generate."
      continue
    fi
    if ! diff -u "${golden_file}" <(echo "${rendered}") > /tmp/golden-${env}.diff; then
      echo "::error::DRIFT in ${env}: live helm-template output differs from ${golden_file}"
      head -40 /tmp/golden-${env}.diff
      drift=$((drift + 1))
    else
      echo "[render-helm-golden] ${env}: clean (matches ${golden_file})"
    fi
  else
    echo "${rendered}" > "${golden_file}"
    echo "[render-helm-golden] wrote ${golden_file} ($(echo "${rendered}" | wc -l) lines)"
  fi
done

if [ "${verify_mode}" = "1" ] && [ "${drift}" -gt 0 ]; then
  echo "[render-helm-golden] FAIL: ${drift} env(s) drifted." >&2
  exit 1
fi

echo "[render-helm-golden] OK"
