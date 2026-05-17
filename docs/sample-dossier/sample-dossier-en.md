# VIGIL APEX DOSSIER — VA-2026-0001

> **NOTICE** — Synthetic dossier, generated for the UNDP review demonstration.
> No entity, amount, or fact corresponds to real data. The names,
> RCCM/NIU references, and addresses are fabricated.

**Reference:** `VA-2026-0001`
**Classification:** RESTREINT — institutional recipient only
**Language:** English (French primary version: `VA-2026-0001-fr.pdf`)
**Issue date:** 17 May 2026
**Recipient:** National Anti-Corruption Commission (CONAC)
**Public verification:** https://verify.vigilapex.cm/verify/VA-2026-0001
**Public timestamp anchor:** https://verify.vigilapex.cm/ledger

---

## Summary

A public-procurement splitting scheme involving three legally-distinct
but effectively-linked entities was detected over the period
October 2024 – February 2026 in the Centre region. The split procurement
would total **287,450,000 XAF**, structured as five tranches each below
the 90,000,000 XAF threshold that triggers open competitive bidding
(art. 22, Public Procurement Code 2018).

The three contracting entities (SARL Synthetic A, SAS Synthetic B, SARL
Synthetic C) share a common ultimate beneficial owner and an identical
postal address per the consulted registries.

---

## Finding (finding-id: f-review-001)

| Field                     | Value                                                |
| ------------------------- | ---------------------------------------------------- |
| **Title**                 | Alleged splitting — three linked contracting parties |
| **Severity**              | high                                                 |
| **Posterior probability** | 0.87                                                 |
| **Aggregate amount**      | 287,450,000 XAF                                      |
| **Region**                | Centre (CE)                                          |
| **Period covered**        | 2024-10-01 → 2026-02-28                              |
| **Pattern categories**    | A (procurement) + B (shell companies)                |
| **Signal count**          | 6 (≥ CONAC threshold of 5 — doctrine § 25.6.1)       |
| **Governance pillar**     | 3 YES / 0 NO / 0 ABSTAIN / 0 RECUSE                  |

---

## Entities involved

### Primary entity

**SARL Synthetic A** — limited-liability company

- **RCCM**: `RC/YAO/2019/B/12345` (synthetic)
- **NIU**: `M01926-001234567P` (synthetic)
- **Registered address**: BP 0000 Yaoundé, Cameroon (synthetic)
- **Declared ultimate beneficial owners (UBO)**:
  - Synthetic Person One (managing partner 51%)
  - Synthetic Person Two (partner 49%)

### Linked entities (1st degree)

**SAS Synthetic B** — simplified joint-stock company

- RCCM: `RC/YAO/2020/B/67890`
- Shares the postal address of SARL Synthetic A
- Beneficial owner: **Synthetic Person One** (same as above)

**SARL Synthetic C** — limited-liability company

- RCCM: `RC/YAO/2021/B/11111`
- Beneficial owner: **Synthetic Person Two** (same as above)

---

## Contributing signals

Six independent signals contributed to the 0.87 posterior; each
references public documents anchored on IPFS (CID + page + char span):

1. **Signal P-A-001 — Award without open tender**
   Evidence: `bafybeih2gqu3...{synthetic}` (Ministry X Award Bulletin,
   2024-10-15, p.3, char_span [142, 287])
   Strength: 0.85, weight: 1.00, likelihood ratio: 5.67

2. **Signal P-A-007 — Below-threshold splitting**
   Five tranches of 50–58 M XAF, each awarded within a 45-day window,
   aggregate 287 M XAF exceeding the 90 M threshold.
   Evidence: `bafybeih3...{synthetic}` (Bulletins X, Y, Z)
   Strength: 0.92, weight: 1.00, likelihood ratio: 11.50

3. **Signal P-B-002 — Common ultimate beneficial owner**
   The three entities declare the same two UBOs per the consulted
   registries. Evidence: `bafybeih4...{synthetic}`
   Strength: 0.78, weight: 0.90, likelihood ratio: 4.20

4. **Signal P-B-004 — Identical postal address**
   Three RCCMs, one PO box. Evidence: `bafybeih5...{synthetic}`
   Strength: 0.65, weight: 0.80, likelihood ratio: 2.30

5. **Signal P-C-003 — Abnormally homogeneous unit price**
   The five tranches show an identical per-lot price to 0.3%.
   Evidence: `bafybeih6...{synthetic}`
   Strength: 0.71, weight: 0.85, likelihood ratio: 3.10

6. **Signal P-H-002 — Suspicious temporal sequence**
   The five awards all fall in the week preceding Q4 fiscal-year close.
   Evidence: `bafybeih7...{synthetic}`
   Strength: 0.59, weight: 0.70, likelihood ratio: 1.65

---

## Counter-evidence (devil's-advocate pass — AI-Safety pipeline §B.4)

