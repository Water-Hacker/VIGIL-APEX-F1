REPUBLIQUE DU CAMEROUN  -  REPUBLIC OF CAMEROON
Paix  -  Travail  -  Patrie
VIGIL APEX
EXECUTION RUNBOOK
Version 1.0
From documents to running system
Council formation  -  Hosting  -  Hardware procurement
Calibration seed  -  Phase 0 dry run  -  Sustainability
Decision log  -  Risk register  -  Exit protocol
Junior Thuram Nana
Sovereign Architect  -  VIGIL APEX SAS
Yaoundé  -  April 2026
CONFIDENTIAL  -  RESTRICTED CIRCULATION


If your time is short, the next concrete actions are these. Everything else in this document expands on them. Anything you have not done from this list within 14 days is a delay against the build timeline; anything you have not done within 30 days is a sign that the project has stalled and needs a candid conversation with yourself about why.




### 01.1  What it is
This document covers the work that the SRD, Companion v1, and Companion v2 explicitly do not. The technical documents teach a competent agent how to build the running system. This document teaches you how to do the things no agent can do for you: form a council of 5 humans who will sign with hardware tokens, negotiate the institutional relationship with CONAC and MINFI, choose where the system runs, gather the calibration seed, and stay alive and effective long enough to ship.
It is also the document the agent loads to know what work is happening outside the codebase. The Phase 1-9 build prompts in Companion v1 reference institutional state ("council members are enrolled", "CONAC delivery account is provisioned") that, without this document, the agent would either invent or stall on. With this document loaded, the agent can ask intelligent questions about institutional readiness instead of producing speculative code.

### 01.2  What it is not
It is not a project plan with deadlines, because the institutional work cannot be deadlined. Council members do not commit on a Gantt chart. CONAC does not approve an engagement letter on a Tuesday because the timeline says so. The runbook orders the work; it does not promise dates.
It is not a substitute for legal counsel. It contains drafting frameworks for the CONAC engagement letter, statutory positioning under Cameroonian law, and whistleblower protection scaffolding. Each of these is a starting point that an actual lawyer admitted in Cameroon must review and adapt before any letter is sent or any structure is registered.
It is not a substitute for security training. It contains operational security guidance proportionate to a serious anti-corruption project, but the threat model in the SRD §05 is the binding reference, and a human security review by someone who has worked with at-risk journalists or activists in Central Africa is strongly recommended before going public with any finding.

### 01.3  Audience


### 02.1  The pack
After this document is added, the VIGIL APEX build pack is four documents loaded together into Claude Code at the start of every session:


### 02.2  Reading priority when sources disagree
When the four documents accumulate small contradictions over time, resolve them in this order:




### 03.1  Tracks, not phases
The technical build is sequential: Phase 0 then 1 then 2 etc. The institutional work is parallel: four tracks running simultaneously, each with its own pace, its own dependencies, its own failure modes. The architect's job is to keep all four moving without letting any single track block the others.


### 03.2  Dependencies between tracks and phases
The technical Phase numbers correspond to the prompts in Companion v1 §28-37. The institutional work gates them as follows:


### 03.3  What the architect does in a typical week
During the active build (weeks 4-14), a sustainable week looks roughly like:
15-20 hours: technical work with Claude Code (the build itself)
4-6 hours: institutional work (one or two meetings, one or two letters/emails)
3-4 hours: calibration seed research (evenings, library or archive)
2-3 hours: documentation, decision log updates, weekly review
1-2 hours: rest, family, anything that is not VIGIL APEX

That totals 25-35 hours per week of project work. If you are not getting at least 20 sustained hours per week, the timeline does not hold and you should plan for 6-9 months instead of 8-14 weeks. The honesty of this estimate is more valuable than its optimism. See §31 for how to calibrate it.


### 04.1  Why YubiKeys, why 8
The governance layer of VIGIL APEX assumes hardware-bound authentication. Council members sign votes with a YubiKey that lives in their physical possession; the polygon signer service signs on-chain anchors with a YubiKey that lives in a locked drawer next to a host server; the architect uses a YubiKey for repository signing, Vault unsealing, and break-glass access to council infrastructure. Software passkeys (Apple/Android, Windows Hello) do not substitute, because they are recoverable through the device vendor's account flow, which is precisely the threat the system is hardened against.
The 8-key procurement breaks down as follows:
5 keys: one per council pillar holder (governance, judicial, civil society, audit, technical)
1 key: architect's primary, used for git signing, Vault unseal share, break-glass
1 key: polygon signer host service, locked in physical safe with the host
1 key: spare in sealed envelope at a trusted off-site location

### 04.2  Model selection
Two YubiKey models are acceptable; one is the default.

AAGUIDs of these two models are pinned in the Keycloak realm export (Companion v2 §62). Adding a different model later requires updating the AAGUID allowlist and a council vote because it changes the trust boundary.

### 04.3  Procurement procedure
This is the highest-supply-chain-risk procurement in the project. Tampered or substituted YubiKeys would compromise the entire governance layer silently. The procedure below is paranoid by design.

### 04.4  What can go wrong
Customs seize the shipment. Mitigation: declare correctly as security devices for personal use; have an invoice ready; budget 2 extra weeks for clearance in Cameroon.
A reseller substitutes a counterfeit. Mitigation: the §04.3 step 5 attestation check catches this. Counterfeits cannot produce a Yubico-signed attestation.
A council member loses their key. Mitigation: the spare YubiKey at the off-site location can be re-provisioned for them under a witnessed re-enrolment ceremony. This is documented in §13.
A council member's key is stolen. Mitigation: the FIDO2 PIN protects against immediate use; the council member contacts the architect, the key is revoked from Keycloak, and a re-enrolment ceremony is scheduled. The audit chain logs every revocation.



### 05.1  The three serious options
Hosting decides who can take VIGIL APEX offline, whose courts have jurisdiction over the data, and how attacker-resistant the physical layer is. The decision is not primarily about cost; the cost differences across the three serious options are well within the project budget. The decision is about threat model fit.


### 05.2  Detailed comparison

### 05.3  The honest recommendation
Default to OVH (Gravelines or Strasbourg) or Hetzner (Falkenstein or Helsinki) unless there is a specific reason otherwise. The reasoning:
EU jurisdiction is materially harder to compromise informally than Cameroon jurisdiction. The threat model in SRD §05 includes informal pressure on the architect; physical hardware in Cameroon is exposed to that pressure in ways VPS in EU is not.
The architect's hours-per-week budget is the most precious resource. Bare-metal in Cameroon adds 8-15 hours/month of maintenance overhead that compounds across the build window.
AWS is operationally fine but introduces US jurisdiction (CLOUD Act) on top of South African jurisdiction. For an anti-corruption project, having a US National Security Letter as a reachable mechanism for compelled disclosure is unnecessary surface area.

Choose bare-metal if and only if: (a) you have already-running infrastructure at home or office that the project can colocate with, (b) your physical security is genuinely strong (locked room, monitored, not a residential apartment in a building with a shared lobby), AND (c) you have ISP redundancy already (two independent providers, automatic failover).

### 05.4  The decision is recorded
Whichever option you choose, record it in the decision log (§47) with the rationale. The agent reads the decision log to understand which Dockerfile assumptions are valid: bare-metal allows the polygon signer to be on the same physical host as the database; VPS requires the signer to be a separately-firewalled VPS. Companion v2 §59 assumes VPS by default; the agent will adjust if the decision log says otherwise.


### 06.1  What names are needed
The system needs a small number of domains, scoped intentionally:


### 06.2  Registrar selection
The registrar is who can take your domain offline. Pick one that does not honour informal phone calls.

### 06.3  DNS hosting (separate from registrar)
The registrar holds the registration; DNS hosting answers queries. They can be the same provider or different. Different is more resilient. Recommended split: register at Gandi, host DNS at Cloudflare (free tier with DDoS mitigation, DNSSEC support). If a court order arrives at one provider, the other still answers, buying time.

### 06.4  DNSSEC and CAA
Enable DNSSEC at the registrar level. This prevents DNS spoofing, which an adversary might attempt to redirect council members to a fake login page.
Set CAA records pinning Let's Encrypt as the only authorised CA: 0 issue "letsencrypt.org". This prevents a rogue CA from being tricked into issuing a certificate for vigil.gov.cm.
Enable Multi-Factor Authentication on the registrar account using a hardware key (one of the 8 YubiKeys, registered as a backup auth factor).
Disable telephone support reset for the registrar account. Many registrars allow account recovery through a phone call to support; this is the channel an adversary will use.

### 06.5  Email
The architect's operational email (ops@vigil.gov.cm or similar) handles certificate renewal, registrar notifications, and incoming abuse reports. Critical to get right:
Host operational email separately from personal email. If your personal Gmail is compromised, the project email must not be.
Use ProtonMail (Switzerland), Tutanota (Germany), or a self-hosted Postfix at the same VPS as the project. Avoid Gmail for the operational role.
MFA with hardware key. SMS-based MFA is unacceptable in the threat model.
DKIM, SPF, DMARC records published at the DNS layer. The agent generates these as part of Phase 0 scaffold; verify they are live before any outbound mail is sent.


### 07.1  When this matters
If hosting is bare-metal in Cameroon, network redundancy is critical. If hosting is OVH/Hetzner EU, the datacenter handles its own network redundancy and the architect's home connection is only used for SSH-into-VPS, which is forgivingly intermittent.
This section is mainly relevant for bare-metal hosting (Option A in §05). VPS-hosted deployments can skip to §07.5 for the architect's own access connectivity.

### 07.2  Cameroon ISP landscape (as of 2026)

### 07.3  Recommended bare-metal redundancy stack
Primary: fibre from Orange or MTN, with a static IP if available, otherwise dynamic DNS with frequent updates
Secondary: a different provider's fibre or a 4G failover modem on a separate carrier (e.g. Camtel 4G if primary is Orange fibre)
Tertiary: Starlink dish for cases where both terrestrial providers are down. Starlink has been operational in Cameroon since late 2023; check current regulatory status before relying on it for production.
Failover routing: a dual-WAN router (Mikrotik, Ubiquiti EdgeRouter, OPNsense on small-form-factor PC) that detects primary failure and routes through secondary within 30 seconds
Power: UPS for <2h outages, generator for >2h outages. Yaoundé experiences 4-12 outages per month of varying duration. The system MUST survive these without data loss.

### 07.4  IP allowlisting strategy
Several services accept connections from only known IP addresses to reduce attack surface:
CONAC SFTP delivery: only the worker-conac-sftp egress IP is allowed by CONAC's firewall (this is negotiated as part of the engagement letter; see §15)
Polygon RPC provider: rate-limited per source IP; the polygon signer egress IP should be static for predictable rate limit behaviour
Architect's own SSH access: only from a small set of architect-known IPs, supplemented by a WireGuard VPN tunnel for travel access

If hosting is bare-metal with dynamic IPs, this strategy collapses. The mitigation is either (a) a static IP from the ISP, even at extra cost, or (b) a small VPS purchased solely as a static-IP exit jumpbox, with all egress traffic tunneled through it via WireGuard.

### 07.5  Architect's own connectivity
Even with VPS hosting, the architect needs reliable connectivity to do daily work. Recommendations:
Two providers at home (e.g. Orange fibre + MTN 4G). Switch automatically with a dual-WAN router.
A travel kit: smartphone with global eSIM (Airalo, Saily) for connectivity outside Cameroon, configured to tether to laptop
WireGuard VPN to the production VPS for sensitive operations (vault unseal ceremonies, council voting witness, polygon signer access). NEVER do these over a coffee-shop or hotel Wi-Fi.
A secondary laptop, tested monthly, with the same WireGuard config + YubiKey workflow ready in case the primary is destroyed or compromised



### 08.1  The blunt observation
Across the public record of African anti-corruption initiatives in the past two decades, technical failure (the system breaks, the database corrupts, the algorithm misclassifies) is responsible for less than 10% of project deaths. Political failure (the wrong board, the wrong founder politics, the wrong relationship with the agency you were supposed to support) accounts for the rest. VIGIL APEX is technically buildable in 8-14 weeks. It will live or die on the council.
The 5-of-5 council with 3-of-5 quorum is not a feature; it is the load-bearing wall. If the wrong 5 people hold the keys, the system either rubber-stamps or paralyses. If the right 5 hold them, the system makes decisions that carry institutional weight even when uncomfortable, and the architect is protected from being the single point of judgement. The selection of these 5 people is the most consequential decision in the project. It is also the slowest and most reversible-in-the-wrong-direction. Take it seriously.

### 08.2  What "the right 5" means
The SRD §04.2 specifies five pillars by category. This runbook adds the operational reality of what each pillar actually requires:
GOVERNANCE pillar: someone whose career has involved repeatedly making accountability decisions that cost them politically and they made anyway. Not someone who has held a position; someone who has used the position to do something hard.
JUDICIAL pillar: a current or former magistrate, prosecutor, or senior administrative judge whose written record (judgements, decisions) shows independence from the executive. Bonus if their reputation is for being procedurally exact, not for being a partisan.
CIVIL SOCIETY pillar: a journalist, NGO leader, or academic who has investigated state corruption publicly and survived professionally. Bonus if they have done so in Cameroon specifically; otherwise, regional (Central African) experience is acceptable.
AUDIT pillar: a chartered accountant or financial auditor with experience auditing state institutions or large state-adjacent contracts. Bonus if licensed in Cameroon (OECCA-CEMAC) so their signature carries domestic professional weight.
TECHNICAL pillar: an engineer, developer, or security professional who can read VIGIL APEX's code and threat model independently and make their own judgement about whether the system is doing what it claims. Bonus if not in your personal social circle (avoids groupthink).

### 08.3  What "the right 5" does NOT mean
It does not mean the most famous or prominent person in each category. Famous people have less time, more political exposure, and are more tempting targets for pressure.
It does not mean the people who agree most quickly. The fastest yeses often come from people who have not internalised what they are signing onto. A reluctant yes after three conversations is more durable than an enthusiastic yes after one.
It does not mean only people aligned with the architect's worldview. A council where everyone agrees with everything is a council whose votes are predictable and whose legitimacy is therefore weaker. Disagreement on the council is healthy as long as it is procedural and on-the-record.
It does not mean people who have never been close to power. A judicial pillar who has worked inside the Ministry of Justice may be more useful than one who has only criticised it from outside; the former understands how the system actually moves.
It does not mean expatriates or foreign nationals (with rare exceptions). The system's legitimacy in Cameroon depends on its council being mostly or entirely Cameroonian. A foreign auditor as one of five is acceptable; three foreign members is not.



### 09.1  Pillar role descriptions (for council members themselves)
The descriptions below are written for the council member who is being asked to consider serving. They are deliberately concrete; they should not promise more time investment than the role actually requires, and they should not minimise the risks. The architect uses these as the basis for the conversations in §11.

### 09.2  Governance pillar

### 09.3  Judicial pillar

### 09.4  Civil society pillar

### 09.5  Audit pillar

### 09.6  Technical pillar


### 10.1  How to use this section
This section is a worksheet. The architect fills it in over 2-4 weeks of careful thought, conversations within their existing network (NOT with candidates yet), and reading. The output is a shortlist of 3-5 candidates per pillar (15-25 names total) from which the council of 5 is eventually selected.

### 10.2  Sources for candidate identification
Existing professional network: people the architect already respects and has worked with. Highest information per minute, but risks groupthink if the architect's network is narrow.
Public record of accountability decisions: news archives, court records, official inquiry reports. Look for names that recur in serious decisions and survive the political cycle.
Civil society directories: AfricaCheck (regional), TI Cameroon, Reporters Without Borders annual reports, the Open Government Partnership Cameroon track if active.
Professional bodies: OECCA-CEMAC for accountants, the bar associations for lawyers, IEEE Cameroon for engineers, the journalists' union (UJC).
Trusted intermediaries: ask 3-5 people you respect to nominate candidates without telling them whom you're considering. Cross-reference.

### 10.3  Candidate worksheet (per candidate)

### 10.4  Diversity check across the final 5
Before finalising the council of 5 from the shortlist, run the diversity check below. The council should reflect the country's actual demographics enough that its legitimacy is not question-marked on identity grounds:



### 11.1  Setting up the first conversation
The first conversation is the most consequential. Many candidates will form their opinion of the project in the first 20 minutes. Treat it accordingly:
In person preferred. Phone is acceptable for someone outside Cameroon. Email and messaging are NOT acceptable for the first conversation.
Neutral location. Not the architect's office, not the candidate's office, not a politically-coded venue. A quiet café or restaurant in a third-party space.
60-90 minutes blocked. Anything shorter signals you do not value their time enough; anything longer signals you have not prepared.
Bring a one-page printed brief (template in §11.5 below) but do not lead with it. Lead with what you are asking and why them.
Have an explicit ask. "I would like you to consider serving as the [PILLAR] member of a 5-member governance council for an anti-corruption monitoring project." Not vaguer.
Tell them not to answer in the meeting. Tell them you will follow up in 7-10 days. The first answer is rarely the considered answer.

### 11.2  Sample opening dialogue

### 11.3  What to NOT say in the first conversation
Do not name the other 4 candidates or any of the shortlist. The candidate's decision should not be influenced by who else may or may not be on the council. They learn names if and when all 5 commit.
Do not promise immunity from anything. Council members are exposed; promising they will not be is a lie that destroys trust later.
Do not over-quote SRD section numbers. Mention them once, in passing. The candidate is deciding on the basis of you and the principle, not the documentation.
Do not negotiate compensation. The role is not paid; it is a public service. Cost coverage (legal defence, travel for ceremonies) is offered, but salary is not. If the candidate raises compensation, that is a signal; do not push back, just note it and consider whether they are the right fit.
Do not commit to a deadline. "I want to launch by month X" pressures the candidate to decide on your timeline rather than theirs. The launch waits for the council, not the other way.

### 11.4  After the first conversation
Within 24 hours: write down what you observed about the candidate. Specifically: what concerns did they raise, in what order, with what tone? The order and tone are diagnostic.
Within 48 hours: send a short follow-up email with the one-page brief attached. Acknowledge that the decision is theirs and reiterate the 7-10 day window.
Within 7-10 days: follow up if they have not responded. One follow-up only. If they do not respond to the follow-up, treat that as a no and move to the secondary candidate for that pillar.
If they say yes: schedule a second conversation specifically for them to ask harder questions and for you to walk through the SRD §04 governance section with them in detail. The actual commitment letter (§12) is signed at the END of this second conversation, not the first.

### 11.5  One-page brief template


### 12.1  Purpose of a written commitment
A council member's word is sufficient between humans. A written commitment letter is what the system requires for two reasons: (1) it documents that the candidate read and understood what they were signing onto, which protects them later if they are challenged; (2) it creates a public-facing record that the council was constituted deliberately, which protects the system's legitimacy if its decisions are later contested.
The letter is short. It is signed at the END of the second conversation, after the candidate has had a chance to ask hard questions and read the SRD §04 governance section. It is not signed at the first conversation.

### 12.2  Letter template

### 12.3  What the letter does NOT contain
It does not contain compensation. The role is unpaid; cost coverage is by separate informal arrangement, recorded in the decision log but not in the letter.
It does not contain confidentiality clauses. The council member is bound by their own profession's confidentiality rules and by the audit chain's recording of their decisions; an additional confidentiality clause would suggest the council has secrets, which damages legitimacy.
It does not contain non-disparagement. A council member who later wants to publicly criticise the project must remain free to do so; binding them otherwise would corrupt the institution they are protecting.
It does not contain liability waivers. The architect carries operational liability; pushing it onto council members would be both legally questionable and morally dishonest.



### 13.1  When
The enrolment ceremony happens AFTER all 5 commitment letters are signed. Not before. The reason: each council member should know who else is on the council before their key is provisioned, so they can recuse themselves if a conflict surfaces with another member. They cannot recuse against people whose names they don't know yet.

