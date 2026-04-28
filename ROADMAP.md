# ROADMAP — Phase 1 → Phase 4

The PPTX deck (`docs/archive/RTPFC_Governance_Intelligence_Platform.pptx`) describes
a "Five-Ring" architecture with **10 federated regional nodes, ZK-proofs, and full
decentralisation**. The SRD/MVP describes a 1 host + 1 VPS + 2 NAS hybrid. There
is no documented bridge between the two. This document **is** that bridge.

This file resolves **W-06** by phase-tagging every claim in the PPTX.

---

## Phase 1 — MVP Pilot (this commit, 26 weeks)

What ships:

- Single MSI Titan host + Hetzner CPX31 VPS + Synology NAS pair (2 sites).
- 26 data sources, 43 patterns, ECE < 5%.
- 5-pillar council, 3-of-5 quorum, 8 YubiKeys.
- Polygon mainnet anchoring (`VIGILAnchor.sol`, `VIGILGovernance.sol`).
- CONAC SFTP delivery + MINFI scoring API.
- Public `/verify` and `/ledger`, Tor-native `/tip` portal.
- Postgres `audit.actions` hash chain (Hyperledger Fabric **deferred to Phase 2**).

What does NOT ship in Phase 1:

| PPTX claim | Phase tag | Notes |
|---|---|---|
| "10 federated regional nodes" | **Phase 3** | MVP runs from Yaoundé only |
| "ZK-Proofs" | **Phase 4** | RTX 5090 has the GPU capacity (rapidsnark) but the proof circuits and verifier contracts are not in MVP scope |
| "Permissioned ledger across institutions" | **Phase 2** | Replaced by Postgres hash chain in MVP per W-11 |
| "Multi-party keys" | **Phase 1** ✅ | 3-of-5 council quorum is the multi-party mechanism |
| "Federated nodes ... no single off switch" | **Phase 3** | The 2-NAS pair is geographic resilience, not federation |
| "Self-healing if nodes go offline" | **Phase 3** | Phase 1 has manual NAS failover only |
| "Civil society oversight board" | **Phase 1** ✅ | The civil-society pillar IS the oversight board |
| "Immutable audit trail" | **Phase 1** ✅ | Postgres hash chain + Polygon anchor |
| "Citizen portal + anonymous tip line" | **Phase 1** ✅ | `/verify` + `/tip` |

---

## Phase 2 — Production Hardening + MOU-Gated Escalation (months 7-12)

**Status (2026-04-28):** technical scaffolding complete (Phases G/H/I
of the Phase-2 Tech Scaffold plan, signed off in
`docs/decisions/log.md`). Institutional preconditions remain open.

Unlocks:

- ~~Hyperledger Fabric multi-org~~ → **scaffolded as single-peer
  Org1**. CONAC + Cour des Comptes peers join at Phase-2 entry by
  extending `infra/docker/fabric/{configtx,crypto-config}.yaml`.
  Chaincode `audit-witness` + bridge worker + cross-witness verifier
  shipped. (Phase G of the Tech Scaffold plan.)
- ~~Adapter self-healing worker (W-19) in continuous CI mode~~ →
  **shipped**. `apps/worker-adapter-repair` runs daily LLM-driven
  selector re-derivation + 48 h shadow tests + auto-promotion for
  informational adapters; operator approval UI for critical
  adapters. (Phase H1–H3.)
- MINFI / BEAC / ANIF MOU-gated direct API ingestion (replaces SFTP
  scraping). **Still gated on MOUs.**
- Full external pentest + ISO 27001 formal certification.
  **Institutional + commercial work.**
- Phase 2 Retention Incentive payable on M4 acceptance ($50K to SAS).
- Continuous calibration with > 200 ground-truth-labelled cases.
  **Pattern test framework + coverage gate landed (Phase H4–H6); the
  200-case ground-truth set accumulates as the platform runs.**

Required institutional pre-conditions (unchanged):
- CONAC engagement letter countersigned for Phase 2 scope.
- MINFI MOU in negotiation with Phase 2 budget allocated.
- ANTIC declaration accepted (W-23).

---

## Phase 3 — Regional Federation (year 2)

Unlocks:

- 10 regional ingest nodes (one per Cameroon administrative region) running
  read-only adapters with cryptographic check-in to the Yaoundé core.
- Federated Vault (one Vault per region, root cluster in Yaoundé under 5-of-7 Shamir).
- Self-healing NAS failover across 3+ sites (Cameroon CE + LT + extra-territorial).
- Phase 3 architectural review by the council (4-of-5 vote required to proceed).

This phase requires the **CEMAC region** to also fund or co-fund — the
single-architect model does not scale to 10 nodes. Phase 3 budget is
projected at $1.2M-$1.8M USD over 12 months, not in scope for this MVP.

**Scaffold status (closed 2026-04-28):** the architectural scaffold for
Phase 3 is now committed in tree under `docs/PHASE-3-FEDERATION.md`
(K1), `infra/k8s/charts/regional-node/` + 10 per-region values files
(K2/K5), `infra/host-bootstrap/13-vault-pki-federation.sh` (K3),
`packages/federation-stream/` (K4),
`infra/host-bootstrap/13-multi-site-replication.sh` + systemd units
(K6), and the council architectural-review brief at
`docs/institutional/council-phase-3-review.md` (K7). Execution remains
gated on (i) CEMAC funding release against the $1.2M–$1.8M envelope
and (ii) the council 4-of-5 architectural-review vote. The architect
is not authorised to begin per-region cutover ceremonies before both
gates clear.

---

## Phase 4 — Full Decentralisation with ZK-Proofs (year 3+)

Unlocks:

- ZK-proof circuits for finding-validity (groth16 or PLONK; rapidsnark on the
  RTX 5090 produces proofs in ~0.4s vs ~180s on CPU).
- Public verifier contract on Polygon: anyone can verify a finding's evidence
  chain without seeing the underlying entity names.
- IPFS pinning federation across council members + civil society.
- Multi-currency anchoring (Polygon + Arbitrum + Base, with majority-anchor consensus).
- Optional: migration to a sovereign Cameroon-hosted L2 if institutional
  appetite exists.

This phase is conditional on the legal regime for ZK-proof admissibility in
Cameroonian and CEMAC courts being clarified. Without that, Phase 4 cryptographic
machinery is a research artefact, not enforcement infrastructure.

---

## Phase Tagging Convention

Every public-facing claim about VIGIL APEX MUST be tagged with a phase. PPTX
decks shown to institutional partners after this commit are required to carry
phase tags inline. The architect uses `[P1]`, `[P2]`, `[P3]`, `[P4]` after each
claim. Removing tags from external decks is a discipline violation worth raising
to the council.

Example revised PPTX claim:

> "Federated nodes across 10 regions [P3] — under design, dependent on Phase 3
> funding by CEMAC partners."

vs. the current ambiguous:

> "Federated nodes across 10 regions"

---

## Out of Scope (forever)

- Autonomous enforcement (the system never takes legal action; only routes evidence).
- Predictive policing of individuals (the system flags transactions, not people).
- Real-time intervention in payment flow (MINFI API advises; never blocks).
- Weaponisation against political opposition (the council is the structural defence).
- Replacement of human investigators (the system is a tool for prosecutors and analysts, not a substitute).
