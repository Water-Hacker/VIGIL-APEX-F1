# VIGIL APEX — Phase 1 Closure TODO

> Single consolidated punch list of every open item across DECISION-013,
> CORE_MVP §14, CORE_HSK provisioning ceremonies, the PGP-key-exchange
> protocol with each receiving body (HSK §04.5 + EXEC §15), audit-anchor
> activation (SRD §22.7 + DECISION-012), and every other tracked location
> in the codebase. Deduplicated. Each item names: who must do it, what
> unblocks the next step, and the source document with exact section
> number. Items cited from more than one source list every citation.
>
> This file does not invent work. Every entry traces to a section in a
> binding doc or to an in-tree decision-log entry, weakness file, work-
> program tracker, or open question on TRUTH §L.
>
> **Scope:** Phase 1 closure = full M4 acceptance per CORE_MVP §14
> (Section 17 metrics hit; ISO 27001 readiness report; council
> onboarded; failover drill documented). The pure-agent items in §4 are
> reserved for Phase 2+ rollout and continuous-operation cadence and
> are NOT required for Phase 1 closure.

**Last reconciled:** 2026-04-29 (DECISION-013 — Post-DECISION-012 work program closure).
**Status legend:** 🟦 architect / counsel / regulator / financial · 🟧 hardware ceremony · 🟨 joint (architect unblocks → agent executes) · 🟩 agent recurring · ⬛ deferred by spec.

---

## Section 1 — Architect actions before the platform can boot

These items must be in flight or complete before Phase 1 development moves
beyond the framework that already ships. They are institutional, hardware,
financial, and account-provisioning blockers. None can be advanced by the
build agent.

### 1.1 Hardware procurement (Track A in EXEC §03.1)

**1.1.1 Order 8 YubiKey 5 NFC + 1 YubiKey 5C NFC (total 9 units).**
🟦 Architect.
Buy from `eu.yubico.com` or an authorised reseller in Belgium / Senegal;
ship in two batches (4 + 4 + 1) to two different Cameroonian addresses;
take delivery personally, do not delegate; verify hologram seal intact;
photograph each serial; record assignment in the decision log.
**Unblocks:** YubiKey provisioning ceremony (§2 below) → all phase-1
ceremonies depending on hardware-key auth.
**Source:** EXEC-v1 §04.3 (procurement procedure), §04.4 (what can go
wrong), table 14; HSK-v1 §03.2-3 (the pair model + custody); TRUTH §E
(YubiKey count = 8); W-03 (YubiKey count drift fix); CORE_MVP §14 M0b
("3 supplier quotes" includes hardware), §14 M1 (8 keys per EXEC §04
allocation); D-013 Track F ("YubiKey procurement + delivery").

**1.1.2 Order MSI Titan 18 HX AI workstation (24-core, 128 GB DDR5, RTX 5090 24 GB).**
🟦 Architect. Three supplier quotes per CORE_MVP §14 M0b. Personally inspect
on receipt; verify TPM 2.0 firmware version.
**Unblocks:** M0c container fabric; M1 host services boot.
**Source:** TRUTH §B; CORE_MVP §02.3, §14 M0b; HSK-v1 §05.9 (BitLocker
configured on the Titan).

**1.1.3 Order Synology DS1823xs+ pair (primary + remote replica) with 6×HAT5300-8T per unit.**
🟦 Architect. Synology authorised distributor list included in the M0b
hardware-quote bundle.
**Unblocks:** M1 NFS bind mounts; M1 Snapshot Replication over WireGuard;
M4 NAS failover drill.
**Source:** TRUTH §B; CORE_MVP §02.2, §14 M0b; W-02 (NAS model + RAID
drift fix).

**1.1.4 Order Hetzner CPX31 ingestion VPS (Falkenstein DE).**
🟦 Architect. Provision at M0b; SSH access configured against architect's
YubiKey-PIV.
**Unblocks:** M1 Hetzner-side container; M1 WireGuard mesh; M2 22 source
adapters running off-host.
**Source:** TRUTH §B; CORE_MVP §05.1, §14 M1; HSK-v1 §04.3.

**1.1.5 Order 3 sentinel VPS for the 2-of-3 outage-attestation quorum.**
🟦 Architect. Hetzner CX22 Helsinki + Vultr Tokyo + DigitalOcean New York
(per CORE_MVP §05.1).
**Unblocks:** outage-quorum sentinel timer (already coded — see
`scripts/sentinel-quorum.ts`, `scripts/sentinel-tor-check.ts`,
`infra/host-bootstrap/systemd/vigil-sentinel-{tor,quorum}.{service,timer}`).
**Source:** TRUTH §B (Sentinel monitors, 2-of-3 quorum); CORE_MVP §05.1;
D-013 (C3 + C6 sentinel).

**1.1.6 Order EcoFlow DELTA 2 + diesel generator + UPS.**
🟦 Architect. ENEO load-shedding mitigation at the architect's residence

- work site.
  **Unblocks:** ENEO outage resilience (Tier-1 TTP-CMR-03 mitigation per
  THREAT-MODEL §1).
  **Source:** THREAT-MODEL-CMR §1; CORE_MVP §02 (resilience); TRUTH §B
  (host workstation context).

**1.1.7 Provision Starlink Standard kit at architect's primary site.**
🟦 Architect. ENEO + Cameroonian-ISP failover; field-demo connectivity.
**Unblocks:** EXEC §07.5 architect's-own-connectivity discipline; field
operations per HSK-v1 §06.3.
**Source:** EXEC-v1 §07 (network resilience); CORE_MVP §05.2 (Starlink
$50/mo); HSK-v1 §06.3.

### 1.2 Account provisioning (Track A + Track C in EXEC §03.1)

**1.2.1 Register `vigilapex.cm` (or `vigil-apex.org` as fallback) at Gandi.**
🟦 Architect. Configure Cloudflare DNS with DNSSEC; CAA records to
`letsencrypt.org` only.
**Unblocks:** TLS issuance for `verify.`, `tip.`, `kc.`, `api.`
subdomains; M0b "all 22 API accounts live" depends on operational
domain.
**Source:** EXEC-v1 §06.1-06.4; TRUTH §F (operational domain;
registrar; DNSSEC; CAA); D-001 (already FINAL — Hetzner + Gandi);
TRUTH §L Q3-Q4 (open questions: hosting confirmation; subdomain
choice).

**1.2.2 Provision operational email (ProtonMail Suite OR self-hosted Postfix on Hetzner N02).**
🟦 Architect. Never Gmail.
**Unblocks:** EXEC §15 CONAC engagement letter delivery; M0b CONAC +
MINFI intro meetings (the meeting invites need an institutional email
address).
**Source:** EXEC-v1 §06.5 (Email); TRUTH §F; CORE_MVP §05.2 (Proton Suite
$16/mo).

**1.2.3 Open Anthropic Console account.**
🟦 Architect. Pay-on-file; record key fingerprint.
**Unblocks:** Anthropic API key (Vault path `anthropic/api_key`) for the
SafeLlmRouter Tier-0 path; without it, every LLM-using worker is on
Bedrock or local Tier-2 from boot.
**Source:** CORE_MVP §06; TRUTH §I (LLM tier 0); HSK-v1 §04.6.

**1.2.4 Open AWS account; enable Bedrock access in eu-west-1.**
🟦 Architect. Bedrock = Tier-1 failover; $0 baseline cost.
**Unblocks:** SafeLlmRouter Tier-1 failover when Anthropic circuit opens.
**Source:** CORE_MVP §06; TRUTH §I (LLM tier 1).

**1.2.5 Open Cloudflare account (free tier with DNSSEC).**
🟦 Architect. Used for DNS + WAF + Zero Trust + DDoS.
**Unblocks:** Public verify / tip / civil-society surfaces.
**Source:** TRUTH §F; CORE_MVP §05.2 (Cloudflare Pro $20/mo).

**1.2.6 Open Alchemy or Infura account; obtain Polygon mainnet RPC URL.**
🟦 Architect. Authenticated provider required by SRD §22 (rejects
fall-through to public `polygon-rpc.com`).
**Unblocks:** worker-anchor production boot (`POLYGON_RPC_URL` no
longer falls back to the public RPC).
**Source:** SRD-v3 §22; CORE_MVP §05.2 (Polygon Mainnet Gas line);
worker-anchor bootguard at `apps/worker-anchor/src/index.ts:53-58`.

**1.2.7 Open Synology Account for cross-NAS replication.**
🟦 Architect.
**Unblocks:** WireGuard-replicated Snapshot Replication (RPO < 5 min)
between primary and remote NAS; M1 acceptance.
**Source:** TRUTH §B (Synology pair); CORE_MVP §02.2; HSK-v1 §04.2.

