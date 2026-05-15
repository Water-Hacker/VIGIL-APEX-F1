# How VIGIL APEX Works — A Complete Walkthrough

**Audience:** Anyone — engineer, lawyer, journalist, council member, citizen — who wants to understand the whole platform from first principles. Written so a non-engineer can read it cover-to-cover; every technical term is defined the first time it appears; every claim cites the file in the repository that proves it; deeper detail is signposted for the curious.

**How to read this:** linearly if you're new, or jump to any section. The first paragraph of each section is the plain-language summary; the rest is the depth.

---

## Table of contents

0. [The sixty-second pitch](#0-the-sixty-second-pitch)
1. [What problem this exists to solve](#1-what-problem-this-exists-to-solve)
2. [Three short stories (the platform from three viewpoints)](#2-three-short-stories-the-platform-from-three-viewpoints)
3. [The complete map](#3-the-complete-map)
4. [The journey of one piece of evidence](#4-the-journey-of-one-piece-of-evidence)
5. [Every app and worker, explained](#5-every-app-and-worker-explained)
6. [The 43 fraud patterns](#6-the-43-fraud-patterns)
7. [The Bayesian certainty engine](#7-the-bayesian-certainty-engine)
8. [The 12-layer AI safety stack](#8-the-12-layer-ai-safety-stack)
9. [Cryptography for non-cryptographers](#9-cryptography-for-non-cryptographers)
10. [The 5-pillar council](#10-the-5-pillar-council)
11. [The triple-witness audit chain](#11-the-triple-witness-audit-chain)
12. [Who sees what (authorization)](#12-who-sees-what-authorization)
13. [The tip portal — a citizen's view](#13-the-tip-portal--a-citizens-view)
14. [The dossier journey — from finding to CONAC](#14-the-dossier-journey--from-finding-to-conac)
15. [Operations — how the platform runs day-to-day](#15-operations--how-the-platform-runs-day-to-day)
16. [Failure modes — what can go wrong and how it's caught](#16-failure-modes--what-can-go-wrong-and-how-its-caught)
17. [Verifiability — how anyone can independently check](#17-verifiability--how-anyone-can-independently-check)
18. [Limits — what this can't do](#18-limits--what-this-cant-do)
19. [Glossary](#19-glossary)

---

## 0. The sixty-second pitch

VIGIL APEX is a sovereign anti-corruption forensic pipeline for the Republic of Cameroon. It reads public-domain data (procurement notices, sanctions lists, corporate registries, court records, citizen tips), looks for 43 specific patterns of fraud, scores how confident it is using Bayesian probability theory, asks an AI to find counter-arguments, requires three out of five hardware-key-holding council members to approve before escalating, then delivers a cryptographically signed dossier to CONAC (the national anti-corruption commission), and writes every step into an audit log that's witnessed by three independent systems (Postgres, Polygon, Hyperledger Fabric) so no one — not even the architect — can tamper with it.

If you remember nothing else, remember the three architectural commitments:

- **Multi-source proof, never single-source.** A pattern only fires when multiple independent sources agree, and a finding only escalates with at least five independent sources at 95 % confidence.
- **No single human can act alone.** Decryption needs three of five council members, each holding a hardware key. Escalation needs the council's vote. Public release needs four of five.
- **Every claim is independently verifiable.** Anyone can check a finding against Polygon mainnet without trusting VIGIL APEX at all.

---

## 1. What problem this exists to solve

Cameroon scored **26 out of 100** on Transparency International's 2023 Corruption Perception Index, ranking 140 of 180. The World Bank's 2022 Public Expenditure Review estimates **10–15 % of state procurement spend is lost to corruption**. That's hundreds of millions of euros a year, in a country with a per-capita GDP under €1,800.

The institutions that exist to catch this — CONAC (Commission Nationale Anti-Corruption), MINFI (Ministry of Finance) audit division, ANIF (Agence Nationale d'Investigation Financière), the Cour des Comptes (national audit court) — are not the bottleneck on enforcement. Their bottleneck is **evidence collection at scale**: 26 separate public data sources, structured procurement portals, sanctions feeds, corporate registries, court extracts, satellite imagery, citizen tips. A human team that cross-references those sources manually for every contract can investigate maybe a dozen cases a year. The platform's job is to do the **mechanical cross-referencing** automatically, present a calibrated probability that something is wrong, and hand the human investigators a complete pre-built dossier when the case is strong.

The platform does **not** decide guilt. It does not prosecute. It does not even publicly accuse. It compiles evidence and signals confidence, then a five-pillar governance council decides whether the evidence is strong enough to hand to a human institution. The human institution makes the consequential decision.

---

## 2. Three short stories (the platform from three viewpoints)

### Aïssatou, a citizen in Maroua, sees a suspicious contract

Aïssatou is a teacher. She reads in _Cameroon Tribune_ that a public-works company called "Construction Plus SARL" just won a €4 million contract to rebuild the regional hospital. She knows from her cousin (who works in construction) that Construction Plus has never built anything bigger than a kindergarten. She suspects fraud.

She opens her browser, goes to `tip.vigil-apex.cm`, types her observation in French, and clicks Submit. Her browser encrypts what she wrote — before sending it. The platform never receives her plaintext. Even the architect cannot read her tip. The encrypted blob is stored. Her IP address is never recorded.

Three weeks later, three of the five council members each touch their hardware keys in a ceremony. The Shamir-share quorum unlocks the council's private key, the platform decrypts her tip, an operator triages it, links it to a finding that the system independently generated from public procurement records, and the case is escalated to CONAC.

Aïssatou doesn't get a thank-you. She wanted it that way. Her contribution is anonymous-by-design.

### Daniel, an operator at VIGIL APEX, starts his Monday

Daniel logs in with his YubiKey (a small USB hardware key he taps to authenticate — no password). The platform's dashboard shows him three queues:

- **Findings** — 14 candidate findings the platform generated overnight from procurement portal scrapes + sanctions checks + corporate registry diffs. Each has a posterior probability between 0.55 and 0.98. He reviews them one by one.
- **Tip triage** — 2 decrypted tips from the latest council quorum, waiting for an operator to link them to existing findings or promote them to new ones.
- **Dead-letter** — 1 ingestion job that failed (the OFAC SDN feed returned a malformed response). He reads the error, requeues it, and watches it succeed on retry.

Daniel doesn't decide what becomes a dossier. He decides what is _ready for council consideration_. He reads a finding scored at posterior 0.96 with seven independent signals — it's about a director of a state agency whose brother's company won eight contracts in a row. He clicks "open council proposal." This commits a hash on Polygon mainnet to prevent front-running, then publishes the proposal to the council portal.

### Naima, a council member, joins a vote ceremony

Naima is the civil-society pillar — a respected investigative journalist, retired now, who agreed to serve a three-year term. Her hardware key has been registered with Keycloak for nine months. She gets an email: a proposal is open. She has 14 days to vote.

She logs in (YubiKey touch), reads the proposal summary, reviews the linked dossier draft, reads the AI-generated counter-argument (the system always presents what it believes is the strongest case _against_ the finding), and decides. She votes YES. Her browser signs the vote transaction with her YubiKey and submits it to the Polygon smart contract.

Three out of five YES votes are required to escalate. When the third pillar votes, the contract emits an event. The platform's governance worker sees the event, renders the dossier in French and English PDF, signs it with the architect's GPG key, pins it to IPFS, and delivers it via SFTP to CONAC.

Naima never sees the contents of any citizen tip. She sees only the audit-grade derived finding. She never knows who tipped what; she knows only what the evidence says.

---

## 3. The complete map

```
┌─────────────────────────────────────────────────────────────────────┐
│                          PUBLIC INTERNET                            │
│  (citizens, journalists, civil-society reviewers, CONAC inspector)  │
└─────────────────┬─────────────────────────────────────┬─────────────┘
                  │                                     │
        ┌─────────▼─────────┐                 ┌─────────▼──────────┐
        │   tip portal      │                 │  /verify, /ledger  │
        │   /tip            │                 │  /public/audit     │
        │  (anonymous)      │                 │ (public verify-on- │
        └─────────┬─────────┘                 │   anything page)   │
                  │                           └─────────┬──────────┘
                  │                                     │
                  ▼                                     │
              CADDY (TLS + rate limit + IP strip)       │
                  │                                     │
                  ▼                                     │
              DASHBOARD (Next.js)                       │
                  │                                     │
                  ▼                                     │
              POSTGRES (encrypted tips)                 │
                                                        │
┌───────────────────────────────────────────────────────┼──────────┐
│                      OPERATOR PERIMETER               │          │
│        (authentic via Keycloak + YubiKey only)        │          │
├───────────────────────────────────────────────────────┼──────────┤
│  /findings    /triage    /calibration    /council     │          │
│                                                       │          │
│  ─── data ingestion (every hour, cron-driven) ───     │          │
│  adapter-runner ──► 26 adapters ──► raw events        │          │
│  (MINFI, OFAC, EU sanctions, OpenCorporates, ...)     │          │
│                                                       │          │
│  ─── entity + pattern pipeline ───                    │          │
│  worker-extractor   (regex + LLM-fallback fields)     │          │
│  worker-entity      (entity resolution)               │          │
│  worker-pattern     (43 patterns)                     │          │
│  worker-score       (Bayesian engine)                 │          │
│  worker-counter-evidence  (devil's-advocate LLM)      │          │
│                                                       │          │
│  ─── council + dossier ───                            │          │
│  worker-governance  ◄──── Polygon events ─────►       │          │
│  worker-dossier     ──► IPFS pin + GPG sign ──►       │          │
│  worker-conac-sftp  ──► SFTP delivery to CONAC ──►    │          │
│                                                       │          │
│  ─── triple-witness audit chain ───                   │          │
│  audit-chain  ──►  Postgres hash chain                │          │
│             ──►  Polygon mainnet (VIGILAnchor.sol)    │          │
│             ──►  Hyperledger Fabric peer (chaincode)  │          │
│  worker-anchor   (every hour: Polygon commit)         │          │
│  worker-fabric-bridge (every emit: Fabric mirror)     │          │
│  worker-reconcil-audit (every hour: 3-way check)      │          │
│  worker-audit-watch (every 5min: anomaly + chain      │          │
│                       integrity replay)               │          │
└───────────────────────────────────────────────────────┴──────────┘
                  │
                  ▼
        ┌───────────────────────┐
        │   CONAC, MINFI, ANIF, │
        │   Cour des Comptes    │
        │ (institutional inbox) │
        └───────────────────────┘
```

The pieces fit together like an assembly line where each station has one job, the audit log is the chain-of-custody, and the council is the foreman who decides what ships.

---

## 4. The journey of one piece of evidence

Let's trace one concrete example. A procurement notice is published on the MINFI portal at 09:14:00 UTC. We follow it from publication to CONAC delivery.

| Time              | Step                    | What happens                                                                                                                                                                                                                                                                             | Where in the code                                                                                                                                                          |
| ----------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 09:14:00          | Publication             | MINFI publishes a tender-award notice on their public portal                                                                                                                                                                                                                             | (external)                                                                                                                                                                 |
| 09:20:00          | Scrape                  | `adapter-runner` (running on a 6-min cadence for MINFI) fetches the new notice via bounded-HTTP fetch (50 MB cap, 30 s timeout)                                                                                                                                                          | [`apps/adapter-runner/src/adapters/minfi-procurement.ts`](../../apps/adapter-runner/src/adapters/minfi-procurement.ts)                                                     |
| 09:20:01          | Raw event written       | Tender event written to `source.event` with provenance (URL, HTTP status, SHA-256 of response body, fetched-via-proxy info)                                                                                                                                                              | [`packages/db-postgres/src/schema/source.ts`](../../packages/db-postgres/src/schema/source.ts)                                                                             |
| 09:20:02          | Audit row 1             | `source.event.received` written to global hash chain                                                                                                                                                                                                                                     | [`packages/audit-log/src/emit.ts`](../../packages/audit-log/src/emit.ts)                                                                                                   |
| 09:20:03          | Field extraction        | `worker-extractor` parses HTML, pulls structured fields (bidder count = 1, amount = 4_200_000_000 XAF, awardee = "Construction Plus SARL", procurement_method = "gré à gré", award_date = "2026-05-11")                                                                                  | [`apps/worker-extractor/src/index.ts`](../../apps/worker-extractor/src/index.ts)                                                                                           |
| 09:20:05          | Entity resolution       | `worker-entity` looks up "Construction Plus SARL" against the entity canonical, finds RCCM `RC/YAO/2024/B/0142`, NIU `M042200012345R`, registered May 2024 (rapid incorporation flag)                                                                                                    | [`apps/worker-entity/src/index.ts`](../../apps/worker-entity/src/index.ts)                                                                                                 |
| 09:20:06          | Pattern detection       | `worker-pattern` runs all 43 patterns against the entity. Three fire: **P-A-001** (single bidder), **P-B-004** (rapid incorporation < 90 days before award), **P-A-003** (no-bid emergency justification missing). Each produces a `Signal` row.                                         | [`packages/patterns/src/category-{a,b}/`](../../packages/patterns/src/)                                                                                                    |
| 09:20:07          | Bayesian scoring        | `worker-score` applies the certainty engine: prior P(F)=0.05, three signals with likelihood ratios 14.2, 6.8, 11.0 → posterior P(F                                                                                                                                                       | E)=0.83                                                                                                                                                                    | [`packages/certainty-engine/src/bayesian.ts`](../../packages/certainty-engine/src/bayesian.ts) |
| 09:20:08          | Counter-evidence pass   | `worker-counter-evidence` asks the LLM (through SafeLlmRouter): "What is the strongest argument _against_ this being fraud?" LLM finds a legitimate emergency-procurement clause in the contract attachment. Posterior drops to 0.79.                                                    | [`apps/worker-counter-evidence/src/index.ts`](../../apps/worker-counter-evidence/src/index.ts)                                                                             |
| 09:20:09          | Finding row written     | Finding state = `review`, posterior = 0.79, signal_count = 3                                                                                                                                                                                                                             | [`packages/db-postgres/src/schema/finding.ts`](../../packages/db-postgres/src/schema/finding.ts)                                                                           |
| 09:20:10          | Audit row 2             | `finding.created` + `finding.posterior_updated` written to chain                                                                                                                                                                                                                         | (same as audit row 1)                                                                                                                                                      |
| (3 days)          | Cross-corroboration     | OpenSanctions adapter ingests an update: a director of Construction Plus is named in a Paris court filing for an unrelated commercial dispute. **P-B-006** (UBO mismatch) fires. New signal.                                                                                             | (background workers)                                                                                                                                                       |
| (3 days)          | Recalculation           | `worker-score` re-runs the Bayesian engine. Now 4 signals, posterior = 0.91.                                                                                                                                                                                                             | (same)                                                                                                                                                                     |
| (5 days)          | Anonymous tip           | Aïssatou submits an encrypted tip ("Construction Plus has no employees and no equipment, I know because my cousin works in construction"). Tip lands in encrypted form. Operator queue increments.                                                                                       | [`apps/dashboard/src/app/tip/page.tsx`](../../apps/dashboard/src/app/tip/page.tsx)                                                                                         |
| (1 week)          | Quorum ceremony         | Three council members each touch their YubiKey, each contributes one Shamir share, the council group private key is reconstructed in-memory, the tip is decrypted, an operator triages it. The tip is _linked_ to the existing finding as a `tip.promoted_to_finding` event. New signal. | [`packages/security/src/shamir.ts`](../../packages/security/src/shamir.ts), [`apps/worker-tip-triage/src/triage-flow.ts`](../../apps/worker-tip-triage/src/triage-flow.ts) |
| (2 weeks)         | Calibration check       | Posterior is now 0.96 with 6 signals. The CONAC threshold is `posterior ≥ 0.95 AND signal_count ≥ 5`. Threshold met.                                                                                                                                                                     | [`packages/shared/src/constants.ts`](../../packages/shared/src/constants.ts)                                                                                               |
| (2 weeks)         | Operator opens proposal | An operator clicks "Open council proposal" on the finding-detail screen. The dashboard computes the commitment hash (`keccak256(finding_hash, uri, salt, proposer)`) and submits it to `VIGILGovernance.sol` on Polygon.                                                                 | [`apps/dashboard/src/app/council/proposals/[id]/page.tsx`](../../apps/dashboard/src/app/council/proposals/[id]/page.tsx)                                                   |
| (2 weeks, +2 min) | Proposal reveal         | After the 2-minute reveal delay (anti-front-running), the proposer calls `openProposal()` with the actual finding_hash + URI. Contract emits `ProposalOpened`.                                                                                                                           | [`contracts/contracts/VIGILGovernance.sol`](../../contracts/contracts/VIGILGovernance.sol)                                                                                 |
| (2.1 weeks)       | Council votes           | Each pillar reviews and votes. After 3 YES votes, contract emits `ProposalEscalated`.                                                                                                                                                                                                    | (same)                                                                                                                                                                     |
| (2.1 weeks)       | Dossier render          | `worker-governance` sees the event, double-checks the FIND-002 threshold (posterior ≥ 0.95, signal_count ≥ 5), publishes a dossier-render envelope. `worker-dossier` renders the FR + EN PDF, GPG-signs, pins to IPFS.                                                                   | [`apps/worker-governance/src/vote-ceremony.ts`](../../apps/worker-governance/src/vote-ceremony.ts), [`apps/worker-dossier/`](../../apps/worker-dossier/)                   |
| (2.1 weeks)       | SFTP delivery           | `worker-conac-sftp` triple-checks the threshold (third defence layer), uploads to CONAC's SFTP inbox, polls for ack.                                                                                                                                                                     | [`apps/worker-conac-sftp/src/index.ts`](../../apps/worker-conac-sftp/src/index.ts)                                                                                         |
| (2.1 weeks)       | Audit closure           | Every step has emitted to the audit chain. The chain has been mirrored to Hyperledger Fabric and a Polygon anchor for the seq range has been committed. The dossier's final state is now independently verifiable on the public Polygon explorer.                                        | (audit chain workers)                                                                                                                                                      |
| (continuously)    | Reconciliation          | `worker-reconcil-audit` runs hourly and confirms all three witnesses agree on every row in the chain range covering this finding.                                                                                                                                                        | [`apps/worker-reconcil-audit/`](../../apps/worker-reconcil-audit/)                                                                                                         |

That's the complete forensic chain. Every step is logged. Every step is signed. Every step is replayable.

---

## 5. Every app and worker, explained

The repository has **5 user-facing apps** and **20 background workers**. Each worker has exactly one job, runs in its own Docker container, consumes one Redis stream, persists results to Postgres, and emits an audit event for every state transition. That "one worker, one job" rule is doctrine: it makes the dead-letter queue diagnostic ("which station did the failure happen at?"), and it lets one worker's outage be contained without taking the whole pipeline down.

### User-facing apps (5)

| App                | Plain-language description                                                                                                                                                               | Code location                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **dashboard**      | The web interface. Operators sign in here, citizens submit tips here, journalists verify here, council members vote here. Next.js 14 server-rendered.                                    | [`apps/dashboard/`](../../apps/dashboard/)           |
| **api**            | A separate HTTP API surface for programmatic integrations (e.g., a media-monitoring system that wants to query verify endpoints).                                                        | [`apps/api/`](../../apps/api/)                       |
| **adapter-runner** | Runs the 26 ingestion adapters on rotating cadence — kicks off MINFI scrape every 6 min, OFAC every 4 hours, etc. Not a worker (no Redis stream), but a scheduled scraper fleet manager. | [`apps/adapter-runner/`](../../apps/adapter-runner/) |
| **audit-verifier** | A command-line tool an investigator runs to replay the audit chain from a CSV export and confirm every hash holds. Used by external reviewers.                                           | [`apps/audit-verifier/`](../../apps/audit-verifier/) |
| **audit-bridge**   | A one-shot tool that backfills legacy single-witness audit rows to the triple-witness format. Used only during migrations.                                                               | [`apps/audit-bridge/`](../../apps/audit-bridge/)     |

### Workers, grouped by what they do (20)

#### Data ingestion pipeline (turn raw scraped HTML into structured fact-rows)

| Worker                      | Plain-language description                                                                                                                                                                                                                                    | Code                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **worker-extractor**        | Takes a raw scraped HTML/PDF event and pulls out the structured fields (bidder count, amount, supplier name, dates). First tries deterministic French regex; only falls back to the LLM if the regex fails, and only with strict schema validation on output. | [`apps/worker-extractor/`](../../apps/worker-extractor/)               |
| **worker-entity**           | "SOCIÉTÉ XYZ" / "XYZ SARL" / "XYZ Cameroun" — are these the same entity? The worker queries Neo4j for fuzzy-matched candidates plus authoritative registry lookups, then collapses them into one canonical entity row with NIU + RCCM.                        | [`apps/worker-entity/`](../../apps/worker-entity/)                     |
| **worker-pattern**          | Runs every applicable pattern (from the 43) against the resolved entity. Patterns are pure functions: input → output, deterministic, unit-tested.                                                                                                             | [`apps/worker-pattern/`](../../apps/worker-pattern/)                   |
| **worker-score**            | Combines the signals fired by `worker-pattern` through the Bayesian certainty engine, then runs the adversarial pipeline (order-randomisation, devil's-advocate, counterfactual collapse), then writes the final posterior.                                   | [`apps/worker-score/`](../../apps/worker-score/)                       |
| **worker-counter-evidence** | Specifically asks the LLM "find the strongest argument _against_ this being fraud" and stores the result alongside the supporting evidence. If the counter-argument is coherent, the operator must address it before escalating.                              | [`apps/worker-counter-evidence/`](../../apps/worker-counter-evidence/) |
| **worker-document**         | Pins documents (procurement PDFs, court filings) to IPFS, runs OCR if needed, computes perceptual hashes.                                                                                                                                                     | [`apps/worker-document/`](../../apps/worker-document/)                 |
| **worker-image-forensics**  | Strips EXIF metadata from images, runs perceptual hashing to detect re-uploaded images, flags photo manipulation.                                                                                                                                             | [`apps/worker-image-forensics/`](../../apps/worker-image-forensics/)   |
| **worker-satellite**        | For findings flagged with an AOI (area of interest — usually a construction site), pulls the relevant Planet NICFI satellite tile and checks for evidence of actual construction vs. ghost project.                                                           | [`apps/worker-satellite/`](../../apps/worker-satellite/)               |
| **worker-minfi-api**        | A specialised adapter for the MINFI BIS (Budget Information System) API — gated behind an MOU because the source requires authentication.                                                                                                                     | [`apps/worker-minfi-api/`](../../apps/worker-minfi-api/)               |

#### Tips pipeline (handle anonymous citizen submissions)

| Worker                | Plain-language description                                                                                                                                                                                                                          | Code                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **worker-tip-triage** | After the 3-of-5 council quorum ceremony unlocks the council private key, this worker decrypts the tip in memory (key never touches disk), an operator triages it, then the worker links it to an existing finding or promotes it to a new finding. | [`apps/worker-tip-triage/`](../../apps/worker-tip-triage/) |

#### Council + dossier pipeline (turn approved findings into delivered dossiers)

| Worker                | Plain-language description                                                                                                                                                                                                                                                                                                                                                                      | Code                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **worker-governance** | Listens to Polygon for `ProposalOpened`, `VoteCast`, `ProposalEscalated`, `ProposalDismissed`, `ProposalExpired` events from `VIGILGovernance.sol`. Projects them into Postgres for operator visibility. When 3 of 5 YES votes are reached and a proposal escalates, this worker re-checks the CONAC threshold (posterior ≥ 0.95 + signal_count ≥ 5) and publishes the dossier-render envelope. | [`apps/worker-governance/`](../../apps/worker-governance/) |
| **worker-dossier**    | Renders the bilingual PDF (French + English), GPG-signs it, pins it to IPFS. The PDF is deterministic — same finding inputs always produce the same PDF bytes — so a third party can verify by re-rendering.                                                                                                                                                                                    | [`apps/worker-dossier/`](../../apps/worker-dossier/)       |
| **worker-conac-sftp** | Delivers the signed PDF + manifest to CONAC via SFTP. Triple-checks the threshold one last time before SFTP put. Polls for the CONAC acknowledgement file.                                                                                                                                                                                                                                      | [`apps/worker-conac-sftp/`](../../apps/worker-conac-sftp/) |

#### Audit chain (the forensic trail — three independent witnesses)

| Worker                    | Plain-language description                                                                                                                                                                                                                                  | Code                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **worker-anchor**         | Every hour, computes a Merkle root over recently-added audit rows and commits it to Polygon mainnet via `VIGILAnchor.sol`. High-significance events (council votes, dossier deliveries) get their own immediate individual anchor through a fast-lane loop. | [`apps/worker-anchor/`](../../apps/worker-anchor/)                 |
| **worker-fabric-bridge**  | Mirrors every audit row to a Hyperledger Fabric chaincode for the third witness. If Fabric's stored hash disagrees with what's in Postgres, the worker raises a fatal alert.                                                                                | [`apps/worker-fabric-bridge/`](../../apps/worker-fabric-bridge/)   |
| **worker-audit-watch**    | Every 5 minutes, scans the user-action log for suspicious patterns (bulk downloads, repeated failed logins, off-hours access bursts). Also re-replays a sliding window of the hash chain to make sure no one tampered with old rows.                        | [`apps/worker-audit-watch/`](../../apps/worker-audit-watch/)       |
| **worker-reconcil-audit** | Every hour, scans all three witnesses (Postgres, Fabric, Polygon anchors) and reports any divergence. Re-queues missing-from-Fabric envelopes for the bridge to pick up. Raises a non-recoverable alert if hashes diverge.                                  | [`apps/worker-reconcil-audit/`](../../apps/worker-reconcil-audit/) |

#### Adapter health (auto-repair when sources change their HTML)

| Worker                    | Plain-language description                                                                                                                                                                                                                                                                                                               | Code                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **worker-adapter-repair** | When a source website changes its HTML and the adapter starts returning zero events, this worker asks the LLM to propose a new CSS or XPath selector, then shadow-tests the new selector against the old selector for 48 windows before auto-promoting (or holding for architect sign-off if the adapter is in the "critical" category). | [`apps/worker-adapter-repair/`](../../apps/worker-adapter-repair/) |

#### Federation (Phase 3 — multi-region coordination)

| Worker                         | Plain-language description                                                                                                                                                                         | Code                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **worker-federation-agent**    | On a regional VPS, listens for outbound events and publishes them via signed-envelope gRPC to the core.                                                                                            | [`apps/worker-federation-agent/`](../../apps/worker-federation-agent/)       |
| **worker-federation-receiver** | On the core, receives events from regional agents, verifies their signatures against Vault PKI subordinate certificate authorities, applies CRL (certificate revocation list) checks, and ingests. | [`apps/worker-federation-receiver/`](../../apps/worker-federation-receiver/) |

That's all 25 production processes accounted for.

---

## 6. The 43 fraud patterns

A **pattern** is a rule. It looks at one entity (a tender, a company, a person, a project, a payment) and answers: "does this look like fraud?" If yes, the pattern produces a **signal** — a structured row describing what fired and why.

Patterns are deliberately narrow. They do not "judge guilt." Each pattern detects one specific anomaly. Real fraud usually fires several patterns together; that's why the Bayesian engine sums multiple signals into a posterior probability instead of trusting any single pattern.

Every pattern is a pure function: `detect(subject, context) → { fires, evidence, citations }`. Patterns are unit-tested with golden fixtures (real example inputs with expected outputs). 552 unit tests pin every pattern's invariants.

Bilingual French + English titles and descriptions live in the pattern source files themselves so the dossier renderer can produce a localised output without separate translation files.

### Category A — Procurement competition (9 patterns)

Patterns that detect manipulation of the bidding process.

| ID          | English              | French                                  | Fires when                                                                                                  |
| ----------- | -------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **P-A-001** | Single-bidder award  | Marché à soumissionnaire unique         | Exactly one bidder + material threshold OR no-bid extension                                                 |
| **P-A-002** | Split tender         | Marché fractionné                       | Multiple awards to same supplier, each just below the threshold for open competition, within a short window |
| **P-A-003** | No-bid emergency     | Urgence sans appel d'offres             | Emergency procurement procedure used without a documented qualifying event                                  |
| **P-A-004** | Late amendment       | Avenant tardif                          | Contract amendment after award that materially changes price or scope                                       |
| **P-A-005** | Sole-source gap      | Justification de gré à gré insuffisante | Sole-source award without the legally-required justification document on file                               |
| **P-A-006** | Uneven bid spread    | Écart anormal entre offres              | Winning bid is less than 60% or more than 140% of the runner-up — suggests collusion or padding             |
| **P-A-007** | Narrow specification | Cahier des charges restrictif           | Technical specification matches only one known supplier's catalogue, eliminating competition                |
| **P-A-008** | Bid-protest pattern  | Recours répétés                         | Same supplier protests every losing bid against the same competitor (harassment / intimidation pattern)     |
| **P-A-009** | Debarment bypass     | Contournement de débarrement            | Awardee is a renamed or "doing-business-as" successor of a debarred firm                                    |

### Category B — Corporate-veil / Ultimate Beneficial Owner (7 patterns)

Patterns that pierce shell companies and nominee directors to find the real owner.

| ID          | English                 | French                                   | Fires when                                                                                                                   |
| ----------- | ----------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **P-B-001** | Shell company           | Société écran                            | Awardee has zero employees, no operating address (registered at a mailbox), no prior contracts                               |
| **P-B-002** | Nominee director        | Administrateur prête-nom                 | Director appears on 5+ unrelated boards with no domain expertise — telltale of a paid front                                  |
| **P-B-003** | Jurisdiction shopping   | Forum non conveniens                     | UBO chain crosses 3+ jurisdictions, ending in an FATF grey-listed country                                                    |
| **P-B-004** | Rapid incorporation     | Création récente avant attribution       | Awardee incorporated less than 90 days before contract — too new to have credentials                                         |
| **P-B-005** | Co-incorporated cluster | Grappe co-incorporée                     | 3+ bidders share incorporation date / registry filer / address — indicates same human is behind multiple "competing" bidders |
| **P-B-006** | UBO mismatch            | Divergence sur le bénéficiaire effectif  | Declared UBO differs from UBO inferred from registry / OpenCorporates data                                                   |
| **P-B-007** | PEP link                | Lien avec personne politiquement exposée | Director or UBO matches a Politically Exposed Person in the OpenSanctions / ANIF PEP list                                    |

### Category C — Price / finance (6 patterns)

Patterns that detect financial anomalies.

| ID          | English                 | French                                | Fires when                                                                 |
| ----------- | ----------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| **P-C-001** | Price above benchmark   | Prix supérieur au marché de référence | Awarded unit price > regional benchmark × 1.5                              |
| **P-C-002** | Unit-price anomaly      | Anomalie de prix unitaire             | Same SKU sold at materially different prices across simultaneous contracts |
| **P-C-003** | Quantity mismatch       | Quantités incohérentes                | Delivery / inspection quantity ≠ contract quantity                         |
| **P-C-004** | Inflation divergence    | Écart par rapport à l'inflation       | Contract escalator clause exceeds 2× CPI for the period — over-indexed     |
| **P-C-005** | Currency arbitrage      | Arbitrage de devises                  | XAF / EUR / USD conversion not at BEAC reference rate on signature date    |
| **P-C-006** | Escalation-clause abuse | Abus de clause d'indexation           | Escalator triggered without a published index supporting it                |

### Category D — Delivery / site (5 patterns)

Patterns that compare what was promised against what was delivered.

| ID          | English                 | French                     | Fires when                                                                                      |
| ----------- | ----------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| **P-D-001** | Ghost project           | Projet fantôme             | Planet NICFI satellite tile shows no construction at declared site / date                       |
| **P-D-002** | Incomplete construction | Construction inachevée     | Final payment released without a valid inspection certificate (or with a deficient one)         |
| **P-D-003** | Site mismatch           | Site déclaré ≠ site réel   | Geographic coordinates in contract documents diverge from the construction-evidence coordinates |
| **P-D-004** | Quality deficit         | Carence qualité            | Sample inspection report flags 30%+ of measurements below specification                         |
| **P-D-005** | Progress fabrication    | Falsification d'avancement | Progress report contradicts prior reports or on-site evidence                                   |

### Category E — Sanctions (4 patterns)

Patterns that catch transactions touching sanctioned parties.

| ID          | English                           | French                                | Fires when                                                                                            |
| ----------- | --------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **P-E-001** | Sanctioned-direct                 | Entité sanctionnée (directe)          | Counterparty matches OFAC SDN / EU consolidated / UN Security Council / World Bank / AfDB / ANIF list |
| **P-E-002** | Sanctioned-related                | Lien avec entité sanctionnée          | Director / UBO / address / phone matches a sanctioned entity within 2 graph hops                      |
| **P-E-003** | Sanctioned-jurisdiction payment   | Paiement vers juridiction sanctionnée | Wire ordered to a FATF grey-list or OFAC sectorally-sanctioned bank                                   |
| **P-E-004** | Transaction with PEP + sanctioned | Transaction PEP + sanctionnée         | Same transaction touches both a PEP and a sanctioned counterparty                                     |

### Category F — Network / structure (5 patterns)

Patterns that detect money-flow shapes that suggest layering or kickbacks.

| ID          | English                | French                           | Fires when                                                                                                                   |
| ----------- | ---------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **P-F-001** | Round-trip payment     | Paiement en boucle               | XAF leaves entity A → B → C → eventually returns to A within window — classic layering                                       |
| **P-F-002** | Director ring          | Anneau de dirigeants             | Directors of A, B, C share 3+ board overlaps without commercial justification                                                |
| **P-F-003** | Supplier circular flow | Flux fournisseur circulaire      | Same supplier shows up as subcontractor under 3+ different prime contractors winning state contracts                         |
| **P-F-004** | Hub-and-spoke          | Modèle hub-and-spoke             | A single hub entity routes 60%+ of payments to or from 5+ spoke entities                                                     |
| **P-F-005** | Dense bidder network   | Réseau dense de soumissionnaires | Louvain community detection (a graph-clustering algorithm) finds a tight cluster of bidders with co-occurrence density > 0.7 |

### Category G — Document forensics (4 patterns)

Patterns that detect document tampering.

| ID          | English            | French                   | Fires when                                                                             |
| ----------- | ------------------ | ------------------------ | -------------------------------------------------------------------------------------- |
| **P-G-001** | Backdated document | Document antidaté        | PDF creation timestamp is later than the declared signature date                       |
| **P-G-002** | Signature mismatch | Discordance de signature | Visual signature on document doesn't match the reference signature in the registry     |
| **P-G-003** | Metadata anomaly   | Anomalie de métadonnées  | EXIF or PDF metadata reveals an author / software that contradicts the declared signer |
| **P-G-004** | Font anomaly       | Anomalie de police       | Document uses fonts inconsistent with the issuing institution's known templates        |

### Category H — Time / sequence (3 patterns)

Patterns that detect impossible orderings.

| ID          | English                   | French                            | Fires when                                                                                    |
| ----------- | ------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| **P-H-001** | Award before tender close | Attribution avant clôture         | The award decision is dated before the tender's official closing date                         |
| **P-H-002** | Amendment out of sequence | Avenant hors séquence             | Amendment N is dated before amendment N-1 in the contract amendment log                       |
| **P-H-003** | Holiday publication burst | Publication groupée en jour férié | Multiple high-value awards published on a public holiday (deliberately low-visibility window) |

**Total: 9 + 7 + 6 + 5 + 4 + 5 + 4 + 3 = 43 patterns.**

Patterns are stored at [`packages/patterns/src/category-{a..h}/`](../../packages/patterns/src/) with one file per pattern. Every pattern has fixtures in [`packages/patterns/test/category-{a..h}/`](../../packages/patterns/test/) — known-positive and known-negative cases that the unit test suite confirms still pass.

---

## 7. The Bayesian certainty engine

The Bayesian engine answers one question: **given the evidence we have, what is the probability this finding is genuinely fraudulent?**

It's based on **Bayes' theorem**, which in plain language says: start with a baseline assumption ("how often is fraud true generally?"), then update that assumption each time a new piece of evidence arrives.

### A worked example

Say we know that in Cameroon's procurement context, the **prior probability** of any randomly selected contract being fraudulent is 5% (`P(F) = 0.05`). That's our starting baseline — before we see any evidence at all, we already know that fraud is fairly rare.

Now signal **P-A-001** (single-bidder award) fires. Through historical calibration we know that when this signal fires, the probability of fraud is approximately 60% (`P(F | E1) = 0.60`). So the posterior is updated upward.

Then signal **P-B-004** (rapid incorporation) fires. Again, calibration tells us how much this should move the posterior.

The engine combines signals using **likelihood ratios** (a more numerically stable formulation than recomputing probabilities each step):

```
posterior_odds = prior_odds × LR1 × LR2 × LR3 × ... × independence_weighting
posterior_probability = posterior_odds / (1 + posterior_odds)
```

Each pattern has a calibrated likelihood ratio (`LR`) that the architect computes from a labelled ground-truth corpus.

### The independence weighting

Two signals that are essentially the same evidence shouldn't multiply the confidence by twice as much as one. The engine applies a **pairwise-independence weight** that down-weights signals that historically co-occur. This is how the platform avoids being fooled by an attacker who knows three of the 43 patterns are correlated and tries to flood evidence into one corner.

### The adversarial pipeline

Before the final posterior is "accepted" and visible to operators, the engine runs four adversarial checks:

| Check                       | Plain-language description                                                                                                                                                   | If it fails                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Order randomisation**     | Run the same evidence through the engine in a different presentation order. If the posterior changes by more than a small tolerance, the engine doesn't trust itself.        | Posterior `held` with reason `order_randomisation_disagreement` |
| **Devil's advocate**        | Ask the LLM to construct the strongest case _against_ the finding. If the counter-argument is coherent and grounded, the engine flags the finding for extra operator review. | Posterior `held` with reason `devils_advocate_coherent`         |
| **Counterfactual collapse** | Remove one piece of evidence at a time and re-run. If the posterior barely changes, that evidence was non-load-bearing — flagged as a calibration signal.                    | Posterior `held` with reason `counterfactual_collapse`          |
| **Secondary review**        | A separate calibration model recomputes. If it disagrees materially, the finding is held.                                                                                    | Posterior `held` with reason `secondary_review_disagreement`    |

These run automatically; an operator sees the result and the reasons.

### Calibration

The engine's quality is measured by two standard metrics:

- **Expected Calibration Error (ECE)** — how well do the posterior probabilities match observed frequencies? If we say "P=0.80" 100 times, fraud should actually be true about 80 of those times. ECE measures the deviation.
- **Brier score** — overall mean-squared error of probability predictions.

The operator dashboard at `/calibration` ([`apps/dashboard/src/app/calibration/page.tsx`](../../apps/dashboard/src/app/calibration/page.tsx)) shows the current ECE per pattern. If ECE drifts above the published threshold, the platform refuses to ship findings until the architect investigates.

The calibration depends on a **labelled ground-truth corpus** in `personal/calibration-seed/` (architect-private, not in the repo). **Phase 1 minimum:** 30 labelled cases before the engine is considered armed for institutional output.

---

## 8. The 12-layer AI safety stack

The platform uses Large Language Models (LLMs) in three narrow contexts: field extraction (`worker-extractor`), counter-evidence drafting (`worker-counter-evidence`), and adapter-selector proposal (`worker-adapter-repair`). The LLM never decides anything consequential on its own — but its output enters the pipeline, so we need extreme rigour about _what kinds of mistakes the LLM is allowed to make_.

The doctrine — **DECISION-011, the AI Safety Doctrine v1.0** — composes twelve layered checks at the [`packages/llm/src/safe-llm-router.ts`](../../packages/llm/src/safe-llm-router.ts) chokepoint. Every LLM call goes through it. There is no bypass. The build-time RBAC coverage check has a sister-shape lint that enforces no other LLM call site exists.

### Layer 1: Provider firewall

Only Anthropic API (primary) and AWS Bedrock (failover). No OpenAI, no Gemini, no local-weight open models for production. The reason is supply chain — the platform's threat model includes prompt-injection attacks that target specific provider quirks; reducing the provider surface reduces the threat surface.

### Layer 2: Model pinning

The model ID is a specific version (e.g., `claude-3-5-sonnet-20241022`), not a `latest` alias. A model upgrade is a deliberate architect decision recorded in `docs/decisions/log.md`, never automatic.

### Layer 3: Temperature lock

LLMs have a "temperature" knob that controls how random their outputs are. The doctrine pins:

- `0.0` for extraction (deterministic — same input always produces same output)
- `0.2` for classification (very low randomness)
- `0.4` for translation
- `0.6` for devil's-advocate (slightly higher to encourage diverse counter-arguments)

Never higher. No "creativity" temperature.

### Layer 4: System-prompt allowlist

System prompts (the instructions an LLM gets) are stored in versioned files in [`prompts/`](../../prompts/). No prompt is constructed by concatenation at runtime. This means an attacker who controls the input data cannot construct a system prompt — they can only fill in the user-message slot of an existing system prompt.

### Layer 5: Schema-validated output

Every LLM response is parsed against a Zod schema (a TypeScript runtime type checker). If the LLM emits something that doesn't match the schema, the response is **dropped** — not retried with wider tolerance. This prevents the LLM from creatively expanding the surface of acceptable outputs.

### Layer 6: Verbatim grounding

Every factual claim the LLM produces must cite the source document by `{document_cid, page, char_span}`. An LLM answer that is not grounded in a specific span of a specific document is rejected — the engine returns `{status: 'insufficient_evidence'}` rather than the LLM's unsupported guess.

### Layer 7: Order randomisation

The same evidence is presented to the LLM in two different orders. If the LLM gives materially different answers, the finding is held for human review.

### Layer 8: Devil's advocate

A separate LLM call constructs the strongest counter-argument. If it's coherent and grounded, the finding is downgraded.

### Layer 9: Counterfactual collapse

For findings that rely on multiple pieces of evidence, the engine re-runs the LLM with one piece of evidence removed. If the posterior barely changes, the LLM was effectively ignoring that evidence — a calibration warning.

### Layer 10: Cluster-dependency guard

If N findings cite the same one document, the dependency is flagged. An adversary who plants one well-crafted forged document shouldn't be able to manufacture N apparently-independent findings.

### Layer 11: Canary detection

Known-false test prompts are injected periodically. The system must surface them as "insufficient evidence." If it doesn't, the audit chain records `canary_triggered` and the architect investigates.

### Layer 12: Lost-in-middle regression

For long-context calls (many pages of evidence), an attention-check question confirms the LLM actually considered evidence from the middle of the context — not just the beginning and end (which LLMs tend to over-weight).

### What an external reviewer sees

Every layer that fires emits a `hold_reason` enum value into the audit chain. An external reviewer can replay the chain and confirm which layer caught which finding. The full list of hold reasons is in [`packages/shared/src/schemas/certainty.ts`](../../packages/shared/src/schemas/certainty.ts):

```
'order_randomisation_disagreement'
'devils_advocate_coherent'
'counterfactual_collapse'
'secondary_review_disagreement'
'sources_below_minimum'
'verbatim_grounding_failed'
'schema_validation_failed'
'canary_triggered'
'cluster_dependency'
'lost_in_middle_regression'
```

---

## 9. Cryptography for non-cryptographers

The platform uses cryptography in five places. Each section below first explains _what problem cryptography is solving_, then how it works.

### 9.1 Tip portal — the sealed envelope

**Problem:** A citizen wants to send a tip but doesn't want the platform's operators to read it before the council has approved decryption.

**Solution:** The citizen's browser **encrypts the tip before sending**. The encryption key is the council's public key. Only the council's private key can decrypt — and that private key is split into 5 pieces (Shamir sharing — see below) so no single council member can decrypt alone.

The encryption uses **libsodium sealed-box** — a well-vetted algorithm combining elliptic-curve key exchange (X25519) with authenticated symmetric encryption (XChaCha20-Poly1305). All in the citizen's browser, before the data leaves their device.

Code: [`apps/dashboard/src/app/tip/page.tsx`](../../apps/dashboard/src/app/tip/page.tsx) lines 109–119.

### 9.2 Shamir secret sharing — the 3-of-5 lock

**Problem:** You want a system where no single person can decrypt tips, but any three trusted council members together can.

**Solution:** **Shamir's secret sharing** is a mathematical technique that splits a secret (in this case, the council's private decryption key) into 5 pieces such that:

- Any **3** of the 5 pieces, combined, reconstruct the secret.
- Any **2** of the 5 pieces reveal nothing — literally nothing, not "partially" — about the secret.

The math is based on polynomial interpolation: a polynomial of degree 2 is uniquely determined by any 3 of its points (3-of-5 means a degree-2 polynomial, since you need at least n points to interpolate a degree-(n−1) polynomial). Below 3 points, infinitely many polynomials fit — information-theoretic security.

The platform's implementation is at [`packages/security/src/shamir.ts`](../../packages/security/src/shamir.ts) — 119 lines, hand-coded, zero dependencies, audited. The math is over the Galois field GF(256) (the same field used in AES).

Each of the 5 pieces is then **encrypted separately with one council member's YubiKey** — so to get a piece out of its sealed envelope, you need that council member's physical YubiKey touched.

### 9.3 YubiKey — the physical key

**Problem:** Passwords can be phished, written down, shared, brute-forced. We want authentication that requires the council member's physical presence.

**Solution:** A **YubiKey** is a small USB device. It holds cryptographic keys inside a tamper-resistant chip. The keys never leave the chip. To use a key, the chip must be physically powered (i.e., plugged in to USB) **and** physically touched (a capacitive sensor on the YubiKey detects a fingertip). No internet attacker can touch a YubiKey from another country.

The platform uses YubiKeys in three modes:

- **FIDO2 / WebAuthn** for login (replaces passwords) — supported by every modern browser
- **PKCS#11 ECDSA** for signing Polygon transactions (the elliptic-curve ECDSA signature operation happens inside the YubiKey)
- **age-plugin-yubikey** for decrypting individual Shamir shares (each share is encrypted such that only one specific YubiKey can decrypt it)

The platform's YubiKey estate plan (HSK-v1) specifies **8 keys** with specific roles: 5 council pillars + architect primary + architect backup + cold reserve. Each is engraved with a serial number and stored in specific physical locations across multiple institutional partners.

### 9.4 Polygon mainnet — the public notary

**Problem:** The platform's audit log is in a Postgres database. The architect technically has the database password. How does an outside reviewer know we haven't gone back and edited old rows?

**Solution:** Every audit row's hash is committed to **Polygon mainnet** — a public, decentralised blockchain. The commitment is a 32-byte hash, written by a smart contract called `VIGILAnchor.sol`. Once committed, the commitment is **immutable** (changing it would require recomputing the entire chain after that point, which is computationally infeasible — Polygon validators globally check this).

A reviewer who suspects tampering: pulls the audit log CSV from VIGIL APEX, recomputes the hash chain, fetches the Polygon anchor for that range, compares. If they match, the chain is intact. If they don't, tampering occurred.

Polygon was chosen over Ethereum mainnet because gas costs are 100× lower; over private chains because public chains can't be silently rolled back by any single actor.

### 9.5 GPG dossier signing — the architect's seal

**Problem:** A CONAC investigator receives a PDF dossier. How do they know it came from VIGIL APEX and hasn't been modified in transit?

**Solution:** The dossier is **GPG-signed** with the architect's signing key. The architect's public key is published; an investigator runs `gpg --verify dossier.pdf.asc dossier.pdf` and gets a clear pass/fail.

The signing key itself lives on a YubiKey — the dossier is signed inside the YubiKey hardware. The architect doesn't have a key file on their laptop that could be stolen.

---

## 10. The 5-pillar council

The council is the platform's governance organ. It exists because:

- The platform must outlast its founder.
- No single person — including the architect — should be able to unilaterally decide what gets escalated to a national institution.
- An external reviewer should see _plural human approval_ before a finding becomes an accusation.

### Who the pillars are

Per SRD §23.2 + EXEC §08.2:

1. **Governance pillar** — typically a former senior public-finance auditor, constitutional-court counsel, or retired ombudsman. Provides institutional weight.
2. **Judicial pillar** — typically a retired magistrate or law professor with anti-corruption case experience. Provides legal credibility.
3. **Civil society pillar** — typically a respected NGO leader or veteran investigative journalist. Provides independence and reputational backing.
4. **Audit pillar** — typically a CPA / chartered accountant with public-sector audit credentials. Provides technical credibility on financial findings.
5. **Technical pillar** — typically a senior security engineer or cryptographer. Provides technical credibility on the platform itself.

Individual identities are published only after the EXEC §13 enrolment ceremony (each pillar signs a binding commitment letter; the architect signs a counterpart; both signatures notarised). Until enrolment, the seats are held open and the public sees the seat status — not individuals — at [`/civil-society/council-composition`](../../apps/dashboard/src/app/civil-society/council-composition/page.tsx).

### What the council votes on

| Vote                                                                                                     | Quorum required                                         | What it does                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Decrypt a citizen tip**                                                                                | 3 of 5 (Shamir share quorum)                            | Each pillar touches their YubiKey, the 3 shares reconstruct the council private key in memory, the tip is decrypted, key is dropped |
| **Escalate a finding to a recipient body**                                                               | 3 of 5 (on-chain vote via `VIGILGovernance.sol`)        | Finding becomes a dossier; dossier is rendered, signed, delivered to CONAC / MINFI / ANIF / Cour des Comptes                        |
| **Unmask entity names in civil-society view**                                                            | 4 of 5 (on-chain vote)                                  | Default is masked; only 4-of-5 majority unmasks for public reading                                                                  |
| **Constitutional change** (e.g., change of cryptographic primitive, change of council quorum thresholds) | 5 of 5                                                  | Unanimous                                                                                                                           |
| **Emergency unseal** (if architect unreachable 14+ days)                                                 | 3 of 5 + safe-paper-share + institutional-partner-share | OPERATIONS.md §10 procedure                                                                                                         |

### How a vote actually happens

1. An operator (or, automatically, a worker that detects a finding crossing the threshold) opens a proposal. The proposal commits its hash on-chain (`VIGILGovernance.sol:commitProposal`) — this is the **commit-reveal** anti-front-running.
2. After a 2-minute reveal delay, the proposer reveals: `openProposal(findingHash, uri, salt)`. The contract verifies that `keccak256(abi.encode(findingHash, uri, salt, proposer)) == commitment`. If yes, the proposal is open. The 14-day vote window starts.
3. Each pillar receives an off-chain notification (email + Slack to operator-only channel). They log in to the council portal, review the dossier draft + the LLM's devil's-advocate counter-argument, and vote.
4. Voting is a Polygon transaction signed by the pillar's YubiKey. The contract enforces:
   - You must be a registered pillar (`MemberRegistry`).
   - You haven't already voted on this proposal (`votedChoice[idx][sender] == 0`).
   - The vote window hasn't expired (`block.timestamp <= window_end`).
5. After each vote, the contract checks if 3 YES is reached. If yes, it emits `ProposalEscalated`. `worker-governance` sees this event, double-checks the threshold (FIND-002 gate from the audit closure), and triggers dossier render + delivery.

### What if a pillar misbehaves?

- **Resignation:** any pillar can resign with 60 days' notice (EXEC §15).
- **Replacement:** by 4-of-5 vote of remaining pillars + architect ratification.
- **Forced removal:** 4-of-5 vote of remaining pillars + 90-day due-process window.
- **5-of-5 collusion failure mode:** explicitly acknowledged in EXEC §22 — the platform does not survive total council capture. Residual defences are the public Polygon ledger (an external observer sees abnormal escalation patterns) + institutional recipient bodies' own due-process review + architect's emergency revocation (EXEC §34.5 sealed envelope).

The platform is designed to survive **4-of-5** with one honest pillar. Not 5-of-5.

---

## 11. The triple-witness audit chain

Every meaningful state transition in the platform — a tip received, a signal fired, a finding created, a posterior updated, a council vote cast, a dossier delivered, an operator login, a forbidden-access attempt — is recorded as an **audit row**. The audit chain is the platform's most important institutional artefact: it is what an external reviewer reads to reconstruct what happened.

### Why three witnesses?

If you only have **one** copy of the audit log (in Postgres), the database administrator can edit old rows. Even if they're caught, the burden of proof is on the accuser.

If you have **two** copies, you have a tie-breaker problem when they disagree.

With **three** copies on three independent infrastructures, an adversary must successfully compromise all three simultaneously without detection — which is, practically, impossible for any single actor.

The three witnesses:

1. **Postgres hash chain** — the source of truth. Each row's hash incorporates the previous row's hash, creating a tamper-evident chain. Replay verifier in [`packages/audit-chain/src/offline-verify.ts`](../../packages/audit-chain/src/offline-verify.ts).
2. **Polygon mainnet anchor** — every hour (and immediately for high-significance events), a Merkle root is committed via `VIGILAnchor.sol`. Once committed, it's globally replicated and immutable.
3. **Hyperledger Fabric chaincode** — every audit row is mirrored to a Fabric peer running the `audit-witness` chaincode. Fabric provides Byzantine-fault-tolerant consensus across multiple organizations, ideal for institutional witness arrangements.

### How the hash chain works

Each row has:

```
seq        : 1, 2, 3, 4, ... (monotonically increasing)
action     : 'tip.received', 'finding.posterior_updated', etc.
actor      : 'public:anonymous', 'user:operator-alice', 'system:worker-pattern'
subject_kind, subject_id, occurred_at, payload
prev_hash  : the body_hash of seq N-1
body_hash  : SHA-256(canonical(this row))
```

The `body_hash` is computed over a **deterministic canonical** representation — sorted keys, NFC Unicode normalisation, pipe-delimited fields. Two database servers that receive the same logical event independently produce identical body hashes.

Insertions use `BEGIN ISOLATION LEVEL SERIALIZABLE` so no two parallel inserts can produce the same seq number ([`packages/audit-chain/src/hash-chain.ts`](../../packages/audit-chain/src/hash-chain.ts) line 69).

The replay verifier walks the chain from seq=1, recomputes every hash, and detects any divergence at the row where it occurs. If the divergence is at row 47, the verifier reports `expected=XYZ, actual=ABC, seq=47` — the operator knows exactly which row was tampered with.

### How the audit-of-audit works

`worker-audit-watch` does two things every 5 minutes:

1. Runs anomaly-detection rules over the user-action log (bulk downloads, off-hours bursts, repeated failed logins).
2. Replays a sliding window of the hash chain through the on-line verifier and emits `audit.hash_chain_verified` to the chain itself.

The watcher's own audit row goes into the same chain — "the watcher is watched."

### What "verifiable by any reviewer" means in practice

An external reviewer takes a CSV dump of `audit.actions`, runs the offline verifier from `packages/audit-chain`, gets a clean pass (or a list of divergences). They then take the Polygon anchor for that seq range and confirm the Merkle root they computed matches the on-chain value. Two independent cryptographic checks. No trust in the platform's claims needed.

---

## 12. Who sees what (authorization)

The platform has six roles (per [`packages/security/src/roles.ts`](../../packages/security/src/roles.ts)):

| Role                         | What they see                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **public** (unauthenticated) | `/`, `/tip`, `/verify`, `/ledger`, `/public/audit`, `/privacy`, `/terms`                                                                    |
| **civil_society**            | All public + `/civil-society/*` (masked audit log, council composition, closed proposals — entity names redacted unless 4-of-5 unmask vote) |
| **auditor**                  | All civil-society views + `/findings`, `/audit/ai-safety`, `/audit/rbac-matrix`                                                             |
| **operator**                 | `/findings`, `/dead-letter`, `/calibration`, `/calibration/reliability`                                                                     |
| **tip_handler**              | `/triage/tips`, `/triage/adapter-repairs`                                                                                                   |
| **council_member**           | `/council/proposals`, `/council/proposals/[id]`                                                                                             |
| **architect**                | Everything (effectively superuser)                                                                                                          |

Authorization is enforced at **three layers**:

### Layer 1: Middleware (request edge)

[`apps/dashboard/src/middleware.ts`](../../apps/dashboard/src/middleware.ts) intercepts every HTTP request before any page renders. It checks:

1. Is the path a public path? If yes, allow.
2. Is there a valid JWT (signed by Keycloak)? If no, redirect to `/auth/login` (or 401 for API routes).
3. Does the path prefix match a rule in `ROUTE_RULES`? If yes, does the user's role intersect with the allowed roles? If no, rewrite to `/403`.

### Layer 2: /403 page audit emission

When a forbidden-access happens, the `/403` page renders. As part of rendering, it emits a `permission.denied` audit event with the actor, the attempted path, the required roles, and the user-agent. This was FIND-001 from the whole-system audit (closed 2026-05-11). The audit chain now records every probe attempt.

### Layer 3: Build-time RBAC coverage check

A script (`scripts/check-rbac-coverage.ts`) runs at every build. It enumerates every page under `apps/dashboard/src/app/` and confirms that the page is either in `PUBLIC_PREFIXES` or matched by a `ROUTE_RULES` entry. If a developer adds a new operator page and forgets to add a rule, the build fails with a clear error naming the unmapped page. This was FIND-004 closure.

### The live RBAC matrix screen

[`apps/dashboard/src/app/audit/rbac-matrix/page.tsx`](../../apps/dashboard/src/app/audit/rbac-matrix/page.tsx) renders the same `ROUTE_RULES` table that the middleware uses. Auditors and architects can inspect the authorization matrix at runtime — there is no separate "documented matrix" that can drift from enforcement. This was FIND-009 closure.

### Navigation visibility

The NavBar in the dashboard reads the `x-vigil-roles` header (set by middleware) and only renders the operator-tier links if the user has at least one operator-class role. An unauthenticated visitor to `/tip` sees only public links — they cannot enumerate the operator routes from the navigation. This was FIND-003 closure.

---

## 13. The tip portal — a citizen's view

The tip portal is the platform's most politically sensitive surface. Its design priority is **the citizen's safety**, not the platform's convenience.

### What the citizen sees

A simple French (default) or English form at [`/tip`](../../apps/dashboard/src/app/tip/page.tsx):

- A text area to describe the suspicion.
- Optional attachment upload.
- A Cloudflare Turnstile anti-bot check.
- Submit button.

That's it. No login. No tracking pixels. No third-party analytics. No "create an account." No name field. No email field. No phone field.

### What happens before the citizen clicks Submit

While the citizen types:

1. The browser fetches the council's public encryption key from `/api/tip/public-key`. This is a libsodium curve25519 public key.
2. When the citizen attaches an image, the browser **re-encodes the image** via `<canvas>` — this strips EXIF metadata including GPS coordinates and device-identifying info.
3. The image is validated against magic-byte signatures (the first few bytes of the file must match the declared MIME type) to reject malicious payloads.

### What happens when the citizen clicks Submit

1. The browser encrypts the body text **using libsodium sealed-box** with the council's public key. The plaintext leaves the browser only as ciphertext.
2. The encrypted blob is POSTed to `/api/tip/submit` along with the Turnstile token.
3. The submit-route reads the citizen's IP **only for the Turnstile check** (not for persistence). It validates the ciphertext is canonical base64 (no embedded payload smuggling). It validates the body size is under the limit. It inserts the encrypted row into Postgres.
4. The Postgres tip schema [`packages/db-postgres/src/schema/tip.ts`](../../packages/db-postgres/src/schema/tip.ts) has **no `client_ip` column**. There is literally no place for an IP address to land.
5. The citizen sees a confirmation reference (`TIP-2026-0142`). They can use this later at `/tip/status` to see whether the tip was triaged or promoted — disposition only, no plaintext.

### What happens after submission

The encrypted tip waits. It cannot be read by anyone — including the architect.

Periodically (typically weekly), the council convenes a **quorum ceremony**:

- Three of five pillars meet (in person or via authenticated video).
- Each touches their YubiKey to decrypt their Shamir share.
- The three shares are combined in memory on the operator's machine.
- The council private key is reconstructed.
- All pending tips are decrypted in memory.
- The key is **dropped** immediately — never written to disk.
- Decrypted tips appear in the operator triage queue.

An operator triages each tip: link it to an existing finding, promote it to a new finding, or dismiss it. Every triage decision is itself an audit event with the operator's signature.

### Caddy's role

The reverse proxy (Caddy) in front of the dashboard performs:

- TLS termination (Let's Encrypt certificates, auto-renewed).
- Rate limiting (5 submissions per minute per IP).
- IP header stripping before the request reaches the application (so the IP literally cannot reach the application database, even if a bug tried to log it).
- Request-ID randomisation (so audit rows don't carry a server-correlatable identifier).

### Tor friendliness

The tip portal works without JavaScript-only flows (Turnstile is the one JS dependency, and it has a fallback for accessibility). A citizen using Tor Browser at default settings can submit a tip. The privacy notice at `/privacy` explicitly recommends Tor Browser for high-risk submissions.

---

## 14. The dossier journey — from finding to CONAC

Once a finding crosses the CONAC threshold and the council escalates, the platform produces a deliverable PDF dossier. Here's what's in it and how it gets to CONAC.

### What the dossier contains

The PDF is bilingual French / English (FR on left page, EN on right page, mirrored). Sections:

1. **Cover** — dossier reference `VA-YYYY-NNNN`, generation date, posterior probability, signal count, council vote tally, GPG signature thumbprint, Polygon anchor transaction hash, IPFS content identifier (CID).
2. **Executive summary** — one paragraph in each language describing the finding.
3. **Entity profile** — canonical entity name, RCCM, NIU, registered address, directors, UBO chain, prior contracts.
4. **Evidence inventory** — each signal that fired, with citations to source documents (IPFS CIDs).
5. **Bayesian breakdown** — the prior, each likelihood ratio, the independence weighting, the posterior.
6. **Counter-evidence** — the strongest argument _against_ the finding (always included, even when the finding escalates).
7. **Recommended action** — typically "open formal investigation" — but always with the institutional caveat that VIGIL APEX is an intelligence pipeline, not a prosecutor.
8. **Audit trail** — chain row IDs and Polygon transaction hashes for every state transition that produced this dossier.
9. **Signing block** — architect's GPG signature, council members' on-chain vote transaction hashes.

### How the PDF is rendered

[`packages/dossier/src/render.ts`](../../packages/dossier/src/render.ts) renders the PDF deterministically from the finding row + signals + counter-evidence + audit trail. **Same inputs always produce the same PDF bytes.** This is critical for verifiability: a CONAC investigator can re-render the dossier from the published inputs and confirm the bytes match.

The renderer uses a fixed font set (architect-curated), a fixed layout grid, and pinned image rendering — no JavaScript-based PDF generation that introduces timestamp-dependent metadata.

### How it gets signed

After rendering, [`apps/worker-dossier`](../../apps/worker-dossier) computes the SHA-256 of the PDF, signs the hash with the architect's GPG key (which lives on the architect's primary YubiKey — the key never leaves the device), and produces a detached signature file (`.asc`).

### How it gets pinned to IPFS

The PDF + signature are pinned to a local Kubo IPFS node (not a public gateway — security boundary). The IPFS CID is recorded in the dossier row.

### How it gets delivered

[`apps/worker-conac-sftp`](../../apps/worker-conac-sftp) reads the dossier row, **triple-checks the CONAC threshold one final time** (FIND-002's third defence layer), fetches the PDF from IPFS, verifies the SHA-256 matches what's recorded, then:

1. Connects to CONAC's SFTP endpoint with the credentials from Vault.
2. Creates a subdirectory `inbox/VA-YYYY-NNNN/`.
3. Uploads the FR PDF, EN PDF, manifest JSON (machine-readable summary).
4. Polls for an acknowledgement file (`VA-YYYY-NNNN.ack`) for up to 7 days.
5. When the ack arrives, records the CONAC case reference in the dossier row.

### How CONAC verifies

A CONAC investigator receives the dossier. They:

1. Verify the GPG signature against the architect's published public key (`gpg --verify`).
2. Note the IPFS CID and the Polygon transaction hash.
3. Visit `/verify/VA-YYYY-NNNN` on the VIGIL APEX public surface. The page shows the same SHA-256, IPFS CID, Polygon transaction hash, and council vote tally.
4. Cross-check the Polygon transaction on polygonscan.com (any blockchain explorer).
5. Independent confirmation: this dossier existed at the published time, the council voted as claimed, the cryptography is intact.

The CONAC investigator then begins their own investigation — VIGIL APEX has no further role in the institutional process.

---

## 15. Operations — how the platform runs day-to-day

### Daily

- 26 ingestion adapters run on their scheduled cadences (some every 6 minutes, some every 4 hours, some daily).
- Workers consume Redis streams in their tight loops.
- Operators review the triage queues during business hours.
- `worker-anchor` commits hourly batches to Polygon.
- `worker-audit-watch` runs anomaly detection every 5 minutes.
- `worker-reconcil-audit` runs three-way reconciliation hourly.
- Sentinel-quorum from Helsinki, Tokyo, NYC probes the dashboard every minute.

### Weekly

- Council quorum ceremony to decrypt pending tips (typically weekly cadence).
- Calibration metrics review by the architect.
- Backup verification.

### Monthly

- Architecture review with the backup architect (one hour).
- Threat-model review per `THREAT-MODEL-CMR.md` cadence.
- Cost review (Polygon gas, LLM API spend, infrastructure).
- Adapter-health review (which sources changed HTML this month).

### Quarterly

- Disaster recovery rehearsal (architect + backup architect).
- YubiKey rotation per `vigil-key-rotation.timer`.
- Council vote on platform-level constitutional matters if any.
- External penetration scan by an independent firm.

### Annually

- External red-team review (target USD 30,000–80,000 engagement at Phase 1 milestone M5).
- ANTIC declaration renewal.
- Council pillar performance review.
- Doctrine review (SRD, EXEC, BUILD-COMPANION versions).

---

## 16. Failure modes — what can go wrong and how it's caught

For every component, the platform anticipates failure. The full catalogue is in [`docs/audit/04-failure-modes.md`](../audit/04-failure-modes.md); here's a beginner-friendly summary of the big classes.

### External dependency failures

- **Postgres goes down** — workers stop, the dashboard returns a degraded state (not a 500 error), `vigil-postgres` healthcheck fires, alertmanager pages the operator. Docker restart policy brings Postgres back; workers reconnect.
- **A source website goes down** — that one adapter fires `SourceUnavailableError` for that URL, the dead-letter queue accumulates, the operator sees it at `/dead-letter`. Other adapters continue.
- **A source changes its HTML** — adapter starts emitting zero events. `worker-adapter-repair` detects, proposes a new selector via LLM, shadow-tests for 48 windows, auto-promotes for informational adapters or holds for architect sign-off on critical adapters.
- **Polygon RPC hiccups** — `worker-anchor` retries with fallback RPC URLs (configurable list), backs off exponentially, accumulates a backlog until RPC returns. No data loss.
- **Fabric peer down** — `worker-fabric-bridge` dead-letters, `worker-reconcil-audit` notices the gap on its hourly tick and re-queues when Fabric returns.
- **LLM provider down** — failover from Anthropic API to Bedrock; if both are down, LLM-dependent workers pause; deterministic workers continue.
- **Vault sealed** — platform refuses to start. No fallback to hardcoded secrets. Operator runs the unseal ceremony.

### Internal failures

- **A worker crashes** — Docker restart policy `unless-stopped` brings it back. The Redis consumer group ensures in-flight messages are re-delivered.
- **A migration fails partway** — runner detects the half-applied state, refuses to start the application, requires operator intervention. No silent half-state.
- **The hash chain diverges** — `worker-audit-watch` detects on its 5-minute tick, emits `audit.hash_chain_break` to the chain, halts the verify cursor on the divergent window, pages the architect. Non-recoverable; requires investigation.
- **The 3-of-5 quorum fails to assemble** — ceremony aborts cleanly, no partial decryption, audit row `council.quorum.failed`. Tip remains encrypted, ceremony retried later.

### Adversarial scenarios

- **An operator tries to forge a finding** — they don't have the council's keys; they can't escalate alone.
- **An operator tries to delete an old audit row** — Postgres permits the deletion locally, but the Polygon anchor for that row's seq range has already been committed; the reconciliation worker detects within an hour and surfaces a fatal alert.
- **An attacker compromises the Postgres database directly** — same outcome; Polygon anchors are immutable.
- **An attacker DDoSes the tip portal** — Caddy rate limit (5/min/IP) absorbs most; Cloudflare in front if needed.
- **A council member is bribed** — they can vote YES alone; nothing happens until 3-of-5 vote YES. Bribing 3 of 5 council members across 3 institutional categories (judicial, civil society, audit) is much harder than bribing one.
- **A state actor compels the architect to disclose tip content** — architect doesn't have the council's keys; can disclose only Vault root + operational state, not citizen tips.

---

## 17. Verifiability — how anyone can independently check

The platform is designed so that a sufficiently determined external reviewer can verify _every claim_ without ever trusting the platform itself.

### Verify a dossier

Anyone in the world with the dossier reference `VA-YYYY-NNNN`:

1. Visit `/verify/VA-YYYY-NNNN` on the platform.
2. Note the SHA-256, IPFS CID, Polygon transaction hash, council vote tally.
3. Download the PDF from any IPFS gateway by CID. Compute SHA-256 locally. Compare.
4. Visit polygonscan.com, look up the transaction hash. Confirm it's a call to `VIGILAnchor.sol` with the published commitment.
5. Decode the contract call's `rootHash` parameter; confirm it matches the published Merkle root.

Three independent cryptographic confirmations.

### Verify the entire chain

For an institutional reviewer who wants to verify nothing was tampered with:

1. Request a CSV export of `audit.actions`.
2. Run the offline verifier: `pnpm --filter @vigil/audit-chain run verify-offline audit-actions.csv`.
3. The verifier walks the chain, recomputes every hash, reports any divergence at the seq where it occurs.
4. Cross-check the Polygon anchors for each seq range.
5. Cross-check the Fabric chaincode for each seq individually.

### Verify the source code

The full repository is hosted on Forgejo (Hetzner-self-hosted, Germany) with read-only mirrors on GitHub. An institutional reviewer signs an NDA, gets repository access, runs:

- `pnpm install && pnpm -r test` — confirm 1,632+ unit tests pass.
- `pnpm --filter dashboard build` — confirm RBAC coverage check passes.
- `gitleaks detect --source . --log-opts='--all'` — confirm zero secrets in git history.
- Read the audit catalogue: [`docs/audit/whole-system-audit.md`](../audit/whole-system-audit.md). Every claim cites a file:line.

### Verify the doctrine

The full doctrine pack is in [`docs/source/`](../source/). Every architectural decision is in [`docs/decisions/log.md`](../decisions/log.md). The threat model is in [`THREAT-MODEL-CMR.md`](../../THREAT-MODEL-CMR.md). All readable. All citable.

---

## 18. Limits — what this can't do

Honest stated limitations (per SRD §21):

- **Cannot detect cash transactions** — we see only what wires + procurement records reveal.
- **Cannot read sealed court records.**
- **Cannot detect sophisticated multi-jurisdiction tax structuring** that uses paths through non-FATF-listed jurisdictions.
- **Cannot detect real-estate flips** where the equity flow is offshore-unregistered.
- **Cannot detect personal bribery** without an associated state contract or licence.
- **Cannot fully protect a high-risk tipster** on state-monitored infrastructure. Client-side controls protect against server-side adversaries; they cannot protect against a state that controls the citizen's ISP, device, and physical environment simultaneously. The platform's privacy notice is explicit about this.
- **Cannot survive 5-of-5 council collusion.** Designed to survive 4-of-5 with one honest pillar.
- **Cannot operate without ≥ 30 labelled ground-truth cases** in the calibration seed. Before that minimum, the certainty engine refuses to ship findings to CONAC.
- **Cannot generalise to another country** without re-calibrating priors, re-writing 5 of the 43 patterns, re-writing the 26 ingestion adapters, and re-authoring the threat model. The framework is general; the deployment is Cameroon-specific.

These limits are stated explicitly so an external reviewer never confuses ambition with delivered capability. The platform is one signal source in a national anti-corruption ecosystem; CONAC, MINFI, ANIF, the Cour des Comptes — and human investigators with human-source signals — remain the institutional decision-makers.

---

## 19. Glossary

| Term                      | Definition                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------- |
| **Adversarial pipeline**  | The four cross-checks (order randomisation, devil's advocate, counterfactual collapse, secondary review) the Bayesian engine runs before accepting a posterior |
| **AEAD**                  | Authenticated Encryption with Associated Data — encryption that also detects tampering (XChaCha20-Poly1305 is an AEAD)                                         |
| **AOI**                   | Area of Interest — a geographic bounding box used to fetch the relevant satellite tile                                                                         |
| **Anchor (Polygon)**      | A commitment on Polygon mainnet of an audit-chain Merkle root, providing immutable third-party witness                                                         |
| **Audit row**             | One row in the global hash chain — records exactly one state transition                                                                                        |
| **Bayesian engine**       | The certainty engine that combines signals through likelihood ratios into a posterior probability of fraud                                                     |
| **Body hash**             | SHA-256 of the canonical-serialised audit row body                                                                                                             |
| **Calibration seed**      | Architect-private set of labelled ground-truth cases used to compute likelihood ratios and ECE                                                                 |
| **Canary**                | A known-false test input deliberately injected to verify the safety stack catches it                                                                           |
| **CONAC**                 | Commission Nationale Anti-Corruption — Cameroon's primary anti-corruption institution                                                                          |
| **Council**               | 5-pillar governance body — governance, judicial, civil society, audit, technical                                                                               |
| **Dead-letter**           | Redis stream where envelopes go after a worker has exhausted retries                                                                                           |
| **Devil's advocate**      | LLM call that constructs the strongest counter-argument against a candidate finding                                                                            |
| **Dossier**               | The bilingual PDF artefact delivered to an institutional recipient                                                                                             |
| **ECDSA**                 | Elliptic-Curve Digital Signature Algorithm — used for Polygon transaction signing                                                                              |
| **ECE**                   | Expected Calibration Error — metric of how well predicted probabilities match observed frequencies                                                             |
| **EIP-1559**              | Ethereum transaction format (Polygon adopted it) with priority fee + max fee fields                                                                            |
| **EXEC**                  | One of the binding doctrine documents — institutional gating procedures                                                                                        |
| **Fabric**                | Hyperledger Fabric — a permissioned blockchain used as the third audit witness                                                                                 |
| **FATF**                  | Financial Action Task Force — international AML standard-setter; "FATF grey list" of jurisdictions with deficient regimes                                      |
| **FIDO2**                 | The successor to U2F — passwordless authentication via hardware key + browser API                                                                              |
| **Finding**               | A candidate fraud case with a posterior probability and supporting signals                                                                                     |
| **FROST**                 | A threshold-signature scheme referenced in the audit spec; not actually implemented — see DECISION-018                                                         |
| **GPG**                   | GNU Privacy Guard — implementation of OpenPGP used for dossier signing                                                                                         |
| **GF(256)**               | Galois Field of 256 elements — the finite field used in Shamir secret sharing and AES                                                                          |
| **Halt-on-failure**       | Doctrine that an audited operation must refuse to proceed if the audit emit fails (no "dark periods")                                                          |
| **HSK**                   | Hardware Security Key — one of the binding doctrine documents (the YubiKey estate manual)                                                                      |
| **IPFS**                  | InterPlanetary File System — content-addressed storage for dossier PDFs                                                                                        |
| **JWT**                   | JSON Web Token — the authenticated session credential issued by Keycloak                                                                                       |
| **Keccak256**             | The Ethereum-flavour SHA-3 hash function used in Polygon transaction signing                                                                                   |
| **Keycloak**              | The open-source identity provider used for authentication                                                                                                      |
| **libsodium**             | Industry-standard cryptography library used for sealed-box (tip encryption) and AEAD                                                                           |
| **Likelihood ratio (LR)** | How much a piece of evidence updates the probability of fraud relative to its baseline                                                                         |
| **Merkle root**           | A single hash that summarises a tree of hashes — used to anchor a batch of audit rows in one Polygon commitment                                                |
| **MINFI**                 | Ministère des Finances — Cameroon's Ministry of Finance                                                                                                        |
| **MOU**                   | Memorandum of Understanding — required for some Phase-2 ingestion adapters (MINFI BIS, BEAC, ANIF)                                                             |
| **Multi-sig**             | Multiple-signature scheme — N signers required; used by `VIGILGovernance.sol` for 3-of-5 quorum                                                                |
| **NICFI**                 | Norway's International Climate & Forest Initiative — provides free Planet satellite imagery                                                                    |
| **NIU**                   | Numéro d'Identification Unique — Cameroon's tax identification number                                                                                          |
| **OFAC**                  | Office of Foreign Assets Control — US Treasury sanctions authority                                                                                             |
| **PIV**                   | Personal Identity Verification — a YubiKey applet for ECDSA signing                                                                                            |
| **PKCS#11**               | Cryptographic token API standard — how the YubiKey's signing operations are invoked                                                                            |
| **Polygon**               | Layer-2 Ethereum-compatible blockchain — chosen for low gas costs                                                                                              |
| **Posterior**             | Probability of fraud after considering all evidence — `P(F                                                                                                     | E1..En)` |
| **Prior**                 | Baseline probability of fraud before any evidence — `P(F)`                                                                                                     |
| **Quorum**                | Minimum number of council members required for a decision — 3, 4, or 5 of 5 depending on the decision                                                          |
| **RBAC**                  | Role-Based Access Control — the authorization model                                                                                                            |
| **RCCM**                  | Registre du Commerce et du Crédit Mobilier — Cameroon's commercial registry                                                                                    |
| **Redis stream**          | The queue mechanism the workers consume; one stream per worker type                                                                                            |
| **Reveal delay**          | The 2-minute wait between committing a proposal and revealing its content — anti-front-running                                                                 |
| **Row hash**              | `SHA-256(prev_row_hash                                                                                                                                         |          | body_hash)` — chains audit rows together |
| **SafeLlmRouter**         | The single chokepoint through which all LLM calls route, applying the 12-layer safety stack                                                                    |
| **Sealed-box**            | libsodium primitive — encrypts to a recipient's public key with no sender identity                                                                             |
| **SERIALIZABLE**          | The strongest Postgres transaction isolation level — prevents race conditions on chain seq allocation                                                          |
| **Shamir**                | Adi Shamir's secret-sharing scheme — split a secret into N pieces where any K of them reconstruct it                                                           |
| **Signal**                | One row produced by a pattern firing — structured evidence that feeds the Bayesian engine                                                                      |
| **SRD**                   | Specification Reference Document — binding architectural specification                                                                                         |
| **TAL-PA**                | Total Action Logging with Public Anchoring — DECISION-012 doctrine: every action is logged and the log is itself anchored to Polygon                           |
| **Tier (action queue)**   | Posterior ≥ 0.95 + ≥ 5 sources — CONAC-eligible. Below that, investigation queue or log-only.                                                                  |
| **UBO**                   | Ultimate Beneficial Owner — the real human behind a corporate chain                                                                                            |
| **Vault**                 | HashiCorp Vault — the secret store, unsealed via 3-of-5 Shamir                                                                                                 |
| **WebAuthn**              | The browser API for FIDO2 — what makes YubiKey login work                                                                                                      |
| **Worker**                | A long-running background service that consumes a Redis stream and does one specific job                                                                       |
| **YubiKey**               | A small USB hardware key that stores cryptographic keys in a tamper-resistant chip                                                                             |
| **Zod**                   | A TypeScript runtime schema validator — used to validate LLM outputs                                                                                           |

---

**Document version:** 1.0, 2026-05-11.
**Author:** the build agent (Claude) per architect direction.
**Status:** PROVISIONAL — promote to FINAL after architect read-through.
**Next review:** when the platform crosses Phase-1 milestone M3 (council enrolment complete) or when doctrine drifts.