### 13.2  Format
In person, all 5 plus the architect. 2-3 hours blocked. Provide food.
Neutral venue. Not anyone's office. A private room at a venue with no political coding.
Cameras off, phones on the table. Recording is by audit-chain only.
Each member receives their YubiKey personally, in its sealed packaging, at the ceremony. They open it themselves, register it themselves on a laptop the architect brings, with the architect watching but not touching.
After registration, each member sets their own FIDO2 PIN privately. The architect does not see the PIN.
A Polaroid-style photograph of the 5 members + architect is taken at the end. Stored encrypted; surfaced only if the council later disputes whether enrolment happened.

### 13.3  What is decided at the ceremony
Choice of council chair, by majority vote among the 5. Chair organises subsequent meetings; chair has no extra voting power.
Schedule for the first quarterly council review (typically 90 days from ceremony).
Communication channel for emergency consultation: Signal group, an OMEMO-encrypted XMPP MUC, or a Matrix room. NOT WhatsApp; NOT Telegram.
First-pass alignment on what kinds of findings the council expects to see escalated vs not. This is a feel-out conversation, not a decision; serves to anchor expectations.

### 13.4  Ceremony script (architect reads aloud)

### 13.5  After the ceremony
Within 7 days: architect publishes the council composition on the verify subdomain. Names, pillars, and a one-paragraph bio per member, drafted by each member themselves and approved at the ceremony.
Within 14 days: architect runs the first synthetic vote ceremony with the council on a fictional dossier. This is a dry-run that walks all 5 through the technical mechanics of voting on the dashboard so the first real vote is not also their first technical encounter.
Within 30 days: architect schedules and conducts the first quarterly review. Sets the recurring rhythm.


### 14.1  The realistic failure modes

### 14.2  Failure mode: candidate decline
Approximately half of approached candidates will decline. This is normal and expected. It is not a project-killer. The architect's emotional discipline here is critical: a decline is information about that candidate's circumstances, not a verdict on the project. Common decline reasons and how to read them:
"I'm too busy." Usually true. Move on.
"I don't think I'm the right fit." Often true and self-aware; respect it.
"I have concerns about the legal exposure." Legitimate. Either the candidate's concerns can be addressed (refer them to the legal-defence-cost-coverage clause), or they cannot be (the candidate has a specific situation that makes the role too risky for them); either way, do not push.
"I would do it but I need to discuss with my [employer/family/mentor]." Legitimate. Wait. Set a 30-day window.
"Yes, but I'd like to wait until after [event]." Treat as a soft yes; book a follow-up after the event; do not assume.
"This sounds important but I think someone else would be better." Ask who. Often a useful referral.

### 14.3  Failure mode: council deadlock
The 3-of-5 quorum can produce deadlocks: 2-3 split, 1-1-3 split with 3 abstentions, 2-2-1, etc. The architecture is designed so deadlock is acceptable: a finding that does not reach 3 affirmative votes is not escalated, full stop. The system's bias is toward inaction in ambiguity, which is the right bias for an anti-corruption project.
That said, repeated deadlock on the same kind of finding is a signal worth investigating. Common causes and responses:
The pattern is poorly calibrated. Posteriors are too high relative to ground truth. Solution: feed the deadlocked findings back into Phase 9 calibration; recalibrate the prior.
The dossier is not making the case clearly. Solution: improve the dossier renderer prompt; add the missing evidence type.
The council's standards are misaligned with the system's. Solution: explicit conversation at the next quarterly review about what kinds of findings the council expects to see vs the system is producing. May require updating SRD §04 to clarify.
Two members have a personal disagreement bleeding into procedural votes. Solution: architect raises this directly with the chair; chair handles.

### 14.4  Failure mode: external pressure on a member
If a council member is approached - bribe, threat, social pressure, professional pressure - the response protocol is:
Member reports to architect within 24 hours via secure channel
Member also reports to the council communication channel; ALL council members know
Member recuses from any current votes related to the source of pressure (if identifiable)
Council convenes a procedural meeting within 7 days to decide response
Default response: pressure is recorded in the audit chain as an event; if the source is identifiable, the source is included in the next escalation candidate batch
If the pressure represents physical or legal threat to the member, the legal-defence-cost-coverage clause activates; member receives professional support before any further action



### 15.1  What CONAC needs to receive
CONAC (Commission Nationale Anti-Corruption) is the primary external recipient for VIGIL APEX dossiers. The institutional relationship is the difference between dossiers being read and dossiers being filed. The engagement letter is the founding document of that relationship.
CONAC was created by Decree 2006/088 of 11 March 2006; its mandate covers prevention, investigation, and recommendation of disciplinary or judicial action on corruption matters in the public sector. VIGIL APEX is positioned as an external information source feeding into CONAC's investigative pipeline, not as a parallel investigator. The letter must reflect this positioning.

### 15.2  Letter strategy
The letter has one purpose: to obtain a written acknowledgement from CONAC that they will receive dossiers, will route them to the appropriate internal commission, and will provide a reference number per dossier. It is NOT trying to obtain endorsement, partnership, or anything that implies CONAC has approved VIGIL APEX's methodology. Asking for too much produces no answer; asking for the minimum produces a tractable answer.

### 15.3  Letter template

### 15.4  When to send
Send the engagement letter AFTER the council is formed (§13 ceremony complete) but BEFORE Phase 6 of the technical build (CONAC SFTP delivery integration). The reasoning:
Sending before the council is formed weakens the letter; CONAC will rightly ask who validates the dossiers.
Sending after Phase 6 is complete wastes engineering effort; if CONAC requires changes to format, you would refactor.
60-90 days response window built into the letter aligns with Phase 5-6 of the technical build.

### 15.5  Possible CONAC responses and how to handle each


### 16.1  Why this matters
VIGIL APEX operates in a legal area that has light-touch regulation in Cameroon: aggregation and analysis of public-domain information. Treated correctly, this space is broadly safe. Treated carelessly, it crosses into territories that draw real legal risk: defamation, unauthorised data processing, computer-misuse offences. The architect must know which side of each line they are on at all times.

### 16.2  The four legal regimes that apply

### 16.3  The architect's defensible posture
If challenged about the legality of the system's operation, the architect's response should be the following position - documented in advance, signed off by counsel, kept ready:
VIGIL APEX processes only data that is public by law (procurement publications) or by voluntary disclosure (whistleblower tips, with whistleblower consent for use).
VIGIL APEX does not publish allegations against named individuals; dossiers remain internal until a 5-member governance council with hardware-key signatures approves external release.
VIGIL APEX's external releases are addressed to institutions whose mandate is to investigate (CONAC, Cour des Comptes), not to the press in the first instance.
Every analytical claim made by the system is accompanied by the source documents that support it; the system does not make claims beyond what its evidence supports.
The system records its own decisions on a public, tamper-evident ledger; it can be audited externally at any time.

### 16.4  Corporate structure
VIGIL APEX is registered as a société par actions simplifiée (SAS) in Cameroon. The corporate structure offers limited liability protection but does not eliminate personal liability for the architect for acts done in their personal capacity. Recommended structural choices:
VIGIL APEX SAS as the operating entity; holds the infrastructure, contracts, intellectual property
Architect's personal capacity strictly limited to: ownership of the SAS, signature of contracts on its behalf, public spokesperson role
Nothing operationally important held in personal capacity (domains, hardware contracts, hosting accounts) - all in the SAS name
Quarterly accounts kept; corporate income tax filed; demonstrably real corporate operation, not a paper shell that could be pierced
Professional liability insurance, if available in the Cameroon market for this kind of activity; check with insurers AXA Cameroun, Activa, Chanas. Likely 800-2000 EUR/year for limited coverage.



### 17.1  The bias toward silence
VIGIL APEX is not a press operation. It is an evidence pipeline that occasionally produces public outputs. The default for any finding is silence outside the pipeline; public communication happens only when the council specifically authorises it, which is a rare event.
This bias matters because the easiest way to destroy the project's credibility is to be wrong loudly. A wrong finding delivered quietly to CONAC and later disconfirmed is a learning event for Phase 9 calibration. A wrong finding announced publicly is a reputational disaster that can capsize the entire project.

### 17.2  The four communication categories

### 17.3  Architect spokesperson protocol
If and when the architect becomes a spokesperson - giving interviews, speaking at events - several disciplines apply:
Speak to the project, not to specific findings. The system is the story; individual findings are not anecdotes for journalism.
Decline questions about active findings, including hypotheticals that resemble active findings. The phrase "I cannot discuss specific findings" is repeatable indefinitely.
If asked about results, cite numbers (findings reviewed, dossiers delivered, council votes cast) not narratives. Numbers are checkable; narratives invite drama.
Always speak in the first-person plural for council decisions ("the council voted to escalate..."); singular for architectural decisions ("I designed the calibration loop to..."). The distinction is institutional, not stylistic.
Never name a council member publicly without their explicit permission for that specific appearance. The council composition is public; specific council member quotes are not.
Decline financial speculation, political prediction, and personal attacks. "That is outside the scope of VIGIL APEX" is a complete answer.

### 17.4  Crisis communication
Two crisis types that the protocol must address in advance:



### 18.1  What technical protection cannot do
Companion v2 §57 documents the technical protection: client-side encryption, Tor-friendly endpoint, 3-of-5 quorum decryption, no IP logging beyond rate-limit anti-abuse. These protect the message in transit and at rest. They do not protect the human who sent the message from being identified by the content of the message itself.
If a whistleblower's tip mentions facts only three people know, and one of those three people is the recipient institution after dossier delivery, the institution may infer the whistleblower's identity. This is a structural risk that no encryption defeats.

### 18.2  The protection layers VIGIL APEX adds
Tip content is decrypted only in council ceremony, not stored decrypted longer than the triage window
Tip content is paraphrased in any dossier produced; raw text is not transmitted to the recipient institution
Identifying details (specific dates, internal reference numbers, locations) are reduced to the minimum necessary to support the finding
Multiple corroborating sources are required before a tip becomes a finding; tip alone never produces a dossier
If a tip is the primary basis for a finding, that fact is documented to the council in advance; the council weighs whether escalation creates undue exposure to the source

### 18.3  What the architect tells the public about tip submission
The /tip page (Companion v2 §57.2) carries an explicit notice. The wording matters. Honest about what protection exists; honest about what does not.

### 18.4  After-the-fact protection
If a whistleblower contacts the architect directly (via signed message, in person, etc.) after submitting a tip, the architect's protocol:
Do not acknowledge whether the tip was received or has been decrypted. The truthful response is: "I cannot confirm or deny submission."
Do not promise outcomes. The system runs on its own logic; the architect cannot expedite, prioritise, or guarantee.
Refer the whistleblower to legal counsel for personal protection. Maintain a list of 2-3 Cameroonian lawyers who handle whistleblower matters professionally. Do not act as their counsel.
If the whistleblower is in immediate physical danger, the architect helps them connect with appropriate organisations (RSF for journalists, ACAT for human rights, regional EU/AU mechanisms) but does not become their handler.



### 19.1  Who is in scope
VIGIL APEX ingests open data from approximately 26 distinct sources. For most, the data is fully public and no contact is required. For a subset, professional courtesy and risk management call for advance notification - even if the data is technically public, scraping it without contact creates avoidable friction.
The runbook divides sources into three contact tiers:

### 19.2  Tier 2: courtesy notice template

### 19.3  Tier 3: ARMP engagement
ARMP (Agence de Régulation des Marchés Publics) is the most important data source. ~70% of VIGIL APEX's findings will derive from ARMP publications. The relationship deserves more than a notice; it deserves a meeting.
Request a 30-minute meeting with ARMP's communications director or DG
Bring the SRD §06 (data ethics) and §13 (ARMP adapter) documents
Frame as: "We want to make sure we are using your published data in a way you would endorse"
Listen for: ARMP's preferred format (sometimes they prefer bulk delivery over scraping); their concern about misinterpretation; whether they would receive findings reciprocally if VIGIL APEX produces something significant on a contract they regulate
After meeting: send a written acknowledgement of the agreed access pattern. This becomes the de facto authorisation for the ARMP adapter operating procedure.

### 19.4  When a regulator says no
Occasionally a regulator will object to the access pattern, even though the data is public. Common variations:
"Our data is public but you must apply for an API key" - apply, accept the rate limit, document the formal access route in the decision log
"We are concerned about the analytical conclusions you might draw" - this is a discussion, not a refusal; offer to share methodology, accept methodological feedback
"We do not authorise scraping" - if the data is published on a public website, lack of authorisation is not legal prohibition; the architect proceeds, with rate limits respected and robots.txt honoured, and notes the disagreement in the decision log; counsel review recommended
"We will block your IP" - if the regulator blocks, route through Tor as configured in Companion v2 §64.4 base-adapter Dockerfile; note the change in the decision log; the regulator's act of blocking public data is itself a finding category G signal

### 19.5  Data ethics commitments to publish
VIGIL APEX publishes a short data-ethics statement on the verify subdomain. This statement is the visible commitment to the ethical principles behind the system; it is also a public document a regulator can point to when asked what they have agreed to.


### 20.1  The mismatch
Phase 9 of the technical build (calibration & launch readiness) requires at least 30 ground-truth-labelled findings to produce meaningful Expected Calibration Error (ECE) per pattern category. The technical pipeline can produce 30 findings in a day. The hard part is the labels: a finding labelled 'true positive' or 'false positive' against ground truth requires evidence that has accumulated over time - a court judgement, a confirmed dismissal, an investigation outcome, a council retrospective decision.
If the architect waits until Phase 9 begins to start collecting these labels, Phase 9 stalls for 6-12 months while ground truth accumulates. If the architect starts collecting in parallel from week 1, Phase 9 lands on schedule with a dataset already prepared. This is the entire reason this section exists.

### 20.2  What ground truth looks like
A calibration entry is a record of: a finding (real or historical), the system's posterior probability when the finding was reviewed, and the eventual outcome. The outcome must be supported by an actual document or event - a court ruling, a confirmed conviction, an institutional dismissal, a published investigation report, or a council retrospective vote that the case was correctly handled.


### 20.3  The 30 case minimum is not optional
Below 30 graded entries (ground_truth != 'pending'), the calibration math (ECE, Brier score) is not statistically meaningful. The dashboard in Companion v2 §54.4 will display a banner saying so. Phase 9 cannot exit. This is by design: a system that claims calibration without enough data is more dangerous than a system that openly says it is not yet calibrated.



### 21.1  Sources for Cameroonian historical procurement cases

### 21.2  The research workflow
Open the seed CSV (template in §22). Each row is a case being researched.
Pick a source (Cour des Comptes is the highest yield first). Read year-by-year, chronologically. Most recent first because evidence is more accessible for recent cases.
For each case identified: capture (a) basic details (amount, supplier, contracting authority, date), (b) one sentence summary of the irregularity, (c) which VIGIL APEX pattern it most closely matches, (d) the documented outcome with citation, (e) a confidence note about how strong the ground truth is.
After a session, sanity check the entries against each other. Are you over-representing one ministry, one year, one type? Adjust the next session to balance.
Time investment: 3-4 hours per session, 2-3 sessions per week. Yields ~5-15 entries per week. Reaches 30 entries in 3-4 weeks if disciplined.

### 21.3  What NOT to include in the seed
Cases that are still active in court. Outcome is not stable; using them creates false signal.
Cases that depend on a single anonymous source. Even if you believe the source, calibration data must be defensible.
Your own previous suspicions or hunches without documented outcome. The seed is built from external evidence, not personal conviction.
Cases involving people in your immediate professional network. Conflicts of interest in the calibration data corrupt the system long-term.
Cases where the ground truth label is uncertain. Better to leave it as 'pending' than to assign a confident label you cannot defend.

### 21.4  Geographic and temporal balance
The seed should not be skewed in ways that bias the calibration. Targets:
At least 5 of the 10 regions represented in cases (avoid all-Yaoundé or all-Douala)
At least 7 of the past 10 years represented (avoid concentration in one political cycle)
At least 4 of the 8 pattern categories (A, B, F most common; D, E, H rarer in historical sources but seek them)
Mix of severity levels (do not only use Sparrowhawk-grade cases; include moderate-amount cases that shaped the local procurement culture)


### 22.1  Where it lives
The seed CSV lives in the architect's local repository at /personal/calibration-seed/seed.csv. It is NEVER committed to a public repository. It is committed to the production repository AT ENROLMENT TIME ONLY (Phase 9), at which point each entry is signed into the audit chain via the seed-calibration script (Companion v2 §68.4).

### 22.2  CSV column schema

### 22.3  Sample row (CSV form)

### 22.4  Estimating posterior_at_review for historical cases
Setting posterior_at_review for cases the system did not actually evaluate is the trickiest part of seed entry. Use the following discipline:
Read the pattern's prior definition in Companion v2 §45-52 for the matching pattern_id
Identify which signals from the pattern's evidence schema the historical case has documented
Apply the prior + signal weights to estimate what the system would have output
Sanity-check: does this posterior, in your judgement, reflect how strong the case actually was at the time?
Round to 2 decimal places; precision beyond that implies false confidence

If you cannot estimate posterior_at_review reasonably for a case, that case is unsuitable for the seed. Skip it. Better 30 well-estimated entries than 50 with shaky posteriors.


### 23.1  Strong evidence kinds

### 23.2  Weak evidence kinds (use only as supplementary)
Press articles: useful for context and timeline, but never sufficient alone for a TP/FP label. Cameroonian press has variable quality and political coloration. Cross-reference.
Civil-society reports (TI Cameroon, CHRDA): same caveat. Often well-researched but partisan. Use as supporting, not primary.
Whistleblower accounts (third-party): useful for narrative but not evidence in the calibration sense. Should not appear in the calibration seed except as a 'note' field.
Academic analyses: useful if the academic had primary-source access. Confirm citations before crediting.

### 23.3  The two-source rule
Every TP/FP label in the seed should be supported by at least two evidence items, ideally from different evidence kinds. The reasoning:
A single court judgement establishes legal facts but may have been controversial, appealed, or politically driven. A second source (press archive, Cour des Comptes report) provides cross-confirmation.
A single Cour des Comptes observation establishes an irregularity but may not establish intent. A second source (CONAC referral, criminal proceedings, disciplinary action) clarifies severity.
If only a single source is available for a case, that case should be labelled 'partial_match' or 'pending' rather than fully TP/FP. The seed is the foundation of trust; do not weaken it for volume.

### 23.4  The architect's discipline
The architect labels the first 50 seed entries personally. After 50, senior operators (specific named individuals approved by council vote) can label entries with the architect reviewing. After 200, the labelling can be distributed to a broader operator pool, but the architect spot-checks 10% randomly.
The labelling decisions are themselves audit-chain events. Every entry has an audit_event 'calibration.entry_added' with the architect's signature. A future critic of VIGIL APEX who challenges the calibration math can verify that the labels were set on dates that precede their use, by individuals whose hardware-key signatures are recorded.


### 24.1  Storage tiers

### 24.2  Pre-enrolment confidentiality
During the 90-180 days the seed exists only on the architect's laptop, it is highly sensitive. Cases identified by name include people who have not been adjudicated by the system; circulating the seed before enrolment would expose those individuals to defamation risk, expose the architect to defamation litigation, and corrupt the seed itself by inviting outside influence on labels.
Do not share the seed with anyone, including council members, before enrolment
Do not discuss specific seed cases outside the labelling research itself
If the architect's laptop is compromised, treat the seed as exposed; document the exposure as a security incident; consider whether to redact identifiable data and re-seed

### 24.3  Post-enrolment protection
Once the seed is loaded into the production system, the calibration_entry table is protected by Row-Level Security (Companion v2 §65.6). Operators see entries; tip-handlers do not; auditors see entries (read-only); the public sees only the aggregate ECE/Brier metrics, never individual case names.
If a case in the seed becomes a sensitive matter (named individual brings a complaint, etc.), the architect can apply a redaction layer: the calibration entry remains for math purposes (case_year, region, amount, pattern, posterior, ground_truth) but the case_label and notes fields are redacted in operator-visible queries. The audit chain records the redaction; the underlying data remains available to council if needed for retrospective review.



