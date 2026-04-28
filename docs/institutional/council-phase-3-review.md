# Phase-3 architectural-review brief — Governance Council

**Audience:** the five members of the VIGIL APEX Governance Council
(one per pillar: judicial, civil society, academic, technical,
religious), constituted under §22 of the v5.1 commercial agreement.
**Sender:** Junior Thuram Nana, Sovereign Architect, VIGIL APEX SAS.
**Channel:** Closed council session. The architect walks the council
through this brief in person; a paper copy is left with each member
and a soft copy is mirrored on the council-quorum-encrypted backup
at `/srv/vigil/architect-archive/council-phase-3-review.<UTC>.pdf`.
**Decision sought:** **4-of-5 architectural approval** of the Phase-3
federation architecture, before the per-region cutover ceremonies
begin and CEMAC funding is drawn against the $1.2M–$1.8M envelope.

---

## 0. What this brief is, and is not

This document is **not** a binding decision artefact. It is the
architect's briefing material for the Phase-3 architectural-review
vote. The vote itself is recorded separately under
`docs/institutional/council-votes/phase-3-<UTC>.md` once the council
has signed.

This is also **not** a request for funding or a procurement decision.
The CEMAC funding ask sits with the Republic's finance ministry under
the v5.1 commercial agreement; the council's mandate is **architectural
fitness**, not budget approval.

What the council is being asked to approve, exactly:

> "The Phase-3 federation architecture as documented in
> `docs/PHASE-3-FEDERATION.md` and the K1–K8 deliverables described
> in this brief, including the federated PKI hierarchy, the
> signed-envelope event-replication stream, and the multi-site NAS
> failover chain — to be executed if and when CEMAC funding is
> released."

A 4-of-5 affirmative vote authorises the architect to begin the
per-region cutover ceremonies in the order CE → LT → NW → OU → SW
→ SU → ES → EN → NO → AD. A 3-of-5 or worse outcome means Phase 3
remains on the roadmap as a *scaffold-only* milestone and the
architect re-presents to the council after addressing the dissent.

---

## 1. What changes in Phase 3

VIGIL APEX today runs as a single Yaoundé core. Phase 3 extends the
deployment with **one regional node per Cameroonian region** (10
regions: CE, LT, NW, SW, OU, SU, ES, EN, NO, AD). Each regional
node:

- Hosts a **regional adapter-runner** that ingests local-scope data
  (regional public-works tenders, regional health/education
  feeds, regional tax-attestation directories).
- Runs a **regional federation-agent** that signs every event with
  an ed25519 key issued by a region-scoped Vault subordinate CA,
  and pushes the signed envelopes to the Yaoundé core over gRPC
  tunnelled through WireGuard.
- Maintains a **read-only Postgres replica** of the core's
  ingestion schema, for read-side query load distribution and
  for warm-spare failover semantics.
