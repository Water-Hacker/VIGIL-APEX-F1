# R10 — Federation key rotation (per region, every 90 days)

**When to run:** every 90 days for each operational region, OR
on demand if a regional federation-signer key is suspected
compromised. The rotation ladder is staggered by 9 days between
regions so two regions never rotate on the same day under
normal operation.

**Status:** scaffold-only until any region is operational. The
runbook is reviewable now as part of the council architectural-
review brief; first execution is on day 90 after a region's
cutover (R9).

---

## Cadence overview

| Material | Cadence | Authority |
|---|---|---|
| Per-region federation-signer ed25519 key (this runbook) | 90 days | Architect, with 2-of-5 council witness |
| Per-region Vault subordinate CA | 2 years | Architect, with 4-of-5 architectural-review vote (R9-style ceremony) |
| Yaoundé root CA | 10 years | Architect + full 5-of-5 council ceremony |
| WireGuard peer pubkeys | 6 months | Architect alone; logged |
| Regional NAS rsync module credentials | 6 months | Architect alone; logged |

This runbook covers **only** the 90-day federation-signer
rotation. The 2-year subordinate CA rotation is documented
separately under §22 of the v5.1 agreement and uses the R9
runbook with a `--rotate-subordinate` flag.

---

## Why 90 days

The federation-signer key is the key the regional agent uses to
sign every event envelope. A 90-day window:

- Bounds the blast radius of a compromised regional NAS to 90
  days of forged envelopes (the Yaoundé core's audit-verifier
  catches inconsistencies at hour-grain, but a sophisticated
  attacker who controls the regional NAS could backfill
  consistent forgeries within the window).
- Aligns with the Vault PKI's default `max_ttl=2160h` on the
  `federation-signer` role (set in
  `infra/host-bootstrap/13-vault-pki-federation.sh`).
- Is short enough to amortise the operational cost (one
  ceremony per region per quarter is sustainable for the
  architect) without being so short that it becomes routine
  enough to be skipped under pressure.

A change to this cadence requires a council 4-of-5 vote.

---

## Stagger schedule

The 10 regions rotate on a 90-day cycle, staggered 9 days apart
so two regions never rotate on the same day:

| Region | Day offset within the 90-day cycle |
|---|---|
| CE | 0 |
| LT | 9 |
| NW | 18 |
| SW | 27 |
| OU | 36 |
| SU | 45 |
| ES | 54 |
| EN | 63 |
| NO | 72 |
| AD | 81 |

The architect computes each region's next rotation date as
`(R9-cutover-date) + (offset days) + (90 days × n)` for
n=1, 2, 3, …

---

## 1. Pre-rotation checks (~10 minutes)

```sh
export REGION_CODE="CE"   # the region rotating today
export REGION_LOWER=$(printf '%s' "$REGION_CODE" | tr '[:upper:]' '[:lower:]')

# Confirm no pending envelopes in the regional agent's WAL.
ssh ops@k3s-${REGION_LOWER}.regions.vigilapex.cm \
    'kubectl exec -n vigil-region-'${REGION_LOWER}' deploy/federation-agent -- \
       /usr/local/bin/vigil-federation-wal-stats'
# Expect: "pending=0 in_flight=0" — if non-zero, wait for drain.

# Confirm the receiver on Yaoundé core has acked the agent's last batch.
docker logs vigil-worker-federation-receiver --tail=50 \
    | grep "region=${REGION_CODE}" | tail -1
# Expect: a recent (< 5 min) envelope-accepted line.
```

If WAL non-empty, **wait** for drain before proceeding. Rotating
mid-batch is recoverable but adds rework — better to wait.

---

## 2. Issue the new federation-signer key (~5 minutes)

```sh
# Architect-policy token required.
ROTATION_SEQ=$(($(vault read -field=rotation_seq \
    "secret/vigil/federation-signer-meta/${REGION_CODE}" 2>/dev/null || echo 1) + 1))

vault write -format=json \
    "pki-region-${REGION_LOWER}/issue/federation-signer" \
    common_name="region-${REGION_LOWER}.vigilapex.cm" \
    ttl="2160h" \
    > /run/vigil/secrets/federation-signer-${REGION_CODE}.json.new

# Bump the rotation_seq counter so the new key id is e.g. "CE:2".
vault kv put "secret/vigil/federation-signer-meta/${REGION_CODE}" \
    rotation_seq="${ROTATION_SEQ}" \
    rotated_at="$(date -uIs)"
```

The new key id is `${REGION_CODE}:${ROTATION_SEQ}`. The architect
records this id in the rotation log entry created in §6.

---

## 3. Publish the new public key to the core's resolver (~2 minutes)

The core's federation-receiver looks up `signing_key_id` against
its KeyResolver. The resolver pulls from
`secret/vigil/federation-signer/${REGION_CODE}/${ROTATION_SEQ}`.

```sh
# Stash the new cert (the ed25519 pubkey is embedded in the cert).
jq -r '.data.certificate' \
    /run/vigil/secrets/federation-signer-${REGION_CODE}.json.new \
    > /tmp/cert-new-${REGION_CODE}.crt

vault kv put \
    "secret/vigil/federation-signer/${REGION_CODE}/${ROTATION_SEQ}" \
    cert=@/tmp/cert-new-${REGION_CODE}.crt \
    valid_from="$(date -uIs)"

# Restart the receiver's KeyResolver cache (or signal it to reload).
docker exec vigil-worker-federation-receiver \
    /usr/local/bin/reload-key-resolver
```

