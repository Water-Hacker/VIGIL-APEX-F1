# VIGIL APEX — Phase 3 federation architecture

**Status:** scaffold (Phase J of the K8s migration shipped first; this
document depends on the chart pattern). The actual rollout is gated on
ROADMAP Phase-3 entry: CEMAC region funding or co-funding commitment
(USD 1.2 M – 1.8 M envelope), council 4-of-5 architectural-review
vote (`docs/institutional/council-phase-3-review.md`), and
operational stability of the Phase-2 Yaoundé core for at least
6 months.

This document is the architect's plan for what Phase 3 is, why it's
scoped this way, and what it isn't.

---

## 1. Goal

Phase 1 + 2 deploy the platform on a single Yaoundé node with a
Hetzner replica. Phase 3 distributes ingest across **10 regional
nodes** (one per Cameroonian administrative region) so that:

1. **Public-source ingest happens close to the source** — adapters
   that scrape regional municipal portals or local-court gazettes hit
   them from a regional IP, which (a) reduces bandwidth load on the
   central node, (b) raises the chance of a 200 OK on rate-limit-
   sensitive sources, (c) sidesteps the "single Yaoundé IP makes a lot
   of requests" pattern that triggers regional firewall blocks.
2. **Geographic resilience.** Yaoundé going offline (power, riot,
   raid, ISP failure, regulatory takedown) doesn't stop ingest. The
   regional nodes queue events locally and replay when the core
   returns. Worst case the platform degrades to **read-only verify
   surface** but never loses unwritten audit-chain entries.
3. **Sovereignty by physical distribution.** A platform whose audit
   chain is one host's hard drive is one search warrant from gone.
   A platform with 10 regional nodes — none of which alone holds the
   council quorum, none of which alone can sign Polygon anchors — is
   structurally harder to disable.
4. **Phase-3 entry is a council decision.** Per ROADMAP, the council
   must vote 4-of-5 to approve the architectural change. The
   council's review document at
   `docs/institutional/council-phase-3-review.md` carries the
   technical material the council members read before voting.

## 2. Topology

```
                               +-----------------------------+
                               |  Yaoundé Core (Centre)      |
                               |  - Postgres (primary)        |
                               |  - Vault root (5-of-7 Shamir)|
                               |  - IPFS-cluster coordinator  |
                               |  - Council cohort + dossier  |
                               |  - Polygon signer host       |
                               |  - Fabric peer.org1          |
                               +-------------+----------------+
                                             |
                  +---------+----------+-----+----+----------+----------+
                  |         |          |          |          |          |
    +-------------+   +-----+-----+  +-+-------+  +----------+   +----------+
    |  Littoral   |   | Nord-Ouest|  | Sud-Ouest | | Ouest    |   | Sud      |
    |  (Douala)   |   | (Bamenda) |  | (Buea)    | | (Bafoussam)| | (Ebolowa)|
    +-------------+   +-----------+  +-----------+ +----------+   +----------+
                  |         |          |          |          |          |
    +-------------+   +-----+-----+  +-+-------+  +----------+   +----------+
    |  Est        |   | Extrême-N |  | Nord    |  | Adamaoua |   |  (CONAC- |
    |  (Bertoua)  |   | (Maroua)  |  | (Garoua)|  |(Ngaoundéré)| |  observ.)|
    +-------------+   +-----------+  +---------+  +----------+   +----------+
                  |         |          |          |          |          |
                  +---------+----------+-----+----+----------+----------+
                                             |
                                             v
                                +------------+-------------+
                                | Hetzner Falkenstein DR    |
                                | (warm replica, no ingest) |
                                +---------------------------+

Replication: regional → Yaoundé over WireGuard mesh, gRPC stream
              with signed envelopes (see §4 federation stream)
Vault PKI:   Yaoundé root issues subordinate CAs per region
              (10 subordinates with ttl=2y, renewable)
NAS chain:   each region NAS → Yaoundé NAS → Hetzner NAS
              (Synology Hyper Backup, RPO < 5 min)
```

## 3. Per-region node — what runs there

Each regional node is a small K8s cluster (k3s on a single dedicated
host, ~16 cores / 64 GB / 4 TB SSD) running:

- **adapter-runner** — pulls public sources allocated to that region
  (see `infra/k8s/charts/regional-node/values-<region>.yaml`).
- **regional Vault** — subordinate to the Yaoundé root via PKI; holds
  only the secrets the regional node needs (HTTP proxy creds, source-
  specific cookies, the regional federation-stream signing key).
- **regional Postgres replica** — read-only streaming replica of the
  Yaoundé primary's `source.events` partition for that region.
  **The regional replica is event-only**; finding/dossier/audit
  partitions stay central.
- **regional Redis** — local stream queue for federation pushback.
  When the core is unreachable the regional adapter-runner writes
  here; a replication agent drains to the core when connectivity
  returns. Idempotent at envelope.dedup_key.
