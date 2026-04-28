# R9 — Phase-3 federation cutover (per-region)

**When to run:** the Governance Council has voted **4-of-5** in
favour of the Phase-3 architecture (per
`docs/institutional/council-phase-3-review.md`), CEMAC funding
has been released against the $1.2M–$1.8M envelope, and the
regional hardware for the target region is racked and reachable
on the WireGuard mesh.

**Cutover target:** one Cameroonian region per execution. Run
this runbook **ten times**, once per region, in the strict
order CE → LT → NW → OU → SW → SU → ES → EN → NO → AD. Do
**not** parallelise. A failed region halts the sequence; the
architect resolves and re-attempts before advancing.

**Status:** scaffold-only until the council vote and CEMAC
funding both clear. The architect is not authorised to begin
this runbook before both gates pass.

---

## Prerequisites (per region)

| Requirement | Why | Source artefact |
|---|---|---|
| Council 4-of-5 vote on file | Architectural authority | `docs/institutional/council-votes/phase-3-<UTC>.md` |
| CEMAC funding tranche released for this region | Operational authority | finance ministry cover letter |
| Regional rack: server + NAS + UPS + redundant uplinks | Hardware floor | per-region procurement record |
| WireGuard peer reachable from the Yaoundé core | Federation hop | `wg show wg-vigil` lists the peer |
| Per-region Vault subordinate already issued (K3) | PKI delegation | `/run/vigil/region-cas/<CODE>.cert.pem` exists |
| `infra/k8s/charts/regional-node/values-<CODE>.yaml` matches the region | Helm input | K5 deliverable |
| K3s installed on the regional server | Cluster runtime | `k3s kubectl get nodes` reports Ready |
| 3-of-5 council quorum present at the regional Vault unseal ceremony | Trust ceremony | council attestation row in `audit.actions` |
| `regional rsyncd.conf` mode `read only = yes`, module `vigil-region-<lowercase code>` | NAS pull safety | regional NAS config commit |

If any prerequisite is missing, **stop**. Do not begin the cutover
without the missing prerequisite. The architect updates
`docs/decisions/log.md` with the blocker and re-presents to the
council if the blocker requires re-vote.

---

## 1. Pre-flight checks (~30 minutes)

Set the region you are cutting over:

```sh
export REGION_CODE="CE"   # or LT, NW, SW, OU, SU, ES, EN, NO, AD
export REGION_LOWER=$(printf '%s' "$REGION_CODE" | tr '[:upper:]' '[:lower:]')
```

### 1.1 Verify the per-region Vault subordinate is healthy

```sh
# From the Yaoundé core, with VAULT_TOKEN under architect policy:
vault list "pki-region-${REGION_LOWER}/roles"   # expect "federation-signer"
vault read "pki-region-${REGION_LOWER}/cert/ca" # expect a non-empty cert
```

### 1.2 Verify the regional WireGuard peer is reachable

```sh
ping -c 3 nas-${REGION_LOWER}.regions.vigilapex.cm
ssh ops@nas-${REGION_LOWER}.regions.vigilapex.cm 'systemctl is-active rsyncd'
```

### 1.3 Verify the regional K3s cluster is up

```sh
ssh ops@k3s-${REGION_LOWER}.regions.vigilapex.cm \
    'k3s kubectl get nodes -o wide'
```

### 1.4 Snapshot the Yaoundé core state

```sh
# So we have a clean rollback point.
sudo /usr/local/bin/vigil-backup
ls -1d /mnt/synology/vigil-archive/* | tail -1
```

Record the snapshot path in `docs/decisions/log.md` under the
cutover entry.

---

## 2. Issue the regional federation-signer key (~10 minutes)

The bootstrap script (K3) provisioned the subordinate CA and the
`federation-signer` role; this step issues the per-region
ed25519 signing key from that role.

```sh
# Architect-policy token required.
vault write -format=json \
    "pki-region-${REGION_LOWER}/issue/federation-signer" \
    common_name="region-${REGION_LOWER}.vigilapex.cm" \
    ttl="2160h" \
    > /run/vigil/secrets/federation-signer-${REGION_CODE}.json

# Extract the key + cert.
jq -r '.data.private_key'  /run/vigil/secrets/federation-signer-${REGION_CODE}.json \
    > /run/vigil/secrets/federation-signer-${REGION_CODE}.key
jq -r '.data.certificate'  /run/vigil/secrets/federation-signer-${REGION_CODE}.json \
    > /run/vigil/secrets/federation-signer-${REGION_CODE}.crt
chmod 0400 /run/vigil/secrets/federation-signer-${REGION_CODE}.{key,crt}
```

