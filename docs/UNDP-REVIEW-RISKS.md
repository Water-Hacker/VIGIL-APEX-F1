# UNDP Review — Risk Register

> **Status:** DRAFT prepared by the architect for the UNDP review team.
> Read this BEFORE the rest of the codebase. Every concern a reviewer
> could raise about VIGIL APEX is enumerated below, with the current
> mitigation in code and the partnership ask that would close the
> residual exposure.
>
> The intent of this document is the opposite of marketing: it lists
> every weakness the architect already knows about, so the reviewer
> can spend their time validating the mitigations rather than
> discovering the weaknesses.
>
> **Audience:** UNDP technical reviewer; UNDP program officer; their
> counsel; their evaluation department.
>
> **Last refreshed:** 2026-05-17 (architect signoff pending).

---

## Reading guide

Each risk has the same shape:

- **What** — the concrete risk in one sentence.
- **Severity** — CRITICAL (blocks deployment) / HIGH (blocks scaling) /
  MEDIUM (operational drag) / LOW (cosmetic).
- **Current mitigation in code/docs** — what the architect has already
  built or written.
- **Residual exposure** — what's left after the mitigation.
- **Partnership ask** — what UNDP partnership would unlock to close
  the residual exposure.

The 12 risks are ordered by _severity × likelihood-of-being-raised-in-review_.
A skim of the bold lines tells you what you're looking at.

---

## R-01 — Bus factor: one architect

