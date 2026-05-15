# Runbook — Vault Raft re-attach

> DL380 Gen11 cluster migration plan, §"Replication / quorum rules" and
> §"Auto-unseal of Vault".
>
> Vault runs as a 3-voter Raft cluster across vigil-node-{a,b,c}. Auto-unseal
> uses Vault Transit on Hetzner N02. This runbook covers re-attaching a
> Vault peer that's been offline (hardware swap, OS upgrade, network partition).

---

## Description

### 🇫🇷

Vault HA repose sur le consensus Raft. Un cluster sain a 3 voters
(quorum 2). Lorsqu'un nœud revient après une panne, il rejoint
automatiquement via la directive `retry_join` de config.hcl. Ce
runbook décrit les cas où l'auto-rejoin échoue.

### 🇬🇧

Vault HA uses Raft consensus. Healthy cluster = 3 voters (quorum 2).
A returning node auto-rejoins via the `retry_join` directives in
config.hcl. This runbook covers the cases where auto-rejoin fails.

---

## Healthy-state baseline

```bash
# As an operator with the management token (NOT a worker token):
export VAULT_ADDR=https://vigil-node-a:8200
export VAULT_TOKEN="$(cat /run/vigil/secrets/vault_root_token)"

vault status
# Expected:
#   HA Enabled    true
#   HA Cluster    https://vigil-node-a:8201
#   HA Mode       active                   (or standby for non-leader nodes)
#   Active Node Address  https://vigil-node-a:8200

vault operator raft list-peers
# Expected:
#   Node         Address                  State     Voter
#   vigil-vault-a  vigil-node-a:8201      leader    true
#   vigil-vault-b  vigil-node-b:8201      follower  true
#   vigil-vault-c  vigil-node-c:8201      follower  true
```

If `vault status` shows `Sealed: true` despite Transit auto-unseal
being configured, the Transit token has expired or the Hetzner N02
Vault is unreachable. See "Transit auto-unseal failure" below.

---

## Scenario 1 — Node returns after a clean shutdown

If the node was drained, powered off cleanly, hardware-swapped, and
booted back up:

1. The systemd unit `vigil-vault-unseal.service` runs at boot.
2. It calls `vault operator unseal` for the Shamir path OR Vault
   self-unseals via Transit (preferred, default path).
3. Vault Raft re-attaches via `retry_join` against the other two
   nodes. This typically takes 5–15 seconds.

Verify:

```bash
ssh vigil-node-<X> "systemctl status vault.service"
ssh vigil-node-<X> "vault status"           # expect Sealed: false, HA Mode: standby
vault operator raft list-peers              # expect 3 voters, all healthy
```

No manual action needed.

---

## Scenario 2 — Returning node is no longer in the peer list

This happens when a node was removed from the cluster (`vault operator
raft remove-peer`) or the node's Raft data directory was wiped without
also removing it from the cluster's peer list. The node will boot,
unseal, and then sit idle showing `Sealed: false, HA Mode: standby`
but never become a voter.

```bash
# 1. Check the cluster's current peer list:
vault operator raft list-peers
# If vigil-vault-<X> is missing → it was removed.

# 2. Stop Vault on the returning node:
ssh vigil-node-<X> "systemctl stop vault.service"

# 3. Wipe the local Raft data (this is safe — the node has no state
#    the rest of the cluster needs):
ssh vigil-node-<X> "rm -rf /vault/file/raft/* /vault/file/snapshots/*"

# 4. Restart Vault. It will detect no local Raft state and use
#    retry_join to bootstrap from the current leader. This pulls a
#    full snapshot — expect 30–60 s for the join to complete on a
#    typical cluster.
ssh vigil-node-<X> "systemctl start vault.service"

# 5. Confirm the join:
vault operator raft list-peers
# Should now show 3 peers including the re-attached node.
```

---

## Scenario 3 — Cluster lost quorum (2 of 3 nodes down)

This is the only scenario that requires manual operator intervention.
With < 2 healthy voters, Raft refuses to elect a leader and the cluster
is read-only (writes return 503).

