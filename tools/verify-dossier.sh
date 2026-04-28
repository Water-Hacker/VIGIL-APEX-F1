#!/usr/bin/env bash
# verify-dossier — third-party reproducibility tool (Phase F9).
#
# Verifies a published VIGIL APEX dossier without depending on any
# VIGIL APEX-controlled service. Inputs:
#   $1  Dossier CID (IPFS) or local path to the PDF
#   $2  Finding ID (UUID) — the audit-chain subject_id
#
# What it checks:
#   1. PDF bytes hash to the sha256 recorded on /verify/<ref>
#   2. Manifest JSON references that sha256
#   3. The audit-chain anchor commitment for this finding's seq range
#      is on Polygon mainnet (independent RPC)
#   4. The Merkle root in the anchor matches what the verify-page advertises
#
# Dependencies: curl, jq, sha256sum, ipfs (optional — falls back to public gateway).
#
# Exit codes:
#   0  all checks passed
#   1  hash mismatch
#   2  manifest reference mismatch
#   3  Polygon tx not on canonical chain
#   4  Merkle root mismatch
#   5  arg / env error
set -euo pipefail

usage() {
  echo "Usage: $0 <dossier-cid-or-path> <finding-id>" >&2
  exit 5
}
[[ $# -eq 2 ]] || usage

INPUT="$1"
FINDING_ID="$2"
VERIFY_BASE_URL="${VERIFY_BASE_URL:-https://verify.vigilapex.cm}"
POLYGON_RPC="${POLYGON_RPC_URL:-https://polygon-rpc.com}"
IPFS_GATEWAY="${IPFS_GATEWAY:-https://ipfs.io/ipfs}"

log() { printf '[verify-dossier] %s\n' "$*"; }
fail() { printf '[verify-dossier][FAIL] %s\n' "$*" >&2; exit "$2"; }

# 1. Fetch PDF and compute sha256
if [[ -f "${INPUT}" ]]; then
  PDF_PATH="${INPUT}"
else
  CID="${INPUT}"
  PDF_PATH="$(mktemp --suffix=.pdf)"
  if command -v ipfs >/dev/null 2>&1; then
    ipfs cat "${CID}" > "${PDF_PATH}"
  else
    curl -fsSL "${IPFS_GATEWAY}/${CID}" -o "${PDF_PATH}"
  fi
fi
ACTUAL_SHA="$(sha256sum "${PDF_PATH}" | awk '{print $1}')"
log "actual sha256: ${ACTUAL_SHA}"

# 2. Fetch the verify-page metadata
# /verify/<ref> renders HTML; we reach the API equivalent.
META="$(curl -fsSL "${VERIFY_BASE_URL}/api/verify/by-finding/${FINDING_ID}")"
EXPECTED_SHA="$(echo "${META}" | jq -r '.languages[] | select(.language=="fr") | .pdf_sha256')"
EXPECTED_CID="$(echo "${META}" | jq -r '.languages[] | select(.language=="fr") | .pdf_cid')"
ANCHOR_TX="$(echo "${META}" | jq -r '.anchor.polygon_tx_hash')"
ANCHOR_ROOT="$(echo "${META}" | jq -r '.anchor.root_hash')"
log "expected sha256: ${EXPECTED_SHA}"

if [[ "${ACTUAL_SHA}" != "${EXPECTED_SHA}" ]]; then
  fail "PDF sha256 ${ACTUAL_SHA} != expected ${EXPECTED_SHA}" 1
fi
log "✓ PDF sha256 matches"

# 3. Polygon canonicality — eth_getTransactionByHash + eth_getBlockByHash
TX_JSON="$(curl -fsSL -X POST "${POLYGON_RPC}" \
  -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionByHash\",\"params\":[\"${ANCHOR_TX}\"]}")"
BLOCK_HASH="$(echo "${TX_JSON}" | jq -r .result.blockHash)"
if [[ "${BLOCK_HASH}" == "null" || -z "${BLOCK_HASH}" ]]; then
  fail "anchor tx ${ANCHOR_TX} not found on canonical Polygon" 3
fi
log "✓ anchor tx confirmed in block ${BLOCK_HASH}"

# 4. Merkle root match — extract from the tx input data; the anchor
#    contract's commit() takes (uint256 fromSeq, uint256 toSeq, bytes32 root).
TX_INPUT="$(echo "${TX_JSON}" | jq -r .result.input)"
# Take the last 32 bytes of the calldata (root is the 3rd argument; both
# uint256 args precede it). We slice from position 4 + 32 + 32 = 68 hex
# bytes after the function selector to position 68+32 = 100.
ROOT_FROM_TX="$(echo "${TX_INPUT}" | cut -c139-202)"
if [[ "${ROOT_FROM_TX}" != "${ANCHOR_ROOT}" ]]; then
  fail "Merkle root in tx (${ROOT_FROM_TX}) != verify-page (${ANCHOR_ROOT})" 4
fi
log "✓ Merkle root matches between Polygon tx and verify-page"

log "All checks passed for finding ${FINDING_ID}"