**What.** VIGIL APEX has a single architect (Junior Thuram Nana). The
weakness tracker has carried W-17 ("backup architect specced but
never named") as 🟦 _institutional-gated_ since 2026-04-28.

**Severity.** CRITICAL.

**Current mitigation in code/docs.**

- The decision log (`docs/decisions/log.md`) is structured so a
  successor can reconstruct architectural intent (23 numbered
  decisions, dated, with rationale).
- The phase-gate CI workflow (`.github/workflows/phase-gate.yml`)
  enforces process discipline that survives author change.
- `CLAUDE.md` is a deterministic load-order for any future agent or
  human picking up the project.
- The doctrine documents (SRD, EXEC, BUILD-COMPANION, HSK, TAL-PA,
  AI-SAFETY-DOCTRINE) constitute a transferable specification.
- The 23 worker runbooks under `docs/runbooks/` give an operator
  enough to keep the system running for ~6 months without the
  architect.

**Residual exposure.** All of the above documents _the work_; none of
them name a person, hand over a YubiKey, brief them on the political
context in Cameroon, or fund their retainer. If the architect is
incapacitated tomorrow, the system is unmaintainable within weeks.

**Partnership ask.** Year-one grant funds:

- One backup architect identified, vetted, and retained for ~€400/mo.
- Quarterly DR rehearsal where the backup runs the full council
  ceremony.
- YubiKey co-provisioning (architect + backup hold parallel hardware
  for every key role).
- Vault Shamir share allocation that includes the backup
  (5-of-5 → 5 named individuals, currently 4 unnamed council pillars
  - 1 backup architect).

The backup architect is the single highest-leverage UNDP intervention.

---

## R-02 — Zero deployment, zero real-world calibration

**What.** The system has never received a real tip, generated a real
dossier, or been audited under real load. Every claim about its
performance is theoretical.

**Severity.** CRITICAL for deployment funding; HIGH for design-partnership.

**Current mitigation in code/docs.**

- 60/60 packages green on typecheck + lint + test
  (4000+ test cases across the monorepo).
- 90/90 hardening modes closed at the code layer (82 CV + 6 N/A +
  2 ceremony-pending), evidenced under
  `docs/audit/evidence/hardening/`.
- A 224-row synthetic anti-hallucination corpus
  (`packages/llm/__tests__/synthetic-hallucinations.jsonl`)
  exercises the 12-layer AI-safety doctrine.
- `scripts/dr-rehearsal.ts` simulates 14 failure modes including
  node loss, Patroni failover, Vault Raft leader loss, k3s node
  drain.
- `scripts/smoke-stack.sh` brings up the full compose stack.

**Residual exposure.** W-16 ("calibration seed chicken-and-egg") has
been deferred to M2 exit. Without ground-truth-labelled cases, the
Bayesian engine's posteriors are uncalibrated — a 0.85 posterior may
mean anything from 0.5 to 0.95 actual true-positive rate.

**Partnership ask.** Year-one grant funds:

- A research partner (one of CSPA, AfriCOG, Transparency
  International-Cameroon, or a Cameroonian university's anti-
  corruption centre) to assemble the 30+ ground-truth-labelled
  cases per EXEC §25.
- Architect-led labelling of cases against published outcomes (CONAC
  press releases, Cour Suprême judgments).
- Calibration table population (`calibration.entry`) followed by
  reliability-band reporting (`expectedCalibrationError`, Brier
  score per pattern).
- A scoped 6-month pilot with one institution (recommended: Cour des
  Comptes, which has more constitutional independence than CONAC)
  to generate real cases the calibration can update against.

---

## R-03 — No independent security audit

**What.** The hardening passes, tier audits, weakness tracker, and
gap-closure sweeps are all by the same author. For a system that
handles citizen tip submissions and produces evidence packages for
prosecutors, this is insufficient.

**Severity.** HIGH.

**Current mitigation in code/docs.**

- Phase-gate CI runs 10 lints + gitleaks + trufflehog + snyk + trivy
  - sbom + a11y + visual-regression + helm-values/golden drift on
    every PR.
- `.gitleaks.toml` blocks accidental secret commits with a
  per-PR pre-commit hook + a daily server-side scan.
- Threat-model coverage matrix at
  `docs/security/threat-coverage-matrix.md` (TTP-CMR-01..07 +
  SRD §05 Tier-1/2/3).
- Per-mode CLOSURE.md files for the 90 hardening modes give an
  external auditor a clear starting point.
- Falco rules at `infra/observability/falco/vigil-rules.yaml`.

**Residual exposure.** No external eyes have looked at the
libsodium tip flow, the Shamir share material handling, the audit-
chain canonical bytes, or the Polygon signer Unix-domain-socket
adapter. A named-firm pentest report would close this.

**Partnership ask.** Year-one grant funds:

- One pentest engagement from a name-brand firm (NCC, Trail of Bits,
  Doyensec, Cure53) — scoped to ~10 person-days, focused on the
  tip-portal flow + audit chain + signer adapter.
- One independent cryptographic review of the Shamir + age-plugin-
  yubikey + libsodium sealed-box composition (1-2 person-days).
- Bug-bounty program scaffolding (~$5k initial pool, scoped to
  read-only surfaces in Phase 1).

---

## R-04 — Cameroon political context: defamation + retaliation exposure

**What.** Anti-corruption tech in Cameroon operates under a regime
with a history of using legal mechanisms against critics (Loi 2019
on cybercrime, defamation suits, ANTIC's surveillance powers). A
false-positive finding against a politically-connected entity could
trigger a defamation suit, an ANTIC investigation, or retaliation
against the architect / council / civic partners.

**Severity.** HIGH.

**Current mitigation in code/docs.**

- W-15 ("Defamation exposure on /verify") closure: the public
  verify page surface is entity-name-free (`apps/dashboard/src/lib/verify.server.ts`);
  operator-only `/api/findings/[id]` has belt-and-braces role check.
- `THREAT-MODEL-CMR.md` enumerates Cameroon-specific TTPs
  (TTP-CMR-01..07).
- W-9 closure: tip portal is Tor-native (onion v3 + PoW + obfs4)
  so citizen submitters are protected from network-level
  identification.
- Off-jurisdiction backup (Hetzner Falkenstein) keeps a copy of the
  ledger outside Cameroonian legal reach.
- Council 3-of-5 quorum + signed escalation means no single
  signature releases a finding to a recipient body.
- DEV-UNSIGNED- fingerprint guard
  (`apps/worker-conac-sftp/src/dev-unsigned-guard.ts`) prevents
  unsigned dossiers from reaching institutional recipients.

**Residual exposure.** No signed legal opinion from Cameroonian
counsel covers: (a) the legality of the operational entity that
will hold the YubiKeys + sign dossiers, (b) defamation safe-harbours
for the dossier delivery model, (c) ANTIC declaration status under
Loi 2010/021 for personal-data processing in the tip flow, (d)
whether the off-jurisdiction backup violates data-sovereignty law,
(e) whether the architect's personal legal exposure is bounded.

**Partnership ask.** Year-one grant funds:

- A Cameroonian counsel retainer (~€2000/mo) producing signed
  opinions on (a)–(e) above.
- Bar-vetted defamation insurance covering the operational entity.
- Counsel-reviewed dossier-delivery contracts with each recipient
  body before any production transmission.
- UNDP's own legal team confirming the chain-of-custody model is
  fit-for-purpose for evidence handling per UNCAC norms.

---

## R-05 — Theory of change: dossier → impact bridge

**What.** The system generates findings → renders dossiers → delivers
them to CONAC and other institutional recipients. Whether _anything
happens after delivery_ depends on the political will and prosecution
capacity of those institutions, which in Cameroon is mixed.

**Severity.** HIGH (for impact-evaluation funding); MEDIUM (for
platform funding).

**Current mitigation in code/docs.**

- `worker-outcome-feedback` is wired to match operational signals
  (CONAC press releases, Cour Suprême judgments, ARMP debarments,
  ANIF bulletins, MINFI clawbacks) back to delivered dossiers so
  the system measures what proportion produces institutional
  action.
- The `OutcomeMatch.score` calibration ([apps/worker-outcome-feedback/src/outcome-matching.ts](../apps/worker-outcome-feedback/src/outcome-matching.ts)) gives the operator a feedback loop on whether the
  threshold (posterior ≥ 0.85 + signal_count ≥ 5) is producing
  actioned cases.
- Multi-recipient routing via format-adapter
  (`apps/worker-conac-sftp/src/format-adapter.ts`) supports
  CONAC, Cour des Comptes, MINFI, ANIF, CDC — the system is not
  CONAC-monogamous and can route to whichever institution shows
  willingness to act.

**Residual exposure.** Even the outcome-feedback worker is
measuring a future the platform hasn't entered yet. Without
operational data, the platform cannot demonstrate which institution
acts on which class of finding, which is the meta-question UNDP
evaluation would prioritise.

**Partnership ask.** Pilot phase funds:

- A formal MOU with Cour des Comptes (or Conseil d'État, or a
  hybrid CONAC + civic-society arrangement) to receive a bounded
  trickle of findings for an evaluation period.
- Quarterly outcome-mapping with civic partner organisations to
  catalogue institutional response patterns.
- A neutral evaluator (probably UNDP's evaluation department or an
  outside contractor) framing the theory of change as a falsifiable
  hypothesis with metrics.

---

## R-06 — Co-design gap: civic society, journalists, prosecutors, citizens

**What.** The system was designed by one engineer working from
public-domain anti-corruption literature + a self-derived threat
model. No civic partners, no journalists, no prosecutors, no
ordinary citizens participated in shaping requirements.

**Severity.** HIGH for UNDP cultural fit; MEDIUM for technical fit
(many requirements would survive co-design).

**Current mitigation in code/docs.**

- Bilingual FR/EN at every UI surface (UN-friendly default).
- Tor-native tip portal with PoW + obfs4 (citizen-safety
  conscious).
- Council quorum is 5-pillar (governance / judicial / civil-society /
  audit / technical) so civic-society representation is structurally
  baked in.
- Hash-chain + Polygon anchor + Fabric witness = the _citizen_ can
  independently verify the system isn't lying about a finding
  (TAL-PA "the watcher is watched").
- Public dashboard (`/verify`, `/public/audit`) gives transparency
  surfaces accessible without authentication.

**Residual exposure.** Civic partners have not validated the menu
flow on the USSD/SMS tip channel, the tone of the dossiers, the
operational triggers for a finding, or the prioritisation of
pattern categories. The architect is one perspective; the system
needs structured exposure to others.

**Partnership ask.** Year-one grant funds:

- A 6–12 month structured co-design engagement with 2–3 civic
  organisations (suggested: CSPA, Transparency International-
  Cameroon, AfriCOG regional, ANIIA — pick the ones with
  operational + journalistic + community-radio reach).
- Two co-design workshops in Yaoundé and Douala.
- Field-testing the tip portal flow with anonymised partner-
  recruited test submitters.

---

## R-07 — Data sovereignty: off-jurisdiction backup

**What.** Citizen tips collected in Cameroon, replicated to Hetzner
Falkenstein, with sentinel monitors in Helsinki / Tokyo / NYC.
Lawful under Cameroonian data-protection regime? GDPR-compliant on
the European leg?

**Severity.** MEDIUM.

**Current mitigation in code/docs.**

- All tips are libsodium sealed-box ENCRYPTED at the browser
  (`packages/security/src/sodium.ts`) before transit; the off-
  jurisdiction host stores ciphertext only.
- The operator-team private key is 3-of-5 Shamir-shared
  (`packages/security/src/shamir.ts`); recovery requires explicit
  council ceremony.
- The Hetzner replica is a backup target, not a primary read path.
- No PII is committed to Postgres without prior sealed-box
  decryption ceremony, which happens only at the Cameroon primary
  site.

**Residual exposure.** A Cameroonian regulator could still argue the
ciphertext is "personal data" under Loi 2010/021 and trigger
notification requirements. Hetzner's data-processing addendum has
not been GDPR-reviewed for this use-case.

**Partnership ask.**

- Counsel opinion (covered under R-04 retainer) on the legality of
  ciphertext-only replication.
- DPIA (Data Protection Impact Assessment) drafted with UNDP's
  privacy-by-design specialist.
- Optionally: a second-jurisdiction backup that's not in the EU
  (e.g., Switzerland or Mauritius) if the European leg is judged
  too sensitive.

---

## R-08 — Sustainability + cost realism

**What.** Phase-2 migration to 3× HPE ProLiant DL380 Gen11 cluster
costs ~$100k hardware + ~$20k network/PDU + ongoing ~$2k/mo ops +
~€2k/mo counsel + ~€400/mo backup architect + ~€500/mo Vault +
~$500/mo Polygon gas + monitoring. Total ~$50k year-one ops on top
of capex. Architect-funded today.

**Severity.** MEDIUM-HIGH for sustainability after grant ends.

**Current mitigation in code/docs.**

- `docs/decisions/decision-020-dl380-ai-security-tier.md` captures
  the hardware decision rationale.
- The Helm chart (`infra/k8s/charts/vigil-apex/`) supports a
  smaller cluster spec via `values.yaml workers[].replicas`
  overrides; the `workersDisabled[]` mechanism lets dev or pilot
  envs run a 1-worker subset.
- The HPE migration plan
  (`/home/kali/.claude/plans/crispy-pondering-teapot.md`) is
  documented end-to-end so a sustainability planner can scope
  refresh cycles, support contracts, and operational rota.
- Single-binary fall-back: the entire stack also boots on a single
  docker-compose host (`scripts/smoke-stack.sh` proves it).

**Residual exposure.** No 3-year TCO document; no operational
transfer plan to a host institution (CONAC's IT shop, a
Cameroonian university's HPC centre, a CEMAC regional facility).
After the grant, the operating expense reverts to the architect
unless transfer is planned.

**Partnership ask.**

- Year-one design-partnership grant funds a sustainability
  planning consultancy producing: 3-year TCO, transfer-to-
  institution shortlist, host-institution due diligence, and a
  signed letter of intent from the receiving institution by month 18.
- Optionally: a co-funding arrangement with the CEMAC regional
  anti-corruption mechanism so VIGIL APEX becomes a regional
  rather than national platform (multiplies the cost base across
  6 countries).

---

## R-09 — Cryptographic complexity vs operational footprint

**What.** Hyperledger Fabric + Polygon anchoring + libsodium sealed-
box + Shamir quorum + age-plugin-yubikey + GPG detached signatures

- mTLS + WireGuard + Tor — the cryptographic surface is sophisticated
  but operationally heavy. A simpler design (Postgres + GPG-signed
  CSV exports + a single transparency-log SaaS) would deliver 70-80%
  of the value with 20% of the ops burden.

**Severity.** MEDIUM (architect-debatable).

**Current mitigation in code/docs.**

- W-11 closure acknowledges Fabric is "single-peer theatre" today
  and the second-witness benefit is real only once Phase-2
  multi-org expansion brings CONAC + Cour des Comptes peers
  online.
- The Postgres hash-chain (`packages/audit-chain/src/hash-chain.ts`)
  is the load-bearing audit primitive; Fabric and Polygon are
  redundant witnesses, not replacements.
- The polygon-signer is a Unix-domain-socket adapter
  (`tools/vigil-polygon-signer`) — the signing key never enters
  Node-process memory; an attacker compromising the JS layer
  cannot exfiltrate it.

**Residual exposure.** The architect has not produced a "minimal
viable witness" alternative design that the UNDP reviewer could
compare against. The honest question is: would $1M of UNDP funding
go further on the current rich design or on a stripped-down
high-volume version?

**Partnership ask.**

- A 2-week architect-led design comparison: current rich design
  vs minimal-witness alternative (Postgres-only + GPG-signed
  CSVs + Sigstore Rekor). Document the trade-offs for UNDP
  reviewers.
- Joint decision on which trajectory to fund.

---

## R-10 — Documentation overload

**What.** SRD-v3 + EXEC-v1 + BUILD-COMPANION-v1 + v2 + HSK + TAL-PA

- AI-SAFETY-DOCTRINE + ROADMAP + OPERATIONS + THREAT-MODEL-CMR +
  27 weakness files + 23 decisions + 61 runbooks + per-mode CLOSURE
  files. A 2-week reviewer cannot read all of this carefully.

**Severity.** MEDIUM.

**Current mitigation in code/docs.**

- `CLAUDE.md` declares a mandatory load-order for any agent or
  human picking up the project.
- `REVIEW.md` (this PR) provides a curated reading path: "if you
  have 4 hours, read these 6 files; if you have a day, also read
  these 8 files."
- `docs/decisions/log.md` is the chronological narrative; a reader
  can follow the project's reasoning end-to-end without reading
  every doctrine doc.
- `PHASE-1-COMPLETION.md` is the single status-board reviewers
  can use to triangulate everything else.

**Residual exposure.** The volume could still signal "building
documentation for an imagined review committee rather than for
users" to a skeptical reviewer. The cure is users; we don't have
them yet (see R-02, R-06).

**Partnership ask.** N/A — this risk closes itself as users come
online via R-02 + R-06 partnerships.

---

## R-11 — Test depth vs surface area

**What.** 4000+ test cases, all 60 packages green — impressive
breadth. But the depth varies: some workers have characterisation
tests of their handle() method, others rely on source-grep
regressions, others have only smoke tests. A failure-mode taxonomy
review would find uncovered paths.

**Severity.** MEDIUM.

**Current mitigation in code/docs.**

- The 90-mode hardening pass closed every documented failure mode
  with a test that would have caught it.
- `scripts/check-test-coverage-floor.ts` is at allowlist count 0 —
  every worker has at least one test file.
- The synthetic-failure CI workflow
  (`.github/workflows/synthetic-failure.yml`) deliberately mutates
  inputs to confirm each phase-gate lint rejects them.
- Integration tests gate on `INTEGRATION_DB_URL` and
  `INTEGRATION_REDIS_URL`; CI provides both.

**Residual exposure.** No chaos-engineering tests under load. No
adversarial fuzzing of the Bayesian engine or the audit chain.
No mutation testing.

**Partnership ask.**

- Year-one grant funds a chaos-engineering consultancy (~10
  person-days from Gremlin, Bloomberg's chaos engineering team,
  or similar) to design 5–10 production-realistic chaos
  experiments.
- Optionally: fuzzing setup (libFuzzer / atheris) for the audit-
  chain canonical bytes + the Bayesian posterior computation.

---

## R-12 — AI safety: LLM-in-the-loop legal exposure

**What.** Findings produced by an LLM-mediated pipeline against
named individuals create defamation risk if the LLM hallucinates
or the threshold gates fail. This is a UNDP-institutional-risk
question more than a Cameroon-local one.

**Severity.** MEDIUM (with current safeguards); HIGH (without them).

**Current mitigation in code/docs.**

- 12-layer anti-hallucination doctrine
  (`docs/source/AI-SAFETY-DOCTRINE-v1.md`).
- 224-row synthetic-hallucinations corpus pinning every layer's
  rejection rate.
- L1 (schema), L2 (citation-required), L3 (CID-in-context) guards
  run on every SafeLlmRouter call
  (`packages/llm/__tests__/guards-l1-l3.test.ts` — 15 tests).
- The adversarial pipeline (`packages/certainty-engine/src/adversarial.ts`)
  runs order-randomisation + devil's-advocate + counterfactual-
  probe + secondary-review before any high-tier dispatch.
- Tier-36 audit closure: silent adversarial-pipeline failure
  forces tier downgrade (no silent promotion to action_queue).
- The 5-pillar council 3-of-5 quorum is the final human gate;
  no LLM output reaches an institutional recipient without
  three signed human votes.
- Permanent CI guard (`scripts/check-safellm-coverage.ts`)
  ensures every direct LlmRouter call is paired with a
  SafeLlmRouter — silent doctrine bypasses are CI-blocked.

**Residual exposure.** None of the layers is 100% effective; a
sophisticated prompt-injection or model-update regression could
slip past. The doctrine assumes human-in-the-loop via council
quorum — if a council pillar rubber-stamps without reading, the
guarantee weakens.

**Partnership ask.**

- UNDP-mediated independent AI-safety review of the doctrine
  (likely a 1-week engagement with an academic or industry safety
  specialist).
- Council training materials emphasising that the YES vote is a
  human attestation, not a rubber stamp.

---

## Summary scorecard

| Risk | Severity | Mitigated today          | Partnership ask                 |
| ---- | -------- | ------------------------ | ------------------------------- |
| R-01 | CRITICAL | Documentation + process  | Backup architect + Shamir share |
| R-02 | CRITICAL | Synthetic only           | Calibration partner + pilot     |
| R-03 | HIGH     | Self-audit               | Pentest + crypto review         |
| R-04 | HIGH     | Code-level guards        | Cameroonian counsel retainer    |
| R-05 | HIGH     | Outcome-feedback wired   | Pilot MOU + evaluator           |
| R-06 | HIGH     | 5-pillar council struct  | Civic co-design engagement      |
| R-07 | MEDIUM   | Ciphertext-only off-site | DPIA + sovereignty opinion      |
| R-08 | MED-HIGH | Helm flexibility         | TCO + institutional transfer    |
| R-09 | MEDIUM   | Layered witnesses        | Architect comparison doc        |
| R-10 | MEDIUM   | Curated reading path     | Closes via users (R-02/R-06)    |
| R-11 | MEDIUM   | 4000+ test cases         | Chaos + fuzzing engagement      |
| R-12 | MEDIUM   | 12-layer + council       | Independent AI-safety review    |

The two CRITICAL items (R-01 + R-02) — backup architect and real
calibration data — are the irreducible blockers to deployment
funding. Every other risk has a layered mitigation in place; the
partnership asks are about _strengthening_ those mitigations, not
_introducing_ them.

---

## What I (the architect) am NOT asking for

For clarity:

- **Not** a deployment grant in year one. The system is not ready;
  asking for one would burn the relationship.
- **Not** UNDP signoff on the cryptographic design. That's an
  architect responsibility; UNDP partnership funds the
  independent review, not the design itself.
- **Not** an exclusive funding relationship. VIGIL APEX should
  also engage Open Government Partnership, the Anti-Corruption
  Resource Centre, and Cameroonian civil-society funding channels.
- **Not** UNDP staff time on the code. The architect maintains
  the codebase; UNDP partnership unlocks institutional ceremonies
  the architect cannot perform alone.

---

## Sign-off

**Drafted by:** Junior Thuram Nana (architect), with agent
support, on 2026-05-17.
**Status:** DRAFT — pending architect read-through + final edit
before transmission to UNDP review team.
**Next revision trigger:** any of the 12 risks moves to a new
severity, or a new risk surfaces during review.