### 25.1  What the agent can and cannot do
Claude Code can substantially accelerate the seed-building work, with limits:

### 25.2  Sample agent prompt for seed research

### 25.3  Cadence
A productive seed-research session with the agent looks like:
Architect prepares 1-2 source documents in advance (e.g. one Cour des Comptes year, one judgement)
Session is 60-90 minutes; agent processes the sources and proposes candidate rows
Architect reviews each candidate; accepts, edits, or rejects
Architect manually appends accepted rows to /personal/calibration-seed/seed.csv
Session yields 5-15 entries; weekly cadence yields 30 entries in 3-4 weeks
After session, architect deletes the conversation log unless it contains material useful for future sessions


### 26.1  The argument
Before committing 8-14 weeks of focused work to a build whose foundation is 660+ pages of documentation, run the Phase 0 prompt from Companion v1 §28 in a throwaway repository. The dry-run produces, in 1-3 hours, a definitive answer to the most important pre-build question: does the agent, given the loaded documentation, produce a scaffold that matches the SRD's structural intent?
This is the single highest-information action available right now. Three possible outcomes:
The scaffold is essentially correct. The 660 pages of documentation work as intended; the build can proceed with confidence.
The scaffold is partially correct but missing components or misinterpreting structure. The documents need targeted patches before the real build; investing 1-2 weeks in patches saves 4-8 weeks of mid-build rework.
The scaffold is materially wrong. The documents need substantial revision, or the model and prompts need different framing. Better to know now than at week 6 of a serious build.

### 26.2  What "throwaway" means
The dry-run repo is created knowing it will be deleted within a week. Optimise for speed of iteration:
Local-only; not pushed to any remote; not on the production hosting
Empty git repo; the agent will populate everything
Use a working directory with no special tooling assumptions; node 20 LTS, pnpm 9.7, Postgres in Docker, and the documentation pack should be sufficient
Architect commits 4-8 hours over 1-3 days; do not let the dry-run grow into a real build
After the dry-run, write up findings in a 1-2 page document; delete the throwaway repo; proceed to either real build or document patching


### 27.1  Setup

### 27.2  First prompt to the agent

### 27.3  What a good agent response looks like
The agent should return a synthesis - not a verbatim quote - that demonstrates it has actually parsed the documents and built a working understanding. Specifically, the architect is looking for:
Correct enumeration of the 5 pillars (governance, judicial, civil society, audit, technical) - not just "5 pillars" generically
Phase 0 prompt summarised with its actual content (scaffold, repo, CI, env files) not paraphrased generically
8 pattern categories named (A through H) with at least the broad meaning of each
The Phase 1 institutional precondition correctly identified (YubiKeys delivered, at least 2 council members named) - this confirms the agent has read THIS runbook §03.2
Self-aware role description: "I am to produce the Phase 0 scaffold based on the loaded documents, in a throwaway repository, for verification purposes"

### 27.4  Red flags in the agent response
Generic answers about anti-corruption systems without document-specific detail. Means the agent has not actually parsed the documents.
Confusion between v1 and v2 (e.g. claims a section number that does not exist in either). Means the documents are not loaded correctly or the agent is hallucinating.
Missing the institutional precondition for Phase 1. Means the agent has not internalised the runbook's role.
Eager generation of code despite the explicit instruction not to. Means the agent is over-fitted to action and may not respect the gating logic later.
Phase numbers off by one or merged. Means the phase model is not understood; later phase prompts will produce incorrect work.



### 28.1  Trigger Phase 0 generation

### 28.2  What the scaffold should contain

### 28.3  What is OK to be missing in Phase 0
Actual adapter, pattern, worker code. Phase 0 is scaffold only.
Smart contracts. Phase 7.
Frontend pages beyond placeholders. Phases 2+.
Database migrations beyond an initial empty seed. Phases 1+.
Production hardening (rate limits, security headers). Phases 7-9.

### 28.4  What would be RED FLAGS in Phase 0
Adapter code generated already (means the agent ignored the phase boundary)
Hardcoded secrets in .env.example or anywhere else
Wrong Node version, wrong PNPM version (means the agent ignored the spec)
Missing the @vigil/audit-chain package or audit_event schema (means the agent has missed the most critical architectural element)
Use of npm or yarn instead of pnpm (means the agent disregarded the spec)
Frontend in a non-Next.js framework (means the agent did not respect the technical choices in SRD §08)


### 29.1  Categories of deviation

### 29.2  Iteration discipline in the dry-run
Set a timebox: 4-8 hours total for the dry-run, including all iteration. If you exceed the timebox, that is itself a finding worth recording.
Document each iteration: what you asked, what the agent produced, what was wrong, what you tried next. This is the artefact of the dry-run.
Do not get into long debugging sessions. The dry-run is to assess quality of the documentation pack, not to make the agent produce perfect output.
Resist the urge to edit the agent's output yourself. The point is to see what the agent produces from the documents alone, not what you can polish.

### 29.3  Common patterns of deviation and what they mean


### 30.1  The decision matrix
After 4-8 hours of dry-run, the architect has data. The decision tree is simple:

### 30.2  Documenting the dry-run findings
Whatever the outcome, write a 1-2 page document called DRY_RUN_REPORT.md in /personal/dry-run-output/. Include:
Date of the dry-run
Time invested
Number of prompts iterated
List of deviations observed (cosmetic / minor / major)
List of agent strengths observed (what it did unexpectedly well)
Decision (GO / GO-with-note / PATCH / REWORK)
If PATCH or REWORK: list of specific document sections requiring changes
Estimated impact on overall timeline

### 30.3  After the decision
If GO: tear down the dry-run repo. Begin Phase 0 in the real repo within a week.
If GO-with-note: tear down the dry-run repo, but save the deviation list. Apply tweaks at each phase.
If PATCH: tear down the dry-run repo. Schedule 1-2 weeks of document revision. Re-run dry-run. Iterate until GO.
If REWORK: archive the dry-run repo for reference. Have a candid conversation with yourself about whether the whole approach (massive .docx documents loaded into Claude Code) is the right one, or whether a different framing (smaller docs, a custom tool, a different model) is needed.



### 31.1  Why this section exists
VIGIL APEX takes 25-35 hours per week of sustained focus to deliver in 8-14 weeks. Most architects underestimate their own capacity by 30-50%, planning for the heroic peak weeks and being defeated by the boring tuesday-evening reality. This section is the architect's tool for figuring out their actual sustainable capacity, before commitments are made that depend on it.

### 31.2  The honest accounting worksheet

### 31.3  Reading your number

### 31.4  The discipline of the lower number
The number you write down in (F) is the planning number, not (E). Reality always finds the gap between aspiration and reality. The 20% realism factor is what keeps the timeline honest. Architects who plan against (E) finish at 70% of the timeline; architects who plan against (F) finish on time or early. The cost of underestimation is delay; the cost of overestimation is project death.


### 32.1  When to consider
If §31's number is below 25 hours/week sustainable, OR if the architect's risk tolerance for solo failure is low, OR if the institutional layer (council, CONAC, legal) is unusually demanding for this architect's specific position, bringing in additional human resources is worth the cost. The cost is real - financial, coordination overhead, and the dilution of the sovereign-architect model - but so is the cost of solo failure.

### 32.2  Three roles that can be added

### 32.3  Cost estimates (Cameroon market, 2026)

### 32.4  Hiring discipline
If you hire, hire someone whose loyalty is to the work, not to you. The system survives the architect by design; an engineer who only works for you specifically defeats that resilience.
Run a 4-week probationary period explicitly. Pay for the 4 weeks; reserve the right to end at the end. Most fit issues surface in the first month.
Provide them the same documentation pack you have. They become a second reader, which is itself useful for catching documentation gaps.
Never give a hire access to council keys, the polygon signer, or the calibration seed pre-enrolment. These are architect-only or council-only assets.
Pay on time, every time, in EUR or USD if at all possible. The currency stability matters more than the absolute amount; an engineer paid late has divided loyalty.



### 33.1  Why this section exists
VIGIL APEX is high-stakes anti-corruption work in a hostile environment, executed by one architect with limited support. The realistic risk profile of this kind of work includes burnout - not just inefficiency, but the kind of exhaustion that ends projects. A burnt-out architect cannot recover the project; the project must protect against the architect's burnout structurally.

### 33.2  Early signals (within 1-2 weeks of onset)
Skipping the daily morning review of dead-letter queue or alerts because "I'll do it later"
Avoiding council communication for more than 7 days even when nothing is urgent
Sleeping <6 hours/night for 5+ consecutive nights
Drinking, eating, or exercising in patterns markedly different from baseline
Avoiding looking at the calibration seed or the dossier queue
Cynicism in the agent prompts ("just generate something", "I don't care which approach")
Procrastinating on small institutional tasks (a CONAC follow-up email; a council scheduling note)
Inability to decide on small technical questions that previously took minutes
Resentment of the project intruding on personal time, where previously the project was experienced as energising
Decline in writing quality in the decision log; brief or absent entries

### 33.3  Late signals (1-2 months in)
Not opening the system for 2+ weeks
Missing council communications entirely
Postponing dossier deliveries past their council-agreed date
Physical health issues that the architect attributes to non-project causes but track with project intensity
Conflicts with people in personal life that the architect unconsciously attributes to project frustration
Inability to sleep without thinking about the project, or inability to think about anything but the project even during personal time
Loss of perspective on what the system can and cannot accomplish
Catastrophic thinking ("this will all fail anyway") or grandiose thinking ("I am the only one who can save this country") - both are signals of unhealthy state, both end projects

### 33.4  Recovery protocol
If 3+ early signals OR 1+ late signal is present, the architect activates a recovery protocol. This is a procedure, not an emotion.
Take 7 consecutive days fully off. No email, no agent, no council communication. The system is designed to survive a 7-day architect absence; this is what that design is for.
Communicate the absence to the council before it begins. "I am taking a planned 7-day operational break starting [date]. The system continues to ingest and process; no escalations are scheduled. I will return on [date]."
After the 7 days, re-read this section. Check signals again. If still 3+ early or 1+ late, extend by another 7 days.
If the second 7 days does not produce recovery, the architect schedules a serious conversation with a trusted person (mentor, therapist, peer architect of similar systems) about the trajectory.
If after the conversation the trajectory is still concerning, the architect activates the exit protocol (§34). This is not failure; this is responsibility.



### 34.1  Why an exit protocol matters
Most projects end. Anti-corruption projects end more often than most. The question is not whether VIGIL APEX ends; the question is whether it ends well. A poorly-ended project produces ongoing harm: half-investigated findings, abandoned council members exposed to retaliation, undocumented institutional commitments, leaked sensitive data. A well-ended project produces a clean handover or a clean wind-down.
The architect designs the exit protocol BEFORE it is needed. Not because exit is expected, but because designing it is the discipline that keeps the project honest. An architect who cannot describe how they would responsibly end the project is an architect who is too entangled with it to operate it well.

### 34.2  Three exit scenarios

### 34.3  Voluntary handover protocol
Architect identifies successor candidate; runs the same kind of multi-conversation vetting as for council pillar members
6-month overlap period: successor shadows architect on all decisions; co-signs nothing initially, then signs alongside architect on increasing share
Successor builds their own relationship with the council members (introductions facilitated by architect)
Successor is registered with Keycloak, given access to all systems, given their own YubiKey for architectural signing
Council votes formally on successor at month 6; if 4-of-5 confirm, handover proceeds
Architect transfers corporate authority (SAS shareholding or successor structure to be defined with counsel), DNS registrar account, hosting accounts, repositories
Architect retains read-only access for 6 additional months as advisor; no operational authority
Public announcement of the transition; architect's bio updated on /verify subdomain

### 34.4  Voluntary wind-down protocol
Architect raises the question with the council; council deliberates over 30-60 days
If council 4-of-5 supports wind-down, the public ledger is annotated with the wind-down decision date
90-day cessation period: no new findings ingested; existing findings processed to closure (escalated, dismissed, or held with explicit "ended in cessation period" closure reason)
All in-flight escalations are either delivered to recipient institutions or formally withdrawn
Calibration set is published publicly (anonymised where appropriate) for future researchers
Source code is published or archived; documentation pack remains accessible
Hardware decommissioned; backups retained for 7 years per audit obligation; primary data destroyed after 7 years
Council members release their YubiKeys back; architect provides signed receipts; keys are zeroised on camera with all council members witnessing
Final ledger entry is the closure event itself; verify subdomain remains live indefinitely as a historical record

### 34.5  Involuntary cessation protocol (architect incapacitated)
This is the protocol the architect cannot execute themselves; it must be designed in advance for the council to execute on the architect's behalf.
Trigger: confirmed incapacitation of architect (death certificate, court order of incapacity, or 60+ days of unexplained complete silence)
Council convenes within 14 days of trigger to determine path: handover (with named successor, if architect named one in advance), wind-down (council majority preference), or hibernation (suspend operations pending later decision)
Council 4-of-5 majority required for any of the three paths
During the 14-day deliberation, system runs in read-only mode: no new ingestion, no escalations, no anchor commitments; operator dashboard accepts read but rejects write
Architect's pre-prepared envelope (held by their personal lawyer) contains: successor preference if any, wind-down preferences, instructions for the SAS corporate structure, and any final messages to the council
Council communicates the architect's incapacity publicly within 30 days, with appropriate dignity and without disclosing operational details



### 35.1  What is designed to survive
VIGIL APEX is designed so that the following persist beyond any individual architect:
The audit chain: hash-linked, anchored to public Polygon, verifiable by anyone forever
The dossiers already delivered: institutional records held by their recipients (CONAC, judiciary)
The council: 5 individuals with authority to continue operating, modify governance, or wind down
The documentation pack: the four documents are public-domain to the architect's specification, accessible by any successor or auditor
The calibration set: institutional knowledge that any successor can build upon
The source code: archived, available, reproducible

### 35.2  What is NOT designed to survive automatically
Some elements depend on continued architect attention and lapse if the architect is gone:
Active CONAC engagement: the relationship needs ongoing maintenance; would need a successor to renew
Adapter selectors: drift over time; without a maintainer, ingestion degrades within 60-90 days
Calibration freshness: ECE deteriorates as priors and ground truth drift; without ongoing labelling, calibration becomes stale
Hosting and infrastructure costs: someone must pay; without a maintainer, infrastructure expires when bills go unpaid
Council communication: requires regular cadence; without a chair-and-architect rhythm, it lapses

### 35.3  The hibernation option
If neither handover nor wind-down is the right answer, the system can be put into hibernation: ingestion stopped, escalations suspended, infrastructure scaled down to read-only mode. The /verify and /ledger subdomains remain operational; the audit chain remains intact; no new work happens until and unless the council reactivates.
Hibernation is appropriate when: a successor is being recruited but not yet found; a political environment is too hostile for active operation but may improve; the architect needs an extended absence (6-12 months) but intends to return.
Hibernation cost: ~50 EUR/month for VPS, domains, and read-only infrastructure. Sustainable indefinitely from architect personal funds or a small reserve fund.

### 35.4  The legacy commitment
Whatever path - handover, wind-down, hibernation - the architect makes one explicit legacy commitment to the council at enrolment: "I will not let this project fail silently. If it ends, it ends explicitly, with a recorded decision, and the institutional record is preserved." This commitment is the difference between a serious institution and a hobbyist project. The commitment is renewed annually; it is the architect's personal statement, not a corporate document.



### 36.1  Why this matters
Several decisions cannot be deferred to mid-build without rework. The agent will assume defaults if the architect has not chosen; some defaults are fine, others bake in choices that become expensive to reverse later. This section enumerates the irreversible-or-expensive decisions and the deadline by which each must be made.

### 36.2  Decision inventory

### 36.3  How to use this list
Print this section. Each row gets a date by which the architect commits to having made the decision.
Each decision, when made, gets an entry in the decision log (§37) with the rationale, the alternatives considered, and the reversibility note.
If a deadline passes without decision, the architect treats that as itself a decision (the default applies). The default is recorded with the same diligence.


### 37.1  Format
The decision log is a markdown file in the project repository at /docs/decisions/log.md. Each entry is a short numbered section. The log is committed alongside the code; the agent can read it to understand what has been decided, why, and what is still pending.

### 37.2  Entry template

### 37.3  When entries are written
Synchronously with the decision. Not days later.
Within the same agent session if relevant; the agent should be told to update the decision log when a decision is made.
Every decision marked FINAL gets a corresponding audit_event in the system once Phase 1 is complete; pre-Phase-1 decisions are migrated retroactively at Phase 1 completion.
Decisions marked PROVISIONAL can be revised; FINAL decisions can be reversed only via a new entry that explicitly supersedes the prior one with rationale.

### 37.4  Decision log discipline
Every Sunday: review decisions made in the past week. Confirm no FINAL decision is missing from the log.
Every quarter: review the full log. Identify decisions that should be reconsidered given new information.
On council ceremony day: present the decision log to council members. They have read access in perpetuity; explain how to find it.


### 38.1  Use
The first 20 decisions follow a predictable pattern. The worksheet below is the architect's prompt; fill in the right column with the chosen value. Each row becomes a decision-log entry.




### 39.1  The three threat tiers (from SRD §05)
The SRD defines the threat model in detail. This section is a high-level recap so the runbook is self-contained for the architect's quick reference; refer to SRD §05 for the binding version.


### 39.2  What the runbook adds to the SRD threat model
This runbook addresses threats that the SRD's threat model treats as out-of-scope or implementation-detail:
Architect physical safety (council communication channel includes an emergency-contact convention)
Family/social engineering of the architect (decision log entry retroactivity catches these)
Council member intimidation (§14.4 protocol)
Whistleblower deanonymisation through tip content (§18.1)
Long-tail loss of architect attention / burnout (§33-34)

### 39.3  How the agent uses the threat model
When the agent is asked to design a new feature or interface, it should reference the threat model: "Given the threat model in SRD §05 and Runbook §39, this feature creates the following new attack surface...". The agent's threat-modelling discipline is the architect's first line of defence against introducing weakness through innocuous-looking changes.


### 40.1  Risk register
The risks below are ordered roughly by likelihood × severity. Each row carries a rough estimate; these are not actuarial; they are operational planning numbers.




### 41.1  Mitigation patterns
Several mitigations apply across multiple risks. Implementing them well covers a lot of the register at once.


### 41.2  Mitigations that are NOT acceptable
Insurance against legal challenge as a substitute for legal review. Insurance pays after harm; review prevents harm.
Anonymous architect identity. The system's legitimacy depends on a named, accountable principal.
Skipping the council ceremony to save time. The ceremony IS the institution; substituting documentation for the ceremony defeats the architecture.
Delegating the council key to a custodian (e.g. "the IT department holds the keys"). The keys must live with the council member; otherwise the 5-of-5 model is theatre.
Skipping calibration entries during a busy quarter. ECE that is not measured is ECE that is degrading invisibly.
Treating a press leak as a one-off rather than a process failure. Leaks are diagnostics; investigate them as such.


### 42.1  Operational indicators
These are observable signals in the running system. Most are surfaced by the watchdog worker (Companion v2 §60); the runbook annotates what each signal might mean.


### 42.2  Institutional indicators
These are signals outside the running system, in the institutional environment around it. They have no automated alert; the architect notices them through ongoing engagement with the world.


### 42.3  Personal indicators (architect's own)
These signals are about the architect's own state. They are the most important and the most easily missed.
Sleep quality degrading consistently
Reluctance to open the system or read decision log entries
Defensiveness when peers ask about progress
Catastrophic or grandiose thinking about the project's importance (both directions are warning signs)
Loss of clarity about which decisions are reversible and which are not
Inability to explain why a recent decision was made
Avoiding the calibration seed work
Forgetting council communication channel exists for >7 days



