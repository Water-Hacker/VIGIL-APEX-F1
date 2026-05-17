# Runbook — Fabric orderer replacement

> One of the 3 Fabric orderers (Raft consenters block in
> `infra/docker/fabric/configtx.yaml`) is permanently lost — hardware
> death, host re-image, irrecoverable disk corruption — and a fresh
> orderer node must be enrolled to restore the 3-orderer quorum the
> migration plan targets.
>
> **Severity:** WARNING during normal hours; URGENT if any other
> orderer is unhealthy.
> **Owner:** the architect (solo) until Phase-2 multi-org expansion
> introduces CONAC + Cour des Comptes peers.
> **Last updated:** 2026-05-17 (T9 of TODO.md sweep).

---

## When this runbook applies

Use this runbook when:

- One specific orderer (`vigil-fabric-orderer-{a,b,c}`) is permanently
  gone AND you have a clean host to enrol a replacement on. Persistent
  hardware loss, not transient unreachability.
- The remaining 2 orderers are healthy and forming Raft quorum (verify
  with `osnadmin channel list --orderer-address vigil-fabric-orderer-b:7053`).

Do **not** use this runbook when:

- The orderer is unreachable but the host is fine (transient network).
  Restart the orderer container; if it rejoins, no replacement is
  needed.
- ALL 3 orderers are down. That is a P0 disaster-recovery scenario;
  follow [R6-dr-rehearsal.md](./R6-dr-rehearsal.md) full-restore
  procedure, not this runbook.
- The peer (not orderer) is lost. See [fabric.md](fabric.md) §"Peer
  replacement" — peers are stateful on the application chain, not the
  consenter set.

---

## Healthy-state baseline

Before starting, capture the baseline so you can verify success:

```bash
# All 3 orderers reachable; channel block-heights match.
for o in a b c; do
  echo "--- orderer-${o} ---"
  docker exec vigil-fabric-peer0-org1 peer channel getinfo \
    -c vigil-audit \
    --orderer "vigil-fabric-orderer-${o}:7053" \
    --tls --cafile /etc/hyperledger/fabric/tls/ca.crt
done
```

Expected: identical `Height` values for orderer-a, orderer-b,
orderer-c. Pin the value (e.g. height = 12_345) — it's your
"chain at incident time" marker for the post-replacement audit row.

```bash
# Current consenter set should still show 3 entries.
osnadmin channel info --channelID vigil-audit \
  --orderer-address vigil-fabric-orderer-b:7053 \
  --ca-file /etc/hyperledger/fabric/tls/ca.crt
```

---

## Step 1 — Identify the lost orderer + decide on a replacement

Determine which orderer is permanently gone (call it `orderer-X`).
Decide whether the replacement will:

- **Re-use the same node identity** (same hostname, same TLS subject
  altname). Easier — chaincode + peer configs don't change. Requires
  re-issuing the same TLS cert from Fabric CA.
- **Be a NEW node identity** (different hostname). Cleaner forensics
  separation but requires a `configtx` consenter swap.

The migration plan's pinned hostnames are
`vigil-fabric-orderer-{a,b,c}:7053`; if you can re-use the same
hostname on the replacement host, prefer re-issue.

---

## Step 2 — Provision the replacement host

The replacement host must:

- Be on the cluster interconnect VLAN (10.50.0.0/24 per the migration
  plan).
- Run the same OS/Docker version as the surviving orderers
  (verify with `docker exec vigil-fabric-orderer-b cat /etc/os-release`).
- Have the same image-digest-pinned Fabric image (see
  [`infra/docker/image-digests.lock`](../../infra/docker/image-digests.lock)
  entry for `hyperledger/fabric-orderer:2.5.10`).

Mount the new host's data directories per the surviving orderer's
compose entry:

```yaml
volumes:
  - /srv/vigil/fabric/orderer-${X}/data:/var/hyperledger/production
  - /srv/vigil/fabric/orderer-${X}/tls:/etc/hyperledger/fabric/tls:ro
  - /srv/vigil/fabric/orderer-${X}/msp:/etc/hyperledger/fabric/msp:ro
```

---

## Step 3 — Regenerate the orderer's TLS material

```bash
# Run on the Fabric-CA host (vigil-fabric-ca-org1 by default).
docker exec vigil-fabric-ca-org1 fabric-ca-client enroll \
  -u "https://${ADMIN_NAME}:${ADMIN_PASS}@vigil-fabric-ca-org1:7054" \
  --tls.certfiles /etc/hyperledger/fabric-ca-server/tls-cert.pem

docker exec vigil-fabric-ca-org1 fabric-ca-client register \
  --id.name "orderer-${X}" \
  --id.type orderer \
  --id.affiliation org1.orderer

docker exec vigil-fabric-ca-org1 fabric-ca-client enroll \
  --enrollment.profile tls \
  --csr.hosts "vigil-fabric-orderer-${X}" \
  -u "https://orderer-${X}:enrollPassword@vigil-fabric-ca-org1:7054" \
  -M "/etc/hyperledger/fabric-ca/orderer-${X}/tls"
```

Capture (a) the new `server.crt`, (b) the new `server.key`, (c) the
chain CA cert. Copy them into the replacement host's
`/srv/vigil/fabric/orderer-${X}/tls/` directory.

---

## Step 4 — Update the channel consenter set

If re-using the same node identity (same hostname, regenerated TLS
cert) — only the cert needs swapping in the `Consenters[].ClientTLSCert`

- `Consenters[].ServerTLSCert` fields of
  [`infra/docker/fabric/configtx.yaml`](../../infra/docker/fabric/configtx.yaml).

If using a new node identity — also update the `Host` /
`OrdererEndpoints` entries.