The new key id is now resolvable on the core. The OLD key id
remains valid until §5 — both keys overlap during the cutover
window so envelopes signed with either one verify cleanly.

---

## 4. Roll the regional agent to the new key (~10 minutes)

The regional agent's `signingKeyId` and the mounted
`/run/vigil/secrets/federation-signer.key` both flip atomically
via a Helm upgrade.

```sh
# Push the new private key into the regional Vault.
ssh ops@k3s-${REGION_LOWER}.regions.vigilapex.cm \
    "vault kv put secret/vigil/federation-signer/current \
       private_key=@/dev/stdin signing_key_id=${REGION_CODE}:${ROTATION_SEQ}" \
    < /run/vigil/secrets/federation-signer-${REGION_CODE}.json.new

# Helm upgrade with the new signing-key id.
helm upgrade "vigil-region-${REGION_CODE}" \
    infra/k8s/charts/regional-node \
    --namespace "vigil-region-${REGION_LOWER}" \
    --reuse-values \
    --set "region.signingKeyId=${REGION_CODE}:${ROTATION_SEQ}"

# Wait for the agent to pick up the new key (Helm rollout strategy: Recreate).
kubectl -n "vigil-region-${REGION_LOWER}" \
    rollout status deploy/federation-agent --timeout=180s
```

---

## 5. Verify and revoke the old key (~10 minutes)

```sh
# Confirm the agent is signing with the new key id.
docker logs vigil-worker-federation-receiver --tail=20 \
    | grep "region=${REGION_CODE}" \
    | grep "signing_key_id=${REGION_CODE}:${ROTATION_SEQ}"
# Expect: at least one envelope accepted with the new id within 60 s.

# Revoke the old key id at the receiver. The OLD cert remains in
# the Vault PKI CRL for forensic review, but no further
# envelopes signed with the OLD key are accepted.
OLD_SEQ=$((ROTATION_SEQ - 1))
docker exec vigil-worker-federation-receiver \
    /usr/local/bin/revoke-key-id "${REGION_CODE}:${OLD_SEQ}"

# Add to Vault PKI CRL.
OLD_SERIAL=$(jq -r '.data.serial_number' \
    /run/vigil/secrets/federation-signer-${REGION_CODE}.json)
vault write "pki-region-${REGION_LOWER}/revoke" \
    serial_number="${OLD_SERIAL}"
```

The 90-day clock for the next rotation starts now.

---

## 6. Council-witness audit row (~5 minutes)

The 90-day rotation requires a 2-of-5 council witness (lighter
than the 3-of-5 ceremony for unseal). The two witnesses join a
brief video call; the architect sends each a one-time confirm
link that lands in the audit row as a counter-signature.

```sh
docker exec -it vigil-postgres psql -U vigil -d vigil -c "
INSERT INTO audit.actions (action, actor, payload, signed_by_yubikey)
VALUES (
  'phase3.region.signing-key.rotated',
  'architect',
  jsonb_build_object(
    'region', '${REGION_CODE}',
    'old_key_id', '${REGION_CODE}:${OLD_SEQ}',
    'new_key_id', '${REGION_CODE}:${ROTATION_SEQ}',
    'witnesses', ARRAY['<<pillar1>>','<<pillar2>>']
  ),
  true
);"
```

Append to `docs/decisions/log.md` under a `## YYYY-MM-DD —
Federation key rotation: <region>` heading: rotation date, old
and new key ids, witness pillars, any operational anomalies.

---

## 7. Shred the old key material

```sh
# On the Yaoundé core:
shred -u /run/vigil/secrets/federation-signer-${REGION_CODE}.json
mv /run/vigil/secrets/federation-signer-${REGION_CODE}.json.new \
   /run/vigil/secrets/federation-signer-${REGION_CODE}.json
shred -u /tmp/cert-new-${REGION_CODE}.crt
```

The OLD private key is now non-recoverable.

---

## 8. Failure modes and recovery

| Failure | Symptom | Recovery |
|---|---|---|
| New key issued but agent never picks it up | `kubectl rollout status` times out | Roll back the helm upgrade; the OLD key remains valid; investigate the regional Vault sync. |
| Receiver rejects the new key id with `KEY_UNKNOWN` | Step 5's verify line is missing | Force a KeyResolver reload on the core; check Step 3 succeeded. |
| Old key revocation runs before agent has picked up new key | Envelopes pile up in the agent's WAL | Re-issue the OLD cert (still in Vault history), unrevoke; investigate before re-rotating. |
| Witness pillar unavailable on rotation day | Architect cannot complete §6 | Defer rotation by ≤ 7 days; if witness unavailability is structural, pause rotations and convene the council. |

---

## 9. Emergency rotation (compromise suspected)

If a regional federation-signer key is suspected compromised
(lost laptop, ransomware on regional admin workstation,
council-pillar forensic finding), the architect invokes
emergency rotation **immediately**, not on the 90-day cadence.

The procedure is identical to §1–§7, except:

1. §6 witness ceremony reduces to **1-of-5 pillar** witness (any
   available pillar) so the architect is not blocked by
   simultaneous-availability constraints.
2. The architect convenes a full council session within 7 days
   to review the compromise and decide whether the regional
   subordinate CA must also be rotated (the heavier 2-year
   ceremony). Council signs a finding under §22.

The audit-row `action` becomes
`phase3.region.signing-key.rotated.emergency` and includes a
`reason` field naming the suspected compromise.