The architect then **physically transfers** these two files to
the regional server during the on-site cutover ceremony. Do not
copy them over WireGuard before the ceremony; the regional
server's disk is not yet unlocked.

---

## 3. Regional Vault unseal ceremony (~90 minutes)

This step requires **3-of-5 council quorum** physically present
in the regional capital. The architect arrives 24 hours before
the ceremony with the council members; the ceremony is recorded
on paper (no recording devices in the room per §22.7 of the v5.1
agreement) and the audit-row is written when the architect
returns to the Yaoundé core.

1. Power on the regional server. Do not let it network until
   the next step.
2. Unlock the LUKS root with the regional shamir share + the
   council's quorum-bound shares (3-of-5).
3. Bring up WireGuard: `systemctl start wg-quick@wg-vigil`.
4. Verify the regional server can reach the Yaoundé core's
   Vault: `vault status -address=https://vault.core.vigilapex.cm`.
5. Initialise the regional Vault subordinate against the
   already-existing `pki-region-<code>/` mount on the Yaoundé
   core:

   ```sh
   vault operator init \
       -key-shares=5 -key-threshold=3 \
       -address=http://127.0.0.1:8200 > /tmp/vault-init-${REGION_CODE}.txt
   ```

6. Distribute the 5 unseal shares to the 5 council members via
   the same age-plugin-yubikey wrapping the Yaoundé core uses
   (W-12 fix). The architect retains the recovery-only share
   in a sealed envelope at the Yaoundé safe.
7. Move the federation-signer key from K2 into the regional
   Vault under `secret/vigil/federation-signer/${REGION_CODE}`.
8. Shred `/tmp/vault-init-${REGION_CODE}.txt` and the
   transport copies of `federation-signer-${REGION_CODE}.key`.

The regional Vault is now operational and holds the only
runtime copy of the federation-signer private key.

---

## 4. Helm install on the regional cluster (~20 minutes)

```sh
# From the architect's workstation, with KUBECONFIG pointed at
# the regional K3s cluster.
helm install "vigil-region-${REGION_CODE}" \
    infra/k8s/charts/regional-node \
    --namespace "vigil-region-${REGION_LOWER}" \
    --create-namespace \
    -f "infra/k8s/charts/regional-node/values-${REGION_CODE}.yaml"

# Wait for readiness.
kubectl -n "vigil-region-${REGION_LOWER}" \
    wait --for=condition=ready pod -l app.kubernetes.io/name=adapter-runner \
    --timeout=300s
kubectl -n "vigil-region-${REGION_LOWER}" \
    wait --for=condition=ready pod -l app.kubernetes.io/name=federation-agent \
    --timeout=300s
```

If either Deployment is `CrashLoopBackOff`, capture logs and abort:

```sh
kubectl -n "vigil-region-${REGION_LOWER}" logs -l app.kubernetes.io/name=federation-agent --tail=200
```

The most common failure modes:

| Symptom | Diagnosis | Resolution |
|---|---|---|
| Agent reports `connect: connection refused` to core endpoint | WireGuard tunnel down OR core federation-receiver not yet listening | Check `wg show` on both ends; restart core receiver |
| Agent reports `KEY_UNKNOWN` from receiver | Core hasn't synced the regional cert yet | Wait 60 s for the cert-sync agent; or run it manually on core |
| Agent reports `REGION_MISMATCH` from receiver | `signingKeyId` in values file does not start with the region prefix | Fix `values-${REGION_CODE}.yaml`; helm upgrade |

---

## 5. Wire up multi-site NAS replication (~15 minutes)

On the Yaoundé core, append the region to the multi-site
replication conf and exercise dry-run before the next nightly
timer fires.

```sh
# Append (or set) the host + bandwidth cap. The values come from
# infra/k8s/charts/regional-node/values-${REGION_CODE}.yaml's
# multiSiteReplication.regionalNas section.
sudo $EDITOR /etc/vigil/multi-site-replication.conf

# Exercise the dry-run; expect the new region to appear.
sudo /opt/vigil/host-bootstrap/13-multi-site-replication.sh \
    --dry-run --region "${REGION_CODE}"

# First real pull (out-of-band, before the timer's nightly run).
sudo /opt/vigil/host-bootstrap/13-multi-site-replication.sh \
    --region "${REGION_CODE}"

# Verify .last-success marker exists and is fresh.
stat /srv/vigil/region-archive/${REGION_CODE}/.last-success
```

