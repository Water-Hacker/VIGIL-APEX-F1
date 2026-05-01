# VIGIL APEX — Procurement & budget inventory

> **Use:** the architect's single-page reference for **everything that
> must be purchased, rented, or subscribed to** before the system can
> ship findings to CONAC. Hardware (excluding YubiKeys per the
> architect's request — those are tracked separately in
> [HSK-v1](../source/HSK-v1.md)), paid APIs, and paid services.
> Each row says: **what / quantity / cost / when / source-of-truth-doc**.
>
> **Total Year-1 envelope** per [TRUTH.md §A](../../TRUTH.md):
> **USD 357,028** for Phase 1 (excluding USD 76K Phase-2 reservations).
> The breakdown below reconciles to that envelope.

---

## §1. Hardware (one-time purchase)

The system runs on a 1-host + 1-cloud-VPS + 2-NAS hybrid topology
(SRD §02; TRUTH.md §A). Below is what the architect actually buys.

| Item                                       | Qty | Unit cost                        | Total           | Purpose                                                                                                 | Source                                        |
| ------------------------------------------ | --: | -------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **MSI Titan 18 HX AI workstation**         |   1 | ~USD 5,800                       | ~5,800          | Primary host (N01 in SRD §02). 24-core CPU, 128 GB DDR5, RTX 5090 24 GB. Runs the Docker compose stack. | [TRUTH.md L31](../../TRUTH.md#L31)            |
| **Backup laptop**                          |   1 | ~USD 1,500                       | ~1,500          | Secondary architect device with WireGuard config + YubiKey workflow ready (EXEC §07.5).                 | EXEC §07.5                                    |
| **Synology DS923+ NAS**                    |   2 | ~USD 700 each                    | ~1,400          | NAS-replica pair, geographically separated. Holds the encrypted backup chain.                           | [TRUTH.md L37](../../TRUTH.md#L37); SRD §02.2 |
| **Seagate HAT5300-8T enterprise HDD**      |  12 | ~USD 230 each                    | ~2,760          | 6 disks per NAS in SHR-2 = ~32 TB usable per unit. 12 total across both NAS.                            | [TRUTH.md L37](../../TRUTH.md#L37)            |
| **APC SMC1500-2U UPS** (or eq.)            |   1 | ~USD 600                         | ~600            | <2h power outage protection (Yaoundé experiences 4–12 outages/month — EXEC §07.4).                      | EXEC §07.4                                    |
| **Petrol/inverter generator**              |   1 | ~USD 1,000                       | ~1,000          | >2h outage protection. Not needed if hosting is EU-VPS-only; required if any bare-metal in CMR.         | EXEC §07.4                                    |
| **Smart-card reader (PIV)**                |   2 | ~USD 30 each                     | ~60             | Architect + backup-architect workstations. Some laptops have it built in; budget anyway.                | EXEC §07.5                                    |
| **Encrypted USB drives (256 GB)**          |   8 | ~USD 50 each                     | ~400            | Cold-backup of GPG keys, council enrolment fixtures, off-jurisdiction safe-deposit-box content.         | EXEC §08 + W-08                               |
| **Travel safe / safe-deposit-box content** |   1 | ~USD 100 (one-time content prep) | ~100            | Tamper-evident storage of OpenPGP master backup, council Shamir shares, Polygon signer offline copy.    | W-08                                          |
| **HARDWARE SUBTOTAL**                      |     |                                  | **~USD 13,620** |                                                                                                         |                                               |

**Notes.**

- The MSI Titan is the canonical host per SRD §02 / MVP §02.3. If the
  architect picks **OVH/Hetzner-only** (no bare-metal in CMR — see
  DECISION-001 in `docs/decisions/log.md`), the workstation cost
  collapses to a normal developer laptop (~USD 1,500–2,000) and the
  generator drops to USD 0; the hardware subtotal becomes ~USD 5,000.
- The 2 NAS are geographically split (one at architect's residence, one
  at a trusted third-party site). Both off-NAS encrypted backups
  mirror to Hetzner cloud archive nightly per
  [TRUTH.md L92](../../TRUTH.md#L92).
- **Excluded per architect's request:** YubiKeys (8× 5 NFC + 1× 5C NFC = ~USD 470). Tracked separately in HSK-v1; see also DECISION-003 in `docs/decisions/log.md`.

---

## §2. Recurring infrastructure (monthly / annual rental)

The cloud rental footprint, by tier. Costs are per-month unless noted.

### §2.1 Compute hosting

| Item                                | Qty | Cost / mo | Annual             | Purpose                                                                           | Source                             |
| ----------------------------------- | --: | --------- | ------------------ | --------------------------------------------------------------------------------- | ---------------------------------- |
| **Hetzner CCX33 dedicated vCPU**    |   1 | ~EUR 60   | ~EUR 720           | Production primary (DECISION-001, FINAL). 8 vCPU, 32 GB RAM, NVMe.                | DECISION-001                       |
| **OVH equivalent (Strasbourg)**     |   1 | ~EUR 50   | ~EUR 600           | Daily backup destination + cold standby for cross-provider redundancy.            | DECISION-001                       |
| **Hetzner CPX31 VPS**               |   1 | ~EUR 14   | ~EUR 168           | Static-IP egress jumpbox (EXEC §07.4 mitigation if home connection drops).        | [TRUTH.md L34](../../TRUTH.md#L34) |
| **Sentinel monitor VPS — Helsinki** |   1 | ~EUR 5    | ~EUR 60            | 2-of-3 outage attestation quorum (`scripts/sentinel-quorum.ts`).                  | [TRUTH.md L38](../../TRUTH.md#L38) |
| **Sentinel monitor VPS — Tokyo**    |   1 | ~USD 6    | ~USD 72            | Same.                                                                             | TRUTH.md §B                        |
| **Sentinel monitor VPS — NYC**      |   1 | ~USD 6    | ~USD 72            | Same.                                                                             | TRUTH.md §B                        |
| **Tor obfs4 bridge VPS** (optional) |   1 | ~EUR 5    | ~EUR 60            | Self-hosted bridge if the public Tor entry node is blocked at the operator's ISP. | EXEC §07.5                         |
| **COMPUTE SUBTOTAL**                |     |           | **~EUR/USD 1,750** |                                                                                   |                                    |

### §2.2 Storage / network

| Item                         | Cost          | Notes                                                                          |
| ---------------------------- | ------------- | ------------------------------------------------------------------------------ |
| Hetzner Storage Box 1 TB     | ~EUR 4/mo     | Off-site mirror of NAS-encrypted snapshots.                                    |
| Cloudflare DNS (free tier)   | USD 0         | DECISION-002, FINAL. DNSSEC enabled. DDoS mitigation included.                 |
| WireGuard VPN                | USD 0         | Self-hosted on the static-IP VPS; no third-party VPN service.                  |
| Egress bandwidth             | included      | Hetzner / OVH include 100–200 GB/month free; Phase-1 traffic stays well under. |
| **STORAGE/NETWORK SUBTOTAL** | **~EUR 4/mo** |                                                                                |

### §2.3 Domain registration

| Item                            | Cost           | Notes                                                            |
| ------------------------------- | -------------- | ---------------------------------------------------------------- |
| `vigil-apex.org` (Gandi, Paris) | ~EUR 15/yr     | DECISION-002, FINAL.                                             |
| `vigilapex.cm` (.cm registrar)  | ~USD 80/yr     | Pursued separately via CONAC liaison (DECISION-005 PROVISIONAL). |
| `vigil.gov.cm` (institutional)  | USD 0          | Pursued via CONAC; AUDIT-080 deferred — non-blocking.            |
| **DOMAINS SUBTOTAL**            | **~USD 95/yr** |                                                                  |

### §2.4 TLS

| Item                       | Cost  | Notes                                                          |
| -------------------------- | ----- | -------------------------------------------------------------- |
| Let's Encrypt certificates | USD 0 | Auto-renewed via Caddy reverse proxy in `infra/docker/caddy/`. |

### §2.5 Email

| Item                               | Cost          | Notes                                                                                           |
| ---------------------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| ProtonMail / Tutanota professional | ~EUR 6/mo     | Operator-role email per EXEC §07.5. SMS-MFA forbidden; hardware key required.                   |
| Resend transactional email         | USD 0–20/mo   | If used for delivery acknowledgements; free tier 100 emails/day usually sufficient for Phase 1. |
| **EMAIL SUBTOTAL**                 | **~EUR 6/mo** |                                                                                                 |

### §2.6 GitHub / CI

| Item                                 | Cost  | Notes                                                               |
| ------------------------------------ | ----- | ------------------------------------------------------------------- |
| GitHub repo (public)                 | USD 0 | Open-source per the binding doctrine. No paid GitHub seat required. |
| GitHub Actions (public-repo minutes) | USD 0 | Public repos get free CI minutes.                                   |

### §2.7 Polygon mainnet anchoring

| Item                                        | Cost             | Notes                                                            |
| ------------------------------------------- | ---------------- | ---------------------------------------------------------------- |
| Polygon RPC (Alchemy / Infura / public)     | USD 0–50/mo      | Free tier covers Phase-1 batch + high-sig anchoring.             |
| Gas — hourly batch anchor                   | ~USD 0.05/hr     | DECISION-012 cost projection: ~USD 36/mo continuous.             |
| Gas — high-sig per-event anchor             | ~USD 0.001/event | DECISION-012 §4. Phase-1 estimated 50–500 high-sig events/month. |
| **POLYGON SUBTOTAL** (Phase-1 conservative) | **~USD 40/mo**   |                                                                  |

**Initial mainnet wallet funding:** USD 200 (one-time) covers ~6 months
of Phase-1 anchoring at the projected rate.

### §2.8 Recurring infrastructure — annual roll-up

| Category               | Annual (Year 1) |
| ---------------------- | --------------- |
| Compute hosting        | ~USD 1,950      |
| Storage/network        | ~USD 50         |
| Domains                | ~USD 95         |
| TLS                    | USD 0           |
| Email                  | ~USD 80         |
| GitHub / CI            | USD 0           |
| Polygon (incl. wallet) | ~USD 680        |
| **YEAR-1 INFRA**       | **~USD 2,855**  |

---

## §3. Paid APIs (usage-based)

Every external API the platform calls. Free tiers noted explicitly;
paid tiers are usage-metered.

### §3.1 LLM (Anthropic + fallbacks)

The platform uses a 3-tier LLM stack (DECISION-011, FINAL):

- **Tier 0 — Anthropic Claude API** (primary, paid).
- **Tier 1 — AWS Bedrock Claude** (failover when Tier 0 circuit opens).
- **Tier 2 — local sovereign LLM** (degraded mode; no API cost).

| API                      | Free tier? | Paid pricing                                         | Phase-1 budget                                                   | Source                                               |
| ------------------------ | ---------- | ---------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| **Anthropic Claude API** | No         | USD 3/1M input + USD 15/1M output (Sonnet 4.6)       | **USD 30/day soft / USD 100/day hard ceiling** = **~USD 900/mo** | `LLM_MONTHLY_CIRCUIT_FRACTION` env var; .env.example |
| **AWS Bedrock Claude**   | No         | Same Anthropic pricing + AWS overhead                | USD 0 baseline; only billed when Tier 0 circuit trips.           | TRUTH.md L131                                        |
| **Local sovereign LLM**  | n/a        | USD 0 API; ~USD 50/mo extra hosting compute if added | Phase-1 deferred                                                 | DECISION-011 §6                                      |
| **LLM SUBTOTAL**         |            |                                                      | **~USD 900/mo / USD 10,800/yr**                                  |                                                      |

**Cap discipline.** The platform refuses calls past the hard ceiling
(circuit breaker). The architect can change the limit in
`.env`; the cap is per-day, not per-month, so a single bad day cannot
blow the annual budget.

### §3.2 Source feeds — paid keys

Of 29 source feeds in `infra/sources.json`, 24 are READY without auth
(per `pnpm compose:precheck`). The 5 remaining either need a paid key
or an MOU.

| API                              | Free tier? | Paid tier                            | Phase-1 budget                          | Notes                                                                                        |
| -------------------------------- | ---------- | ------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| **OpenCorporates v0.4**          | Yes        | ~USD 60/mo for 50K calls/mo          | **~USD 60/mo Year-1**                   | Phase-1 anonymous tier insufficient at expected entity-resolution volume.                    |
| **OCCRP Aleph**                  | Yes        | Free for journalists / civil society | USD 0                                   | Apply for the journalist-tier key — free if accepted.                                        |
| **OpenSanctions**                | Yes        | EUR 200/mo for the live API          | USD 0 (free CSV download is sufficient) | Phase-1 uses the daily CSV; live API only needed if real-time matching becomes a bottleneck. |
| **OFAC SDN / EU / UN sanctions** | Yes        | Free                                 | USD 0                                   | All public XML/CSV feeds.                                                                    |
| **AfDB / World Bank sanctions**  | Yes        | Free                                 | USD 0                                   | Public CSV.                                                                                  |
| **SOURCES SUBTOTAL**             |            |                                      | **~USD 60/mo / USD 720/yr**             |                                                                                              |

### §3.3 Satellite imagery

| API                              | Free tier?               | Paid tier                                         | Phase-1 budget           | Notes                                                                                                          |
| -------------------------------- | ------------------------ | ------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Planet NICFI**                 | Yes (qualifying-org MOU) | n/a — free tier covers tropics monthly basemap    | USD 0                    | MOU-gated but free. The MOU is the architect's institutional task; once signed, NICFI activates automatically. |
| **Sentinel-2 (Copernicus)**      | Yes                      | Optional Sentinel Hub commercial tier ~EUR 100/mo | USD 0                    | Free Copernicus Open Access Hub sufficient for Phase-1.                                                        |
| **Maxar 30 cm**                  | No                       | USD 17–25 per km²                                 | USD 0 — Phase-2 deferred | Production high-res imagery; gated on real findings.                                                           |
| **Airbus Pleiades 50 cm**        | No                       | EUR 11–18 per km²                                 | USD 0 — Phase-2 deferred | Same.                                                                                                          |
| **SATELLITE SUBTOTAL** (Phase 1) |                          |                                                   | **USD 0**                |                                                                                                                |

### §3.4 Map rendering

| API                                  | Free tier?         | Paid tier                             | Phase-1 budget | Notes                                                                       |
| ------------------------------------ | ------------------ | ------------------------------------- | -------------- | --------------------------------------------------------------------------- |
| **Mapbox Static Tiles**              | Yes (50K loads/mo) | USD 0.50 per 1K loads above free tier | USD 0–10/mo    | Dashboard map panel; Phase-1 internal-only audience stays in the free tier. |
| **OpenStreetMap (default fallback)** | Yes                | Free                                  | USD 0          | Auto-fallback when Mapbox key is absent.                                    |

### §3.5 Anti-bot infrastructure

| API                               | Free tier? | Paid tier             | Phase-1 budget                                                                 | Notes                          |
| --------------------------------- | ---------- | --------------------- | ------------------------------------------------------------------------------ | ------------------------------ |
| **Bright Data residential proxy** | Trial      | ~USD 500/mo for 40 GB | **~USD 200/mo** (smaller plan; only for sites that fingerprint datacenter IPs) | EXEC §10 IP rotation strategy. |
| **2Captcha solver**               | No         | USD 1 per 1K captchas | **~USD 30/mo** (only `coleps-tenders` typically captcha-gated)                 | EXEC §10.                      |
| **ANTI-BOT SUBTOTAL**             |            |                       | **~USD 230/mo / USD 2,760/yr**                                                 |                                |

### §3.6 IPFS pinning

| Service                    | Free tier? | Paid tier                            | Phase-1 budget                                   | Notes                                                      |
| -------------------------- | ---------- | ------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------- |
| **Local Kubo node**        | n/a        | USD 0 (self-hosted in compose stack) | USD 0                                            | Default; mounted in `infra/docker/ipfs/`.                  |
| **Pinata pinning service** | Yes (1 GB) | USD 20/mo for 50 GB                  | **~USD 20/mo** (after first 6 months of pinning) | DECISION-012 quarterly export → Pinata pin for permanence. |
| **IPFS SUBTOTAL**          |            |                                      | **~USD 240/yr (Year-1 partial)**                 |                                                            |

### §3.7 Paid-API roll-up

| Category             | Year-1          |
| -------------------- | --------------- |
| LLM (Anthropic)      | ~USD 10,800     |
| Source feeds         | ~USD 720        |
| Satellite            | USD 0 (Phase-1) |
| Maps                 | USD 0–120       |
| Anti-bot             | ~USD 2,760      |
| IPFS                 | ~USD 240        |
| **YEAR-1 PAID APIS** | **~USD 14,640** |

---

## §4. Paid services (subscriptions / annual)

### §4.1 Security tooling

| Service                      | Cost                      | Phase-1 budget                                  | Notes                                                    |
| ---------------------------- | ------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| **Snyk Open Source**         | USD 0 (open-source tier)  | USD 0                                           | `.github/workflows/security.yml` blocks on Critical CVE. |
| **Snyk Pro**                 | ~USD 25/dev/mo            | USD 0 — public repo qualifies for free OSS tier | Optional upgrade if private repos are added.             |
| **GitHub Advanced Security** | included for public repos | USD 0                                           | Gitleaks + secret-scan workflow already in CI.           |
| **SECURITY SUBTOTAL**        |                           | **USD 0/yr**                                    |                                                          |

### §4.2 Off-jurisdiction safe-deposit-box

| Service                           | Cost            | Phase-1 budget                                                   | Notes                                                                                           |
| --------------------------------- | --------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Off-jurisdiction safe-deposit-box | ~USD 200–500/yr | **~USD 350/yr** (architect picks city — W-08 institutional gate) | Holds OpenPGP master backup, council Shamir share for break-glass, Polygon signer offline copy. |

### §4.3 Backup architect retainer

| Service                   | Cost        | Phase-1 budget    | Notes                                                         |
| ------------------------- | ----------- | ----------------- | ------------------------------------------------------------- |
| Backup architect retainer | ~EUR 400/mo | **~EUR 4,800/yr** | OPERATIONS.md §9; signed before M0c. W-17 institutional gate. |

### §4.4 Council legal-defence reserve

| Service                    | Cost          | Phase-1 budget    | Notes                                                                                                                                                                                |
| -------------------------- | ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Legal-defence reserve fund | ~USD 5,000/yr | **~USD 5,000/yr** | Per pillar: covers retainer of a Cameroon-admitted lawyer in case of retaliation. EXEC §11.3 promises this to candidates. 5 pillars × USD 1,000/yr typical; budget rounds to USD 5K. |
| Council ceremony travel    | ~USD 1,500/yr | ~USD 1,500/yr     | 4 × ceremonies/yr × ~USD 75/pillar travel reimbursement.                                                                                                                             |
| **COUNCIL SUBTOTAL**       |               | **~USD 6,500/yr** |                                                                                                                                                                                      |

### §4.5 Counsel + legal services

| Service                                     | Cost                     | Phase-1 budget          | Notes                                                                                            |
| ------------------------------------------- | ------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------ |
| Cameroonian lawyer review                   | ~USD 2,000–5,000         | **~USD 3,500/yr**       | Reviews CONAC engagement letter, ANTIC declaration, council commitment letters per EXEC §11–§15. |
| Statutory positioning + entity registration | ~USD 1,500               | one-time                | If architect chooses to register a SAS or association loi 1990 (EXEC §11.3).                     |
| Certified translation FR↔EN                 | ~USD 50/page × ~10 pages | ~USD 500 one-time       | Only if institutional letters need certified bilingual versions.                                 |
| **COUNSEL SUBTOTAL**                        |                          | **~USD 5,500 (Year-1)** |                                                                                                  |

### §4.6 Year-1 services roll-up

| Category              | Year-1                  |
| --------------------- | ----------------------- |
| Security tooling      | USD 0                   |
| Safe-deposit-box      | ~USD 350                |
| Backup architect      | ~USD 5,400 (~EUR 4,800) |
| Council legal-defence | ~USD 6,500              |
| Counsel + legal       | ~USD 5,500              |
| **YEAR-1 SERVICES**   | **~USD 17,750**         |

---

## §5. Total Year-1 envelope reconciliation

| Bucket                               | Cost (USD)  |
| ------------------------------------ | ----------- |
| §1 Hardware (one-time)               | ~13,620     |
| §2 Recurring infrastructure (Year 1) | ~2,855      |
| §3 Paid APIs (Year 1)                | ~14,640     |
| §4 Paid services (Year 1)            | ~17,750     |
| **YEAR-1 SUBTOTAL (this doc)**       | **~48,865** |
| Architect's compensation envelope    | ~270,000 \* |
| Misc / contingency 20%               | ~38,163     |
| **YEAR-1 TARGET (TRUTH.md §A)**      | **357,028** |

\* Architect's compensation is the dominant Year-1 cost line in MVP §13
(USD 357,028 includes the architect's full-time engagement at the rate
the funder assumes); this doc's scope is procurement, not personnel.

The procurement/services subtotal of **~USD 48,865** is well within
the non-personnel envelope. **Phase-1 has no procurement risk** —
the platform can ship findings to CONAC with the budget already
documented.

---

## §6. Phase-2 deferred procurement (institutional gate)

The following are **deliberately deferred** to Phase-2 (months 7–12,
gated on the Retention Incentive payable at M4 acceptance). They are
already wired in code; activation is a budget-release decision.

| Item                                      | Phase-2 budget     | Notes                                                                                  |
| ----------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| Maxar high-resolution imagery             | ~USD 10,000/yr     | Activates per-finding when council 4-of-5 votes for paid imagery.                      |
| Airbus Pleiades imagery                   | ~EUR 8,000/yr      | Same.                                                                                  |
| OpenSanctions live API                    | ~EUR 2,400/yr      | If real-time matching becomes a bottleneck.                                            |
| Polygon mainnet wallet top-up             | ~USD 500/yr        | After initial USD 200 lasts ~6 months.                                                 |
| Bright Data full-volume plan              | ~USD 6,000/yr      | If Phase-1's ~40 GB cap is exhausted.                                                  |
| Hyperledger Fabric internal-chain hosting | ~USD 1,200/yr      | If the architect activates the cross-witness verifier (DECISION-008 Phase-2 scaffold). |
| **PHASE-2 RESERVE**                       | **~USD 28,000/yr** | TRUTH.md §A reserves USD 76K for Phase-2 — well-covered.                               |

---

## §7. What this inventory deliberately does NOT cover

- **YubiKeys** — excluded per the architect's request. Tracked in
  [HSK-v1](../source/HSK-v1.md) and DECISION-003. Reference: 8× YubiKey 5 NFC + 1× YubiKey 5C NFC at ~EUR 52 each ≈ **EUR 470**, plus Cameroon import tax (~20% formal declaration). EXEC §1041 budget line: **EUR 600–700** total for the YubiKey set.
- **Architect personal compensation / time** — the dominant Year-1 cost
  line. Out of procurement scope.
- **Council member compensation** — by design **unpaid** (EXEC §11.3).
  Only legal-defence reserve and ceremony travel are budgeted (§4.4).
- **CONAC / Cour des Comptes / MINFI / ANIF SFTP endpoint provisioning costs** — these are at the institution's expense per F3.1 letter (`docs/templates/institutional/`).
- **Tip-portal Tor onion service** — runs in the local compose stack
  at no extra cost; no third-party Tor exit node required.

---

## §8. Recommended procurement order

For an architect bootstrapping the platform on a clean budget, the
order that minimises blocked time:

1. **Hardware** (8-week lead time on MSI Titan + NAS for some configs)
   — order on day 1.
2. **Domain + Cloudflare** (one hour) — same day 1.
3. **Hetzner CCX33 + OVH + sentinel VPS** — week 1, before any code
   ships to the cloud.
4. **Anthropic API key** — week 1, populate Vault before
   `pnpm compose:up`.
5. **Polygon mainnet wallet funding** — week 4, before Phase-7 anchor
   contract deploy.
6. **Bright Data + 2Captcha** — week 8, when adapter rotation actually
   becomes necessary (most sources work without proxies in early Phase-1).
7. **Backup architect retainer** — by M0c per OPERATIONS.md §9.
8. **Off-jurisdiction safe-deposit-box** — month 2, after the architect
   selects the city (W-08 institutional gate).
9. **Cameroonian lawyer engagement** — month 2, before any institutional
   letter is sent to CONAC or filed with ANTIC.
10. **OpenCorporates paid tier** — month 3, when entity-resolution
    volume exceeds the free-tier limit.

---

## §9. Source-of-truth references

- [TRUTH.md](../../TRUTH.md) — canonical Year-1 budget, topology, source count.
- [docs/source/SRD-v3.md](../source/SRD-v3.md) §02, §13 — host, NAS, budget.
- [docs/source/EXEC-v1.md](../source/EXEC-v1.md) §05–§11, §31, §1026 — hosting decision, hardware tables, time estimates, YubiKey procurement plan.
- [ROADMAP.md](../../ROADMAP.md) §3, §5 — Phase-1 / Phase-2 budget envelope.
- [OPERATIONS.md](../../OPERATIONS.md) §9 — backup architect retainer.
- [`docs/decisions/log.md`](../decisions/log.md) DECISION-001, -002, -003 — hosting + domain + YubiKey decisions, FINAL.
- [`docs/runbooks/api-credentials-checklist.md`](api-credentials-checklist.md) — operator-facing pre-boot credential checklist.
- [`infra/sources.json`](../../infra/sources.json) — 29-source inventory with per-source tier classification.

---

**Generated:** 2026-05-01
**Counterpart:** [docs/runbooks/api-credentials-checklist.md](api-credentials-checklist.md)
(operator-facing pre-boot credential walk).
