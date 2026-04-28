# THREAT-MODEL-CMR.md — Cameroon-Specific Threat Extension

This document extends SRD §05 (generic Tier 1/2/3 threat model) and EXEC §39
(architect's-eye threats) with **Cameroon-specific actor classes, TTPs, and
infrastructure realities** that the generic model does not address.

Resolves **W-22**.

---

## 1. Actor Classes Specific to Cameroon

| Actor | Capability | Likely TTPs | Mitigation |
|---|---|---|---|
| **Procurement cartel (large contractor + complicit officials)** | Tier 2 — substantial private resources, deep institutional contacts | Litigation as harassment; commercial pressure on architect's other clients; SIM-card cloning; family-network social engineering | Council pillars are diverse + named; legal counsel pre-retained; architect's contracts are strictly SAS-channelled; family briefed on operational silence (EXEC §17.1) |
| **DGRE / SED (intelligence services)** | Tier 3 — legal mechanisms, lawful intercept, physical access via warrant or pretext | Subpoena to SAS; informal "request" to architect; visa/residency leverage if architect has dual nationality issues; ISP-level traffic inspection | EU jurisdictional placement of hosting; Polygon public ledger creates global visibility of any tampering; 5-of-5 council means no single private compulsion suffices |
| **ENEO load-shedding** | Environmental — not adversarial but availability-disrupting | 4-12 outages/month in Yaoundé, 0.5-8 hr each | UPS + EcoFlow DELTA 2 (2.5-3 hr); generator ≥ 2 hr; production nodes are EU-hosted (Hetzner); only architect's interactive workstation is locally exposed |
| **MTN/Orange/Camtel ISP-level pressure** | Tier 2 — by formal compulsion or informal "request" | DNS poisoning of `vigilapex.cm` viewers in-country; throttling; logging architect's residential traffic | DNSSEC at Cloudflare; .onion address for /tip; architect's home connection runs WireGuard tunnel to EU exit before any project traffic; static IP from a single ISP is avoided in favour of dual-WAN |
| **BEAC / banking-system pressure** | Tier 2 — financial leverage on the SAS | SAS bank account frozen pending "compliance review"; cross-border EUR/USD wire inspection | SAS holds reserves in 3 locations: local Cameroon FCFA, EU-bank EUR, Polygon/USDC; quarterly audit trail; corporate-tax compliance is impeccable |
| **Foreign-government (US, French) lawful access** | Tier 3 — CLOUD Act, French data-retention law | Compelled disclosure from AWS, Cloudflare, GitHub | Hetzner DE primary (no CLOUD Act direct); minimal US-jurisdiction surface (Cloudflare only for DDoS, no data); critical secrets never in foreign-jurisdiction systems |
| **Petty crime (laptop theft, residential burglary)** | Tier 1 — opportunistic | Snatched laptop bag; home break-in for valuables | LUKS2 + YubiKey-PIN means stolen device is bricked; safe is bolted (>30 kg); architect carries primary key on lanyard; hot data on EU NAS not local |
| **Domestic political opposition / partisan press** | Soft-power — capture-by-association attempt | Public attacks framing VIGIL APEX as partisan; data leaks from rivals to embarrass; demands for findings against political opponents | Operational silence default (EXEC §17.1); 4-of-5 council vote required for public release; no funding from political parties (data-ethics commitment); architect declines to comment on active findings |

---

## 2. Cameroon-Specific TTPs (and protections)

### TTP-CMR-01: SIM-card cloning to intercept SMS-based MFA

Carrier-side SIM swap is reportedly available informally to well-connected actors
in Yaoundé. The protection is structural: **VIGIL APEX does not use SMS for any
authentication**. Account recovery on registrars, hosting, and email all use
hardware-key MFA only (EXEC §06.4). The architect's personal accounts that touch
project work follow the same rule.

### TTP-CMR-02: Customs delay as soft-pressure

YubiKey shipments can be held for 2-4 weeks at Yaoundé customs. This is normal
but also weaponisable — held indefinitely if the project becomes a target. The
W-18 timeline buffer absorbs this, and the §04.3 two-batch / two-address shipping
protocol reduces the chance both shipments are held simultaneously.

### TTP-CMR-03: ENEO load-shedding as DoS proxy

A coordinated outage timed to a council meeting could disrupt vote signing.
Mitigation: vote ceremonies are **time-flexible by design** — the SRD §23.4
14-day window absorbs any single-day power event. EcoFlow DELTA 2 + UPS keep
the architect's workstation alive for 2-3 hours per outage. Production
components are EU-hosted.

### TTP-CMR-04: Family/social pressure on the architect

EXEC §17 protocol applies. Specific Cameroon-context additions:
- The architect's family is briefed on the §17 spokesperson protocol before
  any council enrolment, with an explicit script: "I cannot discuss specific
  findings."
- Family members are NOT introduced to council members socially.
- Travel arrangements for council ceremonies are made through the SAS, not
  through the architect's personal calendar.

### TTP-CMR-05: Forced-handover of YubiKey under duress

If the architect is physically coerced into handing over a YubiKey AND PIN, the
8-attempt FIDO2 lockout doesn't help. Mitigations are layered:
- The 5-of-5 council with 3-of-5 quorum means architect's key alone produces no escalation.
- The Polygon-signer YubiKey lives in a locked drawer next to the host server, not on the architect's person.
- The deep-cold OpenPGP backup (W-08 fix) is in an off-jurisdiction safe deposit box not accessible without notarial attestation.
- Council communication channel monitors for unusual signing patterns; an out-of-cycle architect signature triggers a council call within 4 hours.

### TTP-CMR-06: Subpoena targeting architect's personal device

Cameroonian courts can compel device unlock. If the architect's MSI Titan is
subpoenaed:
- LUKS2 + clevis-Tang means the drive cannot be unlocked without the Synology
  NAS being reachable (the Tang server lives there) — and the NAS lives off-site.
- Confiscating just the laptop yields encrypted blocks.
- Confiscating the laptop AND the Synology NAS still requires the architect's
  YubiKey + PIN; the architect's legal counsel argues "production of personal
  cryptographic key constitutes self-incrimination" under Article 35 of the Cameroon Constitution.

### TTP-CMR-07: Tor exit-node fingerprinting by Cameroon-aligned ISPs

Direct Tor connections from Cameroon are likely fingerprinted at the ISP level.
The /tip portal's `.onion` v3 service (W-09 fix) is reached via a Tor obfuscation
bridge for in-country submitters. The clearnet `/tip` is reached normally for
international submitters. Both are documented on the portal page.

---

## 3. Infrastructure Realities

| Reality | Operational consequence | Built-in compensating control |
|---|---|---|
| Yaoundé fibre uptime ~95% | Architect's interactive day is 5% interrupted | Hetzner is the production layer; architect downtime ≠ system downtime |
| 4-12 power outages / month | Workstation loses state if unprotected | UPS for <2hr; EcoFlow for 2-3hr; controlled shutdown via apcupsd |
| Customs imports lead time 2-4 weeks | M0c slip | 26-week / 30-week stretch baseline (W-18) |
| SAS bank account: ~3-day SWIFT settlement | Cash-flow lumpiness | Minimum 60 days operating buffer in EU bank |
| French as the operating language for institutional comms | Translation overhead | Bilingual FR/EN documentation suite is contractual; native FR translator on retainer |
| Cameroon time zone: WAT (UTC+1) | Off-cycle from EU support hours | Hetzner support is 24/7; architect schedules YubiKey ceremonies in window when EU support is available |

---

## 4. What This Document Does NOT Try to Do

- It does not enumerate every possible Cameroonian threat. The risk register
  in EXEC §40 covers the classic generics; this document covers **what the
  generic model misses**.
- It does not replace SRD §05. SRD remains binding on cryptographic and software
  threat models.
- It does not predict outcomes. It describes capability and protection; not
  probability.

## 5. Review Cadence

- Quarterly review by the architect alone.
- Annual review with the council technical pillar present.
- After any incident that surfaces a new TTP, immediate amendment with a
  decision-log entry.
