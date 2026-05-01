# SRD §30 — milestone acceptance test enumeration (draft)

**Block-D D.11 / 2026-05-01.** Architect-spec'd Block-D deliverable
per PHASE-1-COMPLETION A8 follow-up: agent drafts §30.1–§30.7 detail
based on the inferred mapping in
[E2E-FIXTURE-COVERAGE.md §3](../work-program/E2E-FIXTURE-COVERAGE.md#3-inferred-phase-1-milestone-gates--fixture-step-mapping)
plus the existing AT-NNN tables already present in SRD-v3 (Tables
186–192). Architect reviews and edits in place, then merges into
[SRD-v3.md §30](SRD-v3.md#section-30) with the section-30 sub-headings.

## Citation discipline

Every test entry below is tagged exactly one of:

- **`[CITED Table N]`** — verbatim from the matching AT-NNN row in
  SRD-v3 Tables 186–192. The architect already wrote this; the only
  change is its placement under the §30.X sub-heading.
- **`[INFERRED §29.X]`** — the agent's inference. The §29.X
  milestone narrative names a deliverable that lacks an
  acceptance-test entry in Tables 186–192; the agent proposes one.
  Architect must confirm or reject before merge.
- **`[INFERRED — agent recommendation]`** — the agent's recommendation
  with no §29 citation. Industry-standard milestone-gate practice or
  defence-in-depth check that fits the milestone's exit posture.
  Architect must confirm or reject before merge.

The build agent commits NO `[INFERRED]` entries to SRD-v3.md without
explicit architect confirmation. This draft is the staging document.

---

## §30.1 — M0c cold-start tests

Entry: hardware delivered, architect alone. Exit: cold-start time
under 30 minutes; LUKS + Vault + Caddy + Keycloak verifiably alive.

- **AT-M0c-01** `[CITED Table 186]` Cold-start time from host power-on
  to all containers healthy is under 30 minutes (measured end-to-end
  on a clean install).
- **AT-M0c-02** `[CITED Table 186]` LUKS unlock requires both Tang
  server reachable AND a YubiKey present; either alone fails.
  Verified by removing one and attempting unlock.
- **AT-M0c-03** `[CITED Table 186]` Vault Shamir unseal requires 3 of 5
  YubiKey-encrypted shares; 2 of 5 fails. Verified manually during
  M0c week 1.
- **AT-M0c-04** `[CITED Table 186]` Caddy serves vigilapex.cm/health
  over public TLS (Let's Encrypt) and the certificate chain validates
  from a clean Firefox / Chrome client.
- **AT-M0c-05** `[INFERRED §29.2 day 7-8]` PostgreSQL container is up
  with all 6 schemas deployed (`adapter`, `entity`, `audit`, `pattern`,
  `finding`, `tip` per §17.2); verified by `pg_dump --schema-only`
  matching the committed migrations.
- **AT-M0c-06** `[INFERRED §29.2 day 7-8]` Neo4j container up + IPFS
  container up + Redis container up; each responds to its respective
  healthcheck endpoint within 30s of `docker compose up`.
- **AT-M0c-07** `[INFERRED §29.2 day 5-6]` All 4 host systemd units
  (`vigil-vault-unseal`, `vigil-polygon-signer`, `vigil-time`,
  `vigil-watchdog`) report `active (running)` after a clean boot.
- **AT-M0c-08** `[INFERRED §29.2 day 9-10]` Keycloak admin can
  enrol the architect's YK-01 via FIDO2 WebAuthn end-to-end; first
  authentication using YK-01 succeeds.
- **AT-M0c-09** `[INFERRED §29.2 day 3-4]` Btrfs subvolume layout
  matches the committed plan: `/srv/vigil/{postgres,neo4j,ipfs,
ipfs2,vault,...}` each is its own subvol; verified by
  `btrfs subvolume list /srv/vigil`.

---

## §30.2 — M1 data plane tests

Entry: M0c green. Exit: 26-of-26 adapter coverage; data flowing
into Postgres + Neo4j + IPFS; entity resolution + dedup working.

- **AT-M1-01** `[CITED Table 187]` Adapter coverage 26 of 26: every
  adapter named in §12 is deployed, scheduled, and producing at least
  one event in a 24-hour window.
- **AT-M1-02** `[CITED Table 187]` Proxy diversity: no single proxy
  provider accounts for more than 60% of total egress GB over a
  7-day window.
- **AT-M1-03** `[CITED Table 187]` Captcha budget compliance: monthly
  captcha solve cost under $500 (extrapolated from 7-day window).
- **AT-M1-04** `[CITED Table 187]` IPFS-Synology consistency: every
  document pinned in local IPFS is also present in Synology backup
  within 1 hour of pin; verified by automated reconciliation script.
- **AT-M1-05** `[INFERRED §29.3 week 4]` Dead-letter queue is
  functional: a deliberately-malformed `source.events` row is
  re-tried per the worker's retry policy and lands in the DLQ within
  the configured backoff window; observable in the operator
  dashboard's DLQ panel.
- **AT-M1-06** `[INFERRED §29.3 week 5]` Document pipeline (fetch →
  hash → MIME → OCR → IPFS pin → store) round-trips a sample PDF
  end-to-end in ≤ 60s; the resulting `document.processed` event
  carries `{document_cid, sha256, mime, ocr_text_excerpt}`.
- **AT-M1-07** `[INFERRED §29.3 week 6]` Entity-resolution worker
  collapses two `source.events` referencing the same supplier under
  different display-name spellings into one `entity.canonical` row
  within 5s; the rule-pass / LLM-pass split is verified by feeding
  one trivial-match pair (rule-pass) and one variant pair (LLM-pass).
- **AT-M1-08** `[INFERRED §29.3 week 6]` Operator dashboard pipeline-
  at-a-glance shows live event counts that update within 5s of a
  fixture seed; verified against the Block-D `e2e-fixture.sh` flow.

---

## §30.3 — M2 intelligence plane tests

Entry: M1 green. Exit: 43-of-43 patterns; ECE under 5%; counter-
evidence runs on every finding above 0.85; cost ceilings enforced.

- **AT-M2-01** `[CITED Table 188]` Pattern coverage 43 of 43: every
  pattern in §21 is implemented and unit-tested with at least one
  synthetic positive and one synthetic negative.
- **AT-M2-02** `[CITED Table 188]` Expected Calibration Error (ECE)
  under 5% measured on the 200-finding labelled set.
- **AT-M2-03** `[CITED Table 188]` At least 50 findings produced over
  a 7-day window in steady state, of which at least 5 cross the 0.85
  escalation threshold.
- **AT-M2-04** `[CITED Table 188]` Devil's-advocate counter-evidence
  pass runs on every finding above 0.85 and produces a non-empty
  Caveats object; verified over 7-day window.
- **AT-M2-05** `[CITED Table 188]` LLM tier routing daily cost stays
  under $30 soft ceiling on all 7 days of a typical week; never
  breaches $100 hard ceiling.
- **AT-M2-06** `[CITED Table 188]` Anti-hallucination quote-match
  rejection rate is between 1% and 8% over a 7-day window (above 8%
  triggers prompt review; below 1% suggests the check is not
  exercised).
- **AT-M2-07** `[CITED Table 188]` Numerical-disagreement rate (L8) is
  under 5% over a 7-day window.
- **AT-M2-08** `[INFERRED §29.4 week 9]` Bedrock failover end-to-end:
  with the Anthropic API key blocked at the egress firewall, the
  next LLM call routes via AWS Bedrock and returns a valid response
  within 3× the normal latency; verified once during M2 standup.
- **AT-M2-09** `[INFERRED §29.4 week 11]` All 12 anti-hallucination
  layers (L1..L12 per AI-SAFETY-DOCTRINE-v1) emit telemetry to
  Prometheus; verified by querying for at least one sample for each
  layer's metric over a 24h window.
- **AT-M2-10** `[INFERRED §29.4 week 12]` First calibration report
  archived under `docs/calibration-reports/<YYYY-MM-DD>.md` with the
  measured ECE, the 200-row labelled set hash, and the operator
  signature. Verified by file existence + content shape.
- **AT-M2-11** `[INFERRED — agent recommendation]` Pattern firing is
  visible in the operator dashboard's per-pattern panel within 5s of
  the producing finding; verified end-to-end with a fixture-seeded
  finding.

---

## §30.4 — M3 delivery plane tests

Entry: M2 green. Exit: dossier renders deterministically; CONAC
SFTP round-trip; MINFI API live; frontend surfaces functional.

- **AT-M3-01** `[CITED Table 189]` VIGILAnchor and VIGILGovernance
  contracts deployed to Polygon mainnet, source verified on
  PolygonScan, deployment record in `/infra/polygon-deploy.json`.
- **AT-M3-02** `[CITED Table 189]` Dossier PDF reproducibility:
  rendering the same finding twice produces a bit-identical PDF
  (sha256 match). Verified across 10 test findings.
- **AT-M3-03** `[CITED Table 189]` CONAC SFTP round-trip: a test
  dossier upload generates an ACK file within 7 days (in M3 testing,
  the ACK is from a test endpoint operated by the architect; in
  production from CONAC).
- **AT-M3-04** `[CITED Table 189]` MINFI scoring API meets P95
  latency under 200ms across 1000 representative requests.
- **AT-M3-05** `[CITED Table 189]` MINFI API fail-soft verified:
  when VIGIL is intentionally taken offline, the documented client
  behaviour (default to unknown, payment proceeds) is achievable
  from a test client.
- **AT-M3-06** `[CITED Table 189]` Frontend surfaces functional:
  operator dashboard loads under 2s, finding-detail loads under 3s,
  council vote ceremony completes within 30s including WebAuthn
  signature, public verification renders for any sample VA-ref.
- **AT-M3-07** `[INFERRED §29.5 week 18]` Triage UI for tips renders
  the operator-facing tip queue with priority sorting, decryption
  affordance (3-of-5 council quorum), and one-click promote-to-
  finding; verified end-to-end against a fixture tip.
- **AT-M3-08** `[INFERRED §29.5 week 18]` Public-verification page
  is reachable via the `.onion` hidden service in addition to the
  clearnet URL; renders the same content as the clearnet path.

---

## §30.5 — Tip-In Portal tests (also M3 exit gate)

Entry: M3 frontend stack stable. Exit: anonymous + identifiable
submission paths both work; PII handling verified; rate-limiting
verified.

- **AT-30.5-01** `[CITED Table 190 / AT-28-01]` Submission flow
  completes in under 5 seconds at P95 over a 1Mbps connection from
  Yaoundé.
- **AT-30.5-02** `[CITED Table 190 / AT-28-02]` Anonymous submission
  produces zero IP entries in the application database (verified by
  automated scan against tip schema).
- **AT-30.5-03** `[CITED Table 190 / AT-28-03]` All five accepted
  attachment types pass through the EXIF-strip pipeline; verified by
  re-extracting metadata from the IPFS-pinned copy and confirming
  GPS / author / created-by are absent.
- **AT-30.5-04** `[CITED Table 190 / AT-28-04]` A submitted contact
  field is unreadable in PostgreSQL without the operator-team
  private key (verified by attempting decryption with a different
  key; expected libsodium failure).
- **AT-30.5-05** `[CITED Table 190 / AT-28-05]` Five submissions from
  the same IP within 60 minutes triggers rate-limit response on the
  sixth (verified end-to-end including Cloudflare layer).
- **AT-30.5-06** `[CITED Table 190 / AT-28-06]` A tip with malformed
  JSON, missing required fields, or oversize attachments returns
  400 / 413 and is not persisted.
- **AT-30.5-07** `[CITED Table 190 / AT-28-07]` A promoted tip
  increases the bound finding's signal count by exactly one and
  shifts its posterior consistent with prior 0.10 ± 0.05; verified
  against the Bayesian engine's deterministic output.
- **AT-30.5-08** `[CITED Table 190 / AT-28-08]` The submitter
  status-lookup page never reveals operator identity, triage notes,
  or finding linkage; verified by inspecting the response body of
  `/tip/status`.

---

## §30.6 — M4 council standup tests

Entry: M3 green. Exit: all five pillar holders provisioned, trained,
and verifiably able to vote.

- **AT-M4-01** `[CITED Table 191]` All five (5) council pillar
  holders successfully cast at least one signed vote on Polygon
  Mumbai testnet during M4. Vote signatures verify on-chain.
- **AT-M4-02** `[CITED Table 191]` Recovery drill: simulating loss
  of one pillar holder's YubiKey, the recovery procedure (§17.16) is
  executed and the holder is replaced and re-enrolled within 24
  hours.
- **AT-M4-03** `[INFERRED §29.6 week 20]` Each of the 5 pillar
  holders has WebAuthn FIDO2 enrolment in Keycloak with their
  YubiKey; verified by 5 successful logins (one per holder) on M4
  exit day.
- **AT-M4-04** `[INFERRED §29.6 week 20]` Pillar-holder training
  delivered: a signed acknowledgement (PDF, FR + EN) from each
  holder confirming receipt of the training pack covering dossier
  review protocol, recusal rules, vote ceremony walkthrough, and
  recovery procedures.
- **AT-M4-05** `[INFERRED §29.6 week 21]` First end-to-end dry run:
  pipeline-produced candidate dossier → council convenes → 3 of 5
  pillars vote ESCALATE on Polygon Mumbai → dossier renders to PDF
  → SFTP-upload to test CONAC endpoint → ACK received. The full
  trace lands in `audit.actions` and is verifiable by `verify-
hashchain`.

---

## §30.7 — M5 hardening tests

Entry: M4 green. Exit: pentest critical findings: zero. DR restore
under 6 hours.

- **AT-M5-01** `[CITED Table 192]` External penetration test: zero
  CRITICAL findings remain unresolved at end of week 23 (HIGH
  findings may remain only with explicit risk-acceptance signed by
  architect and CONAC pillar).
- **AT-M5-02** `[CITED Table 192]` Disaster recovery: full restore
  from latest off-site backup to a clean host completes in under 6
  hours, end-to-end including container bring-up and integrity
  verification.
- **AT-M5-03** `[INFERRED §29.7 week 23]` Final calibration sweep:
  ECE measured over the full 500-finding labelled set (or 200-row
  minimum if 500 is not yet available); result archived in
  `docs/calibration-reports/M5-final.md`.
- **AT-M5-04** `[INFERRED §29.7 week 23]` Launch readiness review
  with funder: a signed checklist (FR + EN) confirming each of M0c
  / M1 / M2 / M3 / M4 / M5 acceptance test sets passes, dated
  within the M5 exit window.

---

## §30.8 — Continuous tests (run forever)

These are unchanged — already enumerated in SRD-v3 §30.8.

- **CT-01** `[CITED §30.8]` Audit log hash chain unbroken (verified
  hourly by `audit_verify.py`).
- **CT-02** `[CITED §30.8]` Polygon ledger root computed locally
  matches the latest VIGILAnchor commitment (verified daily).
- **CT-03** `[CITED §30.8]` All host services running
  (`vigil-vault-unseal`, `vigil-polygon-signer`, `vigil-time`,
  `vigil-watchdog`) — Prometheus alert if any down > 5 min.
- **CT-04** `[CITED §30.8]` All container services healthy per
  Docker healthcheck — Prometheus alert if any unhealthy > 2 min.
- **CT-05** `[CITED §30.8]` Daily cost report (LLM + proxies +
  captcha + S3) emitted to operator email.
- **CT-06** `[CITED §30.8]` Monthly calibration report (ECE,
  rejection rates, finding counts, escalation counts) emitted to
  council.

---

## Summary

| §     | CITED count            | INFERRED count | Total | Source                                     |
| ----- | ---------------------- | -------------- | ----- | ------------------------------------------ |
| 30.1  | 4                      | 5              | 9     | Tables 186 + §29.2                         |
| 30.2  | 4                      | 4              | 8     | Tables 187 + §29.3                         |
| 30.3  | 7                      | 4              | 11    | Tables 188 + §29.4 + AI-SAFETY-DOCTRINE-v1 |
| 30.4  | 6                      | 2              | 8     | Tables 189 + §29.5                         |
| 30.5  | 8 (renumbered AT-28-N) | 0              | 8     | Table 190                                  |
| 30.6  | 2                      | 3              | 5     | Tables 191 + §29.6                         |
| 30.7  | 2                      | 2              | 4     | Tables 192 + §29.7                         |
| 30.8  | 6                      | 0              | 6     | §30.8 (unchanged)                          |
| Total | 39                     | 20             | 59    |                                            |

The architect-spec'd "28 binding tests" in SRD §30 originally counted
33 across Tables 186-192 (M0c=4, M1=4, M2=7, M3=6, Tip=8, M4=2, M5=2)

- §30.8's 6 CT = 39. The 20 `[INFERRED]` additions raise the total to
  59 if all are accepted. The architect can:

* **Accept all** → §30 grows from 39 to 59 binding tests.
* **Accept some, reject others** → §30 lands somewhere in (39, 59).
* **Reject all INFERRED** → §30 keeps the 39 from Tables 186-192 +
  §30.8, just relocated under the §30.1..§30.7 sub-headings instead
  of in the Table 186-192 stack.

## Next-step contract

This draft does NOT modify SRD-v3.md. The architect:

1. Reviews each `[INFERRED]` entry; accepts, edits, or strikes.
2. The build agent merges the accepted set into SRD-v3.md §30,
   replacing the empty sub-headings under §30.1..§30.7 with the
   structured contents above.
3. The `e2e-fixture.sh` coverage matrix in
   [E2E-FIXTURE-COVERAGE.md](../work-program/E2E-FIXTURE-COVERAGE.md)
   gets re-run against the architect-blessed enumeration; any
   newly-named `AT-NNN` becomes a fixture-coverage line item.
4. The PR-template's `AT-?-??:` placeholder becomes architect-named
   for every PR claiming acceptance-test progress.