- Runs a **regional Vault subordinate** that holds only its own
  region's PKI material — cross-region issuance is denied at the
  Vault policy layer (`architect-region-pki`) and again at the
  federation receiver (signing-key-id region prefix must match
  the envelope's region).
- Holds a **regional NAS** that the Yaoundé core pulls nightly
  into `/srv/vigil/region-archive/<CODE>/`, before the existing
  Hetzner offsite chain (10-vigil-backup.sh) sweeps it offsite.

The Yaoundé core is unchanged structurally; it gains a single new
component, **worker-federation-receiver**, which terminates the
gRPC streams from all 10 regions, verifies signatures, and forwards
into the existing ingestion pipeline.

A topology diagram, the federation-stream `.proto`, and the PKI
hierarchy are in `docs/PHASE-3-FEDERATION.md` §§ 2–4.

---

## 2. Why a federated architecture, not a centralised one

The single-core deployment is operationally adequate for Phase 1–2.
Phase 3 adds federation for four specific reasons:

1. **Latency to regional sources.** Several regional ministries
   publish their tender notices and project rolls through portals
   that are slow or rate-limited from outside the country. A
   regional adapter-runner with a regional IP is materially
   faster and less detectable than scraping from Yaoundé.
2. **Data-sovereignty defensibility.** Loi 2010/021 (treated under
   the ANTIC declaration) frames personal-data residency in
   Cameroon. Phase-3 keeps all first-contact data on a regional
   NAS in-country before ANY routing through Yaoundé, which
   simplifies the data-sovereignty argument we make to CONAC and
   the National Assembly.
3. **Failure-domain isolation.** A regional ISP outage today takes
   the entire ingestion stream for that region offline. Phase-3
   gives each region its own ingestion buffer (Redis + the
   federation-agent's WAL); a 7-day partition is recoverable
   without data loss.
4. **Per-region governance posture.** Anglophone regions (NW, SW)
   are operationally distinct from francophone regions, and
   Extrême-Nord is operationally distinct again. Per-region
   adapter selection and per-region rate caps let us match
   the platform's footprint to local conditions.

---

## 3. Cost envelope (CEMAC funding)

| Line | One-off (capex) | Annual (opex) | Notes |
|---|---|---|---|
| Per-region hardware (server + NAS + UPS) × 10 | ~$680k | — | $60–75k per region |
| WireGuard appliances (per-region edge) × 10 | ~$45k | — | low-end, redundant pair option |
| Regional ISP capacity (uplink contract) × 10 | — | ~$140k | varies by region; EN cheapest, LT most |
| Regional NAS replication bandwidth | — | ~$30k | Hetzner offsite ratio fixed |
| Per-region Vault subordinate hardening | ~$25k | — | one-off ceremony tooling |
| Architect operational overhead (Phase-3 cutover) | ~$95k | — | 10 ceremonies × ~1.5 weeks |
| Council quorum-rotation overhead (security) | — | ~$22k | 90-day signing-key rotations |
| **Total (low-end)** | **~$845k** | **~$192k** | aggregate ≈ $1.2M Y1 |
| **Total (high-end with redundancies)** | **~$1.25M** | **~$280k** | aggregate ≈ $1.55M Y1 |

The architect estimates Y1 spend at **$1.2M–$1.8M** depending on
how aggressively per-region hardening is specced. The council's
4-of-5 vote does **not** lock the budget — it locks the
*architecture* the budget will be drawn against.

---

## 4. Rollout order rationale

Sequential, not parallel. The order is:

> CE → LT → NW → OU → SW → SU → ES → EN → NO → AD

Reasoning:

- **CE first** because it's co-located with the Yaoundé core. The
  WireGuard hop is a localhost loop in practice; if CE fails,
  the entire federation architecture is wrong and we abort
  before touching any other region.
- **LT second** because Douala is the economic capital and the
  BEAC HQ. Getting LT online unlocks the BEAC payments adapter
  the moment the BEAC MOU is signed.
- **NW and SW** before the rest of the inland regions because the
  anglophone-region operational profile is the most distinct from
  CE/LT — if it works there, it works anywhere else.
- **EN last** because the Sahel uplink is the most constrained;
  any architectural assumption that the federation stream's
  bandwidth profile is "acceptable" must survive every easier
  region first.

A *parallel* rollout would multiply the number of moving pieces
during ceremony windows (10 cutovers in flight at once is
qualitatively a different operation than 10 cutovers in series)
and is rejected for that reason.

---

## 5. Failure modes the council should consider

| Mode | Mitigation in scaffold | Residual risk |
|---|---|---|
| Regional partition (ISP down, > 7 days) | Federation-agent WAL retains 168 h backlog; nightly NAS pull is independent | If partition exceeds 7 d, the agent's WAL drops oldest envelopes — not silent (alerted), but recoverable only from the regional NAS |
| Subordinate CA compromise (single region) | Cross-region issuance denied by Vault policy; receiver rejects mismatched key id | Forged envelopes for the compromised region are accepted until the architect revokes; rotation cadence is 90 d for signing keys, 2 y for sub-CAs |
| NAS chain break (regional NAS unreachable) | Pull is idempotent + retries; lag-alert at 84 h (half of retainHours) fires page | If regional NAS is down >7 d AND the federation-agent WAL also overflows, oldest data is unrecoverable |
| Yaoundé core compromise | Federation receiver is on the core; if core is compromised, everything is compromised | This is a Phase-1 risk, unchanged. Phase-3 does not add or reduce it. |
| Council-quorum loss during cutover | Per-region cutover requires 3-of-5 council quorum to unseal regional Vault | Architect cannot proceed alone; ceremony halts until quorum restored |

The architect explicitly does **not** claim Phase-3 mitigates the
Yaoundé core risk. The core remains the single point of
authoritative trust; Phase-3 distributes ingestion, not authority.

---

## 6. Rotation cadence

| Material | Rotation | Authority |
|---|---|---|
| Per-region federation-signer ed25519 key | 90 days | Architect, with 2-of-5 council witness |
| Per-region Vault subordinate CA | 2 years | Architect, with 4-of-5 council architectural-review vote |
| Yaoundé root CA | 10 years (per K3 bootstrap) | Architect + full 5-of-5 council ceremony |
| WireGuard peer pubkeys | 6 months | Architect alone; logged |
| Regional NAS rsync module credentials | 6 months | Architect alone; logged |

The 90-day federation-signer rotation is the most operationally
demanding cadence. The architect commits to running it as a
scheduled `docs/runbooks/R10-federation-key-rotation.md`
(forthcoming) and to reporting the previous cycle's rotation log
at every council meeting.

---

## 7. Explicit "do not approve" criteria

The council should vote **against** approving Phase-3 architecture
in any of the following cases. Any one of these is sufficient to
require revision before re-presentation.

- **(NA1)** The federation-stream `.proto` allows a key id not
  prefixed with the region code to authenticate envelopes. The
  council should verify by reading `proto/federation.proto` field
  documentation and `src/verify.ts` `regionMatchesKeyId`.
- **(NA2)** The receiver does not enforce a replay window. The
  council should verify by reading `verifyEnvelopeWithPolicy` and
  the test cases in `src/sign.test.ts`.
- **(NA3)** The Vault policy permits cross-region issuance. The
  council should verify by reading
  `13-vault-pki-federation.sh` Section 3 ("architect-region-pki"
  policy block).
- **(NA4)** The NAS replication is push-based instead of pull-based.
  The council should verify by reading
  `13-multi-site-replication.sh` header comment ("Pull, not
  push.") and the rsync command.
- **(NA5)** Any per-region `values-<CODE>.yaml` file disables
  network policy. The council should verify by grep for
  `networkPolicy.enabled` in
  `infra/k8s/charts/regional-node/values-*.yaml`.

If the council finds none of NA1–NA5 violated, the architect
proposes the architecture is fit for approval.

---

## 8. Materials provided in advance

The council receives the following at least 14 days before the
review session:

1. `docs/PHASE-3-FEDERATION.md` — full architecture document with
   topology, protobuf, PKI hierarchy.
2. `infra/host-bootstrap/13-vault-pki-federation.sh` —
   federated-PKI bootstrap script (K3).
3. `infra/host-bootstrap/13-multi-site-replication.sh` — multi-site
   NAS pull (K6).
4. `packages/federation-stream/proto/federation.proto` — the
   authoritative federation-stream wire format.
5. `packages/federation-stream/src/verify.ts` — receiver-side
   verification logic with NA1/NA2 enforcement.
6. `packages/federation-stream/src/sign.test.ts` — test cases
   covering signature round-trip, region-mismatch rejection,
   replay-window rejection, oversized-payload rejection.
7. `infra/k8s/charts/regional-node/values-CE.yaml` (representative
   sample of all 10 per-region values files).
8. This brief.

A council member who wishes to delegate review of any of these
documents to a domain expert under §22.4 of the v5.1 agreement
must declare the delegation in writing before the session and
reference the expert by name and credentials.

---

## 9. Vote mechanics (per §22 of the v5.1 agreement)

- **Quorum:** 4-of-5 pillars present (any 4 of judicial / civil
  society / academic / technical / religious). The architect is
  not a voting member.
- **Threshold:** affirmative votes from 4-of-5 pillars.
- **Recording:** the result is signed by each present member and
  saved to `docs/institutional/council-votes/phase-3-<UTC>.md`
  along with the architect's signature acknowledging receipt.
- **Re-vote:** if the threshold is not met, the architect may
  re-present after addressing dissent. The council sets the
  re-vote window; default is 30 days.

---

## 10. Architect's signature line

> Signed: ____________________________ (Junior Thuram Nana,
> Sovereign Architect, VIGIL APEX SAS)
>
> Date: __________________
>
> YubiKey-touched audit row id: __________________

---

*End of brief. This file is a template; every `<<FILL: ...>>`
marker that future revisions introduce must be filled in by the
architect before circulation.*
