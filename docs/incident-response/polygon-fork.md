# IR-03 — Polygon mainnet fork past last anchor

**Severity:** warning (auto-escalates to critical if the fork persists
for > 6 h or affects more than 24 confirmations). **Roles needed:**
architect, technical-pillar council member.

Polygon mainnet undergoes a chain reorganisation past
`audit.anchor_commitment.polygon_confirmed_at`. The on-chain root we
published may no longer be in the canonical history, threatening the
external verifiability of dossiers anchored in the affected window.

## Detection
- AlertManager `PolygonAnchorFailing` (Prometheus rule). Operators see
  growth in `vigil_polygon_anchor_total{outcome="failed"}`.
- `worker-anchor` logs show `tx-not-canonical` warnings.

## Triage (15 min)
1. **Confirm scope.** Query the canonical chain:
   ```sh
   curl -s -X POST $POLYGON_RPC_URL \
     -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["latest",false]}' \
     | jq .result.number
   ```
   Compare against `MAX(seq_to)` of `audit.anchor_commitment` whose
   `polygon_confirmed_at` is within the reorg window.
2. **Polygonscan check.** Search the affected `polygon_tx_hash` —
   "tx not in main chain" confirms the reorg.

## Containment (1 hr)
3. **Pause new anchors.** Stop `worker-anchor` so we don't keep adding
   anchors that may also disappear:
   ```sh
   docker compose stop worker-anchor
   ```
4. **Increase confirmation depth.** Edit
   `apps/worker-anchor/src/index.ts` `MIN_CONFIRMATIONS` from 24 to
   72 (≈ 4 hours at Polygon block time). Build + deploy.

## Recovery (24 h)
5. **Re-anchor the affected range.** Once Polygon stabilises, run:
   ```sh
   docker compose run --rm worker-anchor \
       node dist/index.js --reanchor-from=<seq_from> --reanchor-to=<seq_to>
   ```
   The hash chain is unaffected (it lives in Postgres); we publish a
   new anchor commitment with the same root over the same range.
6. **Update verify-page metadata.** The `/verify/<ref>` page reads
   the most recent anchor — no code change needed once the new anchor
   confirms.

## Postmortem
7. Within 14 days. Includes whether the chosen anchor cadence
   (1/hour) is appropriate or should be tightened to 1/15min for
   high-severity dossiers (separate stream).
