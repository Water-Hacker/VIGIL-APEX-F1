# VIGIL APEX — UNDP Technical Reviewer Q&A

**Audience:** UNDP technical staff conducting due-diligence review of VIGIL APEX as a candidate Cameroonian anti-corruption forensic pipeline. Same content is usable for AfDB risk officers, World Bank governance leads, IMF AML/CFT staff, EU Delegation governance unit, GIZ governance programme, OAPI compliance reviewers, ARMP audit team, CONAC technical liaison, and ANIF AML supervisory.

**Posture:** Every answer below cites the file path or commit/decision-log entry that proves the claim. Anything I cannot evidence with a citation, I will mark as **aspirational / pre-provisioned** so a reviewer never confuses doctrine with shipped code. If you read an answer here that contradicts what `git log` or the actual code says, the code wins — flag the drift and we close it.

**Doctrine reference pack** (sent alongside this Q&A):

- [`docs/source/SRD-v3.md`](../source/SRD-v3.md) — binding specification
- [`docs/source/EXEC-v1.md`](../source/EXEC-v1.md) — institutional gates
- [`docs/source/BUILD-COMPANION-v1.md`](../source/BUILD-COMPANION-v1.md) + [`v2`](../source/BUILD-COMPANION-v2.md) — implementation reference
- [`docs/source/HSK-v1.md`](../source/HSK-v1.md) — YubiKey estate manual
- [`docs/source/AI-SAFETY-DOCTRINE-v1.md`](../source/AI-SAFETY-DOCTRINE-v1.md) — DECISION-011
- [`docs/source/TAL-PA-DOCTRINE-v1.md`](../source/TAL-PA-DOCTRINE-v1.md) — DECISION-012
- [`docs/decisions/log.md`](../decisions/log.md) — 19 architectural decisions
- [`TRUTH.md`](../../TRUTH.md) — single source of truth across drift
- [`THREAT-MODEL-CMR.md`](../../THREAT-MODEL-CMR.md) — Cameroon-specific threat model

---

## A. Mandate, scope, and what this actually is

### A1. In one sentence — what is VIGIL APEX?

A sovereign anti-corruption forensic pipeline for the Republic of Cameroon that ingests public-domain data, runs deterministic fraud-pattern detection against a Bayesian certainty engine, requires 5-pillar council quorum to escalate, and delivers cryptographically signed dossiers to CONAC, MINFI, ANIF, or Cour des Comptes with replay-verifiable audit chains anchored on Polygon mainnet and Hyperledger Fabric.

### A2. Who built it and who owns it?

- **Architect:** Junior Thuram Nana (solo build, Phase 0 through Phase 1 in [`docs/decisions/log.md`](../decisions/log.md)).
- **Backup architect:** Onboarded per OPERATIONS.md §9 with paid retainer (~€400/month, signed before M0c), Shamir share of Vault root, Shamir share of Polygon signing key, and read access to the Forgejo repository.
- **Governance owner:** 5-pillar council (governance, judicial, civil society, audit, technical) per SRD §23.2 + EXEC §08.2. Council members hold the 3-of-5 Shamir threshold required to decrypt citizen tips and to escalate findings to recipient bodies.
- **Legal entity:** SAS (French/Cameroonian commercial structure) with the architect as managing director; see EXEC §34.5 envelope for emergency-access succession.

### A3. What is the strategic mandate this platform exists to serve?

Cameroon scored 26/100 on the 2023 Transparency International CPI (rank 140/180). Public-procurement losses are estimated by the World Bank's 2022 Public Expenditure Review at 10–15% of state procurement spend. The platform exists to (a) compile public-domain evidence into actionable findings, (b) deliver those findings to institutions empowered to act (CONAC, MINFI, ANIF, Cour des Comptes), and (c) make every claim independently verifiable so an external observer can confirm the finding without trusting VIGIL APEX itself.

### A4. Why not just hand this work to CONAC directly?

CONAC's mandate is investigation and prosecution; it does not have the engineering capacity to ingest 26 data sources, run Bayesian certainty calibration against a labelled-incident corpus, maintain a 5-pillar governance ceremony, and operate a triple-witness audit chain. VIGIL APEX is the **intelligence pipeline** that feeds CONAC; CONAC remains the **institutional decision-maker**. The platform's CONAC integration is one-way: dossier → SFTP inbox → CONAC ack. We never receive CONAC investigation outcomes back into the platform.

### A5. Is this a startup, an NGO, or a state vendor?

Legally a Cameroonian/French SAS. Operationally a sovereign-tech project — closer in posture to Estonia's e-Residency platform, the EU's eIDAS verification infrastructure, or ID.me's authentication stack than to a SaaS product company. Funding model in §M below.

---

## B. Sovereignty and jurisdiction

### B1. Where does the data live, physically?

- **Primary production stack:** Hetzner dedicated host in Helsinki / Falkenstein (architect-tunable; not on AWS, GCP, Azure, or any US-jurisdiction cloud — this is intentional per [`THREAT-MODEL-CMR.md`](../../THREAT-MODEL-CMR.md) §3 and SRD §F).
- **Audit chain (Postgres):** primary host. **Witnesses:** Polygon mainnet (public, immutable). Hyperledger Fabric peer (planned: Cameroonian institutional host once a credible institutional peer is identified — until then runs on the primary host).
- **Tip portal entry path:** Caddy on Hetzner, IP-stripping happens at the edge before the application database sees the request (verified at `infra/docker/caddy/Caddyfile:166–173`).
- **Mirrors:** GitHub mirror at `Water-Hacker/VIGIL-APEX-CMR` and `Water-Hacker/VIGIL-APEX-F1` (read-only convenience for the architect; not authoritative; primary is the self-hosted Forgejo on Hetzner).

### B2. What jurisdiction does the platform operate under?

- **Data processing:** Cameroon Law No. 2010/012 of 21 December 2010 on Cybersecurity & Cybercrime (the 2010 Cybersecurity Law); Articles 30–35 govern audit-log retention.
- **Privacy:** ANTIC declaration filed at the URL in `NEXT_PUBLIC_ANTIC_DECLARATION_URL`; declaration text in [`docs/institutional/antic-declaration.md`](antic-declaration.md).
- **Tip-portal anonymity:** Same legal framework; tip retention is triple-locked (DB triggers + append-only history table + repo refusing direct DELETE) per DECISION-016.
- **Hosting jurisdiction (Germany via Hetzner):** GDPR applies to incidental EU traffic; the system's design (libsodium client-side encryption, no IP persistence, no tracking) is GDPR-compliant by construction.
- **Cross-border delivery to CONAC:** SFTP from Hetzner to a CONAC-controlled endpoint; CONAC's receipt is governed by Cameroonian internal procedures, not by VIGIL APEX.