**1.2.8 Open Hetzner account (separate from §1.1.4 above — billing).**
🟦 Architect.
**Source:** TRUTH §B; CORE_MVP §05.1.

**1.2.9 Open M365 / GitHub / Snyk Pro / Yubico Authenticator / Sentinel Hub / Mapbox / Apify / Firecrawl / Claude Code / OpenCorporates / Maxar / SkyFi / Planet / Polygon Mumbai-Amoy / EITI / UNGM / GDELT / BigQuery / GitHub mirror / Forgejo (self-hosted on Hetzner N02) accounts.**
🟦 Architect. Each account uses YubiKey FIDO2 for primary auth + TOTP
for the `2FA-required` cases that don't support FIDO2.
**Unblocks:** M0b "all 22 API accounts live" deliverable.
**Source:** CORE_MVP §06 (Claude Code); §05 (cloud); §04 (sources 1-22);
HSK-v1 §05.7 (TOTP enrolment per account); EXEC-v1 §06.4 (MFA on all
critical accounts); D-013 Track F ("Domain + cloud accounts").

**1.2.10 Open Snyk Pro account; obtain `SNYK_TOKEN` for repo secrets.**
🟦 Architect.
**Unblocks:** [.github/workflows/security.yml](../.github/workflows/security.yml)
Snyk job (currently a no-op until token is set); blocks-on-Critical
gate per OPERATIONS §4.
**Source:** D-013 ("Snyk Pro account + `SNYK_TOKEN` repo secret"); D-013
deferred-list entry.

**1.2.11 Open Yubico Authenticator on architect's mobile device.**
🟦 Architect. Required for the per-account TOTP enrolment in HSK §05.7.
**Source:** HSK-v1 §05.7; HSK-v1 §06.2.

### 1.3 Financial provisioning

**1.3.1 Pay Mobilisation Tranche 1 ($25,000) on contract signature.**
🟦 Commissioning body (CONAC / partner) → architect.
**Unblocks:** M0a; pre-development engagement begins.
**Source:** CORE_MVP §12.1 (Pre-Development Mobilisation & Architecture
Fee), §14 M0a.

**1.3.2 Open VIGIL APEX SAS bank accounts in 3 locations (Cameroon FCFA, EU bank EUR, Polygon/USDC).**
🟦 Architect (with counsel).
**Unblocks:** quarterly compliance audit posture per TRUTH §H; mitigates
TTP-CMR / BEAC banking-system pressure (THREAT-MODEL §1).
**Source:** TRUTH §H (compliance + corporate audit); THREAT-MODEL-CMR §1
(BEAC banking pressure mitigation); CORE_MVP §09 (corporate structure).

**1.3.3 Fund Polygon mainnet wallet with ≥ $50 MATIC.**
🟦 Architect. Wallet seed lives only on YubiKey #1 (PIV slot 9C); same
seed on YubiKey #2 (provisioned in same session per HSK §05).
**Unblocks:** §3 joint action — `worker-anchor` deployment ceremony per
SRD §22.7 (Track A in EXEC §03.1, Phase 7 gate in EXEC §43.2).
**Source:** SRD-v3 §22 (anchor activation); HSK-v1 §04.7 (Polygon Wallet
For Blockchain Anchoring), §05.5 (PIV slot 9C wallet generation); CORE_MVP
§14 M1 ("VIGILAnchor.sol on Polygon"); EXEC-v1 §43.2 Phase 7; D-013
("Polygon mainnet contract deployment (M3 anchoring precondition)");
PHASE-1-COMPLETION §F6.

**1.3.4 Pay Mobilisation Tranche 2 ($25,000) on M0 verification.**
🟦 Commissioning body's technical reviewer.
**Unblocks:** Week 1 development begins.
**Source:** CORE_MVP §14 M0b ("MOBILISATION TRANCHE 2 - M0 Verified").

**1.3.5 Reserve Phase 2 Retention Incentive ($50,000) payable to VIGIL APEX SAS on full M4 acceptance.**
🟦 Commissioning body.
**Unblocks:** Phase 2 funding decision.
**Source:** CORE_MVP §14 (Phase 2 reservations not in MVP total); CORE_MVP
§12 retention instrument.

**1.3.6 Open monthly retainer ($25K/mo × 6 = $150K) for the Technical Director after M0 verification.**
🟦 Commissioning body.
**Source:** CORE_MVP §14 (Professional Services line); CORE_MVP §12.

**1.3.7 Engage CONAC-seconded analyst part-time ($2,500/mo × 6 = $15K).**
🟦 CONAC + architect.
**Unblocks:** M3 deliverable ("CONAC analyst onboarded"); §15 of CORE_MVP
governance (Pillar 0 — Analyst Review).
**Source:** CORE_MVP §14 Professional Services, §15 Pillar 0.

### 1.4 Legal + regulatory posture (Track C in EXEC §03.1)

**1.4.1 Identify Cameroonian legal counsel; book initial consultation.**
🟦 Architect. Day 2-5 of EXEC-v1 §46.4 first 14-day list.
**Unblocks:** ANTIC declaration filing (§1.4.2); CONAC engagement-letter
review (§1.4.4); the "involuntary cessation" envelope (EXEC §34.5).
**Source:** EXEC-v1 §46.4 (next 14-day list); EXEC-v1 §16 (legal posture);
W-23 (no ANTIC declaration); D-013 ("ANTIC declaration").

**1.4.2 File ANTIC declaration under Loi N° 2010/021 before Phase 1 ingestion of personal data.**
🟦 Architect + counsel.
**Unblocks:** Phase 1 personal-data ingestion (today the platform runs
on public-data only; ANTIC ack moves the frontier).
**Source:** TRUTH §H ("Cameroonian regulator declaration"); W-23 (no
ANTIC declaration); EXEC-v1 §16.2 (the four legal regimes); D-013
deferred / Track F.

**1.4.3 Register VIGIL APEX SAS under Cameroon Startup Act.**
🟦 Architect + counsel.
**Unblocks:** M0b deliverable ("VIGIL APEX SAS registered"); contractual
counterparty for CONAC engagement letter.
**Source:** TRUTH §H (Corporate entity); CORE_MVP §09; §14 M0b; EXEC-v1
§16.4.

**1.4.4 Sign architect ↔ SAS engagement letter; sign IP assignment + governance charter.**
🟦 Architect.
**Unblocks:** M0a; payment-schedule countersignature.
**Source:** CORE_MVP §14 M0a (deliverables list).

**1.4.5 Draft + counter-sign CONAC engagement letter per EXEC §15.**
🟦 Architect → CONAC. Draft uses the §15.3 letter template.
**Unblocks:** Phase 6 institutional gate (EXEC §43.2); M3 deliverable
("CONAC SFTP referral tested"); the format-adapter version negotiation
(W-25 institutional half).
**Source:** EXEC-v1 §15 (CONAC engagement letter); W-25 (CONAC delivery
format institutional half); D-013 ("CONAC engagement letter (W-25
institutional half)"); TAL-PA Doctrine §10 (institutional commitments
to CONAC); PHASE-1-COMPLETION §F3.

**1.4.6 Choose format-adapter Plan B target (Cour des Comptes recommended).**
🟦 Architect + counsel. Resolve TRUTH §L Q6.
**Unblocks:** §3 joint — agent populates `recipient_body_name` routing
defaults for Cour des Comptes per DECISION-010.
**Source:** TRUTH §L Q6 (open question); D-010 (per-body routing); W-25
(Plan B recipient).

**1.4.7 Engage MINFI on the pre-disbursement scoring API (Phase 1 test, Phase 2 MOU).**
🟦 Architect + MINFI.
**Unblocks:** M3 deliverable ("Pre-payment scoring API to MINFI tested");
Phase 8 institutional gate (EXEC §43.2 Phase 8).
**Source:** SRD-v3 §26 (MINFI integration); CORE_MVP §14 M3; EXEC-v1
§43.2 Phase 8.

**1.4.8 Choose hosting jurisdiction (Hetzner Falkenstein vs OVH Strasbourg).**
🟦 Architect. Resolve TRUTH §L Q3.
**Unblocks:** M0b account provisioning §1.2.8.
**Source:** TRUTH §L Q3; D-001 (recorded as Hetzner — confirm or
supersede); EXEC-v1 §05 (hosting decision matrix).