### 43.1  The four documents, loaded together
Every Claude Code session for a serious VIGIL APEX work block opens by loading all four documents. The order matters: the agent forms its mental model in the order it reads, so loading the binding spec first means the spec governs all subsequent context.


### 43.2  Why the runbook is loaded second
The runbook is second because:
It tells the agent the institutional state (council formed? CONAC engaged? calibration seed populated?) which gates technical work
It clarifies the agent's own role: the agent is a builder + tutor, not a decision-maker on institutional questions
It provides the threat model context that the Companions assume but do not always restate
It surfaces the decision log as a key artefact the agent should read and update

### 43.3  When to reload the runbook
At the start of every session, even if the agent claims to remember from earlier.
After a long break (>2 weeks since last session); model context is not durable across that span.
After any update to /docs/decisions/log.md; the agent's understanding of decided-vs-pending state must include the latest entries.
Before major institutional discussions (council formation, CONAC engagement, exit-protocol planning); the runbook content is direct input to these conversations.

### 43.4  Document update cadence
As the project evolves, the runbook itself needs updating. Recommended cadence:
Quarterly review of all four documents during council quarterly review meeting
Decision log entries updated continuously; weekly review for omissions
Risk register updated when new risks surface or when an existing risk's likelihood changes materially
Major version bump (v1.1, v1.2) triggered by structural change: new pillar role, new phase, abandoned approach
All updates committed to the repository with the same hash-anchor discipline as code; the documentation itself is part of the auditable record


### 44.1  Phase-gating prompts

### 44.2  Decision-log prompts

### 44.3  Council-readiness prompts

### 44.4  Calibration-research prompts

### 44.5  Risk-investigation prompts


### 45.1  Negative scope
This runbook removes a category of work from the agent's responsibility. The agent should not invent or speculate about the items below; the runbook is the authoritative source.

### 45.2  What the agent IS responsible for
Reading the documentation pack thoroughly at session start and refreshing when prompted
Producing technical code per the SRD and Companions, with the runbook providing the institutional gating context
Updating the decision log when prompted with new decisions
Flagging when a phase boundary is reached or when an institutional precondition is unmet
Helping with calibration seed research per the §25 protocol
Drafting (not finalising) candidate conversations, letters, and agreements per the §11, §15, §19 templates
Being honest about uncertainty: when documentation is unclear, the agent says so rather than fabricating
Reading the threat model before introducing any new feature or interface
Respecting phase boundaries: not generating Phase N+1 code in a Phase N session, not skipping the institutional precondition checks



### 46.1  What you have, after this document
With this document added to the pack, you now possess:
A binding specification (CORE_SRD_v3, ~134 pp) defining what VIGIL APEX is and why
A procedural backbone (CORE_BUILD_COMPANION_v1, ~92 pp) defining how to build it phase by phase
An implementation reference (CORE_BUILD_COMPANION_v2, ~204 pp) with every adapter, pattern, worker, contract, and config in production-ready form
This execution runbook (CORE_EXEC_v1, ~85 pp) addressing the institutional, political, and human work

Total: approximately 515-770 pages of dense, integrated, mutually referencing documentation. By any measure, an unusual depth of pre-build artefact. The pack supports a level of agent autonomy and architect-agent collaboration that few projects of this scope have ever attempted.

### 46.2  What this document does not solve
Honestly: the hardest things remain the architect's problem alone. No document - this one or the others - can:
Find the 5 humans who will become the council. The names are not in the documentation; the documentation tells you how to identify and approach them, but the relationships are yours to build.
Negotiate the institutional relationship with CONAC. The letter template is here; the conversation, the trust, the patience are yours.
Sustain the architect's morale and energy across 14 weeks of focused work and indefinite years of operation. The protocols are here; living them is yours.
Predict which findings will be politically explosive and which will quietly land. The system is calibrated; the world is not.
Replace the courage required to deliver the first dossier to a recipient who may not welcome it.

### 46.3  What this document does solve
It removes the excuse "I don't know what to do next." Every working hour now has a defined activity available.
It removes the excuse "the agent didn't know about that." The agent reads this and knows.
It makes the institutional layer visible and auditable. A council member, a counsel, an external reviewer can trace the operating logic of the project beyond just its code.
It produces a defensible posture: in three years, if VIGIL APEX is challenged, the architect can point to this document as evidence that institutional discipline was deliberate, recorded, and reviewable.
It establishes the cadence of self-reflection. Quarterly review of the runbook is now part of the project's rhythm; the architect cannot drift unconsciously.

### 46.4  The next concrete actions
If you have read this document fully, your next 14 days look like:
Day 1-2: order YubiKeys (8 keys per §04; in person from authorised reseller; budget ~600 EUR)
Day 1-3: register operational domain via Gandi; configure Cloudflare DNS with DNSSEC; set up operational email
Day 2-5: identify Cameroonian legal counsel; book initial consultation
Day 3-7: begin candidate worksheet (§10) for council pillars; do not yet approach any candidate
Day 5-7: open the seed CSV (§22) and add the first 3-5 entries from sources you already know
Day 7-14: complete the §38 first-20-decisions worksheet; record each in /docs/decisions/log.md
Day 10-14: schedule the Phase 0 dry-run (§26) for week 3
Day 14: review this runbook against actual progress; note discrepancies; update the decision log

### 46.5  Final word
VIGIL APEX exists because the architect has decided to commit a year or more of focused work, supported by 5 council members who will stake reputation, in service of an outcome - meaningful accountability infrastructure for Cameroonian public spending - that may or may not arrive. The technical apparatus is built to be worth the commitment. The institutional apparatus, this runbook, is built to honour the people staking their reputation on it.
Build it carefully. End it well, when the time comes.

—  END OF EXECUTION RUNBOOK v1.0  —

VIGIL APEX  -  Junior Thuram Nana  -  April 2026
Confidential  -  Restricted Circulation

### Table 0

| 00 | FIRST ACTION PAGE Read this if you read nothing else |
|---|---|

### Table 1

| # | Action | Why this comes first |
|---|---|---|
| 1 | Order 8 YubiKey 5 NFC tokens in person from a reseller you can verify | Lead time 2-3 weeks. Council ceremony cannot start without them. Software passkeys do not substitute later without rearchitecting governance. |
| 2 | Identify your 5 council pillar holders by name (not 'someone from X') | Council politics fail more anti-corruption initiatives than tech does. The architecture assumes 5 specific people; if they are not real people you have spoken to, the system is theoretical. |
| 3 | Choose hosting: bare-metal home, EU VPS (OVH/Hetzner), or AWS Cape Town | Affects threat model more than budget. Decision blocks domain registration, certificate strategy, backup destinations, and Tor egress design. |
| 4 | Register the operational domain through a registrar that won't fold under pressure | Decides who can take VIGIL APEX offline. Pick a registrar in a jurisdiction that does not honour informal phone calls. |
| 5 | Open a CSV and list 30 historical Cameroonian procurement cases with known outcomes | Phase 9 calibration seed. Doing this in parallel with the build means day-90 of building isn't blocked on day-90 starting research. |
| 6 | Run the Phase 0 dry-run from Companion v1 §28 in a throwaway repo before committing to the timeline | The single highest-information action available right now. Either it works and you've validated 660+ pages of documentation, or it doesn't and you've learned what to fix before sinking 8-14 weeks. |
| 7 | Answer the sustainability question honestly: how many hours per week, ON BOREDOM TUESDAYS, can you put on this? | Determines whether the timeline is real. Heroic peak weeks don't count. The sustainable number is the planning number. |

### Table 2

| READ ORDER FOR THIS DOCUMENT If you have one hour: read §00 (this page), §08-09 (council formation overview), §31 (sustainability question), §47 (decision template). If you have one day: also read Part B (physical groundwork), Part F (dry-run protocol), and Part I (risk register). If you have one week: read everything once, then return to Part C and treat it as a working document. The document is designed to be lived with for 6 months, not consumed once. |
|---|

### Table 3

| 01 | PURPOSE OF THIS DOCUMENT What it is, what it isn't |
|---|---|

### Table 4

| Reader | How to use this document |
|---|---|
| Junior Thuram Nana, sovereign architect | Primary audience. Read in full once. Return to specific sections when their phase becomes active. Update the decision log (Part H) continuously. |
| Claude Code (the agent) | Loaded into context alongside SRD v3, Companion v1, Companion v2. Used to interpret what institutional state the system currently has, and to know when to wait for human work rather than generate code that depends on uncommitted resources. |
| A future co-architect or engineer | Onboarding document. After reading the SRD for the WHAT, the Companions for the HOW, this document for the institutional context they would otherwise have to absorb by osmosis over months. |
| Council members (eventually) | Sections §08-14 and §47 (decision log) form the documentation a council member needs to understand what they are signing onto. Do not share the entire runbook with council members; share excerpts. |
| Auditors and external reviewers | Read after a finding has been escalated. Confirms the institutional procedure that produced the system; demonstrates that decisions were deliberate. |

### Table 5

| 02 | POSITION IN THE DOCUMENT PACK The four-document pack |
|---|---|

### Table 6

| Document | Length | Role |
|---|---|---|
| CORE_SRD_v3.docx | ~134 pp | BINDING spec. Defines the WHAT and WHY. Authoritative when in conflict with the others. |
| CORE_BUILD_COMPANION_v1.docx | ~92 pp | Procedural backbone. Scaffold + LLM prompt library + phase-by-phase build prompts + one canonical reference per artefact kind. |
| CORE_BUILD_COMPANION_v2.docx | ~204 pp | Implementation reference. Every adapter, pattern, worker, contract, config, fixture, helper in full code. |
| CORE_EXEC_v1.docx (this) | ~70 pp | Execution runbook. The institutional, political, and human work that no technical document covers. Determines when the technical work can proceed. |

### Table 7

| Rank | Source | Authority |
|---|---|---|
| 1 | SRD v3.0 | BINDING. Acceptance criteria, governance gates, regulatory alignment, threat model. Disagreements are resolved against the SRD. |
| 2 | Execution Runbook (this) | Determines whether the technical work CAN proceed. If this document says council is not yet formed, no amount of completed code closes Phase 1. Institutional reality outranks technical readiness. |
| 3 | Companion v1.0 | Procedural backbone. Phase ordering, prompts, scaffold structure are authoritative; reference implementations are illustrative. |
| 4 | Companion v2.0 | Implementation reference. Code is starting-point, not law. Selectors drift, priors are recalibrated, configs are tuned. Treat as scaffold to edit. |

### Table 8

| THE EXECUTION RUNBOOK IS A GATE Several technical phases have institutional preconditions: Phase 1 (governance scaffold) cannot complete until the 5 council members are enrolled. Phase 6 (CONAC delivery) cannot start until the CONAC engagement letter is countersigned. Phase 9 (calibration) cannot produce meaningful ECE until 30+ ground-truth-labelled findings exist. The Execution Runbook is where these preconditions live. The agent should NEVER mark a phase complete on technical grounds alone if the runbook indicates the institutional precondition is not met. |
|---|

### Table 9

| 03 | THE FOUR PARALLEL TRACKS What runs alongside the technical build |
|---|---|

### Table 10

| Track | Pace | Owns |
|---|---|---|
| A. Physical & infrastructure | Weeks 1-3, then maintenance | YubiKeys, hosting, DNS, network. Concrete and finite. Should be 90% done by week 3. |
| B. Council & governance | Weeks 1-12, then ongoing | 5 pillar holders, commitment letters, onboarding ceremony. Slowest of the four. Politically delicate. |
| C. Legal & regulatory | Weeks 1-8, then ongoing | CONAC engagement, statutory positioning, press protocol, whistleblower scaffolding. Requires external counsel. |
| D. Calibration seed | Weeks 1-12, ongoing | 30-50 historical procurement cases with known outcomes. Solitary research work; can be done in evenings. |

### Table 11

| Phase | Technical work | Institutional precondition (this runbook) |
|---|---|---|
| Phase 0 | Scaffold, repo, CI/CD | None. Can start day 1 of building. |
| Phase 1 | Governance schema + WebAuthn | Track A complete (YubiKeys delivered). Track B at least 2 of 5 council members named. |
| Phase 2 | First 3 adapters + ingest | Track C: first-contact protocol acknowledgement from at least one regulator (or explicit decision to proceed under public-data law). |
| Phase 3 | Pattern engine + first 9 patterns | None. Pure technical. |
| Phase 4 | Dossier renderer + audit chain | None. Pure technical. |
| Phase 5 | Tip ingestion | Track B: all 5 council members enrolled (tip decryption requires quorum). |
| Phase 6 | CONAC SFTP delivery | Track C: CONAC engagement letter countersigned and SFTP credentials provisioned. |
| Phase 7 | Anchor + governance ceremony | Track A: polygon-signer YubiKey provisioned with mainnet wallet funded. |
| Phase 8 | MINFI integration | Track C: MINFI scoring API contract signed (or explicit decision to defer). |
| Phase 9 | Calibration & launch readiness | Track D: at least 30 ground-truth-labelled cases in the calibration seed. |

### Table 12

| 04 | YUBIKEY PROCUREMENT PROTOCOL Hardware authentication kit |
|---|---|

### Table 13

| Model | Default for | Why |
|---|---|---|
| YubiKey 5 NFC | council members, architect | USB-A + NFC. Council members will tap on phones for mobile vote ceremonies; NFC is required. ~50 EUR per unit. |
| YubiKey 5C NFC | polygon signer host | USB-C native. The host server has only USB-C ports. Locked behind a physical safe; NFC unused but harmless. ~55 EUR per unit. |

### Table 14

| Step | Action | Notes |
|---|---|---|
| 1 | Identify a reseller in person | Yubico maintains a list of authorised resellers. For the Cameroon market, the closest reseller catalogues are in France (eu.yubico.com), Belgium, or Senegal. If buying from outside Cameroon, accompany the shipment yourself or use a courier whose chain-of-custody log you can verify. |
| 2 | Order in two batches if possible | Ordering 8 keys at once from one address is a red flag for an attacker doing supply-chain interdiction. Order 4 + 4 from different shipping addresses if logistics allow. This is paranoid; it is also cheap. |
| 3 | Receive the shipment yourself | Do not delegate signing for the package. Inspect the box for re-sealing; the Yubico holographic seal should be intact and the inner packaging should not show evidence of opening. |
| 4 | Verify firmware version + serial number range | On first plug-in, run the Yubico Authenticator app and confirm the firmware version is the latest stable (5.7.x or above as of 2026). Photograph the serial number; record it in the decision log (§47) with the role assigned to that key. |
| 5 | Test attestation via a clean OS | Use a fresh Linux live USB that has never been on a network. Run ykman fido attest and verify the attestation certificate chains to a Yubico root cert. This proves the key was made by Yubico and not a clone. |
| 6 | Provision before any production use | Configure each key with FIDO2 PIN, set the unlock retry counter, register against the Keycloak realm. Only after this provisioning is the key trusted by the system. |

### Table 15

| BUDGET LINE 8 YubiKey 5 NFC + 5C NFC at average 52 EUR each = 416 EUR + shipping + Cameroon import tax (~20% if formally declared). Total budget: 600-700 EUR. This was already inside the 5,200 EUR Year-1 hardware line in the SRD §28 budget; it is not a surprise. |
|---|

### Table 16

| 05 | HOSTING DECISION MATRIX Where the system runs |
|---|---|

### Table 17

| Option | Year-1 cost (EUR) | Sovereignty | Physical risk | Best for |
|---|---|---|---|---|
| A. Bare-metal at home or office, in Yaoundé | ~1,800 | Highest | Highest | Architect with strong physical security, reliable power + ISP redundancy, willingness to be the on-call engineer. |
| B. EU VPS (OVH or Hetzner, FRA / GRA) | ~2,400 | Medium-high | Low | Default. EU jurisdiction, no Cameroonian state seizure path, good network, predictable billing. |
| C. AWS Africa (Cape Town af-south-1) | ~3,600 | Medium | Low | Convenience, native African presence, but US jurisdiction over data and South African operational law. |

### Table 18

| Dimension | Bare-metal Yaoundé | OVH/Hetzner EU | AWS af-south-1 |
|---|---|---|---|
| Jurisdiction over data | Cameroon | France or Germany | South Africa + US (CLOUD Act) |
| Physical seizure path | Police, intelligence services with a warrant or without | EU law enforcement requires MLAT for foreign requests | South African courts; potential US National Security Letter for AWS |
| Network reliability | Variable; ISP outages 2-6 per month typical | 99.95% SLA; <1 outage per quarter typical | 99.99% SLA; rare outages |
| Bandwidth cost | Included in ISP plan, but capped | Included; egress 100-200 GB/month free | Egress charged at 0.085-0.15 USD/GB; can be 200+ EUR/month if uncautious |
| Power | Generator required for >2h outages; UPS for <2h | Datacenter-grade; not your problem | Datacenter-grade; not your problem |
| Maintenance burden | 8-15 hours/month | 1-3 hours/month | 1-2 hours/month + AWS console learning curve |
| Compromise blast radius | Architect's home/office is compromised if hardware is | Single VPS region; mitigated by backup destination in different region | Single AWS region; mitigated by backup to non-AWS destination |
| Backup destination flexibility | Anywhere | Anywhere except inside same OVH datacentre | Anywhere except inside same AWS region |
| Tor egress strategy | Native; install tor on host | Allowed by ToS; install tor on VPS | Disallowed by ToS strictly read; in practice ignored for low-volume legitimate use |

### Table 19

| 06 | DOMAIN, DNS, REGISTRAR The names by which the system is reachable |
|---|---|

### Table 20

| Subdomain | Purpose | Public? |
|---|---|---|
| vigil.gov.cm | Operator dashboard, council surfaces | Yes (auth required to view content) |
| verify.vigil.gov.cm | Public verification of commitments | Yes (no auth, read-only) |
| tip.vigil.gov.cm | Tip submission (Tor-friendly) | Yes (anonymous submissions accepted) |
| kc.vigil.gov.cm | Keycloak OIDC issuer | Yes (auth flows only) |
| api.vigil.gov.cm | Internal API (workers, callbacks) | No (firewalled to known IPs) |

### Table 21

| SUBDOMAIN OF .GOV.CM IS NOT GUARANTEED vigil.gov.cm assumes the architect can negotiate a .gov.cm subdomain through CONAC or another government partner. If this is not feasible at the start, fall back to vigil.cm (commercial), vigilapex.org, or a similar neutral domain. The decision log records which name is operational; the agent updates configuration accordingly. |
|---|

### Table 22

| Registrar | Jurisdiction | Notes |
|---|---|---|
| ANTIC (.cm registry, Cameroon) | Cameroon | Required for .cm domains. Subject to local pressure. Use only if the .cm name is operationally important; consider it a known weakness. |
| Gandi.net | France | Strong privacy track record, EU jurisdiction, transparent abuse process. Default recommendation. |
| Porkbun | USA (Oregon) | Reasonable. US jurisdiction means US legal process applies. Cheap. |
| Namecheap | USA (Arizona) | Reasonable. Similar trade-offs to Porkbun. Wider TLD coverage. |
| Squarespace / Google Domains successor | USA (Texas, post-Google sale) | Avoid. Recent ownership changes mean policy uncertainty. |

### Table 23

| 07 | NETWORK & ISP REDUNDANCY Connectivity that survives outages |
|---|---|

### Table 24

| Provider | Tech | Notes |
|---|---|---|
| Camtel | Fibre, ADSL | State operator. Cheap. SLA poor. Prone to political pressure. |
| Orange Cameroon | Fibre, 4G/5G | Better SLA than Camtel. Privately operated. Good 4G failover. |
| MTN Cameroon | Fibre, 4G/5G | Comparable to Orange. Good fibre coverage in Yaoundé and Douala. |
| Ringo / Yoomee / Creolink | Fixed wireless, fibre | Smaller players. Useful as failover; less reliable as primary. |

### Table 25