**Do not panic-promote.** Force-resetting Raft membership with stale
data risks data loss. Diagnose first:

```bash
# 1. Which node is alive?
for node in vigil-node-a vigil-node-b vigil-node-c; do
  echo "=== $node ==="
  ssh $node "vault status" 2>&1 | head -5
done

# 2. Of the dead nodes, can either be brought back?
#    - Hardware failure → HPE 4-hour SLA call
#    - OS panic / disk full → boot rescue, free space, restart Vault
#    - Network partition → check the 25 GbE bonding + switch

# 3. If you can recover even ONE of the dead nodes, do that and skip
#    the next step. Quorum returns automatically once you have 2 voters.
```

**Only if you cannot recover a second node within 30 minutes:**

```bash
# 4. Force the surviving node to become a single-voter cluster. THIS
#    DROPS THE OTHER TWO PEERS — when they return they must rejoin from
#    scratch (Scenario 2).
#
# WARNING: this is destructive. Make sure the surviving node has the
# most recent snapshot before doing it.
vault operator raft snapshot save /tmp/vault-pre-recovery-$(date +%s).snap

# Use the peers.json recovery procedure documented at
# https://developer.hashicorp.com/vault/docs/concepts/integrated-storage#manual-recovery-using-peers-json
# (we deliberately do NOT script this — it's a 1-of-100 operation that
# should be eyes-on every step).

# Write /vault/file/raft/peers.json on the surviving node:
ssh vigil-node-<X> "cat > /vault/file/raft/peers.json" <<'JSON'
[
  {
    "id": "vigil-vault-<X>",
    "address": "vigil-node-<X>:8201",
    "non_voter": false
  }
]
JSON
ssh vigil-node-<X> "systemctl restart vault.service"

# 5. After the surviving node forms a single-voter cluster, restore from
#    the snapshot taken in step 4 (or an older one if the snapshot is
#    suspect).

# 6. Re-attach the recovered nodes one at a time via Scenario 2.
```

---

## Transit auto-unseal failure

Symptom: `vault status` shows `Sealed: true` and the journal shows
`failed to unseal core: ... transit ...`.

Likely cause: the Vault Transit token at `/run/vigil/secrets/vault_transit_token`
has expired, or Hetzner N02 itself is sealed/unreachable.

```bash
# 1. Check token validity (run from the failing node):
VAULT_ADDR=https://n02.vigilapex.cm:8200 \
  vault token lookup -field=ttl "$(cat /run/vigil/secrets/vault_transit_token)"
# Output should be > 0. If 0 or error → token expired.

# 2. Renew or re-issue the transit token. The architect generates a new
#    one against N02 with policy 'vigil-unseal' and a 90d TTL:
ssh hetzner-n02 "vault token create -policy=vigil-unseal -ttl=90d -format=json" \
  | jq -r .auth.client_token > /tmp/new-transit-token

# 3. Materialise it on all 3 cluster nodes:
for node in vigil-node-a vigil-node-b vigil-node-c; do
  scp /tmp/new-transit-token $node:/run/vigil/secrets/vault_transit_token
  ssh $node "chmod 0400 /run/vigil/secrets/vault_transit_token"
  ssh $node "systemctl restart vault.service"
done

# 4. Confirm unseal:
for node in vigil-node-a vigil-node-b vigil-node-c; do
  echo "=== $node ==="
  ssh $node "vault status | grep Sealed"
done

# 5. SHRED the temp file:
shred -u /tmp/new-transit-token
```

**The annual Shamir rotation ceremony also rotates the Transit token.**
Calendar this so a token never reaches expiry in production.

---

## Cross-links

- [docs/source/HSK-v1.md](../source/HSK-v1.md) — YubiKey + Shamir ceremony manual
- [03-vault-shamir-init.sh](../../infra/host-bootstrap/03-vault-shamir-init.sh) — initial Shamir bootstrap
- [hardware-swap.md](hardware-swap.md) — node drain before maintenance
- AUDIT-040 — NOT_VOTED sentinel in VIGILGovernance.sol (same Raft pattern, different layer)
- DECISION-018 — council vote design (depends on Vault for council member keys)