- **regional IPFS node** — pins documents fetched in-region.
  ipfs-cluster (already in tree from D8) coordinates pinning across
  regions for any document hash that crosses the popularity
  threshold.
- **regional health-probe** — re-uses the F2 `vigil-watchdog` shape;
  each watchdog row is signed by the regional Vault's identity and
  forwarded to the core's `audit.actions` chain.

What does **not** run regionally:
- Worker-pattern, worker-score, worker-counter-evidence, worker-
  dossier, worker-anchor — these stay central. Patterns need the
  full graph; counter-evidence needs full LLM-cost concentration;
  dossier rendering needs the council key; anchoring needs Polygon
  signer access. Centralisation is a feature, not a bug.
- Worker-tip-triage — sensitive-tip decryption requires the 3-of-5
  council quorum which is centrally orchestrated.
- The dashboard. End users hit Yaoundé (or Hetzner DR via DNS flip
  per F11). Regional nodes have no human-facing UI.

## 4. Federation stream protocol

### Wire shape

Regional → core replication uses **gRPC over WireGuard** with a
signed-envelope stream service. Defined in
`packages/federation-stream/proto/federation.proto`:

```protobuf
service FederationStream {
  rpc PushEvents(stream EventEnvelope) returns (PushAck);
  rpc HealthBeacon(HealthBeaconRequest) returns (HealthBeaconReply);
}

message EventEnvelope {
  string envelope_id    = 1;   // UUID, deterministic from dedup_key
  string region         = 2;   // 'CE' | 'LT' | 'NW' | 'SW' | 'OU' | 'SU' | 'ES' | 'EN' | 'NO' | 'AD'
  string source_id      = 3;
  string dedup_key      = 4;
  bytes  payload        = 5;   // the SourceEvent shape, JSON-encoded
  int64  observed_at_ms = 6;
  bytes  signature      = 7;   // ed25519 over (region|source_id|dedup_key|payload|observed_at_ms)
  string signing_key_id = 8;   // points at the regional Vault PKI cert SAN
}

message PushAck {
  uint64 last_committed_envelope_seq = 1;
  bool   chain_break_detected        = 2;
}
```

### Trust model

- Each region holds an ed25519 signing key in its regional Vault.
- The signing key's certificate is issued by the **Yaoundé root CA**
  via the federated PKI (see §5).
- The core verifies every envelope's signature **before** writing
  to `source.events`. An envelope with `chain_break_detected=true`
  on the ack triggers a critical AlertManager page (extends
  `infra/docker/prometheus/alerts/vigil.yml` by one rule).

### Idempotency

`source.events` already enforces `UNIQUE (source_id, dedup_key)`.
Replays are no-ops at the DB layer. The gRPC stream is at-least-once.

### Backpressure

Regional Redis queues hold envelopes when the core is unreachable.
Steady-state queue depth is monitored as `vigil_federation_queue_depth`
(new metric). When the queue exceeds `MAX_FEDERATION_BACKLOG` (default
1 M envelopes) the regional adapter-runner pauses ingest and writes
a `region.degraded` watchdog row.

## 5. Federated Vault PKI

### Root → subordinate hierarchy

```
Yaoundé root Vault (5-of-7 Shamir, council + 2 architects)
└── pki/root          (TTL 10 years, kept offline most of the time)
    ├── pki/CE        (Centre subordinate, TTL 2 years, online)
    ├── pki/LT        (Littoral subordinate)
    ├── pki/NW
    ├── pki/SW
    ├── pki/OU
    ├── pki/SU
    ├── pki/ES
    ├── pki/EN
    ├── pki/NO
    └── pki/AD
```

The root is unsealed once during Phase-3 cutover, used to issue the
10 subordinate CA certificates, then re-sealed. Subordinate vaults
each issue **one** federation-signing certificate (the regional ed25519
key from §4) and that's the only cert they need to issue under
steady state. Quarterly rotation per F10 timer extends to the
regional vaults.

### Compromise containment

A region whose Vault is compromised can only issue federation
certificates **for that region**. The root CA's policy explicitly
forbids subordinates from cross-issuing. A compromised subordinate is
revoked at the root within 4 hours per the F10 incident path.

### Why subordinates, not Transit-only

Vault Transit gives signing without exposing keys, but it requires
network reachability to the unsealing party at every signature.
Phase 3 explicitly requires regions to **operate degraded when the
core is unreachable**; subordinate CAs let regions sign locally.
Trade-off accepted at architect decision §3 below.

## 6. NAS failover chain

Extends F11 (multi-region failover script) from a 2-site (Yaoundé +
Hetzner) to a 3+ site chain:

```
Region NAS  →  Yaoundé NAS  →  Hetzner NAS
   (RPO < 5m)      (RPO < 5m)      (RPO < 60m)
```

The chain is enforced by Synology Hyper Backup's chained-replication
mode. Each link is independent — Yaoundé NAS failing doesn't block
the regional NAS from continuing to replicate to Hetzner directly
(emergency bypass).