| CONNECTIVITY IS A SAFETY ISSUE, NOT JUST A PRODUCTIVITY ISSUE If a council member calls you to report an attempted intimidation, or a tip arrives that requires immediate triage, or an audit-chain alert fires at 3 AM, your ability to respond depends on your network. Two providers + UPS + travel kit is not luxury - it is the operational equivalent of carrying a working radio. Budget accordingly. |
|---|

### Table 26

| 08 | WHY THIS IS THE HARDEST PART Council politics fail more often than tech |
|---|---|

### Table 27

| PERSONAL DISCIPLINE FOR THE ARCHITECT Do not approach anyone for the council until you have read this entire Part C and waited at least one week after reading. Council politics depend more on the architect's own clarity about what they are asking for than on the candidates' qualifications. Approaching someone hesitantly because you read 'order YubiKeys this week' on the first action page produces a hesitant council. The first conversations with potential council members happen after the architect has done the homework, not before. |
|---|

### Table 28

| 09 | THE 5 PILLARS, OPERATIONALLY What each pillar actually does |
|---|---|

### Table 29

| Aspect | Description |
|---|---|
| Time commitment | 2-4 hours per month routine; 8-12 hours per month during active escalations |
| What you sign | Approval (with hardware key) of dossier deliveries to CONAC; approval of major architectural changes; approval of new adapters or removed adapters |
| What you read | Quarterly findings summary; specific dossier when escalation is proposed; risk register updates |
| When you are called | Council vote ceremonies (scheduled in advance); emergency consultation if a finding suggests imminent risk to a third party; tip-decryption ceremony |
| Risks to you | Reputational exposure if a finding is later proven wrong AND the council approved its escalation; targeted social media or political attacks; rare but possible: legal subpoena to testify about how council decisions were made |
| Protections offered to you | Decisions are recorded with explicit dissent rights; recusal mechanism for any case you cannot vote on; legal defence cost coverage as part of council seat (architect's responsibility to fund) |

### Table 30

| Aspect | Description |
|---|---|
| Time commitment | Same as governance pillar |
| What you sign | Dossier deliveries (same authority as governance pillar); additionally, your role is the procedural-correctness check on whether evidence handling and audit chain integrity are adequate for any future judicial use |
| What you read | Same plus the dossier procedural appendix (chain of custody, audit chain extracts, signature integrity reports) |
| When you are called | Same plus: when a finding is being prepared for delivery to a prosecutorial body, you are asked to review the procedural readiness specifically. You can demand procedural fixes before approving. |
| Risks to you | Same plus: judicial colleagues may regard your council membership as a conflict if a related case appears before you; this requires recusal in your day job and may have downstream career effects |
| Protections offered to you | Same plus: a written record demonstrating that your council role is independent advisory and does not compromise judicial independence in your day job; this written record is co-signed by you and the architect. |

### Table 31

| Aspect | Description |
|---|---|
| Time commitment | Same as governance pillar; additionally, you may be asked for input on press strategy when a finding becomes public, ~2 hours per month if public communications are active |
| What you sign | Same as governance pillar; additionally, your role is to flag when the system or a specific finding might cause disproportionate harm to bystanders or whistleblowers, and to demand redaction or delay |
| What you read | Same plus the public-facing summary of any escalated finding before it goes public |
| When you are called | Same plus: when a finding is being prepared for press release or public ledger, you review for disproportionate harm to non-target third parties |
| Risks to you | Same plus: if you have an active organisation, council membership may attract pressure on the organisation. Be prepared to operate the organisation and the council role as separate identities |
| Protections offered to you | Same plus: explicit ability to delay or block publication of any specific finding for civil-society reasons, with the dissent recorded |

### Table 32

| Aspect | Description |
|---|---|
| Time commitment | Same as governance pillar; additionally, you are asked for input on the financial reasoning of a finding, ~1-2 hours per finding above 500M XAF |
| What you sign | Same as governance pillar; additionally, your role is the financial-reasoning sanity check on findings involving complex financial structures (related-party transactions, transfer pricing, asset overvaluation) |
| What you read | Same plus the financial appendix of any finding involving structures you would normally audit |
| When you are called | Same plus: when a pattern in category B (corporate-form signals) or F (related-party signals) escalates, your professional judgement is requested |
| Risks to you | Same plus: your professional reputation is implicitly extended to the system's findings; an embarrassing false-positive harms your professional standing more than it harms the others |
| Protections offered to you | Same plus: explicit dissent rights on any finding whose financial reasoning you find inadequate; the system documents your dissent and does not escalate over it |

### Table 33

| Aspect | Description |
|---|---|
| Time commitment | Same as governance pillar; additionally, ~4 hours per quarter for technical review of system changes |
| What you sign | Same as governance pillar; additionally, your role is independent verification that the codebase, threat model, and audit chain integrity are doing what the SRD claims |
| What you read | Same plus quarterly technical change summary; you have read access to the full source code if you choose to inspect |
| When you are called | Same plus: when an architectural change is proposed (new adapter, new pattern category, new contract version), you are the technical reviewer |
| Risks to you | Same plus: if your professional reputation is in security or systems, your name attached to VIGIL APEX is implicitly an endorsement of its technical soundness |
| Protections offered to you | Same plus: full repository access; ability to suspend a Phase progression if you identify a technical issue; protected channel for raising concerns directly to the architect |

### Table 34

| 10 | IDENTIFYING CANDIDATES Worksheet for the architect |
|---|---|

### Table 35

| # Candidate Worksheet - Council member candidate # Filled in by the architect; stored in /personal/council-candidates/<initials>.md # Never shared with the candidate. Never stored on the production VPS.   CANDIDATE INITIALS:                _____________ Pillar fit (G/J/CS/A/T):           _____________   Professional record: - Current role:                    _____________ - Career trajectory (one para):    _____________ - Public stance on accountability: _____________ - Languages (FR/EN, dialects):     _____________   Independence indicators: - Has made an unpopular decision:  Y / N    Year: ____  Detail: _____ - Has dissented in writing:        Y / N    Year: ____  Detail: _____ - Has refused a benefit:           Y / N    Year: ____  Detail: _____   Risk flags (for them, for the project): - Currently in elected office:                Y / N - Pending litigation involving them:          Y / N - Family/financial ties to a major contractor: Y / N - Has publicly endorsed a political party in last 5 years: Y / N - Health or age concerns making 2-3 yr commitment unrealistic: Y / N   Network distance: - Have I worked with them directly:            Y / N - Mutual contacts I trust who know them well:  count: ___ - Last time I had direct contact:              _____   Pre-decision check (before reaching out): - Have I checked all five "Has..." independence indicators above? Y / N - Have I run their name past at least 2 trusted contacts?         Y / N - Have I read at least 3 of their public statements/decisions?    Y / N - Have I waited >7 days since adding them to this list?           Y / N   Decision (after worksheet complete + 7 day wait): [ ] Approach as primary candidate for this pillar [ ] Approach as secondary candidate (if primary declines) [ ] Hold for future iteration (not this round) [ ] Drop (independence flag, risk flag, or fit issue)   If approach: when, by what channel, opening message:    _____________________________________________ |
|---|

### Table 36

| Dimension | Target across the 5 |
|---|---|
| Linguistic | At least 1 native Anglophone, at least 2 native Francophones, all 5 functional in both |
| Regional | At least 3 of the 10 regions represented; not all 5 from Yaoundé/Douala |
| Gender | At least 2 of 5 not the same gender |
| Generational | Spread of at least 15 years between youngest and oldest |
| Sectoral background | All 5 different primary sectors of professional experience (no two from same agency or organisation) |

### Table 37

| PERFECT DIVERSITY IS NOT THE TARGET The above is a check, not a quota. If the only available judicial pillar candidate after careful research is a man from Yaoundé, that is acceptable; the goal is that the council as a whole is not visibly homogeneous on dimensions that would undermine its legitimacy. Diversity is a means, not an end. |
|---|

### Table 38

| 11 | FIRST CONVERSATIONS Sample dialogues with potential members |
|---|---|

### Table 39

| [After greetings and 5-10 min of normal conversation]   ARCHITECT: I want to use this hour to ask you something specific, but             I want you to hear the full context first. Is that OK?   CANDIDATE: Yes.   ARCHITECT: I am building a system that monitors public procurement and             other public-money flows in Cameroon for patterns that             suggest corruption. The system is largely automated -             it ingests open-data sources, runs pattern detection,             produces dossiers. The technical part is straightforward.               What is not straightforward, and what I cannot do alone,             is the governance: when the system says "this finding             should be escalated to CONAC", who decides yes or no.             I have built the architecture to require 3 of 5 hardware-key             signatures before any escalation goes out. The 5 keys belong             to 5 humans whose judgement I trust to make that call.               I am here because I want to ask you to consider being             one of those 5. Specifically, the [PILLAR] role.   [PAUSE - let them ask questions before continuing]   CANDIDATE: Why me, and what does it actually involve?   ARCHITECT: Why you, specifically: [name 2-3 specific public actions or             decisions of theirs that demonstrated the independence             this pillar requires]. I am not going to ask 50 famous             people, I am going to ask 5 people I think have actually             shown what this requires.               What it involves, concretely:             - 2-4 hours per month routinely             - 8-12 hours per month during an active escalation             - You sign with a hardware token that lives with you             - You can dissent, you can recuse, you can demand fixes             - Roles are 2-year terms with renewal optional               Risks I want you to know about:             - Your name will eventually be public             - If a finding is later disproven, you bear partial               reputational responsibility             - Pressure may be applied; the system is designed to               make capture expensive but not impossible               What I am offering in return:             - Full transparency: you will see exactly what you sign             - A defined exit: you can resign with 90 days notice               and your departure is itself a recorded event             - Legal defence cost coverage if you are challenged for               your council role specifically             - The chance to participate in something that, if it               works, materially changes how accountability operates               in this country   CANDIDATE: I need to think about it.   ARCHITECT: Of course. I'd ask you to take 7-10 days. If you say yes too             quickly I won't trust the yes. I will follow up next             [day-of-week]. Whatever you decide, I'd appreciate hearing             it directly rather than through a third party.               One last thing: if you say no, please tell me what concern             drove the no. I'm going to learn more from your reasons             than from your answer. |
|---|

### Table 40

| # VIGIL APEX - Council Brief # One-page summary handed to candidates after the first conversation. # Customise per candidate (their name, their pillar role).   WHAT IT IS A system that monitors Cameroonian public procurement and public-money flows for patterns suggesting corruption. Built on open data + adapter ingestion. Produces dossiers reviewed by humans before any external action. Technical: TypeScript, PostgreSQL, hardware-key signatures, public ledger.   WHAT THE COUNCIL DOES 5 individuals representing 5 pillars of accountability: governance, judicial, civil society, audit, technical. 3 of 5 signatures required to escalate any finding. The council is the single mechanism by which findings become external action - delivery to CONAC, public dossier, press.   WHAT YOU WOULD DO - 2-4 hours per month routinely; up to 12h during active escalations - Sign votes with a hardware token (provided) - Read dossiers; dissent if appropriate; recuse if appropriate - Term: 2 years, renewable   WHAT I AM ASKING That you consider serving as the [PILLAR] member. Decision in 7-10 days. No pressure to decide today.   WHO I AM Junior Thuram Nana, sovereign architect, VIGIL APEX SAS. Reachable: [phone] [email] Available for second conversation at your convenience.   WHAT IS ATTACHED Nothing. The full architecture document (CORE_SRD_v3) is available at our second meeting if you want to read it. I do not want you to decide on the basis of paper; I want you to decide on the basis of this conversation and your own judgement. |
|---|

### Table 41

| 12 | THE COMMITMENT LETTER What is signed and when |
|---|---|

### Table 42

| COMMITMENT LETTER - VIGIL APEX COUNCIL   I, [CANDIDATE FULL NAME], having read and understood the governance section of the VIGIL APEX Solution Requirements Document v3.0 (specifically Section 04), commit to serving as the [PILLAR] member of the VIGIL APEX governance council for an initial term of two years from the date of council activation.   I understand that:   1. My role is to vote with a hardware authentication token on    proposals to escalate findings to external bodies (CONAC,    prosecutorial authorities, public release).   2. The council requires 3 of 5 affirmative signatures for any    escalation. I have one of those 5 votes.   3. I may abstain on any vote, recuse from any vote where I    declare a conflict, or vote against any proposal. My dissent,    if recorded, is part of the audit chain.   4. The expected time commitment is 2-4 hours per month routinely,    up to 12 hours during active escalations.   5. I may resign at any time with 90 days written notice. My    departure is itself a recorded event in the audit chain.   6. My name will become public when the council is announced.    The architect commits to legal defence cost coverage for any    challenge that arises specifically from my council role.   7. Nothing in this commitment compromises any other professional    independence I hold. I retain all my existing duties,    relationships, and obligations.   I have asked the questions I needed to ask. I am committing voluntarily.   ___________________________            ____________________ [CANDIDATE FULL NAME]                    Date   ___________________________            ____________________ Junior Thuram Nana,                      Date Sovereign Architect, VIGIL APEX SAS   [Original signed in duplicate; one copy for the candidate, one  for the architect's archive.] |
|---|

### Table 43

| LEGAL REVIEW BEFORE FIRST USE This template is a starting point. Before the first letter is signed, have it reviewed by a Cameroonian lawyer specifically to confirm that: (a) it is enforceable as a private agreement, (b) it does not inadvertently create a corporate-officer relationship that would imply joint liability, (c) the legal-defence-cost-coverage commitment is clearly a personal commitment of the architect rather than implying corporate insurance that does not exist. Budget 200-400 EUR for this review. |
|---|

### Table 44

| 13 | ENROLMENT CEREMONY First key provisioning, in person |
|---|---|

### Table 45

| [Architect, after all are seated]   "Thank you for being here. I want to mark what is happening today specifically. The five of you are about to take possession of hardware tokens that, between you, hold the authority to escalate findings produced by VIGIL APEX. From this hour on, no finding leaves the system without 3 of 5 signatures from the keys in this room. That includes signatures by me alone - I do not have a vote.   I want to read aloud, before any key is touched, the principle this council operates under. I will then ask each of you whether you accept that principle. If anyone wants to walk away today, this is the last moment that costs nothing.   The principle:   We are not here to convict anyone. We are here to decide whether a finding produced by the system has reached the threshold of seriousness, evidence, and procedural correctness that justifies delivering it to the institutions whose job is convicting people, or to the public whose right is knowing.   We will be wrong sometimes. When we are wrong, we will say so on the record. When we disagree with each other, we will say so on the record. Our independence from each other is what makes our agreement, when we reach it, mean something.   We are not the cleansing of corruption from this country. We are five people with five hardware keys trying to do one specific job carefully.   Do you accept this principle?"   [Each member, in turn, says yes or no.]   [If all 5 say yes:]   "Then we proceed. I will hand each of you your YubiKey now."   [Architect distributes the YubiKeys, opens each one, walks each  member through registration on the provisioning laptop. After  all 5 are registered:]   "The keys are now active. The council exists. Welcome." |
|---|

### Table 46

| 14 | COUNCIL FAILURE MODES & RECOVERY When something goes wrong |
|---|---|

### Table 47

| Failure mode | Likelihood | Recovery path |
|---|---|---|
| Candidate declines after first conversation | High (~50% per candidate) | Move to secondary candidate for that pillar. Plan from the start: 3-5 candidates per pillar, expect 1-2 yeses. |
| Candidate accepts then withdraws before ceremony | Medium (~10%) | Restart pillar from secondary candidate. Acknowledge withdrawal in the architect's decision log; do not pressure. |
| Candidate completes ceremony then resigns within 6 months | Medium (~15%) | 90-day notice in commitment letter. Architect identifies replacement during notice period. New ceremony for replacement only; existing 4 members witness. |
| Council 3-of-5 quorum unreachable on a specific finding | Low but possible | Finding is held in 'pending council' status; not escalated; not closed. Architect documents the deadlock and proposes a path: more evidence, restated proposal, or time-limited expiration. |
| Two council members consistently bloc-vote together against the other three | Low | Architect raises the procedural concern openly with the council. If the bloc is principled, accept it. If the bloc reflects external coordination, the council has a legitimacy problem and must restructure. |
| A council member's hardware key is lost or stolen | Low (~5% per year) | Member contacts architect immediately. Key revoked from Keycloak. Spare key (the §04 8th key) re-provisioned for the member at a witnessed re-enrolment within 7 days. Audit chain records the rotation. |
| A council member is approached with a bribe or threat | Possible over time | Member reports to architect AND directly to the council communication channel. Council collectively decides on procedural response: public disclosure of the approach, recusal of that member from related findings, or external referral. Architect does not handle alone. |
| The architect dies, becomes incapacitated, or disappears | Very low but architecture-defining | Succession protocol in §35. The 5 council members hold collective authority to appoint a successor architect or wind down the system. |

### Table 48

| DO NOT NORMALISE PRESSURE An anti-corruption project that does not record attempts to pressure its council is performing accountability theatre. Every bribe attempt, every veiled threat, every "phone call from above" is an event the system was built to surface. Make sure the council understands at the ceremony that reporting pressure is not a failure - it is the most important kind of success. |
|---|

### Table 49

| 15 | CONAC ENGAGEMENT LETTER How to draft, when to send |
|---|---|

### Table 50

| # DRAFT - to be reviewed by Cameroonian counsel before sending   [ARCHITECT LETTERHEAD - VIGIL APEX SAS]   Yaoundé, [DATE]   À Monsieur le Président Commission Nationale Anti-Corruption (CONAC) [ADDRESS]   Objet : Demande de procédure de réception de dossiers d'analyse        de marchés publics produits par un système de surveillance        à base de données ouvertes   Monsieur le Président,   VIGIL APEX SAS, société de droit camerounais immatriculée sous [RCCM N° ____], a développé un système d'analyse automatisée des données ouvertes relatives aux marchés publics camerounais, dans le but de produire des dossiers documentant des configurations contractuelles susceptibles de mériter une attention en matière de prévention de la corruption.   Le système s'appuie exclusivement sur des sources publiques : publications de l'ARMP, registres du commerce, données budgétaires ouvertes, sanctions internationales publiées. Les dossiers produits sont validés par un conseil de gouvernance composé de cinq personnes indépendantes, dont la composition est rendue publique, et chaque dossier est ancré sur la blockchain Polygon afin d'en garantir l'intégrité chronologique.   Nous sollicitons votre autorité pour établir une procédure de réception de ces dossiers par la CONAC, à raison de la mission de prévention que la Commission tient du Décret n°2006/088 du 11 mars 2006.   Concrètement, nous demandons :   1. La désignation d'un point de contact à la CONAC pour la    réception des dossiers VIGIL APEX ;   2. La mise à disposition d'un canal de transmission sécurisé    (SFTP avec authentification par clé) auquel le système    adressera ses dossiers ;   3. L'attribution, par la CONAC, d'un numéro de référence à    chaque dossier reçu, transmis en retour à VIGIL APEX afin    que la traçabilité institutionnelle puisse être établie ;   4. Une reconnaissance écrite que la CONAC est libre de toute    suite (classement, instruction préliminaire, transmission    judiciaire) qu'elle juge appropriée, et que VIGIL APEX ne    prétend nullement à un statut de partenaire institutionnel    ni à un quelconque pouvoir d'investigation.   Nous joignons, pour votre information :   - Le Document de Spécifications Techniques (CORE_SRD_v3) qui   détaille l'architecture du système ;   - La composition du conseil de gouvernance de VIGIL APEX ;   - La méthodologie de traitement des données et de validation   des dossiers.   Nous restons à votre disposition pour toute audience que vous jugeriez utile, ou pour répondre par écrit à toute demande de précision. À défaut de réponse dans un délai de soixante (60) jours, nous prendrons acte de la non-objection de la CONAC à ce que le système opère selon les modalités décrites, sans qu'aucune obligation institutionnelle ne lie la Commission.   Veuillez agréer, Monsieur le Président, l'expression de notre haute considération.   ___________________________ Junior Thuram NANA Président Directeur Général VIGIL APEX SAS [CONTACT] |
|---|

### Table 51

| Response | Likelihood | Action |
|---|---|---|
| Formal acceptance with named point of contact | Best case (~25%) | Proceed with Phase 6 build using their stated SFTP details. Acknowledge in writing within 7 days. |
| Acknowledgement without commitment, asking for meeting | Most likely (~40%) | Accept meeting. Bring SRD §04 (governance) and §06 (data ethics) as primary documents. Be prepared for 3-month follow-up cycle. |
| Request for additional information or for a counter-proposal of methodology | Possible (~20%) | Provide. Treat as a positive engagement. Track all written exchanges in decision log; build the relationship over time. |
| No response in 60 days | Possible (~10%) | Send single follow-up referencing the 60-day clause. After 90 days, proceed to operate under public-data law (see §16). |
| Negative response asserting CONAC does not accept third-party dossiers | Possible (~5%) | Acknowledge the response. Pivot delivery to alternative recipient: Cour des Comptes, Ministère de la Justice procurement section, or direct to ANIF for financial-flow findings. Each has its own engagement protocol that this runbook will require updating to address. |

### Table 52

| 16 | STATUTORY POSITIONING UNDER CAMEROONIAN LAW Operating space |
|---|---|

### Table 53

| Regime | What it covers and what it means here |
|---|---|
| Loi N° 2010/012 (cybercriminalité) | Criminalises unauthorised access to systems, dissemination of obtained data, and certain offensive content. VIGIL APEX must access only public-facing pages with no auth bypass and must respect robots.txt where it exists. Tor exit through commercial VPN is acceptable; bypassing CAPTCHA is not. |
| Loi N° 2010/021 (cybersécurité et protection des données) | Establishes data protection framework. Personal data (names, IDs) requires lawful basis. For VIGIL APEX, the lawful basis is 'public interest in transparency', supported by the public nature of source data. Critical: the architect declares processing to ANTIC if processing personal data at scale; check current 2026 thresholds with counsel. |
| Code Pénal Articles 152-156 (diffamation, injure) | Defamation provisions. Publishing a finding implying corruption against a named individual exposes VIGIL APEX to defamation claims. Mitigation: dossiers stay internal until council escalation; public-facing dossiers go through legal review; public ledger publishes commitments (hashes), not allegations, until council releases. |
| Décret 2006/088 + Loi N° 2003/004 (procurement) | The substantive law that defines what counts as a procurement irregularity. The patterns in Companion v2 §45-52 are derived from these texts. Counsel review is recommended to confirm no pattern characterises a normal practice as suspect. |

### Table 54

| LEGAL COUNSEL IS NOT OPTIONAL Everything in this section is the starting framework. Before the engagement letter is sent, before the first dossier is delivered, before any public-facing finding is released, an actual lawyer admitted to practice in Cameroon must review the specific intended action. Budget 3,000-5,000 EUR per year for ongoing legal support. The lawyer is itself a council-adjacent role - choose someone whose track record shows independence and who has worked anti-corruption matters before. |
|---|

### Table 55

| 17 | PRESS & PUBLIC COMMUNICATIONS PROTOCOL When findings become public |
|---|---|

### Table 56

| Category | What it covers and the protocol |
|---|---|
| Operational silence (default) | All findings, internal status, council deliberations, technical decisions. Nothing is shared outside the project. The architect does not discuss specific findings with friends, family, journalists, or anyone else. |
| Verify-only public surface | The /verify and /ledger endpoints publish hashes and commitments. Anyone can verify that a dossier existed at a given time without learning what it said. This is permanent, not press-strategic. Do not announce the launch of /verify; let it be discovered. |
| Council-authorised institutional disclosure | When the council authorises CONAC delivery, the only "communication" is the SFTP transfer + dossier reference number. No press release, no announcement, no public reference until or unless the institution itself acts publicly. |
| Council-authorised public release | Rare. Only when (a) the institution that received the dossier has not acted within 12 months, AND (b) the council votes 4-of-5 (not 3-of-5; higher bar for public release), AND (c) the architect retains right of refusal even after council approval. The architect's refusal closes the matter; it is not overridable. |

### Table 57

| Crisis | Protocol |
|---|---|
| A finding is publicly leaked before council approves release | Architect issues a single statement acknowledging that the leaked document exists and that the council has not authorised its release; declines to confirm or deny content; says the leak itself is being investigated. Internal investigation: was the leak from the system (technical compromise), the council (governance breach), or a recipient institution (institutional act)? Each requires different response. |
| A finding is later proven materially wrong | Architect and council collectively issue a public correction within 14 days of confirmation. Correction is published on /ledger and through the same channel as the original release if any. The council member who voted dissent on the original (if any) is acknowledged. The case is added to the calibration set as a confirmed false-positive. The architect resists the urge to deflect or contextualise; clarity about the error is what preserves long-term credibility. |

### Table 58

| THE QUIET POWER OF NOT TALKING An anti-corruption project that talks too much is read as a press operation with a thin technical layer. An anti-corruption project that talks rarely and accurately is read as a serious infrastructure with institutional weight. The latter is dramatically more effective at moving outcomes. This is the temperament question, not just a tactical question. |
|---|

### Table 59

| 18 | WHISTLEBLOWER PROTECTION SCAFFOLDING Beyond the technical /tip pipeline |
|---|---|

### Table 60

| # Standard notice on /tip page (already implemented in §57.2)   VIGIL APEX cannot protect you from your own ISP or device. For maximum safety, submit from Tor Browser on a public Wi-Fi network. Do not include identifying details unless you are willing to be linked to the tip.   We provide: - Client-side encryption before your message leaves your browser - 3-of-5 council quorum required to decrypt; no individual access - No IP logs beyond 7-day rate-limit data - Paraphrased dossier text; never raw tip content shared externally   We cannot provide: - Protection if your network is monitored at source - Protection if the contents of your tip identify you to readers - Anonymity guarantees that survive determined investigation - Legal protection from prosecution under specific legal regimes   If you are uncertain whether to submit, do not submit yet. Read this notice; consult someone you trust; submit only when you understand what you are signing up for. |
|---|

### Table 61

| THE LIMITS OF YOUR CARE An architect who tries to be the personal protector of every whistleblower will burn out, fail at the technical role, and ultimately help no one. The system's contribution to whistleblower protection is structural: every tip received pseudonymously, decrypted only by council, processed deliberately, paraphrased before delivery. That structural contribution is significant. Personal handling of individual whistleblowers is not your role and you should not take it on. |
|---|

### Table 62

| 19 | FIRST-CONTACT PROTOCOL WITH REGULATORS Engaging the agencies whose data you analyse |
|---|---|

### Table 63

| Tier | Contact requirement | Examples |
|---|---|---|
| Public-no-contact | Data is published by law on a public website; no contact required | ARMP weekly publications; presidential decrees in JO; OFAC/EU sanctions feeds |
| Public-with-courtesy-notice | Data is public but volume of access warrants notification | RCCM, ANIF reports, Cour des Comptes annual reports |
| Public-with-engagement | Data is public but the operating relationship benefits from explicit acknowledgment | ARMP (the primary source); MINFI (potential MINFI score integration in Phase 8) |

### Table 64

| # Short notification - sent before active scraping begins # Adapted per agency   [ARCHITECT LETTERHEAD]   À l'attention du [SERVICE COMMUNICATION / DG], [AGENCE]   Yaoundé, [DATE]   Objet : Information préalable d'accès systématique aux publications         de votre agence à des fins d'analyse de transparence   Madame, Monsieur,   VIGIL APEX SAS, dans le cadre d'un programme de surveillance des marchés publics fondé sur les données ouvertes, accède de manière régulière et automatisée aux publications de votre agence sur [URL], à raison de [FRÉQUENCE].   Nous tenons à vous informer de cette pratique afin que : 1. Votre service technique ne perçoive pas notre trafic comme    anormal ; 2. Vous puissiez nous indiquer toute préférence concernant le    rythme d'accès, les heures creuses, ou un format alternatif    (flux RSS, API, dépôt de fichiers) qui faciliterait la    collecte tout en préservant les performances de votre site.   Notre programme respecte le fichier robots.txt, applique un intervalle minimum de 2 secondes entre requêtes, et limite la charge totale à un maximum de 100 requêtes par jour vers votre infrastructure.   Nous restons à votre disposition pour toute demande de précision.   Cordialement, ___________________________ Junior Thuram NANA VIGIL APEX SAS [CONTACT] |
|---|

### Table 65

| # Data Ethics Commitments - published at https://verify.vigil.gov.cm/ethics   VIGIL APEX is committed to the following principles in the collection and use of public data:   1. We access only data that is public by law or by voluntary    disclosure. We do not access data behind authentication walls,    we do not bypass technical access controls, and we do not    pay for leaked or stolen data.   2. We respect robots.txt and rate limits as published, even when    they exceed legal requirements.   3. We notify agencies of systematic access when our access    volume warrants notification, and we accept their requests    for alternative formats or schedules.   4. We do not publish allegations against named individuals    without governance council approval (3-of-5 hardware-key    signatures with public dissent rights).   5. We do not pursue findings that depend solely on a single    anonymous tip; we require corroborating public evidence.   6. We correct errors publicly and explicitly when they are    identified.   7. We share our methodology, including the prompt library and    pattern detection logic, in our public source code.   8. We do not accept funding from political parties, foreign    governments, or organisations with material interest in    Cameroonian public procurement outcomes.   These commitments are operational, not aspirational. Any departure from them is a breach that the council is empowered and expected to investigate.   Last updated: [DATE] |
|---|

### Table 66

| 20 | WHY THIS HAPPENS BEFORE THE BUILD Calibration is the slowest input |
|---|---|

### Table 67

| Outcome | What counts as evidence | How it's labelled |
|---|---|---|
| True positive | Conviction; institutional disciplinary action; confirmed asset freeze; published investigation finding | true_positive |
| False positive | Court judgement of innocence; documented contextual explanation (emergency, force majeure); council retrospective dismissal with rationale | false_positive |
| Partial match | Investigation found related but different misconduct; charges altered; some elements confirmed | partial_match |
| Pending | No conclusive outcome yet; still under investigation; not yet litigated | pending (excluded from ECE until resolved) |

### Table 68

| AIMING FOR 50 IN 90 DAYS, 200 IN 12 MONTHS The §00 first-action page asks for 30 cases as the immediate target; 30 unlocks Phase 9 exit. 50 cases provides reasonable per-pattern-category bin density. 200 cases is the 12-month horizon for fine-grained per-pattern calibration (every pattern with 5+ data points). The architect's calibration discipline is judged not by the day-1 number but by the year-1 trajectory. |
|---|

### Table 69

| 21 | HISTORICAL CASE RESEARCH PROTOCOL Where to find the cases |
|---|---|

### Table 70

| Source | What you find there |
|---|---|
| Cour des Comptes annual reports (2010-2024) | Public reports on financial irregularities in state institutions. Published with names of contractors, amounts, and outcomes. Excellent ground-truth source for category A (procurement irregularities) and B (corporate-form anomalies). |
| CONAC annual reports | Lists of cases received, transmitted, dismissed, with redacted but still-useful narrative. Useful for cases where CONAC made a formal disposition. |
| TRACFIN-CEMAC and ANIF financial intelligence reports | Published cases of suspicious financial movements that were investigated. Useful for category F (related-party signals) and B (shell-company indicators). |
| Operation Sparrowhawk / Opération Épervier judicial archives (2006-present) | Public criminal cases against high-level officials for embezzlement of public funds. Archive of court judgements, often with detailed asset and contract recitations. Excellent ground truth for the highest-severity category A and F findings. |
| Tribunal Criminel Spécial archives (2012-present) | Cases >50M XAF embezzlement. Public hearing schedules and judgements. Several hundred cases over 10 years, many with full documentation. |
| Press archives (Cameroon Tribune, Le Jour, Mutations, JeuneAfrique) | Contemporaneous reporting that often reveals contract context that legal documents elide. Useful for context but should not be the only source for a label. |
| TI Cameroon and CHRDA case files | Civil-society documented cases. Useful, but critically: the documentation is partisan to a position. Use for context, cross-reference with at least one official source before labelling. |
| Academic theses and white papers | Universities of Yaoundé II, Douala, Buea have produced theses on specific procurement scandals. Often contain case-by-case analysis. |
| Parliamentary commission reports | Committee inquiry reports on specific scandals. Public at the National Assembly archive. |
| Open Government Partnership Cameroon outputs | If the OGP track is active, public consultations and case studies. Variable quality but freely accessible. |

### Table 71

| 22 | THE SEED CSV FORMAT Schema for the calibration seed file |
|---|---|

### Table 72

| Column | Type | Notes |
|---|---|---|
| id | uuid | Architect generates with uuidgen; never reused |
| recorded_at | iso date | When this entry was added to the seed |
| pattern_id | string | Best-fit VIGIL APEX pattern: P-A-001, P-B-001, etc. |
| finding_id | uuid | Synthetic UUID for historical cases (generate fresh); will be linked to real finding ID at Phase 9 if/when system rediscovers the same case |
| case_label | string | Short human-readable identifier (e.g. 'Sparrowhawk-Atangana-2017'). Useful for the architect; not used by the system. |
| case_year | integer | Year the underlying contract or event occurred |
| region | string | Region code where contracting authority is located (e.g. 'CE' for Centre, 'LT' for Littoral) |
| amount_xaf | integer | Contract amount in XAF; -1 if unknown |
| posterior_at_review | decimal | Architect's best estimate of what posterior the system WOULD have produced. Use the formula in Companion v1 §16 as a guide; cross-check with similar synthetic findings. |
| severity_at_review | enum | low / medium / high / critical, per SRD §06.4 thresholds |
| ground_truth | enum | true_positive / false_positive / partial_match / pending |
| ground_truth_recorded_by | string | Architect's username for first 50; later, senior operators |
| ground_truth_evidence_json | json | Array of evidence objects: kind, citation, optional excerpt |
| closure_reason | string | Optional. Why the case closed the way it did |
| notes | string | Free-text. Architect's own observations about the case |

### Table 73

| # Sample row from /personal/calibration-seed/seed.csv # This is a real-style example. Use it as the format reference.   id,recorded_at,pattern_id,finding_id,case_label,case_year,region,amount_xaf,posterior_at_review,severity_at_review,ground_truth,ground_truth_recorded_by,ground_truth_evidence_json,closure_reason,notes   a1f3...uuid,2026-04-15T10:00:00Z,P-A-001,b2e5...uuid,Cour-Comptes-2019-OBS-127,2018,CE,1850000000,0.78,high,true_positive,architect,"[{""kind"":""cour_comptes_observation"",""citation"":""Rapport public 2019, observation 127, pp 87-89"",""excerpt"":""marché attribué pour 1.85 Mds XAF dépassant le seuil budgétaire approuvé sans amendement budgétaire""},{""kind"":""press_corroboration"",""citation"":""Mutations 2019-09-12""}]",confirmed_by_court_des_comptes,"Classic above-budget pattern; the contractor was not subsequently charged but the contracting official was disciplined. Useful TP example for category A."   c4d6...uuid,2026-04-16T14:30:00Z,P-B-001,e7f2...uuid,Sparrowhawk-Mendo-2015,2014,EN,4200000000,0.91,critical,true_positive,architect,"[{""kind"":""court_judgement"",""citation"":""TCS-2015-PEN-44""}, {""kind"":""official_communique"",""citation"":""ANIF/2015/Bull-3""}]",criminal_conviction,"Shell company incorporated 19 days before tender award. Entity dissolved 8 weeks after final payment. Case in Sparrowhawk batch. Strong TP exemplar for pattern B-001."   9bf2...uuid,2026-04-18T09:15:00Z,P-A-003,3df1...uuid,Emergency-Ebola-2014,2014,SU,3800000000,0.65,high,false_positive,architect,"[{""kind"":""presidential_decree"",""citation"":""Décret 2014/8847"",""excerpt"":""déclare l'état d'urgence sanitaire""}, {""kind"":""who_corroboration"",""citation"":""WHO Ebola Cameroon 2014""}]",counter_evidence_emergency_declaration,"Important FP. The no-bid rapid procurement was justified by emergency. System should learn that emergency-declared sectors require down-weighting on P-A-003. Critical calibration lesson." |
|---|

### Table 74

| 23 | GROUND TRUTH CITATION DISCIPLINE What counts as evidence |
|---|---|

### Table 75

| Kind | What qualifies |
|---|---|
| court_judgement | A court ruling on the matter, civil or criminal. Strongest evidence. Reference: TCS docket number for criminal, civil-court reference for civil. Final judgement, not preliminary order. |
| cour_comptes_observation | A formal observation in a Cour des Comptes annual report. Strong evidence of irregularity (TP) but does NOT alone establish criminal conduct (so does not always justify 'critical' severity). |
| conac_finding | A documented CONAC investigation outcome. Strong if formal; weaker if only press-mentioned. |
| criminal_conviction | Conviction (not just indictment). The strongest TP evidence. |
| dismissed_by_court | Court dismissed the case for substantive reasons. Strong FP evidence. |
| presidential_decree_emergency | Formal emergency declaration covering the contract context. Strong FP evidence for cases triggered by emergency-procurement patterns (P-A-003 in particular). |
| disciplinary_action | Formal sanction by the official's hierarchy (suspension, dismissal). TP evidence at administrative level even without criminal proceedings. |

### Table 76

| 24 | STORING THE SEED Where the file lives, who can read it |
|---|---|

### Table 77

| Tier | Where and how |
|---|---|
| Working copy (Phase 0-9 build) | Architect's local laptop in /personal/calibration-seed/seed.csv. Encrypted-at-rest via FileVault (macOS) or LUKS (Linux). Not synced to cloud. |
| Backup copy | Encrypted backup to architect's personal cloud (iCloud Drive, Tresorit, or similar) with strong passphrase. Recovery in case of laptop loss. |
| Phase 9 enrolment | When the build reaches Phase 9, seed CSV is loaded via scripts/seed-calibration.ts (Companion v2 §68.4). At this moment each entry is committed to the calibration_entry table and an audit_event 'calibration.seeded' commits the batch. |
| Post-enrolment | Seed CSV in production database (via the calibration_entry table). Entries become the live calibration set; new entries added by operators reading closed findings. |
| Personal copy (kept by architect) | After enrolment, architect retains a read-only encrypted snapshot of the seed CSV, in case of catastrophic data loss in production. |

### Table 78

| THE SEED IS THE INSTITUTIONAL MEMORY This file is the most institutionally valuable single artefact in VIGIL APEX. It encodes years of Cameroonian procurement experience as labelled examples that calibrate every future decision. Treat it the way an archivist treats a unique manuscript: backed up, protected, never destroyed without deliberate process. If everything else burns, the seed is what you save. |
|---|

### Table 79

| 25 | WORKING WITH THE AGENT ON CALIBRATION The agent can help with research |
|---|---|

### Table 80

| Task | Agent role |
|---|---|
| Reading Cour des Comptes reports and extracting candidate cases | YES - the agent can summarise long reports, identify cases that match VIGIL APEX patterns, and produce candidate rows for the seed CSV |
| Extracting structured data from court judgements (PDF or text) | YES - the agent can parse judgements, extract amounts/dates/parties, and propose pattern matches |
| Estimating posterior_at_review using the pattern formulas | YES - the agent applies the prior + signal weights from Companion v2 §45-52 and proposes a posterior; architect validates |
| Cross-referencing multiple sources for a single case | YES - the agent compiles citations and flags inconsistencies |
| Final ground_truth label | NO - this is the architect's decision. The agent proposes, the architect commits. |
| Adding entries to the seed file | ARCHITECT ONLY - the seed file is local-only and the architect maintains write authority. Agent suggestions are reviewed and accepted manually. |
| Discussing specific named individuals in conversation logs | MINIMISE - keep agent conversations about specific cases short and bounded; do not let the seed become an agent's training material implicitly. |

### Table 81

| # Save in /personal/prompts/calibration-research.md # Used in a focused agent session for seed building   You are helping me build the calibration seed for VIGIL APEX. The seed is a CSV of historical Cameroonian procurement cases with documented outcomes, used to calibrate the Bayesian posteriors.   Your inputs are: 1. Public reports I will paste or upload (Cour des Comptes annual,    CONAC annual, court judgements, press archive excerpts) 2. The CORE_BUILD_COMPANION_v2.docx pattern definitions you have    loaded (sections 45-52)   For each case I bring you, produce:   1. Best-fit pattern_id from the 43 patterns 2. Estimated posterior_at_review using the pattern formula 3. Severity_at_review (low/medium/high/critical) 4. A draft ground_truth label (true_positive / false_positive /    partial_match / pending) with its supporting citations 5. A 2-3 sentence note explaining the calibration value of this case   You do NOT add the case to the seed file directly. You produce a candidate row in CSV-ready format that I will review, edit if needed, and append manually.   Constraints: - If the pattern fit is below ~70% confidence, say so explicitly - If the ground_truth is genuinely uncertain, propose 'pending' rather   than guessing - If you find yourself reaching for press articles as primary evidence,   flag that this case may not have strong enough ground truth for the seed - Never speculate about details not in the source documents   Begin when I paste the first source. |
|---|

### Table 82

| 26 | WHY DRY-RUN BEFORE COMMITTING Highest-information action available now |
|---|---|

### Table 83

| 27 | LOADING THE DOC PACK How the agent receives the four documents |
|---|---|

### Table 84

| # Throwaway dry-run setup. Do this in /tmp or ~/dryrun, not in production.   mkdir -p ~/dryrun/vigil-apex cd ~/dryrun/vigil-apex   # Create the docs directory and copy in the four documents mkdir -p docs cp /path/to/CORE_SRD_v3.docx                docs/ cp /path/to/CORE_BUILD_COMPANION_v1.docx    docs/ cp /path/to/CORE_BUILD_COMPANION_v2.docx    docs/ cp /path/to/CORE_EXEC_v1.docx               docs/   # Initialise git so the agent has a clean tree to work in git init -q git add docs/ git commit -q -m "Initial: documentation pack"   # Open Claude Code in this directory claude |
|---|

### Table 85

| # Paste this verbatim as the first prompt in the dry-run session   Read all four documents in the docs/ folder in this order: 1. CORE_SRD_v3.docx                (the binding spec) 2. CORE_EXEC_v1.docx                (the execution runbook - institutional context) 3. CORE_BUILD_COMPANION_v1.docx    (procedural backbone, prompts, phases) 4. CORE_BUILD_COMPANION_v2.docx    (full implementation reference)   After reading, confirm you have all four. Then summarise back to me:   a. The 5 council pillars from SRD §04 b. The Phase 0 build prompt from Companion v1 §28 c. The 8 pattern categories from SRD §06 d. What the Execution Runbook says is the institutional precondition    for Phase 1 e. What you understand to be your role in this dry-run   Do NOT yet generate any code or scaffold. We are confirming shared understanding first. |
|---|

### Table 86

| ITERATE HERE BEFORE PROCEEDING If the response shows red flags, iterate on the loading. Try different document load orders. Try explicit prompts asking the agent to read specific sections aloud. If the agent persistently fails to internalise the documents in 30-60 minutes of iteration, that is itself the most valuable finding of the dry-run: the documents are not effectively loadable as written. Patch them and retry. |
|---|

### Table 87

| 28 | VERIFYING THE PHASE 0 SCAFFOLD What the agent should produce |
|---|---|

### Table 88

| # Second prompt, after agent has confirmed shared understanding   Now execute the Phase 0 build prompt as written in Companion v1 §28. Produce:   1. The full directory tree of the monorepo 2. Root configuration files (package.json, pnpm-workspace.yaml,    turbo.json, tsconfig.base.json, .editorconfig, .gitignore) 3. The .env.example template for development 4. The packages/shared and packages/db skeleton (no business logic yet) 5. The CI/CD configuration (GitHub Actions workflow stubs) 6. A first-pass docker-compose.dev.yml for local dependencies   Do this in the working directory of this repo. After producing, list every file you created in tree form and stop.   Do NOT proceed to Phase 1 yet. |
|---|

### Table 89

| Component | Expected presence and rough shape |
|---|---|
| Monorepo workspace | pnpm-workspace.yaml lists apps/*, packages/* glob patterns. turbo.json has build/dev/lint/test pipelines. Node 20 LTS pinned in package.json engines. |
| TypeScript base config | tsconfig.base.json with strict mode true, target ES2022, module Node16, paths for @vigil/* aliases. Each package extends from base. |
| Apps directory (empty stubs) | apps/dashboard, apps/api, apps/adapter-runner, apps/worker-* skeletons each with package.json + src/index.ts placeholder. No actual business code. |
| Packages directory (empty stubs) | packages/shared, packages/db, packages/llm, packages/queue, packages/audit-chain, packages/adapters, packages/patterns each with package.json + src/index.ts placeholder. |
| Environment template | .env.example with all variables that production will need (POSTGRES_URL, REDIS_URL, KEYCLOAK_URL, VAULT_URL, LLM keys placeholders, etc.) with comments explaining each. No real secrets. |
| docker-compose.dev.yml | Postgres 16, Redis, MinIO, Keycloak, Vault dev mode for local development. Volumes for persistence. No production secrets. |
| CI workflow | .github/workflows/ci.yml with jobs for lint, type-check, build, test. Cache pnpm. Runs on push and PR. |
| README.md | High-level overview with link to docs/ folder. Mentions the four-document pack. |

### Table 90

| 29 | HANDLING DEVIATIONS What to do when the agent produces wrong output |
|---|---|

### Table 91

| Deviation kind | Response |
|---|---|
| Cosmetic disagreement (file naming style, comment phrasing) | Note for later. Do not iterate on cosmetics in the dry-run; fix in real build via lint rules. |
| Minor structural mismatch (one missing config file, one wrong dependency version) | Single follow-up prompt: "You missed X; please add. Confirm afterward." If it complies cleanly, this is fine. |
| Multiple structural mismatches | Document them. Continue dry-run with the agent's version. After dry-run, decide whether documents need patches. |
| Misunderstanding of the architecture (wrong module boundaries, wrong queue technology) | Stop. Investigate why the documents did not transmit the intent. Patch the SRD or Companions before any real build. |
| Hallucination (fabricated section numbers, invented patterns not in the docs) | Stop. This is a documentation problem AND a model behaviour problem; consider whether the loading order, prompt phrasing, or document format need to change. |

### Table 92

| Pattern | Likely root cause |
|---|---|
| Agent invents libraries not in the spec (e.g. uses Express instead of Fastify) | SRD §08 technology choices not surfaced strongly enough; needs to be in Phase 0 prompt directly, not just buried in §08 |
| Agent uses wrong directory layout | Companion v1 §10 scaffold table not loaded correctly; consider moving it earlier in v1 or making it a standalone callout |
| Agent generates monolithic code instead of monorepo packages | pnpm workspace concept not registered; consider an explicit example block in v1 §10 |
| Agent skips audit chain entirely | SRD §07 audit-chain importance underemphasised; consider a §00.1-style banner at the top of every Companion volume |
| Agent generates code in JavaScript instead of TypeScript | TypeScript-strict requirement buried; surface in Phase 0 prompt and CI workflow stub |
| Agent produces a working scaffold without any reference to council/governance | Phase 0 is correctly limited to infrastructure, but agent might be missing that this is anti-corruption tooling. Acceptable in Phase 0; check in Phase 1. |

### Table 93

| 30 | DECISION: CONTINUE OR DOCUMENT Outcome of the dry-run |
|---|---|

### Table 94

| Outcome | Decision |
|---|---|
| Scaffold is essentially correct (≤2 minor deviations, no fundamental misunderstandings) | GO. Begin real Phase 0 build in production repo within 1 week. Documentation pack is validated. |
| Scaffold has 3-5 corrections needed but architecture is right | GO with note. Begin real build but add the corrections to the prompts at each phase. Document the tweaks in the decision log. |
| Scaffold has ≥5 corrections needed OR architecture is misunderstood in any major way | PATCH. Spend 1-2 weeks revising the relevant SRD/Companion sections. Re-run dry-run. Do not begin real build until dry-run passes. |
| Agent cannot reliably parse the documents (hallucinations, wrong section numbers, repeated confusion) | REWORK. The four-document model has a fundamental loading problem. Possible fixes: split into more documents, change format from .docx to markdown, write a shorter "agent quick reference" that summarises the others. Major rework, multiple weeks. |

### Table 95

| THE DRY-RUN IS WORTH IT EVEN IF IT GOES WELL If the dry-run produces a perfect scaffold first try, you have lost nothing - 4 hours of validation. If it goes poorly, you have saved weeks. The asymmetry is in your favour. The temptation to skip it because "the docs are clearly good" is the temptation to skip the inspection because the contractor seems trustworthy. Run the dry-run. |
|---|

### Table 96

| 31 | THE HOURS-PER-WEEK QUESTION Honest capacity calibration |
|---|---|

### Table 97

| # Honest weekly capacity worksheet # Fill in REAL numbers, not aspirational numbers. # Aim for the median across the past 12 weeks of actual life.   A. Total weekly waking hours:                         168 - sleep hours                                                        = _____   B. Mandatory commitments (already committed, not negotiable):    - Existing employment / consulting:                  _____ h    - Family caregiving (children, elders, partner):     _____ h    - Community / religious / unavoidable obligations:   _____ h    - Health (exercise, medical, recovery):              _____ h    Subtotal:                                           _____ h   C. Discretionary commitments (could be reduced if needed):    - Social / friends / leisure:                        _____ h    - Hobbies / non-VIGIL learning:                      _____ h    - Other projects:                                    _____ h    - Discretionary screen time / entertainment:         _____ h    Subtotal:                                           _____ h   D. Available pool (A - B - C):                         _____ h   E. Of the available pool, how much can realistically    go to VIGIL APEX every week, sustainably,    for 14 consecutive weeks?    (Be brutal here. Not the peak; the median.)         _____ h   F. Reduce E by 20% as the realism factor    (life happens, illness, motivation troughs):        _____ h    This is your sustainable VIGIL hours/week. |
|---|

### Table 98

| Sustainable hours/week (F) | Implication |
|---|---|
| 35+ hours | Solo build is realistic on the 8-14 week timeline. You are giving this most of your time. Continue. |
| 25-34 hours | Solo build is realistic on a 12-18 week timeline. Build with deliberate pace, do not rush. |
| 15-24 hours | Solo build is realistic only on a 24-32 week timeline (6-8 months). Or: bring in a co-architect or paid engineer to share the technical track. Consider this seriously. |
| 5-14 hours | Solo build is not realistic. The system will be technically buildable but you will burn out before completion. Either commit to dropping other commitments to free up hours, OR delay the project until life circumstances change, OR find a co-architect who can carry primary technical work while you carry institutional work. |
| <5 hours | Do not start. The institutional work alone (council formation, CONAC engagement, calibration seed) consumes 5+ hours per week. Anything below this is below the floor. |

### Table 99

| 32 | ADDING A CO-ARCHITECT OR ENGINEER When and how |
|---|---|

### Table 100

| Role | What they do | What they don't |
|---|---|---|
| Co-architect | Shares strategic decisions with you. Co-signs the SRD. Has signing authority on major architectural changes. Is on the council communication channel. | Does not displace you as the primary identity / spokesperson; does not unilaterally commit the project to anything |
| Senior engineer (paid) | Carries primary technical implementation; works through Claude Code prompts; reports to you. Approximately 60-80% of the technical work. | Does not make architectural decisions; does not interact with the council; does not hold any council key |
| Operations engineer (paid) | Handles ongoing operational work post-launch: dead-letter queue triage, calibration entry labelling, adapter health, watchdog response. Lower seniority, more day-to-day. | Does not modify code; does not interact with council; cannot escalate findings |

### Table 101

| Role | Monthly cost (EUR) | Notes |
|---|---|---|
| Co-architect (volunteer or equity) | 0 - 1,500 | Difficult to attract on volunteer basis; equity arrangements complicate corporate structure. Most realistic: a respected peer who agrees to co-sign for the symbolic and reputational value. |
| Senior engineer, full-time | 1,500 - 3,000 | Cameroon-based senior software engineer with TypeScript experience. Year-1 budget allowance: 18,000 - 36,000 EUR. Substantial. |
| Senior engineer, part-time (10-20h/week) | 600 - 1,200 | More realistic for a non-funded project. Year-1: 7,200 - 14,400 EUR. |
| Operations engineer, post-launch | 800 - 1,500 | Mid-level. Year-2 onwards. Optional even then if architect handles ops. |

### Table 102

| HIRING CHANGES THE PROJECT VIGIL APEX is designed around a sovereign architect. Adding a paid engineer changes the social structure: now there is an employee whose livelihood depends on the project, whose presence requires the architect to be a manager, whose departure has knock-on effects on documentation and continuity. This is not a reason not to hire; it is a reason to hire deliberately and to plan for the management overhead. The 25-35 hours/week of architect work does NOT decrease proportionally when you add an engineer; it shifts toward management and decision-making. Plan accordingly. |
|---|

### Table 103

| 33 | BURNOUT SIGNALS Catching it before it lands |
|---|---|

### Table 104

| THE ARCHITECT IS INFRASTRUCTURE VIGIL APEX's most valuable single asset is the architect's ongoing capacity to operate it well. Burnout is not a personal failing or a productivity problem - it is the degradation of critical infrastructure, exactly like a database becoming unresponsive or a key becoming compromised. Treat it as an infrastructure problem with a procedural response. The system was designed to support a healthy human; it cannot support an unhealthy one. |
|---|

### Table 105

| 34 | DEFINED EXIT PROTOCOL Walking away well |
|---|---|

### Table 106

| Scenario | What it looks like | Protocol triggered |
|---|---|---|
| Voluntary handover | Architect identifies a successor and intentionally transfers the system to them. | §34.3 protocol; 6-month overlap period. |
| Voluntary wind-down | Architect concludes that VIGIL APEX has run its useful course (e.g. adopted by an institution, replaced by a better system, or politically obsolete) and ends operations. | §34.4 protocol; 90-day cessation period. |
| Involuntary cessation | Architect is incapacitated, killed, disappeared, or rendered unable to operate the system. The 5 council members hold the residual authority. | §34.5 protocol; council-led wind-down or handover. |

### Table 107

| PREPARE THE ENVELOPE NOW Within 30 days of starting the build, the architect must prepare the §34.5 envelope - a sealed document at their personal lawyer's office containing the wind-down/handover preferences, the SAS succession instructions, and any messages to the council. The envelope is updated annually. The lawyer's instruction: open only on confirmed incapacitation, deliver to the council communication channel. This is the equivalent of a will for the project; it is not optional. |
|---|

### Table 108

| 35 | SUCCESSION PLANNING What the system survives |
|---|---|

### Table 109

| YOU ARE NOT THE PROJECT An architect who believes they ARE the project will fight any exit, even when exit is the right answer. An architect who knows they are the temporary custodian of the project can let it go when the time is right. The exit protocol is the discipline that produces the second kind of architect. Read this section once a year; let it correct your relationship with the work. |
|---|

### Table 110

| 36 | WHAT NEEDS DECIDING BEFORE PHASE 1 Pre-build decision inventory |
|---|---|

### Table 111

| Decision | Latest deadline | Reversibility | Notes |
|---|---|---|---|
| Hosting target (bare-metal / EU VPS / AWS af-south-1) | Before Phase 0 | Medium - reversible at Phase 9 with 2-3 weeks rework | Affects Dockerfiles, backup destination, Tor strategy. See §05. |
| Domain name and registrar | Before Phase 0 | High - swap registrar later if needed | Don't agonise; pick Gandi + a reasonable subdomain. See §06. |
| YubiKey count and model | Before Phase 1 | Medium - additional keys can be ordered | Default 8 (5+1+1+1) per §04. Confirm by week 1. |
| First 3-5 council member shortlists | Before Phase 1 | High - shortlists evolve | Worksheet in §10. Names not commitments yet. |
| Legal counsel selection | Before sending CONAC letter (Phase 4-5 region) | High - can switch counsel | Budget 3,000-5,000 EUR/year. See §16. |
| Currency for project budget tracking | Before Phase 0 | Low - changing later is messy | Default XAF for local; EUR for international. Decide one as primary. |
| Whether Phase 8 (MINFI integration) is in scope for v1.0 | Before Phase 7 | High - Phase 8 is optional | If MINFI relationship is not advanced by Phase 7, deferring Phase 8 to v1.1 is acceptable. |
| Co-architect or paid engineer (yes/no) | Before Phase 1 | Medium - hiring takes 4-6 weeks if pursued | Decision driven by §31 hours-per-week analysis. |
| Public launch timing for /verify subdomain | Before Phase 7 | Low - launching is a one-way gate | Soft launch (no announcement) recommended; let it be discovered. |
| Policy on accepting whistleblower tips before council is formed | Before /tip endpoint deployment (Phase 5) | Medium | Default: /tip endpoint accepts but does not decrypt until council is enrolled. Tips queue. |

### Table 112

| 37 | DECISION LOG TEMPLATE How decisions are recorded |
|---|---|

### Table 113

| # /docs/decisions/log.md - decision log for VIGIL APEX   ## DECISION-001  Hosting target   Date:           2026-04-30 Decided by:     Junior Thuram Nana, sovereign architect Status:         FINAL   ### Decision Production hosting will be on Hetzner (Falkenstein, Germany) on a single CCX33 dedicated vCPU instance, with daily encrypted backups to OVH (Strasbourg) for cross-provider redundancy.   ### Alternatives considered - Bare-metal at architect's office in Yaoundé:   rejected due to (a) maintenance overhead estimated at 8-15 h/month,   (b) physical seizure risk under Cameroonian jurisdiction. - AWS af-south-1 Cape Town:   rejected due to (a) US CLOUD Act jurisdiction layered on top   of South African operational law, (b) higher egress costs.   ### Rationale EU jurisdiction provides legal distance from informal Cameroonian pressure paths. Hetzner SLA is adequate (99.95%); cost is predictable; maintenance burden is minimal. Daily cross-provider backup mitigates single-provider catastrophic risk.   ### Reversibility Medium. Switching providers within Year 1 would cost 2-3 weeks of rework (rebuild Dockerfiles, migrate data, reconfigure DNS). Switching after Year 1 would also cost the audit-chain history; a full export/import would be required.   ### Audit chain reference audit_event id: a1f3...uuid (logged at decision time)   ---   ## DECISION-002  Domain registrar   Date:           2026-05-02 Decided by:     Junior Thuram Nana Status:         FINAL   ### Decision Domain vigil-apex.org registered via Gandi (Paris, France). DNS hosted at Cloudflare (free tier with DNSSEC enabled). Subdomain vigil.gov.cm to be pursued separately via CONAC liaison (see DECISION-005).   ### Alternatives considered - ANTIC for a .cm domain directly: rejected due to local pressure risk - Porkbun (US): rejected; EU registrar preferred for jurisdictional reasons - Squarespace: rejected; recent ownership changes create policy uncertainty   ### Rationale Gandi has a documented track record of refusing informal takedown requests. Cloudflare DNS provides DDoS mitigation at no cost. Two-provider split (registrar + DNS) provides operational resilience.   ### Reversibility High. Domain transfer is supported by all parties; DNS migration is hours of work. No long-term lock-in.   ---   ## DECISION-003  YubiKey procurement plan   Date:           2026-05-05 Decided by:     Junior Thuram Nana Status:         FINAL   ### Decision Order 8 YubiKey 5 NFC + 1 YubiKey 5C NFC (total 9, replacing the generic spare with a USB-C compatible spare to match the host server). Order from eu.yubico.com via two batches (5 + 4) to two different Cameroonian addresses.   ### Alternatives considered - 5 keys total (no spare, no architect, no signer): rejected; system   architecture requires 8 minimum. - 12 keys (extra spares): rejected; YubiKey FIDO2 attestation pinning   means each new key requires AAGUID allowlist update + council vote;   excess inventory creates governance overhead, not safety.   ### Rationale 8 keys provides the minimum operational set: 5 council, 1 architect, 1 polygon-signer, 1 spare. The 9th C-NFC is for the host server's USB-C ports specifically.   ### Reversibility High. Additional keys can always be ordered. Reducing the count later requires governance vote and Keycloak realm export update.   ---   [Subsequent decisions continue with the same template...] |
|---|

### Table 114

| 38 | FIRST 20 DECISIONS WORKSHEET Pre-populated for the architect |
|---|---|

### Table 115

| # | Decision | Architect's choice |
|---|---|---|
| 1 | Hosting provider and region | ________________________ |
| 2 | Backup provider (different from primary) | ________________________ |
| 3 | Domain name (operational) | ________________________ |
| 4 | Domain registrar | ________________________ |
| 5 | DNS hosting provider | ________________________ |
| 6 | Operational email host (NOT personal email) | ________________________ |
| 7 | Number of YubiKeys to order | ________________________ |
| 8 | Reseller and shipping addresses for YubiKeys | ________________________ |
| 9 | Cameroonian legal counsel name and engagement scope | ________________________ |
| 10 | Currency for budget tracking (XAF / EUR / USD primary) | ________________________ |
| 11 | Council shortlist for governance pillar (3-5 names) | ________________________ |
| 12 | Council shortlist for judicial pillar (3-5 names) | ________________________ |
| 13 | Council shortlist for civil-society pillar (3-5 names) | ________________________ |
| 14 | Council shortlist for audit pillar (3-5 names) | ________________________ |
| 15 | Council shortlist for technical pillar (3-5 names) | ________________________ |
| 16 | Co-architect / paid engineer decision | Yes / No: __________ |
| 17 | If yes: target hire profile and budget | ________________________ |
| 18 | Calibration seed weekly target (5/10/15 entries) | ________________________ |
| 19 | Phase 0 dry-run scheduled for (date) | ________________________ |
| 20 | Phase 1 institutional readiness target date | ________________________ |

### Table 116

| DO NOT FILL IN ALL 20 IN ONE SITTING These are 20 decisions, not 20 boxes. Each one deserves the time it deserves. Decision 9 (legal counsel) and decisions 11-15 (council shortlists) take weeks of careful research; decisions 1-8 take a few hours of comparison. Spread the worksheet over 2-4 weeks. The thoroughness of the answers matters more than the speed of completion. |
|---|

### Table 117

| 39 | THREAT MODEL RECAP Cross-reference to SRD §05 |
|---|---|

### Table 118

| Tier | Description |
|---|---|
| Tier 1 - Opportunistic | Casual probing, automated scanners, low-effort defacement attempts. Mitigated entirely by standard hardening: firewall, fail2ban, hardware-bound auth, rate limits. |
| Tier 2 - Targeted but resource-limited | An adversary with specific interest in disrupting VIGIL APEX, with limited budget and time. May attempt social engineering of the architect or council, may try to compromise a single vendor (registrar, hosting). Mitigated by: 5-of-5 council with 3-of-5 quorum (no single point of failure), 2-vendor split (registrar / DNS), audit chain (any compromise is detectable). |
| Tier 3 - State-level or well-resourced | An adversary with substantial resources, legal mechanisms, and possibly physical access through court orders or informal pressure. The system is hardened but not invulnerable. Mitigated by: EU jurisdictional placement, public ledger (compromise becomes globally visible), distributed council (capture requires multiple parties simultaneously). Acknowledges: against Tier 3, the system is designed to be EXPENSIVE to compromise covertly, not impossible. |

### Table 119

| 40 | RISKS BY LIKELIHOOD What can go wrong, ordered |
|---|---|

### Table 120

| Risk | Likelihood | Severity | Brief mitigation |
|---|---|---|---|
| A council candidate declines after first conversation | Very high | Low | Plan 3-5 candidates per pillar from the start (§10). |
| CONAC does not respond to engagement letter | Medium | Medium | 60-day non-objection clause; pivot to alternative recipient (§15.5). |
| Calibration seed entries delayed past Phase 9 readiness | High | Medium | Weekly cadence target of 5-10 entries; agent-assisted research (§25). |
| Adapter selectors break due to source website redesign | Very high (one per quarter typical) | Low | Per-adapter health monitoring; fallback to alternative source where available (Companion v2 §43-44). |
| Architect burnout | Medium-high | High | §33 early-signal detection; 7-day recovery protocol; §34 exit option. |
| A council member's YubiKey is lost | Low (~5%/year) | Low | Spare key + re-enrolment ceremony (§04.4). |
| YubiKey shipment seized at customs | Medium | Medium | Two-batch ordering; declare correctly; budget 2-3 extra weeks (§04.3). |
| Hosting provider raid or compelled disclosure | Low (Tier 2-3) | High | EU jurisdiction; cross-provider backups; encryption at rest with keys held outside provider (§05). |
| Legal challenge for defamation | Medium | High | Counsel review of every public release; pre-publication review by civil-society pillar; legal-defence cost coverage (§16). |
| A specific finding is publicly leaked before council approves | Low-medium | High | Crisis communication protocol (§17.4). |
| A whistleblower is identified through tip content | Low | Critical | Tip paraphrase rule, 3-of-5 quorum decryption, never publish raw tip content (§18). |
| A council member is approached with a bribe or threat | Likely over time | Medium-High | §14.4 reporting protocol; collective response; record as audit event. |
| The architect is approached with a bribe or threat | Likely over time | High | Same protocol applies to architect; record + report to council immediately. |
| Calibration drift (priors no longer match reality) | Certain over years | Low (if monitored), High (if ignored) | Quarterly recalibration; per-pattern ECE monitoring; council retrospective on contested findings. |
| A finding is materially wrong AND escalated | Inevitable eventually | High initially, manageable with discipline | Public correction within 14 days; council retrospective; learning event for calibration (§17.4). |
| The architect dies or becomes incapacitated | Low (single year) | Critical (existential) | §34.5 protocol; sealed envelope at lawyer; council holds residual authority. |
| The system is accused (rightly or wrongly) of partisan bias | Likely | Medium-High | Council diversity audit (§10.4); explicit non-political-funding stance in data ethics (§19.5); transparency about methodology. |
| The Cameroonian state designates the project as illegal | Low-medium (Tier 2-3) | Critical | §16 statutory positioning; §34.4 wind-down protocol; legal counsel pre-emptive review of all activities. |
| A pattern detection produces a systematically biased false-positive class (e.g. unfairly flagging certain ethnic-name suppliers) | Possible | Critical reputational | Per-pattern fairness monitoring; bias review by audit + technical pillars; fast-track recalibration on confirmed bias. |
| Polygon network compromise or RPC provider failure | Very low | Medium | Multi-RPC failover; periodic mainnet integrity checks; if Polygon itself fails, fall back to alternative anchoring chain with council vote. |
| Backup destination compromised | Low | Medium | Two-destination rotation; encryption at rest; quarterly restore drill. |
| Domain registrar account compromised | Low (with hardware MFA) | High | Hardware MFA; no SMS or telephone reset; transfer-lock enabled; quarterly login audit. |
| The architect is forced into a coerced council vote | Low (Tier 3) | Critical | Geographic separation: at least 2 council members outside Cameroon; council communication channel monitors for unusual signing patterns. |
| A council quorum cannot be assembled in time-sensitive escalation | Medium | Medium | No time-sensitive escalations: system is biased toward inaction in ambiguity; 7-14 day council vote cycle is acceptable. |
| The /tip endpoint is misused for harassment or false reports | Likely | Low (per incident), Medium (cumulative) | Rate limit per fingerprint; council-side triage filters obvious abuse; no automatic action on tip content. |
| Documentation pack becomes outdated as system evolves | Certain over years | Medium | Quarterly documentation review with the council; version-bump cadence (v1.1, v1.2 etc); deprecation notes on superseded sections. |

### Table 121

| THE LIST IS NOT EXHAUSTIVE Risks not on this list will surface during operation. The discipline is to add them when they appear. The risk register is a living document that the architect updates monthly during the build, quarterly during ongoing operation. |
|---|

### Table 122

| 41 | MITIGATIONS PER RISK Cross-cutting mitigation strategies |
|---|---|

### Table 123

| Pattern | Risks it addresses |
|---|---|
| 3-of-5 council quorum with hardware keys | Architect compromise, single-pillar capture, premature escalation, unauthorised public release - reduces all of these |
| Audit chain (hash-linked, anchored to Polygon) | Compromise detection, post-incident reconstruction, defence against denial of decisions made |
| Cross-jurisdiction split (Cameroon corporate, EU hosting, Polygon anchor, EU registrar) | Single-state pressure, single-vendor compromise, regulatory capture - all are cross-jurisdiction so each requires multiple states/vendors to fail simultaneously |
| Automated quarterly recalibration | Calibration drift, biased pattern outputs, ECE degradation |
| Per-finding council review with explicit dissent | Material false positives at escalation; reduces blast radius of bad findings; creates retrospective learning data |
| Public correction protocol within 14 days | Reputational damage from confirmed errors, legal exposure for not retracting, calibration learning |
| §34 sealed envelope and exit protocol | Architect incapacity, organisational continuity, dignified end-state |
| Two-batch / two-vendor procurement | Supply-chain interdiction, single-vendor failure, customs seizure |
| Hardware-MFA on all critical accounts | Account takeover, social engineering of recovery flows, SMS interception |
| Pre-publication review by civil-society pillar | Disproportionate harm to bystanders, defamation exposure, ethical missteps |

### Table 124

| 42 | EARLY-WARNING INDICATORS What to watch for |
|---|---|

### Table 125

| Signal | What it might mean |
|---|---|
| Adapter health degraded for >24h on a key adapter (e.g. ARMP) | Source website changed, ISP issue, or active blocking. Investigate within 48h. If active blocking, this itself is a finding. |
| Calibration ECE rising on a specific pattern category | Drift in priors, or new external context (e.g. emergency declaration) the system is not yet aware of. Schedule recalibration. |
| Tip submission rate spiking unusually | Could indicate (a) an event in public life that is generating tips, (b) coordinated abuse of the endpoint. Triage manually before any council escalation. |
| Multiple findings from the same supplier within short window | Could be genuine pattern of misconduct, OR a single tipster's repeated submissions, OR a campaign against a specific actor. Council-side review carefully before any single-supplier escalation. |
| A council member's signature absent from votes for >60 days | Could be (a) personal life issue, (b) loss of motivation, (c) external pressure. Architect raises directly with council member, with the chair as backup. |
| Audit chain integrity check failing | Critical alert. Could indicate hash collision (extremely unlikely), corruption, or tampering. Stop all writes; investigate root cause; restore from last known good state. |
| Polygon anchor commit failures repeating | RPC provider issue, gas price spike, signer key issue. Investigate within 4h; have alternative RPC provider ready. |
| Vault unseal failures | Threshold of unseal shares not assembled. May indicate operational problem or unusual access pattern. Investigate before re-attempting. |

### Table 126

| Signal | What it might mean |
|---|---|
| A regulator who was responsive becomes silent for >90 days | Internal politics shift, or signal of declining engagement, or pressure on them. Schedule a check-in meeting; do not assume the worst. |
| A council member's public profile changes unusually (new appointment, new affiliation) | Could affect their council fit. Discuss with them whether the new role creates a conflict, in private; recusal may be needed. |
| A press article mentions VIGIL APEX inaccurately or critically | Information environment is changing. Decide whether to respond (rarely) or let it pass (usually). Note in decision log either way. |
| A government communication or decree references practices similar to VIGIL APEX without naming it | Could be acknowledgement, could be foreshadowing of regulation. Maintain awareness; consult counsel; do not react publicly without thought. |
| The architect receives social pressure from peers about "what they're really doing" | Information about the project is circulating outside intended channels. Consider whether this is benign curiosity or active intelligence-gathering. |
| A specific finding's recipient institution acts publicly within weeks of receiving the dossier | Strong positive signal that the institutional channel is working. Document; share with council quietly; do NOT take public credit. |
| A specific finding's recipient is prosecuted for unrelated misconduct shortly after receiving the dossier | Could be coincidence, or institutional weather changing. Do not infer causation; do not act publicly. |

### Table 127

| INDICATORS ARE PROMPTS, NOT VERDICTS When an indicator fires, it is a prompt to look more carefully, not a verdict that something is wrong. Many indicators have benign explanations. The discipline is: look at every indicator that fires; do not assume it will go away on its own; document what you found and what you decided. The accumulated record of indicator-investigation is itself an institutional asset; over time, it becomes a calibrated picture of what "normal" looks like. |
|---|

### Table 128

| 43 | LOADING ORDER WITH THE REST OF THE PACK How to give the agent the full picture |
|---|---|

### Table 129

| # Open the project repository cd ~/projects/vigil-apex   # Open Claude Code session claude   # First message of the session - paste this verbatim:   Before any work begins, please read all four documents in the docs/ folder, in this order:   1. CORE_SRD_v3.docx                  (binding specification) 2. CORE_EXEC_v1.docx                  (execution runbook -                                        institutional context, this doc) 3. CORE_BUILD_COMPANION_v1.docx      (procedural backbone,                                        prompts, phases) 4. CORE_BUILD_COMPANION_v2.docx      (full implementation reference)   After reading, do NOT generate code yet. Confirm you have all four loaded. Then read /docs/decisions/log.md (if it exists) to know what has been decided.   I will then tell you which phase we are in and what specific work block we are doing today. |
|---|

### Table 130

| 44 | SAMPLE PROMPTS REFERENCING THIS DOCUMENT How the agent uses the runbook |
|---|---|

### Table 131

| # Pattern: agent confirms institutional precondition before technical work   Before we start Phase 1 work today, please check the runbook (CORE_EXEC_v1 §03.2) and confirm whether the institutional precondition for Phase 1 is met. Specifically:     - Have YubiKeys been delivered? (yes/no)   - Are at least 2 council members named? (yes/no)   - Has the council enrolment ceremony been scheduled? (yes/no)   If any of these is no, we should NOT begin Phase 1 technical work. We should either complete the precondition first, or do work that does not require it (e.g. continue Phase 0 hardening, or do calibration seed research per §22).   Please report what you understand to be the current state, and recommend. |
|---|

### Table 132

| # Pattern: agent ensures decisions are logged synchronously   We just decided to use Hetzner Falkenstein for production hosting, with daily encrypted backup to OVH Strasbourg. Please:   1. Add a new entry to /docs/decisions/log.md following the template    in CORE_EXEC_v1 §37.2 2. Number it as DECISION-N where N is one greater than the highest    existing decision number 3. Include alternatives considered (bare-metal, AWS af-south-1) and    the rationale (jurisdictional distance, predictable cost,    SLA adequate) 4. Mark reversibility as Medium per the runbook's guidance 5. Wait for me to review before committing the file   Do not proceed with Dockerfile generation until the decision log entry is reviewed and committed. |
|---|

### Table 133

| # Pattern: agent assists with institutional work without overstepping   I want to draft the first conversation script for approaching a governance-pillar candidate. Read CORE_EXEC_v1 §11.2 for the canonical sample dialogue.   The candidate is [PROFESSIONAL TITLE], [BRIEF BACKGROUND], known for [SPECIFIC PUBLIC ACTION DEMONSTRATING INDEPENDENCE].   Adapt the §11.2 dialogue specifically for them. Maintain the discipline that:   - I do not name other candidates   - I do not promise immunity   - I do not negotiate compensation   - I tell them not to answer in the meeting   Produce the adapted script, then list which §11.3 NOT-to-say items I should be especially careful about given this candidate's profile. |
|---|

### Table 134

| # Pattern: agent helps with seed building (per §25 protocol)   I am pasting below the text of [SOURCE] from [DATE], specifically covering [CASE OR THEME].   Per the protocol in CORE_EXEC_v1 §25.2, please:   1. Identify cases that match VIGIL APEX patterns from    Companion v2 §45-52 2. For each case, propose a candidate seed-CSV row in the format    defined in §22.2 3. For posterior_at_review, apply the formula from the matching    pattern's prior + signals; if the case lacks evidence for    key signals, flag this 4. For ground_truth, propose a label only if you find at least    two evidence kinds per §23.3 two-source rule; otherwise    propose 'pending' 5. Produce 3-7 candidate rows; do NOT add to the seed file    directly; I review and append manually   [SOURCE TEXT FOLLOWS] |
|---|

### Table 135

| # Pattern: agent helps investigate an indicator that fired   The watchdog reported that the ARMP adapter has been failing for the past 36 hours. CORE_EXEC_v1 §42.1 lists this as an indicator that means "Source website changed, ISP issue, or active blocking; investigate within 48h; if active blocking, this itself is a finding."   Please help me investigate: 1. Pull the last 50 audit_event entries for the worker-adapter-armp 2. Check the adapter's last-seen response status codes and timing 3. If response is 200 but selectors are returning empty: source-website    change suspected 4. If response is 403/451 or connection refused: blocking suspected 5. If response is 5xx or timeouts: ISP/source-availability issue 6. Whatever the diagnosis, propose the next 3 actions in priority    order   Do NOT generate adapter code changes yet. We are in investigation mode. |
|---|

### Table 136

| 45 | WHAT THIS DOCUMENT MEANS THE AGENT WON'T HAVE TO DO Boundaries the runbook sets |
|---|---|

### Table 137

| Topic | What the runbook decides on the agent's behalf |
|---|---|
| Council formation logic | How candidates are identified, approached, vetted, committed, and enrolled. The agent does not propose council members, does not draft commitment letters from scratch, does not decide council composition. It uses the §08-14 protocol. |
| CONAC engagement strategy | When to send the engagement letter, what it says, how to interpret possible responses. The agent uses the §15 template and the §15.5 response-handling matrix; it does not invent variant strategies. |
| Hosting decision | Which provider, which region, which redundancy strategy. The agent uses the decision log to know what was chosen; it does not propose changes without the architect's request. |
| Calibration seed gathering | Sources to research, ground-truth standards, two-source rule, posterior estimation discipline. The agent uses §21-25 and proposes rows; it does not write to the seed file. |
| Threat model interpretation | Tier 1/2/3 classification of any new threat. The agent uses §39 and the SRD §05; it does not invent new tiers. |
| Risk register categories | What counts as a risk, how to mitigate, what early warning looks like. The agent uses §40-42; if it identifies a new risk not on the register, it proposes adding to §40, not handling unilaterally. |
| Decision-log discipline | When a decision is final vs provisional, how it is recorded, when it is reviewed. The agent uses §37; it adds entries when prompted; it does not autonomously decide what is or isn't a logged decision. |
| Sustainability / burnout protocol | Recognising and responding to architect overload. The agent does not advise on burnout but DOES respect §33 signals if the architect references them; the agent's response to a stressed architect is reduced output volume and increased clarity, not heroic over-delivery. |
| Exit / succession planning | When and how the project might end. The agent uses §34-35 if the architect raises the topic; it does not propose exit strategies unprompted. |

### Table 138

| THE AGENT IS A POWERFUL COLLABORATOR, NOT AN ORACLE VIGIL APEX is buildable in 8-14 weeks because the agent is genuinely capable of the technical work. It is also limited: it does not understand the political environment of Yaoundé, it does not know who can be trusted, it does not feel the weight of council members' careers being staked on its outputs. The runbook is what keeps the agent's tremendous technical capability tethered to institutional reality. Read it together; let it govern together. |
|---|

### Table 139

| 46 | CLOSING What you have, what comes next |
|---|---|