### B3. Can the Cameroonian state compel disclosure of source code or running data?

- **Source code:** The Forgejo primary is in Germany. Cameroon would need a Hetzner-side legal request through German channels, which is the deliberate design choice per OPERATIONS.md §1.
- **Tip plaintext:** Cannot be disclosed even by the architect alone. Decryption requires 3-of-5 Shamir share holders — the 5-pillar council. A single state-actor compelling the architect alone yields zero plaintext.
- **Architect-only emergency:** Per EXEC §34.5 envelope + OPERATIONS.md §10, if the architect is unreachable for 14 days, the backup architect + safe-paper-share + institutional-partner-share = 3 of 5. No single party (state, employer, or platform operator) can decrypt unilaterally.

### B4. Can the architect see citizen tip content?

No. Tips are sealed-box encrypted client-side with the council group public key (libsodium `crypto_box_seal` in [`apps/dashboard/src/app/tip/page.tsx:109–119`](../../apps/dashboard/src/app/tip/page.tsx)). The architect holds zero Shamir shares for the council's decryption key. The architect's Shamir share is for the Vault root (operational secrets), not for tip content.

---

## C. Architecture and topology

### C1. Stack at a glance?

- **Language:** TypeScript (Next.js 14 dashboard + 20 workers + 30 shared packages), Solidity (Polygon contracts), Python 3.11 (YubiKey signer host service), Rust (PKCS#11 ECDSA helper, added 2026-05-11 per FIND-007 closure).
- **Databases:** PostgreSQL 16 (audit chain + business state), Neo4j 5 (entity graph + Louvain communities), Redis 7 (streams for worker pipeline, NOT for audit emission).
- **Secrets:** HashiCorp Vault with 3-of-5 Shamir unseal. Per-secret rotation via `vigil-key-rotation.timer` (systemd).
- **Identity:** Keycloak realm `vigil` with FIDO2/WebAuthn-only authentication (no passwords); per HSK-v1.
- **Smart contracts:** `VIGILAnchor.sol` (audit-chain root commits) + `VIGILGovernance.sol` (5-pillar voting). Both on Polygon mainnet. Deployed bytecode hash pinned in `docs/decisions/log.md` DECISION-013.
- **Object store:** IPFS (local Kubo node, NOT a public gateway) for dossier PDFs and tip attachments.
- **Reverse proxy:** Caddy 2.x with explicit `request_id` randomisation, IP stripping at the application boundary, rate-limit 5 req/min/IP on tip submission.
- **Federation (Phase 3):** Regional VPS → core via signed-envelope gRPC, per regional CA chain rooted at Vault PKI.

### C2. How many independent services are there?

Twenty workers + five non-worker apps + four databases + a Vault + a Keycloak + a Caddy + an IPFS node + a Polygon RPC client + a Fabric peer = roughly 35 containers in production, all on the `vigil-internal` network (172.20.0.0/24) per [`infra/docker/docker-compose.yaml`](../../infra/docker/docker-compose.yaml).

### C3. Why so many workers?

Each worker has **one job**. A worker that does two things has two failure modes that mask each other. Dead-letter queue surfaces "where did processing stop?" with one-step precision. When a Fabric peer goes down, only `worker-fabric-bridge` retries; the rest of the pipeline keeps going. See `apps/worker-*` directories for the full list — every worker name maps to exactly one Redis stream consumer in [`packages/queue/src/streams.ts`](../../packages/queue/src/streams.ts).

### C4. Is it cloud-native, on-prem, or hybrid?

Self-hosted on Hetzner dedicated hardware. Sovereign-tech design: no managed cloud, no auto-scaling, no horizontally-sharded database. A single tall machine (24+ cores, 128+ GB RAM, NVMe) runs the full stack. Federation to additional regions happens via Phase-3 federation workers, not via cloud auto-scaling.

---

## D. Data ingestion — sources, adapters, governance

### D1. What data sources does the platform consume?

Twenty-six adapters in [`apps/adapter-runner/src/adapters/`](../../apps/adapter-runner/src/adapters/). Public-domain only:

- **Procurement & state finance:** MINFI Public Procurement Portal, BIP (Public Investment Budget), Cour des Comptes annual reports, DGI tax-compliance attestations, MINFI BIS (Budget Information System, Phase-2-gated behind signed MOU per AUDIT-001), BEAC payment-system bridge (Phase-2 MOU per AUDIT-002), ANIF AML/PEP screening (Phase-2 MOU per AUDIT-003).
- **Sanctions feeds:** OFAC SDN, EU Consolidated, UN Security Council, World Bank Group debarred firms, OpenSanctions, AfDB sanctions.
- **Corporate registry:** OpenCorporates Cameroon slice, OAPI (West/Central Africa IP office), CRESCYC (Cameroon registry).
- **Satellite imagery:** Planet NICFI tiles for AOI-flagged sites (illegal logging, ghost construction).
- **Media:** Curated Cameroon press feeds (Cameroon Tribune, Mutations, Investir au Cameroun) for cross-corroboration.
- **Court records:** Public TPI / Cour Suprême judgement extracts.
- **Tip portal:** Anonymous citizen submissions via [`apps/dashboard/src/app/tip/`](../../apps/dashboard/src/app/tip/) — encrypted client-side, never decrypted without 3-of-5 council quorum.

### D2. Is web scraping legal?

The platform restricts itself to (a) publicly accessible URLs without authentication walls, (b) endpoints that have not declared a `robots.txt`-style exclusion against generic crawlers, and (c) data that is published as part of statutory transparency obligations (procurement disclosures, sanctions lists, public registry). The legal basis is the 2010 Cybersecurity Law Article 4 (public-data processing). Each adapter is gated by an explicit signed MOU only where the source explicitly requires it (MINFI BIS, BEAC, ANIF — see AUDIT-001/002/003 in [`AUDIT.md`](../../AUDIT.md)).

### D3. What stops the platform from hammering a source's website?

- Per-adapter `defaultRateIntervalMs` (every adapter declares one; default 1–5 s between requests).
- Rotating proxy pool per adapter (defence against single-IP blocking; deliberate, transparent — not anonymisation).
- HTTP body cap of 50 MB and headers timeout of 30 s per request (`packages/observability/src/bounded-fetch.ts`), so a hostile or stuck endpoint cannot exhaust adapter heap.
- Daily scrape schedule with off-peak windowing where the source publishes regular reports.

### D4. What happens when a source changes its HTML?

[`apps/worker-adapter-repair`](../../apps/worker-adapter-repair) detects selector drift, runs an LLM through the SafeLlmRouter chokepoint to propose new selectors, then runs **48 windows of shadow testing** comparing old vs new output before auto-promoting. Critical adapters (sanctions, procurement) require architect sign-off before promotion regardless of shadow-test result. The LLM never directly edits the codebase.

---

## E. The 43 fraud patterns (full inventory)

All 43 patterns live in [`packages/patterns/src/category-{a..h}/`](../../packages/patterns/src/) with bilingual French + English titles and descriptions. Each pattern is a pure `detect(subject, context) → { fires, evidence, citations }` function tested with golden-fixture cases in [`packages/patterns/test/category-{a..h}/`](../../packages/patterns/test/). 552 unit tests pin every pattern's invariants. A pattern that fires produces a `Signal` with structured evidence; signals aggregate through the Bayesian certainty engine ([`packages/certainty-engine`](../../packages/certainty-engine)) to a posterior probability.

### Category A — Procurement competition (9 patterns)

| ID          | EN title             | FR title                                | Trigger (summary)                                                          |
| ----------- | -------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| **P-A-001** | Single-bidder award  | Marché à soumissionnaire unique         | Exactly one bidder + material threshold or no-bid extension                |
| **P-A-002** | Split tender         | Marché fractionné                       | Multiple awards to same supplier, each just below threshold, within window |
| **P-A-003** | No-bid emergency     | Urgence sans appel d'offres             | Emergency-procedure invocation without documented qualifying event         |
| **P-A-004** | Late amendment       | Avenant tardif                          | Contract amendment after award altering material terms (price, scope)      |
| **P-A-005** | Sole-source gap      | Justification de gré à gré insuffisante | Sole-source award without mandatory justification on file                  |
| **P-A-006** | Uneven bid spread    | Écart anormal entre offres              | Winning bid ≤ runner-up × 0.6 OR ≥ runner-up × 1.4                         |
| **P-A-007** | Narrow specification | Cahier des charges restrictif           | Technical spec matches only one known supplier's catalogue                 |
| **P-A-008** | Bid-protest pattern  | Recours répétés                         | Same supplier protests every losing bid against the same competitor        |
| **P-A-009** | Debarment bypass     | Contournement de débarrement            | Awarded entity is a renamed / DBA-flagged successor of a debarred firm     |

### Category B — Corporate-veil / UBO (7 patterns)

| ID          | EN title                | FR title                                 | Trigger (summary)                                                          |
| ----------- | ----------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| **P-B-001** | Shell company           | Société écran                            | Awardee has zero employees, no operating address, no prior contracts       |
| **P-B-002** | Nominee director        | Administrateur prête-nom                 | Director appears on ≥ 5 unrelated boards with no domain expertise          |
| **P-B-003** | Jurisdiction shopping   | Forum non conveniens                     | UBO chain crosses ≥ 3 jurisdictions, ending in an FATF grey-listed country |
| **P-B-004** | Rapid incorporation     | Création récente avant attribution       | Awardee incorporated < 90 days before contract                             |
| **P-B-005** | Co-incorporated cluster | Grappe co-incorporée                     | ≥ 3 bidders share incorporation date / registry filer / address            |
| **P-B-006** | UBO mismatch            | Divergence sur le bénéficiaire effectif  | Declared UBO ≠ UBO inferred from registry / OpenCorporates                 |
| **P-B-007** | PEP link                | Lien avec personne politiquement exposée | Director / UBO matches a PEP in the OpenSanctions / ANIF PEP list          |

### Category C — Price / finance (6 patterns)

| ID          | EN title                | FR title                              | Trigger (summary)                                                          |
| ----------- | ----------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| **P-C-001** | Price above benchmark   | Prix supérieur au marché de référence | Awarded unit price > regional benchmark × 1.5                              |
| **P-C-002** | Unit-price anomaly      | Anomalie de prix unitaire             | Same SKU sold at materially different prices across simultaneous contracts |
| **P-C-003** | Quantity mismatch       | Quantités incohérentes                | Delivery/inspection quantity ≠ contract quantity                           |
| **P-C-004** | Inflation divergence    | Écart par rapport à l'inflation       | Contract escalator clause exceeds 2× CPI for the period                    |
| **P-C-005** | Currency arbitrage      | Arbitrage de devises                  | XAF / EUR / USD conversion not at BEAC reference rate on signature date    |
| **P-C-006** | Escalation-clause abuse | Abus de clause d'indexation           | Escalator triggered without published index supporting it                  |

### Category D — Delivery / site (5 patterns)

| ID          | EN title                | FR title                   | Trigger (summary)                                                          |
| ----------- | ----------------------- | -------------------------- | -------------------------------------------------------------------------- |
| **P-D-001** | Ghost project           | Projet fantôme             | NICFI satellite tile shows no construction at declared site/date           |
| **P-D-002** | Incomplete construction | Construction inachevée     | Final-payment release without inspection certificate or with deficient one |
| **P-D-003** | Site mismatch           | Site déclaré ≠ site réel   | Geo coordinates in contract documents diverge from build evidence          |
| **P-D-004** | Quality deficit         | Carence qualité            | Sample inspection report flags ≥ 30% below spec                            |
| **P-D-005** | Progress fabrication    | Falsification d'avancement | Progress report inconsistent with prior reports + on-site evidence         |

### Category E — Sanctions (4 patterns)

| ID          | EN title                        | FR title                              | Trigger (summary)                                                                  |
| ----------- | ------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| **P-E-001** | Sanctioned-direct               | Entité sanctionnée (directe)          | Counterparty matches OFAC SDN / EU / UN / World Bank / ANIF                        |
| **P-E-002** | Sanctioned-related              | Lien avec entité sanctionnée          | Director / UBO / address / phone matches sanctioned entity within graph distance 2 |
| **P-E-003** | Sanctioned-jurisdiction payment | Paiement vers juridiction sanctionnée | Wire ordered to FATF grey-list / OFAC sectorally-sanctioned bank                   |
| **P-E-004** | Transaction with PEP+sanctioned | Transaction PEP + sanctionnée         | Same transaction touches both a PEP and a sanctioned counterparty                  |

### Category F — Network / structure (5 patterns)

| ID          | EN title               | FR title                         | Trigger (summary)                                                                                   |
| ----------- | ---------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| **P-F-001** | Round-trip payment     | Paiement en boucle               | XAF leaves entity A → B → C → back to A within window                                               |
| **P-F-002** | Director ring          | Anneau de dirigeants             | Directors of A, B, C share ≥ 3 board overlaps with no commercial justification                      |
| **P-F-003** | Supplier circular flow | Flux fournisseur circulaire      | Same supplier shows up as subcontractor under 3 different prime contractors winning state contracts |
| **P-F-004** | Hub-and-spoke          | Modèle hub-and-spoke             | Single hub entity routes ≥ 60% of payments across 5+ spoke entities                                 |
| **P-F-005** | Dense bidder network   | Réseau dense de soumissionnaires | Louvain community detection finds bidders with co-occurrence density > 0.7                          |

### Category G — Document forensics (4 patterns)

| ID          | EN title           | FR title                 | Trigger (summary)                                                                |
| ----------- | ------------------ | ------------------------ | -------------------------------------------------------------------------------- |
| **P-G-001** | Backdated document | Document antidaté        | Document PDF creation timestamp postdates declared signature date                |
| **P-G-002** | Signature mismatch | Discordance de signature | Visual signature on document ≠ reference signature in registry                   |
| **P-G-003** | Metadata anomaly   | Anomalie de métadonnées  | EXIF / PDF metadata reveals author / software that contradicts declared signer   |
| **P-G-004** | Font anomaly       | Anomalie de police       | Document mixes fonts inconsistent with the issuing institution's known templates |

### Category H — Time / sequence (3 patterns)

| ID          | EN title                  | FR title                          | Trigger (summary)                                                                |
| ----------- | ------------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| **P-H-001** | Award before tender close | Attribution avant clôture         | Award decision dated before tender closing date                                  |
| **P-H-002** | Amendment out of sequence | Avenant hors séquence             | Amendment N dated before amendment N-1 in the contract amendment log             |
| **P-H-003** | Holiday publication burst | Publication groupée en jour férié | Multiple high-value awards published on a public holiday (low-visibility window) |

### E1. How does a pattern firing become a delivered finding?

1. A pattern's `detect()` returns `fires = true` → `Signal` row written to Postgres (atomic with the audit-chain row).
2. Signals aggregate through the Bayesian certainty engine ([`packages/certainty-engine/src/bayesian.ts`](../../packages/certainty-engine/src/bayesian.ts)) — prior + per-signal likelihood ratio + pairwise-independence weighting → posterior `P(F | E1..En)`.
3. The certainty engine runs the **adversarial pipeline** (devil's advocate, counterfactual collapse, order-randomisation cross-check, secondary review) before the posterior is accepted (DECISION-011).
4. If posterior ≥ 0.80 — surfaces on operator triage at `/findings`.
5. If posterior ≥ 0.95 AND signal_count ≥ 5 — operator may open a council proposal.
6. Council vote: 3-of-5 YES on Polygon → `worker-governance` publishes dossier-render envelope (with FIND-002 threshold re-check). 4-of-5 YES required for _public_ release of entity names.
7. Dossier rendered in FR + EN, GPG-signed, IPFS-pinned.
8. CONAC SFTP delivery with **third-line threshold check** (FIND-002) at the SFTP boundary.
9. Audit chain rows for every transition: `finding.created`, `finding.posterior_updated`, `council.proposal_opened`, `council.vote_cast`, `governance.proposal_escalated`, `dossier.render_enqueued`, `dossier.rendered`, `dossier.signed`, `dossier.delivered`, `dossier.acknowledged`.

### E2. How are the patterns calibrated against ground truth?

Per EXEC §25, the architect populates [`personal/calibration-seed/seed.csv`](../../personal/calibration-seed/) (architect-write only, not in repo) with labelled historical cases: known confirmed fraud, known cleared cases, known borderline. The certainty engine's calibration loop in [`packages/calibration`](../../packages/calibration) computes Expected Calibration Error (ECE) + Brier score per pattern + per-category, surfaces drift on `/calibration` operator surface, and refuses to ship findings if calibration quality falls below the published threshold (currently ECE < 0.05 per AUDIT-099). **Phase 1 gate:** ≥ 30 ground-truth-labelled cases must be in the seed before the calibration loop is considered armed (EXEC §43.2).

### E3. What patterns are NOT covered (i.e. what won't this detect)?

- Cash transactions outside the formal payment system (we see only what wires reveal).
- Sealed-record corporate structures (where UBO declarations are sealed by court order).
- Sophisticated multi-jurisdiction tax structuring that uses non-FATF-listed paths.
- Real-estate flips where the transaction is registered in Cameroon but the equity flow is offshore unregistered.
- Personal bribery without an associated state contract or licence.

These are stated explicitly to the architect's councils per EXEC §21 ("known blindspots"). The platform is one signal source; CONAC's investigators have other (human-source) signals.

---

## F. AI safety — DECISION-011 (the most-asked-about doctrine)

### F1. Is the platform "AI-generated decisions about corruption"?

**No.** The LLM never decides anything consequential. It is used in three narrow, gated contexts:

1. **Field extraction** ([`apps/worker-extractor`](../../apps/worker-extractor)): pull structured fields out of HTML/PDF after deterministic regex has run first. The LLM's output is then validated against a Zod schema; failed validation is dropped, not retried with wider latitude.
2. **Counter-evidence drafting** ([`apps/worker-counter-evidence`](../../apps/worker-counter-evidence)): for a candidate finding, the LLM drafts the strongest available argument _against_ the finding. This is then served to operators alongside the supporting evidence; operators may not escalate if the counter-evidence is coherent.
3. **Adapter selector proposal** ([`apps/worker-adapter-repair`](../../apps/worker-adapter-repair)): when a source's HTML changes, the LLM proposes a new CSS / XPath selector, which is then shadow-tested for 48 windows before promotion.

In every other place — pattern detection, Bayesian engine, council voting, threshold gate, audit-chain emission — the code is pure, deterministic, and unit-tested.

### F2. What's the 12-layer LLM safety stack?

Per [`docs/source/AI-SAFETY-DOCTRINE-v1.md`](../source/AI-SAFETY-DOCTRINE-v1.md) (DECISION-011), every LLM call routes through `SafeLlmRouter` in [`packages/llm/src/safe-llm-router.ts`](../../packages/llm/src/safe-llm-router.ts), which composes twelve checks:

1. **Provider firewall** — Anthropic API or Bedrock (no OpenAI, no Google Gemini, no open self-hosted weights for production paths).
2. **Model pinning** — exact model ID + version; no `latest` aliases.
3. **Temperature lock** — 0.0 extraction, 0.2 classification, 0.4 translation, 0.6 devil's advocate. Never higher.
4. **System-prompt allowlist** — system prompts loaded from versioned files in [`prompts/`](../../prompts/); no inline construction.
5. **Schema-validated output** — every response parsed with Zod; failure means drop, not retry.
6. **Verbatim grounding** — every claim must cite `{document_cid, page, char_span}`; ungrounded answers are dropped.
7. **Order-randomisation cross-check** — same evidence presented in two orders; disagreement = held finding.
8. **Devil's-advocate pass** — separate model call constructs the strongest counter-argument; if coherent, the finding is downgraded.
9. **Counterfactual collapse** — re-run with one piece of evidence removed; if posterior unchanged, the evidence was non-load-bearing (audit signal).
10. **Cluster-dependency guard** — if N findings cite the same 1 document, dependency is flagged.
11. **Canary detection** — known-false test prompts are injected periodically; the system must surface them as "insufficient evidence."
12. **Lost-in-middle regression** — for long-context calls, an attention check confirms the model considered evidence from all positions.

Every layer that fires emits a structured `assessment.hold_reason` enum value (see [`packages/shared/src/schemas/certainty.ts:zHoldReason`](../../packages/shared/src/schemas/certainty.ts)) into the audit chain. An external reviewer can replay the chain and confirm which layer caught which finding.

### F3. What model is used in production?

Per DECISION-011 + [`packages/llm/src/providers/anthropic.ts`](../../packages/llm/src/providers/anthropic.ts), the primary is `claude-3-5-sonnet-{pinned-version}` via Anthropic API; failover is `anthropic.claude-3-5-sonnet-{pinned-version}` via AWS Bedrock (different infrastructure path, same model). Failover is automatic on Anthropic API outage; both endpoints share the same model pinning so output is reproducible.

### F4. What is the per-finding LLM cost? Is the platform expensive to operate?

Order-of-magnitude per dossier: $0.30 – $1.50 in LLM token cost for the full extraction + counter-evidence + adversarial pipeline. At Phase 1 throughput (~50–200 findings/month), monthly LLM cost is in the $50 – $300 range. See [`docs/decisions/log.md` DECISION-011 Appendix B](../decisions/log.md) for the per-pattern cost model.

### F5. Has the AI safety stack been independently reviewed?

External red-team review is scheduled at Phase 1 milestone M5 (estimated USD 30,000–80,000 engagement). The internal audit catalogue ([`docs/audit/`](../audit/)) catalogues every defect found in the audit pass; the 16 critical-through-info findings from the 2026-05-10 whole-system audit are all closed in commits `fd38e2c` and `66bd103` per `docs/decisions/log.md` DECISION-019.

---

## G. Cryptography

### G1. Where does the private-key material live?

- **Tip portal council key:** Distributed via 3-of-5 Shamir secret-sharing over GF(256) ([`packages/security/src/shamir.ts`](../../packages/security/src/shamir.ts)). Each pillar's share is encrypted with `age-plugin-yubikey` to that pillar's individual YubiKey. Reconstruction requires 3 council members' physical YubiKey touches.
- **Polygon anchor key:** YubiKey PIV slot 9c on the architect's primary hardware key. Signing happens via PKCS#11 + Rust helper (FIND-007 closure 2026-05-11) → Unix socket → Python service → `worker-anchor`. Private key never leaves the YubiKey.
- **Vault root token:** Shamir 3-of-5; architect + backup architect + safe-paper-share + institutional-partner-share + audit-pillar-share. No single party can unseal alone.
- **GPG dossier-signing key:** Architect's YubiKey-backed PGP subkey, exported as repo secret `GPG_SIGNING_KEY` only at release-tag-push time; the key material is never decrypted on disk during normal operations.
- **mTLS certificates:** Per-worker certs auto-rotated via the `mtls-singleflight.ts` mechanism in [`packages/security/src/mtls.ts`](../../packages/security/src/mtls.ts), pinned against Vault PKI subordinate CAs per region.

### G2. What cryptographic primitives are used?

| Use                            | Primitive                                          | Library                          | Verified                                                               |
| ------------------------------ | -------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| Hash chain                     | SHA-256                                            | `node:crypto` (Node built-in)    | ✓ 26 unit tests                                                        |
| Tip encryption                 | libsodium sealed-box (X25519 + XChaCha20-Poly1305) | `libsodium-wrappers-sumo` 0.7.13 | ✓ 4 unit tests                                                         |
| At-rest field encryption       | XChaCha20-Poly1305 (AEAD)                          | `libsodium-wrappers-sumo`        | ✓ via sodium.ts tests                                                  |
| Threshold reconstruction       | Shamir over GF(256)                                | hand-coded (zero-deps, audited)  | ✓ 6 unit tests                                                         |
| WebAuthn / FIDO2               | Standard                                           | `@simplewebauthn/server` v11     | ✓ via fido.ts tests                                                    |
| Polygon transaction signing    | ECDSA-secp256k1 on YubiKey                         | PKCS#11 + custom Rust helper     | ✓ 9 unit tests in `tools/vigil-polygon-signer/rust-helper/src/sign.rs` |
| Smart-contract message hashing | keccak256                                          | OpenZeppelin / ethers.js         | ✓ via Hardhat tests                                                    |
| Dossier signing                | OpenPGP / Ed25519 subkey                           | gpg via host CLI                 | architect-provisioned per HSK-v1                                       |
| TLS to external sources        | TLS 1.2 / 1.3                                      | Node.js undici + Caddy           | standard                                                               |

### G3. There's no FROST signature scheme — wasn't the spec calling for FROST?

Per **DECISION-018** (2026-05-11): the audit-spec language referencing "FROST-Ed25519" was aspirational. The shipped design is **contract-native multi-sig** via `VIGILGovernance.sol`. Each council pillar's YubiKey produces an independent signed Polygon transaction; the contract enforces 3-of-5 quorum via the `votedChoice[][]` tally with a `NOT_VOTED = 0` sentinel. This is arguably _stronger_ than FROST aggregation: each signature is independently verifiable on-chain and recorded in the public Polygon ledger, while FROST produces a single aggregated signature that loses per-signer attribution. Commit-reveal (2-min reveal delay) plus per-proposal vote-lock prevent replay and front-running. See `contracts/contracts/VIGILGovernance.sol`.

### G4. Have you done a key-rotation drill?

Vault has a `vigil-key-rotation.timer` systemd unit ([`infra/systemd/vigil-key-rotation.timer`](../../infra/systemd/vigil-key-rotation.timer)) running quarterly. Quarterly DR rehearsal is scheduled per OPERATIONS.md §9 (backup architect attends). Phase 1 institutional precondition: at least one full rehearsal documented before institutional handoff (EXEC §43.2 — pending council enrolment).

---

## H. Audit chain — the triple-witness

### H1. Why three witnesses?

Per DECISION-012 + TAL-PA-DOCTRINE: a single audit chain in a single database is one tampering target. Three independent witnesses on three independent infrastructures means an adversary must compromise (a) the application Postgres, (b) Polygon mainnet, and (c) a Hyperledger Fabric peer simultaneously to forge a record without detection. The independent-replay test catches any single-witness divergence.

### H2. How does the hash chain work?

Per [`packages/audit-chain/src/canonical.ts`](../../packages/audit-chain/src/canonical.ts):

- Every audit event is **canonicalised** (sorted keys, NFC Unicode normalisation, pipe-delimited field projection) into a deterministic byte string.
- `body_hash = SHA-256(canonical_bytes)`.
- `row_hash = SHA-256(prev_row_hash || body_hash)`.
- Each row is inserted under `BEGIN ISOLATION LEVEL SERIALIZABLE` so two parallel inserts can never collide on the same seq.
- An offline verifier ([`packages/audit-chain/src/offline-verify.ts`](../../packages/audit-chain/src/offline-verify.ts)) reads a CSV export of `audit.actions`, recomputes every hash, and reports all divergences (continue-and-collect, not first-break). 21 tests pin every divergence type.

### H3. Where on Polygon mainnet do anchors land?

`VIGILAnchor.sol` deployed to a Polygon mainnet contract address pinned in [`docs/decisions/log.md` DECISION-013](../decisions/log.md). Every commitment is `(seq_from, seq_to, root_hash, polygon_tx_hash, polygon_block_number)`. Verifiable on `polygonscan.com/address/{contract}`. The architect's anchor wallet is funded with MATIC; per Phase 1 milestone the wallet should hold ~$100 / month of MATIC at current gas prices (worker-anchor adaptive throttling reduces this materially during low-throughput periods).

### H4. How can an external auditor independently verify a finding?

Per the `/verify/[ref]` public surface ([`apps/dashboard/src/app/verify/[ref]/page.tsx`](../../apps/dashboard/src/app/verify/[ref]/page.tsx)):

1. Reviewer obtains the dossier reference `VA-YYYY-NNNN` from the CONAC-delivered file or public ledger.
2. Visits `/verify/VA-YYYY-NNNN` — sees PDF SHA-256, IPFS CID, Polygon transaction hash, council vote tally, dossier render timestamp.
3. Verifier may independently:
   - SHA-256 the received PDF and compare to the published hash.
   - Fetch the PDF from the IPFS CID via any public gateway and compare.
   - Look up the Polygon tx on polygonscan and confirm the timestamp + the anchor commitment.
   - (For institutional reviewers) request the audit-chain CSV export and replay using the bundled offline verifier.

Three independent cryptographic confirmations that the dossier existed at the published timestamp and was approved by the council.

### H5. What if Polygon disappears tomorrow?

The hash chain in Postgres is the source of truth. Polygon and Fabric are _witnesses_ — they confirm integrity but are not where the chain lives. If Polygon were to disappear, every existing anchor commitment is still verifiable from blockchain explorers and archival nodes (Polygon's state is mirrored worldwide). New anchors would pause until a fallback chain is chosen (DECISION-013 contemplates Bitcoin-via-OP_RETURN as a fallback). The Postgres chain itself is unaffected.

---

## I. Privacy & data protection (especially tip portal)

### I1. Are citizen tips truly anonymous?

The architecture enforces anonymity by construction:

- **Client-side encryption**: tip content is encrypted in the citizen's browser before transmission, with `libsodium.crypto_box_seal` against the council's public key. The server receives only ciphertext.
- **No IP persistence**: the tip schema in [`packages/db-postgres/src/schema/tip.ts`](../../packages/db-postgres/src/schema/tip.ts) has no `client_ip` column. Caddy strips IPs from access logs before they reach the application database. Cf-Connecting-IP is read at the application layer only for Turnstile anti-bot verification, never persisted.
- **No third-party analytics**: confirmed by grep of the public bundle for `gtag|segment|hotjar|mixpanel|amplitude|posthog` — zero hits.
- **EXIF stripping**: attachments are canvas-re-encoded in the browser to strip GPS coordinates and ICC profiles before encryption.
- **Tor-friendly**: no JavaScript-only flows; the entire tip submission works without modern JS (Cloudflare Turnstile is the one exception, and is documented).
- **Triple-locked retention** (DECISION-016): DB triggers + append-only history table + repo policy refusing direct DELETE on the tip table.

### I2. Can a state-level adversary identify a tipster?

- The server has only ciphertext + a server timestamp + (transiently, for rate limiting) the source IP.
- Decryption requires 3-of-5 council member YubiKey touches.
- If a state-level adversary compels Cloudflare to log Turnstile cookies, they could correlate IPs to submission times — but the contents remain encrypted.
- Tor exit nodes are tolerated (no AS-blocking, no behavioural filtering).
- **The state-level threat is partial; this is stated honestly in [`THREAT-MODEL-CMR.md`](../../THREAT-MODEL-CMR.md) §6** — a tipster on a state-monitored ISP using a state-monitored device cannot be fully protected by client-side controls alone. The tip portal's brand presentation explicitly recommends Tor Browser for high-risk tips.

### I3. What about personal data on operators?

Operators authenticate via Keycloak with FIDO2-only (no passwords). Personally identifiable data on operators is limited to: Keycloak username, role assignments, YubiKey serial (audit trail), IP at authentication time. All operator actions are TAL-PA-logged per DECISION-012; operators are aware of and have signed an explicit "the watcher is watched" notice as part of their enrolment.

---

## J. Governance — the 5-pillar council

### J1. Who are the 5 pillars?

Per SRD §23.2 + EXEC §08.2:

1. **Governance pillar** — typically a former senior public-finance auditor or constitutional-court counsel (institutional weight).
2. **Judicial pillar** — typically a retired magistrate or law professor with anti-corruption case experience.
3. **Civil society pillar** — typically a respected NGO leader or investigative journalist (independence).
4. **Audit pillar** — typically a CPA / chartered accountant with public-sector audit credentials (technical credibility on financial findings).
5. **Technical pillar** — typically a senior security engineer or cryptographer (technical credibility on the platform itself).

Individual identities are published only after the EXEC §13 enrolment ceremony. Until then, the council seats are held open per `/civil-society/council-composition` ([`apps/dashboard/src/app/civil-society/council-composition/page.tsx`](../../apps/dashboard/src/app/civil-society/council-composition/page.tsx)).

### J2. What does the council actually vote on?

- **Escalate-a-finding** to a recipient body (3-of-5): a candidate finding becomes a deliverable dossier.
- **Unmask civil-society view** (4-of-5): identity of accused entities is published to the read-only civil-society audit log. Default is masked.
- **Constitutional changes** to the platform (5-of-5): change of jurisdiction, change of cryptographic primitive, change of council quorum thresholds.
- **Emergency unseal** if the architect is unreachable for 14 days (3-of-5 via Shamir + safe-paper-share per OPERATIONS.md §10).

### J3. How does a pillar resign or get replaced?

Per `/civil-society/council-composition` + EXEC §15: a pillar may resign at any time with 60 days' notice. Replacement is by 4-of-5 vote of remaining pillars + architect ratification (5-of-5 council vote not required, but architect veto allowed). Forced removal of a pillar requires 4-of-5 vote of the other pillars + 90 days for due process.

### J4. What if all 5 pillars collude?

Then the platform fails. Per EXEC §22 ("five-of-five collusion failure mode"), the residual defences are:

- The Polygon anchor is public and immutable; an external observer notices unusual escalation patterns.
- The civil-society audit log is read-only and replicated; any sudden change to unmasking patterns is publicly visible.
- The institutional recipient bodies (CONAC, MINFI, ANIF) have their own due-process review of received dossiers; a coordinated false-finding still requires the recipient to act on it.
- The architect's emergency revocation (EXEC §34.5 envelope) can revoke all 5 pillar enrolments at the Keycloak layer pending a fresh council ceremony.

The platform is not designed to survive 5-of-5 collusion; it is designed to survive 4-of-5 with one honest pillar.

---

## K. Resilience and operational continuity

### K1. What happens if the architect dies, is incapacitated, or is unreachable?

Per OPERATIONS.md §9 + §10 + EXEC §34.5 (the sealed envelope):

1. Backup architect (named in EXEC §34.5, paid retainer per §9) takes over operational continuity.
2. After 14 days unreachable: Hetzner web-console recovery via SAS company papers + architect's personal lawyer.
3. Vault unseal via 3-of-5 Shamir: backup architect's YubiKey share + safe-paper-share + institutional-partner-share.
4. No commits to `main` during the unreachable window without 4-of-5 council vote.
5. Quarterly DR rehearsal validates this entire path.

### K2. What about backup and disaster recovery?

- **Postgres:** daily `pg_dump --custom` to Synology primary NAS WORM volume + weekly off-site replica to second region.
- **IPFS:** all pinned content is also stored as files on Synology NAS; pins re-served from there in disaster.
- **Audit chain:** replicated to Polygon mainnet + Fabric peer; recovery from any single witness reconstructs the chain.
- **Vault:** Shamir shares held off-site in 5 different physical / institutional locations (per HSK-v1).
- **Forgejo repo:** daily `git clone --mirror` to NAS; mirror also pushed to private GitHub.
- **Recovery time objective (RTO):** 4 hours for the full operator dashboard. **Recovery point objective (RPO):** zero data loss on the audit chain (Polygon is the upper bound on RPO); ≤ 24 hours on other state.

### K3. How is uptime monitored?

- **3-VPS sentinel quorum** ([`packages/observability/src/sentinel-quorum.ts`](../../packages/observability/src/sentinel-quorum.ts)): probes from Helsinki, Tokyo, NYC. If 2 of 3 report "down" within a 5-minute window, an outage is declared and `sentinel.quorum_outage` is emitted to the audit chain.
- **Prometheus + Grafana** stack on `vigil-internal`. Per-worker `/metrics` endpoint surfaces lag, error rate, dead-letter depth.
- **Alertmanager → Slack webhook** (operator-only channel) for critical alerts.

### K4. What's the dead-letter queue and how is it managed?

Per [`OPERATIONS.md §11`](../../OPERATIONS.md): each worker stops retrying after 8 attempts and moves to a Redis dead-letter stream + mirrored Postgres `audit.dead_letter` row. Operators view at `/dead-letter` (operator + architect role). The new `worker-reconcil-audit` (FIND-005 closure 2026-05-11) auto-republishes missing-from-Fabric envelopes; other categories require operator triage per the documented runbook.

---

## L. Compliance and legal alignment

### L1. Cameroon legal alignment?

- **2010 Cybersecurity Law:** Article 4 (lawful public-data processing), Articles 30–35 (audit-log retention — VIGIL APEX exceeds requirement by maintaining 7-year retention with replay verification).
- **ANTIC declaration:** filed per Article 38; reference at `NEXT_PUBLIC_ANTIC_DECLARATION_URL`. Declaration text reviewed by counsel.
- **Cybersecurity / data-protection regulator coordination:** first-contact protocol per EXEC §22; before Phase 2, the platform either (a) receives explicit acknowledgement from ≥ 1 regulator, or (b) records an explicit decision to proceed under public-data law alone.

### L2. International alignment?

- **GDPR (incidental EU traffic via Hetzner host):** no consent required for public-data processing; tip portal has explicit consent banner; ANTIC declaration covers controller obligations. Right-to-erasure handled via the triple-locked retention exception clause (legal-public-interest carve-out).
- **AML / FATF Recommendations:** alignment with R.20 (suspicious-activity reports) — VIGIL APEX outputs are non-binding intelligence, not SARs; ANIF retains exclusive SAR-issuance authority. R.40 (sanctions screening) — sanctions-feed adapters cover OFAC, EU, UN, World Bank, AfDB.
- **Open-data standards:** dossiers exported via SFTP follow the IDA (International Disclosure Architecture) JSON schema documented in [`docs/decisions/log.md` DECISION-010](../decisions/log.md).

### L3. Is there an audit trail for the audit chain itself?

Yes. Per DECISION-012 + AUDIT-014: `worker-audit-watch` performs audit-of-audit by replaying the hash chain every cycle (FIND-014 closure 2026-05-11) and emitting `audit.hash_chain_verified` to the chain. The verifier is itself watched: every audit-watch cycle produces a chain row. An adversary tampering with the chain must also forge the audit-watch's verification row, which is anchored to Polygon within the next anchor window.

---

## M. Costs and sustainability

### M1. What does this cost to operate per year?

Order-of-magnitude estimates (Phase 1, single-region, ~50–200 findings/month):

| Item                                                     | Annual estimate        |
| -------------------------------------------------------- | ---------------------- |
| Hetzner dedicated host (24 cores, 128 GB, NVMe)          | ~€2,400                |
| Polygon gas (anchor commits)                             | ~€500                  |
| Anthropic API + Bedrock failover                         | ~€2,000                |
| YubiKey estate (one-time + replacement cycle)            | ~€600/year amortised   |
| Synology NAS + off-site backups                          | ~€400                  |
| Caddy + Let's Encrypt + Cloudflare Turnstile (free tier) | €0                     |
| ANTIC declaration renewal                                | ~€100                  |
| Insurance + legal retainer (SAS)                         | ~€3,000                |
| Backup architect retainer (€400 × 12)                    | €4,800                 |
| External red-team review (M5 milestone, one-time)        | €30,000 – €80,000      |
| Quarterly DR rehearsal (one day × 4 × architect rate)    | ~€2,000                |
| **Recurring annual operating cost (steady-state)**       | **~€16,000 – €18,000** |
| **Recurring + amortised first-year red-team**            | **~€26,000 – €58,000** |

### M2. Funding model?

- **Phase 1 (2026):** architect-funded with backup-architect retainer paid out of operating budget.
- **Phase 2 (2027):** anticipated UNDP / AfDB / GIZ governance-programme grant funding for council enrolment expenses + external red-team. Council members serve as volunteer-paid (modest honorarium per session, not full-time salary).
- **Phase 3 (federation, 2028+):** anticipated multi-country institutional consortium with cost-sharing.

### M3. What's the institutional sustainability story?

- The platform is open architecture (every doctrine document is in the repo).
- The 5-pillar council survives architect departure (per OPERATIONS.md §9–10).
- The findings are cryptographically verifiable independently of the platform's continued operation — a CONAC investigator with a dossier from 2026 can in 2036 still independently verify it via Polygon + IPFS even if VIGIL APEX itself no longer runs.
- A successor team can fork the codebase (which is open within the institutional consortium) and continue operations from the same audit-chain genesis.

---

## N. Verifiability and external review

### N1. How would a UNDP technical staffer independently verify the platform?

1. **Code-level:** clone the repository. Run `pnpm install && pnpm -r test` — confirm ~1632 tests pass. Run `gitleaks detect --source . --log-opts='--all'` — confirm 0 secrets. Read [`docs/audit/whole-system-audit.md`](../audit/whole-system-audit.md) — every claim cites a file path.
2. **Cryptographic-level:** verify the Polygon contract bytecode against the deployed contract hash pinned in DECISION-013. Replay the audit chain CSV through the offline verifier.
3. **Operational-level:** schedule a half-day with the architect to observe a council vote ceremony and a finding-escalation dry run on staging.
4. **Legal-level:** request the ANTIC declaration text and the council-pillar enrolment records. (Note: pillar identities are revealed only at the formal enrolment ceremony per EXEC §13.)

### N2. What's the known defect surface today (2026-05-11)?

- **107 catalogued findings** total: 89 prior ([`AUDIT.md`](../../AUDIT.md), 2026-04-30 — all `fixed`, `blocked-on-architect-decision`, or `info`), 16 new ([`docs/audit/10-findings.md`](../audit/10-findings.md), 2026-05-10 — all closed in commits `fd38e2c` and `66bd103` per DECISION-019), plus AUDIT-095 (closed in commit `66bd103`).
- **Deferred to live-fire phase** (requires running stack): Section-11 stress tests in [`docs/audit/09-stress-test.md`](../audit/09-stress-test.md), Lighthouse / axe a11y runs, Polygon Mumbai/Amoy testnet E2E validation of the YubiKey signer (FIND-007 reference build is complete; production E2E pending architect's testnet wallet funding).
- **Architect-blocked items (Track F):** Phase-1 institutional preconditions per EXEC §43.2 — council members not yet named, YubiKeys not yet delivered, calibration seed below 30 cases.

### N3. What independent assurance is already in place?

- **Internal:** ~1632 unit tests across the monorepo. Gitleaks scan of full git history: 0 findings. Build-time RBAC coverage check (FIND-004 closure). Three layers of CONAC threshold enforcement (FIND-002 closure). Three independent audit-chain witnesses with reconciliation worker (FIND-005 closure).
- **External (scheduled):** Phase 1 milestone M5 red-team engagement (~€30K–€80K, target 2026 Q4). Annual external rotation of the threat model per `THREAT-MODEL-CMR.md` review cycle.
- **Public:** Polygon anchor is publicly verifiable. The dossier `/verify` page is publicly accessible. The civil-society read-only audit log is published with W-15 masking + 4-of-5 unmasking ceremony.

### N4. What are the platform's stated limitations?

Per [`docs/source/SRD-v3.md` §21](../source/SRD-v3.md) ("known limitations"):

1. **English-second:** UI is FR primary; bilingual coverage is enforced but some operator UIs are FR-only by design (e.g., `/dead-letter` operator triage).
2. **Cameroon-specific:** patterns are tuned to Cameroon's public-finance context. Generalising to another country requires re-calibration of priors + likelihood ratios + an architect-supervised pattern review.
3. **Public-data only:** no access to bank records, court sealed records, or wiretap evidence. We see what the state itself or third parties have already published or which can be inferred from cross-source correlation.
4. **5-of-5 collusion**: by design, the platform does not survive total council capture (see J4).
5. **State-level adversary against an individual tipster on monitored infrastructure**: stated honestly; client-side controls alone cannot fully protect such a tipster.

### N5. Where can a reviewer start?

For a UNDP technical lead reading this for the first time, the recommended 90-minute read path:

1. [`TRUTH.md`](../../TRUTH.md) §A–F (mandate, architecture, governance, data, hardware, hosting)
2. [`docs/audit/whole-system-audit.md`](../audit/whole-system-audit.md) — executive summary + findings catalogue
3. [`docs/source/AI-SAFETY-DOCTRINE-v1.md`](../source/AI-SAFETY-DOCTRINE-v1.md) — the 12-layer LLM stack (this is the most-asked-about doctrine)
4. [`docs/source/TAL-PA-DOCTRINE-v1.md`](../source/TAL-PA-DOCTRINE-v1.md) — Total Action Logging with Public Anchoring
5. This Q&A document for institutional-context answers
6. A live session with the architect for code-level walkthrough of one end-to-end finding flow

---

## O. Quick-reference answers

| Q                                                        | Short answer                                                                                                                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open source?                                             | Open architecture under institutional consortium licence; not MIT-licensed public source. Verifiability does not require open public source.                                                       |
| Hosted where?                                            | Hetzner DE, primary; Polygon mainnet for anchors; IPFS for dossiers. Not on AWS / GCP / Azure.                                                                                                     |
| Who pays Polygon gas?                                    | Architect (Phase 1); institutional partner (Phase 2).                                                                                                                                              |
| What if the LLM hallucinates?                            | Twelve layers; ungrounded claims dropped; canary detection; counter-evidence required.                                                                                                             |
| How long do tips live?                                   | Indefinitely on the encrypted side; plaintext only exists transiently during a 3-of-5 ceremony and is dropped after triage.                                                                        |
| How does CONAC respond to findings?                      | CONAC retains exclusive investigative authority; VIGIL APEX delivery is one-way (SFTP → CONAC ack).                                                                                                |
| What happens to a finding that doesn't reach 3-of-5?     | Stored as "review" state, visible to operators, not escalated, audit-logged.                                                                                                                       |
| Can a foreign government read citizen tips?              | Only by compelling the 3-of-5 council quorum — physically distributed across 5 pillars.                                                                                                            |
| Can the platform be turned off by the Cameroonian state? | Primary infrastructure is in Germany; primary code repo is self-hosted in Germany; council quorum is multi-jurisdictional. The platform is designed to be resilient against single-state coercion. |
| Has any finding been delivered yet?                      | Phase 1 pilot stage — calibration seed is being populated; no findings delivered to CONAC yet.                                                                                                     |

---

**Document maintained by:** the build agent (Claude) per architect direction.
**Last updated:** 2026-05-11.
**Next review:** Phase 1 milestone M3 (council enrolment complete) or earlier if doctrine drifts.