---

## 6. End-to-end smoke (~30 minutes)

Inject a synthetic envelope from the regional federation-agent
and confirm the Yaoundé core receives + ingests it.

```sh
# On the regional cluster:
kubectl -n "vigil-region-${REGION_LOWER}" exec deploy/federation-agent -- \
    /usr/local/bin/vigil-federation-test-push \
    --source-id "smoke-test" \
    --payload '{"smoke":"test","region":"'${REGION_CODE}'"}'
```

Expected result on the Yaoundé core:

```sh
docker logs vigil-worker-federation-receiver --tail=20 \
    | grep "${REGION_CODE}"
# Expect: "envelope-accepted region=${REGION_CODE} source_id=smoke-test"
```

Cross-witness check (same hour):

```sh
make verify-cross-witness
# Expect: 0 divergences across Postgres ↔ Fabric ↔ Polygon
```

If any of these fail, **roll back** (Section 8) before the
council session that follows the cutover.

---

## 7. Council attestation row (~5 minutes, but ceremonial)

Once the smoke passes, the architect writes the cutover
attestation row to the Yaoundé Postgres `audit.actions`:

```sh
docker exec -it vigil-postgres psql -U vigil -d vigil -c "
INSERT INTO audit.actions (action, actor, payload, signed_by_yubikey)
VALUES (
  'phase3.region.cutover.complete',
  'architect',
  jsonb_build_object(
    'region', '${REGION_CODE}',
    'snapshot_path', '<<from Section 1.4>>',
    'council_quorum_at', '<<3-of-5 ceremony UTC>>',
    'first_envelope_observed_at', now()
  ),
  true
);"
```

The architect's YubiKey touch records the row as
council-witnessed.

---

## 8. Rollback (if needed)

If steps 4–6 fail, roll back to the snapshot from §1.4:

```sh
# 1. Drain the regional federation-agent so it stops sending.
kubectl -n "vigil-region-${REGION_LOWER}" scale deploy federation-agent --replicas=0

# 2. Helm uninstall the chart.
helm uninstall "vigil-region-${REGION_CODE}" \
    --namespace "vigil-region-${REGION_LOWER}"

# 3. Revoke the federation-signer cert (Vault PKI CRL).
vault write "pki-region-${REGION_LOWER}/revoke" \
    serial_number="<<serial from Section 2 issue response>>"

# 4. Remove the region from the multi-site replication conf.
sudo $EDITOR /etc/vigil/multi-site-replication.conf

# 5. Write the rollback row.
docker exec -it vigil-postgres psql -U vigil -d vigil -c "
INSERT INTO audit.actions (action, actor, payload, signed_by_yubikey)
VALUES (
  'phase3.region.cutover.rolledback',
  'architect',
  jsonb_build_object('region', '${REGION_CODE}', 'reason', '<<one-line cause>>'),
  true
);"
```

The Yaoundé core is unaffected by a regional rollback. Phase-1
ops continue until the architect re-attempts.

---

## 9. Post-cutover (within 7 days)

- Run R10 (federation-key-rotation) with `--dry-run` to confirm
  the rotation cadence wires up correctly for this region.
- File a per-region observation note in
  `docs/decisions/log.md` covering operational issues, latency
  numbers, and any architectural learnings.
- If this is regions 1–3 (CE, LT, NW): pause for a 7-day soak
  before advancing to the next region. After NW, the architect
  pipelines the remaining seven regions back-to-back unless a
  soak issue surfaces.

---

## Appendix A — Sequential rollout order rationale

| # | Region | Reason for position |
|---|---|---|
| 1 | CE | Co-located with Yaoundé core; if it fails the architecture is wrong, abort. |
| 2 | LT | Economic capital, BEAC HQ; unlocks BEAC-payments adapter once MOU signed. |
| 3 | NW | Anglophone region; operational profile most distinct from CE/LT. |
| 4 | OU | Densely populated; housing programs active. |
| 5 | SW | Anglophone region; easier than NW after lessons learned. |
| 6 | SU | Coastal/Kribi-port region; energy adapter on. |
| 7 | ES | Forested east; easy uplink in Bertoua compared to north. |
| 8 | EN | Sahel uplink most constrained; bandwidth assumptions tested last. |
| 9 | NO | Northern agropastoral; housing + energy on. |
| 10 | AD | Plateau region; rail terminus. |

A change to this order requires a fresh council 4-of-5 vote.