Fetch the current channel config:

```bash
peer channel fetch config /tmp/config_block.pb \
  -c vigil-audit \
  --orderer vigil-fabric-orderer-b:7053 \
  --tls --cafile /etc/hyperledger/fabric/tls/ca.crt

configtxlator proto_decode --input /tmp/config_block.pb \
  --type common.Block --output /tmp/config_block.json
jq '.data.data[0].payload.data.config' /tmp/config_block.json > /tmp/config.json
```

Apply the consenter edit, re-encode, sign:

```bash
# Edit /tmp/config.json: replace the lost orderer's ClientTLSCert /
# ServerTLSCert (base64) with the freshly-issued cert.
configtxlator proto_encode --input /tmp/config.json \
  --type common.Config --output /tmp/config.pb
configtxlator proto_encode --input /tmp/modified_config.json \
  --type common.Config --output /tmp/modified_config.pb
configtxlator compute_update --channel_id vigil-audit \
  --original /tmp/config.pb --updated /tmp/modified_config.pb \
  --output /tmp/config_update.pb
```

Submit the update via `osnadmin channel update`:

```bash
osnadmin channel update --channelID vigil-audit \
  --config-block /tmp/config_update.pb \
  --orderer-address vigil-fabric-orderer-b:7053 \
  --ca-file /etc/hyperledger/fabric/tls/ca.crt
```

The two surviving orderers form Raft quorum (2 of 3 is sufficient
to commit the config update). The new orderer joins on next start.

---

## Step 5 — Start the replacement orderer

```bash
docker compose up -d vigil-fabric-orderer-${X}
docker compose logs -f vigil-fabric-orderer-${X}
```

Expected log line within ~30 s:
`Beginning to serve requests` followed by Raft heartbeat lines from
the other 2 orderers.

Verify it caught up:

```bash
docker exec vigil-fabric-peer0-org1 peer channel getinfo \
  -c vigil-audit \
  --orderer "vigil-fabric-orderer-${X}:7053" \
  --tls --cafile /etc/hyperledger/fabric/tls/ca.crt
```

Height should match the baseline you captured in §Healthy-state.

---

## Step 6 — Audit-chain emission

Submit an audit-chain record of the replacement so the on-chain
witness trail captures the event:

```bash
psql "${POSTGRES_URL}" -c "
  INSERT INTO audit.actions (action, actor, subject_kind, subject_id, occurred_at, payload)
  VALUES (
    'fabric.orderer_replaced',
    'architect@vigilapex.cm',
    'orderer',
    'vigil-fabric-orderer-${X}',
    now(),
    jsonb_build_object(
      'old_node_id', 'orderer-${X}-pre-incident',
      'new_node_id', 'orderer-${X}',
      'baseline_height', ${BASELINE_HEIGHT},
      'post_replacement_height', ${POST_HEIGHT},
      'replacement_reason', 'hardware_loss',
      'config_update_tx_id', '${CONFIG_UPDATE_TX_ID}'
    )
  );
"
```

The next reconciliation tick of worker-reconcil-audit verifies
Postgres↔Fabric agreement; if it fires
`audit.reconciliation_divergence`, the replacement was incomplete
(the new orderer's height does not match expected). Open
[audit-chain-divergence.md](audit-chain-divergence.md).

---

## Step 7 — Verify quorum tolerance + rehearse fallback

Re-run the healthy-state baseline. Then exercise a 1-of-3 fault to
prove quorum survives loss of any one orderer:

```bash
docker compose stop vigil-fabric-orderer-${X}
# Submit a probe transaction via the peer; verify it commits.
docker exec vigil-fabric-peer0-org1 peer chaincode invoke \
  -C vigil-audit -n audit-witness \
  -c '{"function":"NoOp","Args":[]}' \
  --orderer vigil-fabric-orderer-b:7053 \
  --tls --cafile /etc/hyperledger/fabric/tls/ca.crt
# Expected: success within 2 s.

docker compose start vigil-fabric-orderer-${X}
```

If the probe transaction succeeded with one orderer down, Raft
quorum is correctly tolerating a 1-node failure. Append a second
`audit.actions` row recording the quorum-tolerance verification.

---

## Step 8 — Incident write-up

Within 7 days, append an entry to
[docs/decisions/log.md](../decisions/log.md):

- Detection timestamp + failure mode (hardware, host re-image, disk
  corruption).
- Replacement strategy (same identity / new identity).
- Baseline + post-replacement heights.
- Configuration update transaction ID.
- Audit-chain row IDs for the `fabric.orderer_replaced` +
  quorum-tolerance-verified events.
- Follow-up actions to prevent recurrence (e.g. tighter disk
  monitoring, faster spare-hardware turnaround).

---

## Related runbooks

- [fabric.md](fabric.md) — general Fabric ops + peer replacement.
- [worker-fabric-bridge.md](worker-fabric-bridge.md) — bridge between
  Postgres audit chain and Fabric chaincode.
- [worker-reconcil-audit.md](worker-reconcil-audit.md) —
  reconciliation worker that detects orderer-replacement-induced
  divergence.
- [audit-chain-divergence.md](audit-chain-divergence.md) — P0 path if
  the replacement introduces witness disagreement.
- [vault-raft-reattach.md](vault-raft-reattach.md) — analogue runbook
  for Vault's separate Raft cluster.
- [hardware-swap.md](hardware-swap.md) — host-level component
  replacement (covers the hardware path that motivates this runbook).

## Related migration-plan section

`/home/kali/.claude/plans/crispy-pondering-teapot.md` — "Fabric:
3 orderers in a Raft consenters block (etcdraft)" + the
"Failure-mode catalogue" row for Fabric orderer failure.