The adversarial pipeline was run after the initial score per DECISION-011.
Three passes were executed:

- **Order randomisation**: three Bayesian-engine passes with permuted
  evidence order. Posterior min 0.84 / max 0.89 / spread 0.05 →
  **stable** (tolerance 0.05).
- **Devil's advocate (LLM)**: counter-narrative generated, two potential
  concerns identified (see below), **not coherent** as a complete
  alternative explanation.
- **Counterfactual probe**: removing the strongest signal P-A-007 →
  posterior drops to 0.61; the finding **remains above the investigation
  threshold 0.55** but **falls below the action threshold 0.85** →
  **robust but sensitive** to the splitting signal.
- **Independent secondary review**: posterior 0.85 → **agrees** within
  the 0.05 tolerance.

### Concerns raised by the devil's advocate

1. The three entities are legally distinct; below-threshold splitting
   is only prohibited per se with proof of concerted intent.
2. The shared postal address could be explained by an accommodation
   fiscal domicile used independently by the UBOs.

### Alternative explanation

No coherent alternative explanation was produced by the adversarial
pipeline that simultaneously accounts for the six signals. The two
concerns above are partial hypotheses, not a substitute narrative.

### Recommended verification steps before action

1. Independently verify the UBO identities via direct consultation of
   the Commercial and Personal Property Credit Register at CCIMA.
2. Examine whether the five awards were made via the same procuring
   entity (contracting authority) or distinct entities.
3. Examine procurement documentation (specifications, bid-opening
   minutes) to verify formal eligibility of the three bidders.

---

## Governance Council Deliberation

The finding was submitted to the five council pillars on 17 May 2026.
3-of-5 quorum (DECISION-008 § C.5.b):

| Pillar        | Address      | Vote                                 | Timestamp            |
| ------------- | ------------ | ------------------------------------ | -------------------- |
| Governance    | `0xpillar-a` | YES                                  | 2026-05-17T14:02:31Z |
| Judicial      | `0xpillar-b` | YES                                  | 2026-05-17T14:04:18Z |
| Civil society | `0xpillar-c` | YES                                  | 2026-05-17T14:07:55Z |
| Audit         | `0xpillar-d` | (did not vote before quorum closure) |                      |
| Technical     | `0xpillar-e` | (did not vote before quorum closure) |                      |

**Result: APPROVED for transmission to CONAC.**

On-chain proposal: `proposal_index = 17` on the `VIGILGovernance.sol`
contract (Polygon testnet; mainnet deployment gated on W-08 / backup-
architect funding).

---

## Chain of custody — cryptographic evidence

| Element                       | Value                                  |
| ----------------------------- | -------------------------------------- |
| **PDF SHA-256**               | `0000000000…{synthetic, 64 hex chars}` |
| **IPFS CID**                  | `bafybeih{synthetic}…`                 |
| **GPG signature fingerprint** | `0000…{synthetic, 40 hex chars}`       |
| **Signature timestamp**       | 2026-05-17T14:15:00.000Z               |
| **Audit-chain anchor seq**    | `audit.actions[seq=12]`                |
| **Anchor body hash**          | `b9c1a4…{from review-demo seeder}`     |
| **Polygon anchor (testnet)**  | tx `0x{synthetic}` block `{synthetic}` |

The validity of this anchor can be independently verified by consulting
public sources:

1. The Merkle inclusion proof on `VIGILAnchor.sol` (Polygon testnet)
   for `seq = 12`.
2. The signed checkpoint of the Hyperledger Fabric witness (chaincode
   `audit-witness`) for the same `seq`.
3. The weekly signed (GPG) public CSV export covering this anchor's
   period, accessible via `https://verify.vigilapex.cm/ledger`.

The three witnesses (Postgres, Fabric, Polygon) must agree on the
`body_hash`; any divergence triggers an `audit.reconciliation_divergence`
event (see `docs/runbooks/audit-chain-divergence.md`).

---

## Version notes

Document produced by VIGIL APEX version `0.1.0` in demonstration mode
(`VIGIL_PHASE=0`, synthetic data). A production instance would emit:

- A valid GPG signature (not `DEV-UNSIGNED-*`) produced by the
  architect's or designated pillar signer's YubiKey.
- A Polygon mainnet anchor (not testnet) with gas covered by the
  operational wallet.
- An SFTP transmission to the CONAC server (not a local drop) with
  acknowledgement-of-receipt followed for 7 days by `worker-conac-sftp`.

---

> This document was produced automatically by the VIGIL APEX system under
> the constraints of AI-SAFETY-DOCTRINE-v1 (12 anti-hallucination layers)
> and TAL-PA doctrine (Total Action Logging with Public Anchoring —
> "the watcher is watched"). Every action taken on this dossier (operator
> read, council vote, transmission) is itself timestamped in the
> publicly-verifiable audit chain.