**1.4.9 Choose off-jurisdiction safe-deposit-box city (Geneva / Lisbon / Zurich).**
🟦 Architect. Resolve TRUTH §L Q5; open the box.
**Unblocks:** §2 ceremony — sealing of the 9th deep-cold YubiKey + Vault
Shamir backup envelopes (W-08); resolves Vault Shamir distribution
target #5 in `docs/runbooks/vault-shamir-init.md` step 4.
**Source:** TRUTH §L Q5 (open question); W-08 (OpenPGP no break-glass);
HSK-v1 §08.5 (Both Keys Lost simultaneously); D-013 ("Off-jurisdiction
safe-deposit-box (W-08; TRUTH §L Q5)"); PHASE-1-COMPLETION §F8.

**1.4.10 Confirm operational domain choice between `vigil.gov.cm` and `vigilapex.cm`.**
🟦 Architect → CONAC liaison (slow path) OR architect-direct (fast path
via Gandi, currently assumed in TRUTH §F). Resolve TRUTH §L Q4.
**Source:** TRUTH §L Q4; SRD-v3 §06.1; CORE_MVP §05.2; EXEC-v1 §06.1.

**1.4.11 Submit Planet NICFI MOU to Norway International Climate and Forest Initiative.**
🟦 Architect. ~3-week review.
**Unblocks:** §3 joint — agent flips `PLANET_NICFI_ENABLED=true` and
populates `PLANET_API_KEY` in Vault, activating Phase-1 close-view
satellite verification.
**Source:** D-013 deferred ("NICFI MOU submission"); D-010 close-view
provider selection; PHASE-1-COMPLETION §F (NICFI MOU); `.env.example`
line 393 (`PLANET_API_KEY=PLACEHOLDER`).

**1.4.12 Defer Maxar / Airbus / SkyFi commercial-imagery procurement until Phase 2 budget approved.**
🟦 Architect. Currently feature-flagged off (`MAXAR_API_KEY=PLACEHOLDER`,
`AIRBUS_API_KEY=PLACEHOLDER`).
**Source:** D-010 (Maxar / Airbus gated off); ROADMAP Phase 2; CORE_MVP
§04 sources 14-16; PHASE-1-COMPLETION §F.

### 1.5 Council (5 pillars + analyst) formation (Track B in EXEC §03.1)

**1.5.1 Identify candidate for the governance pillar.**
🟦 Architect. Use EXEC §10.2 candidate-identification sources; complete
the §10.3 candidate worksheet; do not yet approach.
**Unblocks:** §1.5.6 first-contact letter.
**Source:** EXEC-v1 §08-09 (council "right-five" definition);
§10 (candidate identification); §09.2 (governance pillar role);
TRUTH §D (5 pillars); CORE_MVP §15 governance architecture; D-013 Track
F ("Council formation (5 pillars)").

**1.5.2 Identify candidate for the judicial pillar.**
🟦 Architect.
**Source:** EXEC-v1 §09.3; CORE_MVP §15 (Pillar 1 — Tribunal Criminel
Spécial).

**1.5.3 Identify candidate for the civil-society pillar.**
🟦 Architect.
**Source:** EXEC-v1 §09.4; CORE_MVP §15 (Pillar 4 — Cameroon Bar
Association delegate).

**1.5.4 Identify candidate for the audit pillar.**
🟦 Architect.
**Source:** EXEC-v1 §09.5; CORE_MVP §15 (Pillar 3 — ANIF Financial
Intelligence).

**1.5.5 Identify candidate for the technical pillar.**
🟦 Architect (typically self until backup architect named).
**Source:** EXEC-v1 §09.6; CORE_MVP §15 (Pillar 5 — VIGIL APEX Technical
Director).

**1.5.6 Send first-contact letter to each named candidate per EXEC §11 template.**
🟦 Architect.
**Unblocks:** §1.5.7 (post-acceptance written commitment).
**Source:** EXEC-v1 §11 (first conversation), §11.2 (sample opening
dialogue), §11.5 (one-page brief template).

**1.5.7 Receive signed written commitment letter from each accepting candidate per EXEC §12.**
🟦 Each council member.
**Unblocks:** Phase 1 institutional precondition (EXEC §43.2: "≥ 2 of 5
named"); §1.5.8 ceremony.
**Source:** EXEC-v1 §12 (written commitment); §12.2 letter template.

**1.5.8 Hold the council formation ceremony (EXEC §13).**
🟦 Architect + 5 members.
**Unblocks:** §2.5 YubiKey enrolment per pillar; §3.5 first dry-run vote.
**Source:** EXEC-v1 §13 (ceremony — when, format, what is decided,
script); CORE_MVP §15 (governance architecture).

**1.5.9 Identify backup architect (W-17); negotiate ~€400/month retainer; sign engagement letter.**
🟦 Architect.
**Unblocks:** Phase 1 institutional precondition; §2.6 Vault Shamir
share custody; OPERATIONS §10 emergency repo access; HSK §08.5 break-
glass for both keys lost.
**Source:** TRUTH §D ("Backup architect: Named individual with paid
retainer, signed letter before M0c"); W-17 (backup architect specced
but never named); EXEC-v1 §32 (backup architect role); OPERATIONS §10;
D-013 ("Backup architect (W-17)"); PHASE-1-COMPLETION §F2.

### 1.6 Calibration seed (Track D in EXEC §03.1) — ⬛ deferred to M2 exit by spec

**1.6.1 Open the calibration seed CSV at `personal/calibration-seed/seed.csv` (architect-write-only).**
🟦 Architect.
**Source:** EXEC-v1 §22.1 (where it lives); §22.2 (CSV column schema);
W-16 (Calibration seed chicken-and-egg, deferred to M2 exit per spec).

**1.6.2 Research + grade ≥ 30 historical CONAC-published cases per EXEC §25 protocol.**
🟦 Architect (agent assists with raw research per §25.2 sample prompt).
**Unblocks:** Phase 9 institutional gate (EXEC §43.2 Phase 9); §3.7 first
reliability-band run; AI Safety Doctrine §A.6 quarterly calibration audit
producing meaningful output.
**Source:** EXEC-v1 §20-25 (calibration); §21 (sources for Cameroonian
historical procurement cases); §22 (CSV schema); §23 (evidence kinds);
§25 (cadence + sample agent prompt); W-16; CORE_MVP §17 metrics (ECE
< 5%); AI-SAFETY-DOCTRINE-v1 §A.6; D-013 ("Calibration seed (W-16)");
PHASE-1-COMPLETION §F7.

### 1.7 Documentation discipline + Phase 0 sign-off (already FINAL)

**1.7.1 Phase 0 dry-run sign-off — `docs/decisions/DRY-RUN-DECISION.md` Status: GO.**
🟩 Done — committed 2026-04-28.
**Source:** EXEC-v1 §28-30 (Phase 0 dry-run); CLAUDE.md phase gates
(Phase 0 closed); W-26 (no formal Phase-0 dry-run sign-off — fixed).

**1.7.2 Complete EXEC §38 first-20-decisions worksheet; commit each to `docs/decisions/log.md`.**
🟦 Architect. Day 7-14 of EXEC §46.4.
**Source:** EXEC-v1 §38 (first 20 decisions); §37 (decision-log
discipline).

---

## Section 2 — Architect actions during M0 mobilisation (single-day ceremonies + same-week setup)

These are the ceremonies and one-shot configurations that happen during
the M0 window (after Tranche 1, before Week 1 development begins). Most
are HSK-driven; some originate in EXEC + the Vault Shamir runbook.

### 2.1 YubiKey provisioning ceremony — HSK §05 (single working day, both keys at once)

**2.1.1 Initial inspection + firmware check on both YubiKey #1 and YubiKey #2.**
🟧 Architect. Verify firmware ≥ 5.7.x; record serials.
**Source:** HSK-v1 §05.2; EXEC-v1 §04.3 step 4-5.

**2.1.2 Disable unused applets on both keys.**
🟧 Architect.
**Source:** HSK-v1 §05.3.

**2.1.3 Set PIV PIN, PUK, and management key on both keys.**
🟧 Architect. PIN length + composition per HSK §07.1.
**Source:** HSK-v1 §05.4, §07.1-07.5.

**2.1.4 Generate the Polygon wallet on YubiKey #1 (PIV slot 9C); transfer same secret to YubiKey #2's slot 9C.**
🟧 Architect.
**Unblocks:** §3.1 worker-anchor deployment ceremony (the wallet is the
committer for VIGILAnchor.sol).
**Source:** HSK-v1 §05.5; §04.7; SRD-v3 §17.6 (Polygon wallet recovery
via Shamir 3-of-5).

**2.1.5 Generate the OpenPGP master key on-card on YubiKey #1; transfer subkeys to YubiKey #2.**
🟧 Architect. ed25519 sign + cv25519 encrypt; expiry 5 years; record
fingerprint on paper, sign across the print, deposit in safe.
**Unblocks:** §2.4 PGP key exchange with each receiving body; §3.2
GPG-signed dossier delivery.
**Source:** HSK-v1 §05.6; §04.5 (GPG signing of every dossier); HSK-v1
§10.2 (replacement provisioning); CORE_HSK §05.6 (line 575 sample
sequence with detailed sub-procedure in Appendix C).

**2.1.6 Enrol FIDO2 credentials on both keys for each platform account.**
🟧 Architect. Approximately 10-15 accounts (Anthropic, AWS, Hetzner,
Cloudflare, GitHub, M365, Synology, the SAS bank, accounting tool,
OpenCorporates, Maxar/SkyFi/Planet dashboards, etc.).
**Source:** HSK-v1 §05.7; §04.6 (Two-Factor Authentication For All
Platform Accounts).

**2.1.7 Enrol TOTP secrets on both keys for each web account that uses TOTP (10-15 accounts).**
🟧 Architect.
**Source:** HSK-v1 §05.7 (TOTP secrets enrolment).

**2.1.8 Configure BitLocker on the MSI Titan with TPM 2.0 + YubiKey-PIN protector.**
🟧 Architect. The 48-character recovery key sealed in the fireproof safe;
second copy in M365 enterprise account.
**Source:** HSK-v1 §05.9; §04.1; TRUTH §B (Disk encryption: LUKS2 +
clevis + Tang on Synology + YubiKey FIDO2).

**2.1.9 Configure LUKS2 + clevis (Tang on Synology + YubiKey FIDO2 dual-factor).**
🟧 Architect. The Linux-side equivalent of §2.1.8 — boot unlock via
clevis bind to Tang + YubiKey.
**Source:** TRUTH §B (W-01 fix); W-12 (Vault Shamir storage on YubiKey
challenge-response slot mis-specified — age-plugin-yubikey wired to PIV
slot 9d); `infra/host-bootstrap/04-clevis-luks-bind.sh`.

**2.1.10 Configure Vault Shamir 3-of-5 unseal share.**
🟧 Architect (with backup architect as witness).
**Unblocks:** §3.4 first Vault unseal at production boot; M1 Vault
operational.
**Source:** HSK-v1 §05.10 (Configure Vault Unseal Share); §04.4 (Vault
unsealing); SRD-v3 §17.6; W-12 (age-plugin-yubikey to PIV slot 9d, NOT
challenge-response); BUILD-COMPANION-v1 §"Vault Shamir initialisation
ceremony"; `docs/runbooks/vault-shamir-init.md` (full 7-step procedure).

**2.1.11 Run the verification battery on both keys.**
🟧 Architect.
**Source:** HSK-v1 §05.11.

**2.1.12 Sign the provisioning attestation document.**
🟧 Architect (counter-signed by backup architect when present).
**Source:** HSK-v1 §05.12.

### 2.2 Polygon-signer YubiKey (the third-purpose key)

**2.2.1 Provision the polygon-signer YubiKey 5C NFC (the 5C variant; locked behind a physical safe).**
🟧 Architect. Same provisioning sequence as §2.1, but only PIV slot 9c
is used (secp256k1 wallet); FIDO2 + OpenPGP slots are unused.
**Unblocks:** Phase 7 institutional gate (EXEC §43.2 Phase 7); §3.1
contract deployment ceremony (the polygon-signer key signs the deploy
tx + every subsequent VIGILAnchor.commit and VIGILGovernance vote tx).
**Source:** TRUTH §E (8 keys = 5 council + 1 architect + 1 polygon-signer

- 1 spare); HSK-v1 §05.5 (PIV slot 9C); EXEC-v1 §04.2 (model selection —
  5C NFC for polygon signer); SRD-v3 §17.7 (Unix-socket signer adapter);
  CORE_MVP §14 M1 (VIGILAnchor.sol on Polygon); D-013 Track F ("Polygon
  mainnet contract deployment").

### 2.3 Spare + deep-cold YubiKey (W-08 break-glass)

**2.3.1 Provision the 8th YubiKey as the on-island spare (replacement-ready clone of YK-01 / YK-02).**
🟧 Architect.
**Source:** TRUTH §E (8 keys allocation); HSK-v1 §10.2 (Replacement
Provisioning).

**2.3.2 Provision a 9th YubiKey holding the identical OpenPGP master key; seal in the off-jurisdiction safe-deposit-box.**
🟧 Architect. Box selection per §1.4.9 above.
**Unblocks:** Break-glass for both keys lost simultaneously (HSK §08.5);
W-08 fix.
**Source:** TRUTH §E ("Deep-cold backup: 9th YubiKey holding identical
OpenPGP master key, sealed in off-jurisdiction safe deposit box"); W-08;
HSK-v1 §08.5; D-013 Track F.

### 2.4 PGP key exchange with each receiving body (HSK §04.5 + DECISION-010)

**2.4.1 Send architect's GPG public key (fingerprint from §2.1.5) to CONAC.**
🟦 Architect. Method: paper printout signed across the print, delivered
in person at the §1.4.5 engagement-letter signing OR by encrypted
courier; CONAC adds the key to the CONAC OpenPGP keyring.
**Unblocks:** CONAC verification of every signed dossier on receipt;
M3 deliverable ("CONAC SFTP referral tested"); Phase 6 institutional
gate.
**Source:** HSK-v1 §04.5 ("The architect's GPG public key is on the
CONAC OpenPGP keyring; CONAC verifies the signature on receipt"); EXEC-v1
§15 (CONAC engagement letter); CORE_MVP §14 M3 (CONAC SFTP referral
tested); W-25 (CONAC delivery format institutional half).

**2.4.2 Send architect's GPG public key to Cour des Comptes (DECISION-010 Plan B recipient).**
🟦 Architect.
**Unblocks:** §3.6 Cour-des-Comptes SFTP delivery target activation;
TRUTH §L Q6 resolution.
**Source:** D-010 (Plan B recipient); HSK-v1 §04.5 (key-exchange protocol
generalises beyond CONAC); TRUTH §G (Plan B recipient = Cour des
Comptes); TRUTH §L Q6.

**2.4.3 Send architect's GPG public key to MINFI (for the pre-disbursement scoring API path).**
🟦 Architect.
**Source:** SRD-v3 §26 (MINFI integration); D-010 (per-body routing).

**2.4.4 Send architect's GPG public key to ANIF (for AML / PEP envelope path).**
🟦 Architect.
**Source:** SRD-v3 §28.7 (ANIF AML / PEP); D-010 (per-body routing).

### 2.5 Council-side YubiKey enrolment (Track B + Track A intersection)

**2.5.1 YubiKey provisioning ceremony for each of the 5 council members.**
🟦 Architect (as enrolment officer) + each council member in person.
Same procedure as HSK §05 for the architect, scoped to the council
member's required slots: FIDO2 (WebAuthn against the dashboard's
Keycloak realm) + PIV slot 9c (secp256k1 for on-chain vote signing).
**Unblocks:** Phase 1 institutional gate (≥ 2 of 5 named, plus key in
hand); Phase 5 institutional gate (all 5 enrolled); §3.5 first dry-run
vote on Polygon Amoy testnet.
**Source:** HSK-v1 §05 (procedure); HSK-v1 §10 (replacement / annual
rotation); EXEC-v1 §13 (council formation ceremony); CORE_MVP §14 M4
("All 5 governance council members onboarded with hardware keys");
TRUTH §D + §E; D-013 Track F ("Council formation").

### 2.6 Vault Shamir share distribution

**2.6.1 Distribute Vault Shamir share #1 → architect's primary safe (Yaoundé).**
🟦 Architect.
**Source:** `docs/runbooks/vault-shamir-init.md` step 4.

**2.6.2 Distribute share #2 → architect's secondary safe (off-site, EU jurisdiction).**
🟦 Architect.
**Source:** ibid.

**2.6.3 Distribute share #3 → backup architect (W-17, after §1.5.9 retainer signed).**
🟦 Backup architect.
**Source:** ibid.; OPERATIONS §9.

**2.6.4 Distribute share #4 → council pillar 1 (after §2.5.1 enrolment).**
🟦 Council member 1.
**Source:** ibid.

**2.6.5 Distribute share #5 → off-jurisdiction safe-deposit-box (W-08 deep-cold; co-located with the 9th YubiKey from §2.3.2).**
🟦 Architect.
**Source:** ibid.; W-08; HSK-v1 §08.5.

### 2.7 M0 institutional / contractual deliverables (CORE_MVP §14 M0a + M0b)

**2.7.1 Counter-sign Statement of Work (SOW) on contract execution.**
🟦 Architect + commissioning body.
**Source:** CORE_MVP §14 M0a.

**2.7.2 Counter-sign IP assignment.**
🟦 Architect → SAS.
**Source:** CORE_MVP §14 M0a.

**2.7.3 Counter-sign governance charter.**
🟦 Architect + commissioning body.
**Source:** CORE_MVP §14 M0a; §15 governance architecture.

**2.7.4 Counter-sign payment schedule (the §14 milestone table itself).**
🟦 Architect + commissioning body.
**Source:** CORE_MVP §14 M0a.

**2.7.5 Draft Phase-2 retention instrument ($50K Phase-2 retention payable on full M4 acceptance).**
🟦 Architect + counsel.
**Source:** CORE_MVP §12 (retention instrument), §14 M0a.

**2.7.6 Hold introductory meeting with CONAC; minute it.**
🟦 Architect.
**Unblocks:** M0b deliverable verification.
**Source:** CORE_MVP §14 M0b ("intro meetings with CONAC + MINFI
minuted"); EXEC-v1 §15 (CONAC engagement letter strategy).

**2.7.7 Hold introductory meeting with MINFI; minute it.**
🟦 Architect.
**Source:** CORE_MVP §14 M0b.

**2.7.8 Sign the SRD (commissioning body's reviewer countersigns).**
🟦 Architect + commissioning body.
**Unblocks:** Mobilisation Tranche 2 release.
**Source:** CORE_MVP §14 M0b ("Signed SRD").

**2.7.9 Verify all 22 API accounts live (per §1.2 above) for the M0b sign-off.**
🟦 Architect (with reviewer verification).
**Source:** CORE_MVP §14 M0b ("all 22 API accounts live").

**2.7.10 Verify hardware specs delivered with 3 supplier quotes (incl. Synology authorised distributor list) for M0b sign-off.**
🟦 Architect.
**Source:** CORE_MVP §14 M0b.

### 2.8 Drill calendar — install the recurring schedule at M0c (HSK §13)

**2.8.1 Schedule the weekly backup-key health check (Friday ~5 PM, 5 minutes).**
🟦 Architect.
**Source:** HSK-v1 §13.1.

**2.8.2 Schedule the quarterly full-failover drill (last Friday of each quarter, ~90 minutes).**
🟦 Architect (joint with backup architect when named).
**Source:** HSK-v1 §13.2; OPERATIONS §9 (quarterly DR rehearsal);
`docs/runbooks/dr-rehearsal.md`.

**2.8.3 Schedule the annual full rotation + recovery drill (anniversary of M0 ceremony, ~half day).**
🟦 Architect (joint with backup architect + 1 council member).
**Source:** HSK-v1 §13.3; HSK-v1 §10.4 (Annual Rotation Policy).

---

## Section 3 — Joint architect-and-agent actions (architect unblocks → agent executes)

These items are paired: the architect performs an institutional / hardware
/ financial action that lifts a Track-F blocker, then the build agent
runs the technical step that depends on it. Each entry names the
unblocking architect action AND the downstream agent action.

### 3.1 Polygon mainnet contract deployment (SRD §22.7 ceremony)

**Architect prerequisite:** §1.3.3 wallet funded + §2.2.1 polygon-signer
YubiKey provisioned + §1.2.6 Alchemy / Infura RPC URL provisioned.

**3.1.1 Deploy `VIGILAnchor.sol` + `VIGILGovernance.sol` to Polygon Amoy testnet.**
🟨 Agent runs `pnpm --filter contracts hardhat run scripts/deploy.ts --network amoy`. Architect funds the polygon-signer with Amoy MATIC; verifies tx confirmations on amoy.polygonscan.com.
**Source:** SRD-v3 §22.7 (deployment ceremony); EXEC-v1 §43.2 Phase 7;
`contracts/scripts/deploy.ts`; CORE_MVP §14 M1 (VIGILAnchor.sol on
Polygon); BUILD-COMPANION-v1 §"VIGILAnchor and VIGILGovernance deployed
and verified on Polygon mainnet".

**3.1.2 Deploy both contracts to Polygon mainnet (after testnet ceremony green).**
🟨 Agent runs the same script with `--network polygon`. Architect funds
mainnet wallet; tx confirmations on polygonscan.com.
**Source:** SRD-v3 §22.7; SRD-v3 line 550 ("Migration to Polygon mainnet
at end of week 14"); CORE_MVP §14 M3 ("CONAC SFTP referral tested"
depends on contracts live); SRD-v3 §AT-M3-01 ("VIGILAnchor and
VIGILGovernance contracts deployed to Polygon mainnet, source verified
on PolygonScan, deployment record in /infra/polygon-deploy.json").

**3.1.3 Verify both contracts on PolygonScan.**
🟨 Agent — handled by `scripts/deploy.ts` if `POLYGONSCAN_API_KEY`
present. Architect provides the API key.
**Source:** SRD-v3 §AT-M3-01; `contracts/scripts/deploy.ts:51-58`.

**3.1.4 Update `.env.example` + Vault → set `POLYGON_ANCHOR_CONTRACT` and `POLYGON_GOVERNANCE_CONTRACT` from `PLACEHOLDER_DEPLOYED_AT_M{1,3}` to the real addresses.**
🟨 Agent edits `.env.example`; architect populates Vault paths.
**Source:** `.env.example` lines 93-94; D-013 Track F ("Polygon mainnet
contract deployment"); `apps/worker-anchor/src/index.ts:48-52` (refusal-
to-boot guard).

**3.1.5 Fix VIGILGovernance ABI drift in `packages/governance/src/abi.ts`: add the missing `bytes32 salt` argument to `openProposal`, the `commitProposal(bytes32 commitment)` function, the `ProposalCommitted` event, the `REVEAL_DELAY` constant, and the `commitments` accessor.**
🟨 Agent — once contract addresses are real and the write path is needed,
realign the ABI to the on-chain commit-reveal flow.
**Source:** D-013 (drift identified during smart-contract status report);
`packages/governance/src/abi.ts:17` (current 2-arg signature);
`contracts/contracts/VIGILGovernance.sol:172-212` (on-chain 3-arg flow).

**3.1.6 Record contract addresses in `TRUTH.md` Section K + decision-log entry (DECISION-014 or successor).**
🟨 Architect signs the decision-log entry; agent drafts.
**Source:** TRUTH §K (document archive integrity); SRD-v3 §22.8.

**3.1.7 First testnet anchor commit + first mainnet anchor commit.**
🟨 Agent runs `worker-anchor` against the testnet first; architect
verifies the Anchored event on amoy.polygonscan.com; then the same on
mainnet.
**Source:** SRD-v3 §22.7; CORE_MVP §14 M3.

### 3.2 Dossier-delivery production cutover

**3.2.1 Once §1.4.5 CONAC engagement letter signed → populate `infra/sources.json` `delivery_targets[]` for CONAC with real host + port + path-pattern + signer-pubkey-path.**
🟨 Architect supplies CONAC SFTP credentials + host fingerprint via Vault;
agent edits `infra/sources.json`.
**Source:** D-010 (per-body delivery format-adapter dispatch);
`apps/worker-conac-sftp/src/index.ts:104` (refuse-to-boot if PLACEHOLDER);
W-25 (format-adapter layer); CORE_MVP §14 M3.

**3.2.2 Once §1.4.6 Plan B recipient confirmed → populate `delivery_targets[]` for Cour des Comptes.**
🟨 Architect → agent.
**Source:** D-010; TRUTH §G; TRUTH §L Q6.

**3.2.3 Once §1.4.7 MINFI engagement letter signed → populate `delivery_targets[]` for MINFI.**
🟨 Architect → agent.
**Source:** SRD-v3 §26.

**3.2.4 Once ANIF MOU signed (Phase 2 reservation) → populate `delivery_targets[]` for ANIF.**
🟨 Architect → agent.
**Source:** SRD-v3 §28.7; D-008 (anif-amlscreen MOU-gated).

**3.2.5 First end-to-end CONAC SFTP delivery test against staging SFTP.**
🟨 Architect provides staging credentials → agent runs `scripts/e2e-fixture.sh`.
**Source:** CORE_MVP §14 M3 ("CONAC SFTP referral tested"); D-013 (E2E
fixture).

**3.2.6 CONAC verifies the architect's GPG signature on the staged dossier (PGP key-exchange round-trip — depends on §2.4.1).**
🟦 CONAC operations team.
**Source:** HSK-v1 §04.5 ("CONAC verifies the signature on receipt").

### 3.3 Council enrolment + first vote

**3.3.1 Once §1.5.7 written commitments received → agent populates `governance.member` Drizzle table with the 5 enrolled members; loads each member's WebAuthn credential.**
🟨 Architect runs the §2.5.1 enrolment ceremony; agent runs the
`infra/host-bootstrap` script that posts each member's WebAuthn
attestation to the dashboard's enrolment endpoint.
**Source:** EXEC-v1 §13 ceremony script; W-10 fix (WebAuthn fallback
shipped per D-008 C5b); D-013 Track F ("Council formation").

**3.3.2 First dry-run vote on Polygon Amoy testnet (dummy proposal).**
🟨 Architect coordinates the 5 members; agent prepares the test proposal.
**Source:** CORE_MVP §14 M4 ("All 5 governance council members onboarded
with hardware keys"); SRD-v3 §22.7; CORE_MVP §15 governance.

**3.3.3 First production vote on Polygon mainnet (real proposal, post-mainnet-deploy).**
🟦 Architect + council.
**Source:** SRD-v3 §22.8 (deployment ceremony); CORE_MVP §15.

### 3.4 Vault unseal at production boot

**3.4.1 Once §2.6 share distribution complete → first production Vault unseal (3-of-5 quorum) at Hetzner host.**
🟨 Architect + at least 2 of {backup architect, council pillar 1, off-
jurisdiction box if accessible}; agent runs `vault operator unseal -`
loop on host.
**Unblocks:** every container that reads a secret from Vault — all 22
adapters' API keys, Anthropic key, Polygon RPC URL, GPG signing key
materialisation.
**Source:** HSK-v1 §05.10; SRD-v3 §17.6; W-12 fix; `docs/runbooks/vault-
shamir-init.md` step 5.

### 3.5 AI safety + audit-anchor activation (DECISION-011 + DECISION-012)

**3.5.1 Once §1.6.2 calibration seed loaded (≥30 cases) → first reliability-band run (AI Safety Doctrine §A.6 quarterly cadence).**
🟨 Architect populates `personal/calibration-seed/seed.csv` + commits to
`calibration.entry`; agent's `calibration-audit-runner` cron produces
the first non-empty band table.
**Source:** AI-SAFETY-DOCTRINE-v1 §A.6 (quarterly calibration audit);
EXEC-v1 §43.2 Phase 9; CORE_MVP §17 (ECE < 5%); D-011; W-16.

**3.5.2 Architect chooses 32-byte hex `AUDIT_PUBLIC_EXPORT_SALT`; commits to Vault path `tal-pa/public-export-salt-q{N}`.**
🟨 Architect → agent. Per-quarter rotation.
**Unblocks:** First quarterly TAL-PA CSV export to IPFS (currently
refused-at-boot when salt is `PLACEHOLDER`).
**Source:** D-012 (TAL-PA Doctrine §8); `apps/adapter-runner/src/triggers/
quarterly-audit-export.ts:83-87`; TAL-PA-DOCTRINE-v1 §5.1 (PII salting
policy).

**3.5.3 Promote DECISION-012 (TAL-PA) from PROVISIONAL to FINAL.**
🟨 Architect walks `docs/decisions/decision-012-readthrough-checklist.md`;
flips status; emits `decision.recorded` audit row through audit-bridge.
**Source:** D-012; `docs/decisions/decision-012-readthrough-checklist.md`;
D-013 deferred ("DECISION-012 promotion to FINAL").

**3.5.4 Promote DECISION-013 (post-DECISION-012 closure) from PROVISIONAL to FINAL.**
🟨 Architect walks the file list in D-013; signs.
**Source:** D-013 ("DECISION-013 promotion to FINAL").

**3.5.5 Native YubiKey PKCS#11 production signer integration (replace `DeterministicTestSigner`).**
🟨 Architect provides PKCS#11 path / module per HSK-v1 §05; agent
swaps the signer in `packages/audit-log/src/signer.ts` from the
deterministic test signer to a `YubikeyPkcs11Signer` implementation.
⬛ Deferred to M3-M4 by spec.
**Source:** D-012 ("does not wire the production YubiKey PKCS#11 signer");
HSK-v1 §05; W-10.

### 3.6 Satellite verification activation

**3.6.1 Once §1.4.11 NICFI MOU acknowledged → architect populates `PLANET_API_KEY` in Vault → agent flips `PLANET_NICFI_ENABLED=true`.**
🟨 Architect → agent.
**Unblocks:** Phase-1 close-view satellite verification (currently falls
back to Sentinel-2 alone).
**Source:** D-010 (close-view provider); D-013 deferred; `.env.example`
lines 393-395; `apps/worker-satellite/src/vigil_satellite/stac.py`.

**3.6.2 Once §1.4.12 Maxar / Airbus procurement approved (Phase 2) → populate corresponding API keys; agent activates the feature flags.**
🟨 ⬛ Phase 2.
**Source:** D-010 (gated off pending procurement); ROADMAP Phase 2.

### 3.7 Bringing the platform up at the Hetzner host (M0c → M1)

**3.7.1 Once §1.1.4 + §1.2.8 Hetzner CPX31 provisioned → run host bootstrap scripts in order (`infra/host-bootstrap/01-...` through `13-...`).**
🟨 Architect (executes scripts on host) → agent (drafted scripts).
**Unblocks:** M1 acceptance (10 nodes running).
**Source:** CORE_MVP §14 M1; `infra/host-bootstrap/` directory tree.

**3.7.2 Run `pnpm compose:up` on the bootstrapped host; verify smoke checks.**
🟨 Architect → agent runs `scripts/smoke-stack.sh` (when implemented) +
`scripts/e2e-fixture.sh` against the live stack.
**Source:** D-013 (E2E fixture); PHASE-1-COMPLETION §C1 (compose smoke);
CORE_MVP §14 M1.

**3.7.3 Snapshot Replication active over WireGuard from primary site to remote replica site.**
🟨 Architect provisions remote-site WireGuard endpoint → agent (the
`infra/host-bootstrap/13-multi-site-replication.sh` already in tree).
**Source:** CORE_MVP §14 M1; TRUTH §B (NAS pair); HSK-v1 §04.2.

**3.7.4 First end-to-end fixture run against the live stack (Yaoundé GPS investment_project → satellite verification → finding → score → council vote → escalation → render → SFTP delivery → public verify).**
🟨 Architect provides credentials + signs council vote → agent runs.
**Source:** D-013 (manual fixture run); D-012 (manual fixture run in
doctrine §11 implementation index); `scripts/e2e-fixture.sh`.

### 3.8 CI / observability activation

**3.8.1 Once §1.2.10 `SNYK_TOKEN` set → Snyk CI job activates (currently a no-op).**
🟨 Architect → CI.
**Source:** D-013 deferred; `.github/workflows/security.yml`;
PHASE-1-COMPLETION §E1.

**3.8.2 Wire `INTEGRATION_DB_URL` in CI from a real Postgres service → CAS integration test runs against a live DB on every PR.**
🟨 Already wired in `.github/workflows/ci.yml`; first run pending an
actual PR with the test invoked.
**Source:** D-013; `packages/db-postgres/__tests__/audit-log-cas.test.ts`;
PHASE-1-COMPLETION §A5.

**3.8.3 Provision Grafana admin password + first dashboard imports (the 14 JSONs already in tree).**
🟨 Architect supplies Keycloak admin secret → agent's compose-up wires
the rest.
**Source:** D-013 (C4 Grafana provisioning); `infra/docker/grafana/`.

**3.8.4 Provision Falco alertmanager destination URL + first rule load.**
🟨 Architect → agent.
**Source:** D-013 (C5 Falco compose mount).

**3.8.5 Provision sentinel `SENTINEL_HELSINKI_URL`, `SENTINEL_TOKYO_URL`, `SENTINEL_NYC_URL` + first cron/timer activation.**
🟨 Architect (per §1.1.5) → agent (`vigil-sentinel-{tor,quorum}.timer`).
**Source:** D-013 (C3 + C6); TRUTH §B.

### 3.9 Documentation back-fill (architect prose into agent-generated skeletons)

**3.9.1 Fill the architect-prose sections of every pattern doc under `docs/patterns/` (LR reasoning, FP traps, calibration history per pattern).**
🟨 Architect prose → agent regenerates the auto-block on each pattern
change without overwriting the architect's sections.
**Source:** D-013 ("auto-generated artefacts ship with empty architect-
prose sections"); `scripts/generate-pattern-catalogue.ts` BEGIN/END auto-
generated tags.

**3.9.2 Fill the architect-prose sections of every worker runbook under `docs/runbooks/workers/` (boot sequence, common failures, paging policy, rollback) in BOTH FR and EN.**
🟨 Architect.
**Source:** D-013; `scripts/generate-worker-runbooks.ts`.

---

## Section 4 — Pure agent actions after Phase 1 closure

These items are reserved for after Phase 1 closes. They are either
documented as explicit Phase 2/3/4 reservations in ROADMAP, or as
recurring cadence work that the running platform produces, or as
already-deferred items per spec. None of these are required for Phase
1 acceptance.

### 4.1 Phase 2 — Production Hardening + MOU-Gated Escalation (months 7-12)

**4.1.1 Hyperledger Fabric multi-org rollout — CONAC + Cour des Comptes peers join.**
🟩 Agent. Single-peer Org1 already scaffolded; rollout = extending
`infra/docker/fabric/{configtx,crypto-config}.yaml`.
**Source:** ROADMAP Phase 2; TRUTH §B.2 (Phase-2 scaffold note); W-11 fix
(scaffolded, multi-org at Phase 2 entry); D-008 (Phase G of Phase-2 Tech
Scaffold).

**4.1.2 Fabric `audit-witness` chaincode multi-org endorsement policy.**
🟩 Agent.
**Source:** TRUTH §B.2; ROADMAP Phase 2.

**4.1.3 MOU-gated direct API ingestion — replaces SFTP scraping for MINFI / BEAC / ANIF.**
🟩 Agent (workers already coded). 🟦 Architect side: MOUs.
**Source:** ROADMAP Phase 2; D-008 (MOU-gated adapters list); CORE_MVP §15
(Pillar 3 — ANIF).

**4.1.4 Adapter self-healing in continuous CI mode (`worker-adapter-repair`).**
🟩 Already shipped per W-19 fix.
**Source:** ROADMAP Phase 2; W-19; D-008 (Phase H1-H3).

**4.1.5 Continuous calibration with > 200 ground-truth-labelled cases.**
🟩 Agent (test framework + coverage gate landed).
🟦 Architect: accumulates the seed as the platform runs.
**Source:** ROADMAP Phase 2; AI-SAFETY-DOCTRINE-v1 §A.6; W-14 (corpus
expansion ongoing toward 200-row target — already at 224 rows; the
production-finding seed is the long-tail).

**4.1.6 Full external pentest at production go-live ($18,000 reserved).**
🟦 Architect engages pentest firm. Agent supports with scope.
**Source:** ROADMAP Phase 2; CORE_MVP §14 Phase 2 reservations.

**4.1.7 ISO 27001 formal certification (auditor + 3-12 month engagement).**
🟦 Architect engages certification body.
**Source:** ROADMAP Phase 2; CORE_MVP §14 M4 ("ISO 27001 readiness report
delivered" is M4, certification itself is Phase 2).

**4.1.8 Phase 2 retention payment ($50,000) on full M4 acceptance.**
🟦 Commissioning body → SAS.
**Source:** CORE_MVP §14 (Phase 2 reservations not in MVP total).

**4.1.9 Native libykcs11 helper for council vote signing (W-10 deferred to M3-M4).**
🟩 Agent. Desktop OS-specific; per-platform bundles.
**Source:** W-10; D-008 (WebAuthn fallback shipped); D-013 deferred;
PHASE-1-COMPLETION §F.

**4.1.10 Cluster-detection pre-pass (Haiku-driven) — design landed; deferred until first 100 production findings exist.**
🟩 Agent.
**Source:** D-011 (cluster-detection pre-pass); decision-log line 2424
("deferred until first 100 production findings exist").

**4.1.11 `SafeLlmRouter` adoption across any future worker that calls `LlmRouter` directly.**
🟩 Agent. Currently `worker-counter-evidence` + `worker-entity` are
migrated; any new worker must wire through SafeLlmRouter.
**Source:** D-011; D-013 ("A2 SafeLlmRouter migration" — chokepoint
universal).

### 4.2 Phase 3 — Regional Federation (year 2)

**4.2.1 10 regional ingest nodes (one per Cameroon administrative region).**
🟩 Agent. Helm charts already scaffolded under `infra/k8s/charts/regional-
node/`.
🟦 Architect side: CEMAC funding ($1.2M-$1.8M); council 4-of-5
architectural-review vote (gate per ROADMAP Phase 3).
**Source:** ROADMAP Phase 3; TRUTH §B.3; `docs/PHASE-3-FEDERATION.md`;
`infra/k8s/charts/regional-node/values-<CODE>.yaml` (10 per-region values
files).

**4.2.2 Federated Vault PKI hierarchy.**
🟩 Already scaffolded.
**Source:** TRUTH §B.3 (1); `infra/host-bootstrap/13-vault-pki-
federation.sh`.

**4.2.3 Signed-envelope federation stream.**
🟩 Already shipped in `@vigil/federation-stream`.
**Source:** TRUTH §B.3 (2); `proto/federation.proto`; `packages/
federation-stream/`.

**4.2.4 Multi-site NAS failover chain (Yaoundé core ← regional NAS pulls).**
🟩 Already scaffolded.
**Source:** TRUTH §B.3 (3); `infra/host-bootstrap/13-multi-site-
replication.sh`.

**4.2.5 Council architectural-review gate (4-of-5 vote required).**
🟦 Council action; agent provides the evidence brief.
**Source:** ROADMAP Phase 3; TRUTH §B.3 (5);
`docs/institutional/council-phase-3-review.md`.

### 4.3 Phase 4 — Full Decentralisation with ZK-Proofs (year 3+)

**4.3.1 ZK-proof circuits for finding-validity (groth16 / PLONK on rapidsnark).**
🟩 Agent. Conditional on legal admissibility regime.
**Source:** ROADMAP Phase 4.

**4.3.2 Public verifier contract on Polygon (zk-proof verifier).**
🟩 Agent.
**Source:** ROADMAP Phase 4.

**4.3.3 IPFS pinning federation across council members + civil society.**
🟩 Agent.
**Source:** ROADMAP Phase 4.

**4.3.4 Multi-currency anchoring (Polygon + Arbitrum + Base, with majority-anchor consensus).**
🟩 Agent.
**Source:** ROADMAP Phase 4.

### 4.4 Recurring cadence (continuous-operation)

**4.4.1 Quarterly DR rehearsal per `docs/runbooks/dr-rehearsal.md`.**
🟩 Architect drives; agent provides `scripts/dr-restore-test.sh`.
**Source:** SRD-v3 §27 (DR plan); HSK-v1 §13.2; OPERATIONS §9; D-013
(B3).

**4.4.2 Quarterly TAL-PA anonymised CSV export to IPFS.**
🟩 Already automated by `runQuarterlyAuditExport` cron (`0 5 1 1,4,7,10 *`
Africa/Douala).
**Source:** D-012 (TAL-PA Doctrine §8); `apps/adapter-runner/src/triggers/
quarterly-audit-export.ts`.

**4.4.3 Quarterly AI-Safety reliability-band audit.**
🟩 Already automated by `calibration-audit-runner` cron (`0 4 1 1,4,7,10
*` Africa/Douala). Produces meaningful output once §1.6.2 seed is
loaded.
**Source:** D-011; AI-SAFETY-DOCTRINE-v1 §A.6;
`apps/adapter-runner/src/triggers/calibration-audit-runner.ts`.

**4.4.4 Quarterly per-quarter rotation of `AUDIT_PUBLIC_EXPORT_SALT`.**
🟦 Architect rotates the salt; agent reads from Vault on each quarterly
export run.
**Source:** TAL-PA-DOCTRINE-v1 §5.1; D-012.

**4.4.5 Annual YubiKey rotation policy (HSK §10.4).**
🟦 Architect drives; agent provides scripts (`packages/security` re-encrypt
share helper).
**Source:** HSK-v1 §10.4; SRD-v3 §17 (rotation cadence).

**4.4.6 Weekly backup-key health check (HSK §13.1).**
🟦 Architect.
**Source:** HSK-v1 §13.1.

**4.4.7 Daily nightly backup (`infra/host-bootstrap/10-vigil-backup.sh`).**
🟩 Already running via systemd timer at M0c install. Verifier:
`scripts/verify-backup-config.sh`.
**Source:** SRD-v3 §27; D-013 (C9).

**4.4.8 Daily Tor onion health probe (`vigil-sentinel-tor.timer`).**
🟩 Hourly cron; activates once §1.1.5 sentinel VPS provisioned.
**Source:** D-013 (C3); W-09; `infra/host-bootstrap/systemd/vigil-
sentinel-tor.timer`.

**4.4.9 Every-5-minute 2-of-3 sentinel-quorum probe.**
🟩 systemd timer.
**Source:** D-013 (C6); TRUTH §B.

**4.4.10 Hourly cross-witness audit-chain verifier (Postgres ↔ Polygon ↔ Fabric).**
🟩 Already running via `apps/audit-verifier`.
**Source:** SRD-v3 §22.5 (CT-01/02/03); TRUTH §B.2; W-11.

**4.4.11 Hourly Polygon Merkle batch anchor.**
🟩 `worker-anchor` cron. Activates once §3.1.4 contract address is real.
**Source:** SRD-v3 §22.3; D-012 (TAL-PA Doctrine §4.2); CORE_MVP §14 M1.

**4.4.12 5-second high-significance individual Polygon anchor fast-lane.**
🟩 `runHighSigAnchorLoop` per D-012.
**Source:** D-012; TAL-PA-DOCTRINE-v1 §4.2.

**4.4.13 5-minute anomaly evaluation by `worker-audit-watch` (10 deterministic rules).**
🟩 Already running.
**Source:** D-012 (TAL-PA Doctrine §7); TAL-PA-DOCTRINE-v1 §7.1.

**4.4.14 Weekly Renovate dependency PRs (Monday 05:00 Africa/Douala).**
🟩 Already configured; `renovate.json`.
**Source:** D-013 (E3); OPERATIONS §4.

**4.4.15 Daily Snyk + nightly SBOM generation.**
🟩 Daily 05:23 UTC + on every push.
**Source:** D-013 (E1 + E5); `.github/workflows/security.yml`.

**4.4.16 Quarterly TRUTH.md reconciliation; quarterly weakness-index reconciliation.**
🟩 Architect-driven; agent runs `scripts/audit-decision-log.ts`.
**Source:** OPERATIONS §5 (binding doc quarterly review per EXEC §43.4);
D-013 (B5).

**4.4.17 Anti-hallucination corpus expansion (W-14 ongoing).**
🟩 Agent grows the corpus as new failure modes are discovered.
**Source:** W-14; D-013; `packages/llm/__tests__/synthetic-
hallucinations.jsonl` (currently 224 rows).

**4.4.18 Anthropic SDK rev tracking via Renovate; architect review on each major.**
🟩 Renovate auto-PRs with `minimumReleaseAge: 3 days`; architect-review
label.
**Source:** D-013 (final isolated SDK bump pass); `renovate.json` rule
for `@anthropic-ai/sdk`.

**4.4.19 Quarterly review of EXEC-v1 + SRD-v3 + BUILD-COMPANION + HSK-v1 + AI-SAFETY-DOCTRINE-v1 + TAL-PA-DOCTRINE-v1 per EXEC §43.4.**
🟦 Architect.
**Source:** EXEC-v1 §43.4 (document update cadence).

### 4.5 Open feature work (not blocked by architect; not yet built)

**4.5.1 Operator UI for redaction approvals (Right-to-Erasure court-order workflow).**
🟩 Agent. The `audit.redaction` table is in place per D-012; the operator
UI is a separate plan.
**Source:** D-012 ("does not provide an operator UI for redaction
approvals"); D-013 deferred.

**4.5.2 TAL-PA: Hyperledger Fabric internal-chain wiring as `@vigil/fabric-anchor` adapter.**
🟩 Agent — Phase 2.
**Source:** D-012 ("does not replace Hyperledger Fabric for the internal
substrate"); ROADMAP Phase 2.

**4.5.3 Visual regression tests on the 19 dashboard pages (D7).**
🟩 Agent + a running dashboard.
**Source:** PHASE-1-COMPLETION §D7; D-013 deferred.

**4.5.4 Live-environment validation of D2 / D3 / D4 (Tor flow / SFTP delivery / federation stream E2E).**
🟩 Agent — runs against the live compose stack once §3.7.2 is up.
**Source:** D-013 deferred ("D2 / D3 / D4 / D7 require running services").

**4.5.5 Compose-stack smoke test (`scripts/smoke-stack.sh`) — referenced by PHASE-1-COMPLETION but the script does not yet exist.**
🟩 Agent (small).
**Source:** PHASE-1-COMPLETION §C1.

**4.5.6 M4 NAS failover drill — documented end-to-end.**
🟦 Architect drives; agent supports with `scripts/dr-restore-test.sh`.
**Source:** CORE_MVP §14 M4 ("Synology NAS remote-replica failover drill
completed and documented"); HSK-v1 §13.2.

**4.5.7 CONAC 3-day training delivery + bilingual operator manuals.**
🟦 Architect delivers; agent assists with FR + EN documentation
generation (worker runbooks already auto-generated; pattern catalogue
already auto-generated).
**Source:** CORE_MVP §11 (Institutional Engagement budget line); CORE_MVP
§14 M3 ("CONAC analyst onboarded"), M4 ("CONAC staff trained").

**4.5.8 Public transparency dashboard hardening (M4 deliverable).**
🟩 Agent. Already exists at `/public/audit` per D-012; M4 deliverable
includes additional public-facing surfaces.
**Source:** CORE_MVP §14 M4 ("Public transparency dashboard live").

**4.5.9 Targeted security audit (no critical/high unresolved) at M4.**
🟦 Architect engages pentest firm.
**Source:** CORE_MVP §14 M4.

**4.5.10 Load test SLAs met at M4.**
🟩 Agent runs test; architect signs off.
**Source:** CORE_MVP §14 M4; SRD-v3 Section 17 numerical targets.

### 4.6 Phase boundaries that are firmly out-of-scope (per ROADMAP)

These are not TODO items — they are explicit non-goals listed for
completeness so the architect can refuse scope-creep requests
referencing them.

- Autonomous enforcement (system never takes legal action; only routes
  evidence). Source: ROADMAP "Out of Scope (forever)".
- Predictive policing of individuals (system flags transactions, not
  people). Source: ibid.
- Real-time intervention in payment flow (MINFI API advises; never
  blocks). Source: ibid.
- Weaponisation against political opposition (council is the structural
  defence). Source: ibid.
- Replacement of human investigators. Source: ibid.

---

## Cross-reference index

| Citation                  | Where it lives in tree                                 |
| ------------------------- | ------------------------------------------------------ |
| CORE_MVP / MVP_SERVER §14 | `docs/archive/MVP_SERVER.docx`                         |
| CORE_HSK / HSK-v1         | `docs/source/HSK-v1.md`                                |
| EXEC-v1                   | `docs/source/EXEC-v1.md`                               |
| SRD-v3                    | `docs/source/SRD-v3.md`                                |
| BUILD-COMPANION-v1        | `docs/source/BUILD-COMPANION-v1.md`                    |
| BUILD-COMPANION-v2        | `docs/source/BUILD-COMPANION-v2.md`                    |
| AI-SAFETY-DOCTRINE-v1     | `docs/source/AI-SAFETY-DOCTRINE-v1.md`                 |
| TAL-PA-DOCTRINE-v1        | `docs/source/TAL-PA-DOCTRINE-v1.md`                    |
| TRUTH                     | `TRUTH.md`                                             |
| OPERATIONS                | `OPERATIONS.md`                                        |
| ROADMAP                   | `ROADMAP.md`                                           |
| THREAT-MODEL-CMR          | `THREAT-MODEL-CMR.md`                                  |
| CLAUDE.md                 | `CLAUDE.md`                                            |
| DECISION-NNN (D-NNN)      | `docs/decisions/log.md` (14 entries: D-000…D-013)      |
| W-NN (weakness)           | `docs/weaknesses/W-NN.md` (27 files) + `INDEX.md`      |
| PHASE-1-COMPLETION        | `docs/work-program/PHASE-1-COMPLETION.md`              |
| Pattern catalogue         | `docs/patterns/` (43 + index)                          |
| Worker runbooks           | `docs/runbooks/workers/` (40 + index)                  |
| Vault Shamir runbook      | `docs/runbooks/vault-shamir-init.md`                   |
| DR rehearsal runbook      | `docs/runbooks/dr-rehearsal.md`                        |
| PLACEHOLDER policy        | `docs/runbooks/placeholder-policy.md`                  |
| Threat-coverage matrix    | `docs/security/threat-coverage-matrix.md`              |
| DECISION-012 readthrough  | `docs/decisions/decision-012-readthrough-checklist.md` |

## How this list is to be used

- **Architect's daily / weekly cadence:** pick one item from §1 or §2 per
  available block; record progress in `docs/decisions/log.md` per
  OPERATIONS §7 + EXEC §37.
- **Joint actions in §3:** when an architect prerequisite clears, ping
  the agent with the lifted blocker and the corresponding §3 sub-item;
  the agent runs the technical step.
- **Recurring §4 items:** already wired as cron / timer / GH Actions
  schedules; they self-trigger as the platform runs.
- **Re-baseline:** quarterly per EXEC §43.4. Every closed item gets a
  decision-log entry; every still-open item is re-affirmed in the
  quarterly TRUTH reconciliation.

This file is the single source of remaining-work truth. It supersedes
`docs/work-program/PHASE-1-COMPLETION.md` for institutional / hardware /
financial scope (PHASE-1-COMPLETION remains the master tracker for the
agent's code-side work program). When the two disagree, this file wins
and the work program is updated.