`infra/host-bootstrap/13-multi-site-replication.sh` provisions the
chain at install time. The architect runs it once per region; the
script is idempotent.

## 7. Council 4-of-5 architectural-review vote

Per ROADMAP, Phase-3 entry requires a council vote. The vote is on
the **architecture as a whole**, not on individual regions — the
architect proposes the entire 10-region rollout in one resolution.

The brief at `docs/institutional/council-phase-3-review.md` is what
each council member reads before voting. It cites this document.

The vote is on-chain:

```js
await VIGILGovernance.openProposal(
  findingHash = keccak256("phase-3-architectural-review"),
  uri = "ipfs://<this-document-cid>",
  salt = <random>,
);
// 2-minute REVEAL_DELAY (B11)
// then 4-of-5 vote per the council ceremony
```

If the vote returns **not approved**, the rollout pauses
indefinitely. If **approved**, the architect proceeds to K6 (NAS
chain provisioning) followed by K2 (regional-node Helm install)
region-by-region in the order:

1. **Centre (CE) — Yaoundé core** (no-op; already Phase-2 deployment).
2. **Littoral (LT) — Douala** (highest source volume after Centre).
3. **Nord-Ouest (NW) — Bamenda** (security-sensitive region; serves
   as the resilience test).
4. **Ouest (OU) — Bafoussam**.
5. Sequence then continues by source-volume order: SW → SU → ES → EN → NO → AD.

One region per quarter is the recommended rollout cadence. The
architect documents each region's go-live in `docs/decisions/log.md`.

## 8. Architect decisions locked in this scaffold

1. **K3s, not full K8s, for the regional nodes.** k3s on a single
   dedicated host per region matches the operational scale and gives
   the same Helm chart pattern. Full K8s control planes per region
   are out of budget envelope.
2. **Subordinate CAs, not Transit-only signing.** Regions must work
   offline for hours-to-days; Transit forces every signature through
   the core. See §5.
3. **Event-only regional Postgres replica.** Findings, dossiers, and
   audit events stay centrally written. Regional replicas read but
   do not write.
4. **gRPC, not Kafka.** Kafka adds operational weight that doesn't
   pay for itself at 10 regions × the Phase-1 Compose stack's event
   rate. gRPC streams + Redis backlog handles 100× the projected
   load.
5. **No regional dashboard.** Users hit Yaoundé. End-of-story.
6. **Council vote on architecture, not on individual regions.** A
   per-region vote forces the council to revisit a settled question
   ten times and creates a path for one region to be killed in
   isolation while the others proceed — which structurally weakens
   the resilience claim.

## 9. Out of scope for the Phase-3 scaffold (deferred)

- **Cross-CEMAC federation.** Regions in Cameroon only. CEMAC region
  expansion (Gabon, Congo, Tchad, RCA, Guinée Équatoriale) is Phase 4.
- **Regional councils.** No per-region council; the central
  Governance Council remains the only escalation gate.
- **Per-region dashboards or operator surfaces.** Out of scope.
- **Regional finding-store.** All findings central. Out of scope.
- **CEMAC regulator integrations** (BEAC already sits at the centre).

## 10. Cost envelope

Per ROADMAP: **USD 1.2 M – 1.8 M over 12 months**. Breakdown sketch
(architect maintains the live estimate in `personal/phase-3-budget.md`):

| Item | Estimate (USD) |
|---|---|
| 10× regional node hardware (16-core / 64 GB / 4 TB SSD) | 250 K |
| 10× regional Synology DS1823xs+ NAS + storage | 80 K |
| 10× region WireGuard / fibre BGP peering setup | 120 K |
| Council key-rotation ceremonies (Phase-3 cutover + quarterly) | 60 K |
| Counsel review for each regional engagement | 80 K |
| Operations team headcount (3 FTE × 12 months) | 600 K |
| Contingency (15 %) | 200 K |
| **Total (low estimate)** | **1.39 M** |

The architect does not unlock this budget. CEMAC region funding or
co-funding commitment must arrive via the v5.1 §8 budget annex
before any K-deliverable in this plan is acted on.

## 11. Where this scaffold lives in the repo

| Concern | Path |
|---|---|
| Architecture doc (this file) | `docs/PHASE-3-FEDERATION.md` |
| Regional-node Helm subchart | `infra/k8s/charts/regional-node/` |
| Per-region values | `infra/k8s/charts/regional-node/values-<region>.yaml` (10 files) |
| Federation stream protocol | `packages/federation-stream/` |
| Federated Vault topology | `infra/host-bootstrap/13-vault-pki-federation.sh` |
| Multi-site NAS failover | `infra/host-bootstrap/13-multi-site-replication.sh` |
| Council review brief | `docs/institutional/council-phase-3-review.md` |
| Cutover runbook | (Phase-3 entry — drafted alongside K8 close) |

Everything in this list is **template** — written in code, signed
into the repo, but not deployed until the budget + council vote
unlock the actual rollout.
