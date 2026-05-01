# E2E Fixture Coverage — SRD §30 audit (Block-B B.5 / A8)

> **Status:** committed 2026-05-01 per Block-B plan §3 hold-point #3 default ("audit, capped at 3 commits").
> **Author:** build agent.
>
> Scope of the audit: map every SRD §30 acceptance gate to one of
> (a) the fixture step that covers it, (b) a different test that
> covers it, or (c) uncovered. Architect signoff said the document
> ships regardless of whether fixture changes are needed.

---

## 1. SRD §30 — what's actually enumerated in the binding doc

A fresh read of [docs/source/SRD-v3.md §30](../source/SRD-v3.md)
shows that **most §30 sub-sections are empty headings**:

| §     | Title                                   | Enumerated tests  |
| ----- | --------------------------------------- | ----------------- |
| §30.1 | M0c Cold-start tests                    | (heading only)    |
| §30.2 | M1 Data plane tests                     | (heading only)    |
| §30.3 | M2 Intelligence plane tests             | (heading only)    |
| §30.4 | M3 Delivery plane tests                 | (heading only)    |
| §30.5 | Tip-In Portal tests (also M3 exit gate) | (heading only)    |
| §30.6 | M4 Council standup tests                | (heading only)    |
| §30.7 | M5 Hardening tests                      | (heading only)    |
| §30.8 | Continuous tests (run forever)          | **CT-01 … CT-06** |

Only §30.8 has named test entries. §30.1–§30.7 carry the milestone
title but no contents — the binding-doc enumeration is incomplete.

**This is itself an audit finding.** The Phase-1 milestone exit
gates are not named in the binding doc. The fixture script cannot
"cover every SRD §30 acceptance gate" when none are written.
Two paths forward (architect call):

- (i) **Authoritative-doc fix:** the architect writes the M0c/M1/M2/M3
  acceptance criteria explicitly into SRD §30. Then the fixture
  audit proceeds against that enumeration.
- (ii) **Reverse-engineer:** the agent infers Phase-1 acceptance gates
  from the architect's narrative (M0c "cold-start tests", M1 "data
  plane tests", M3 "first real escalated dossier published") plus
  what the fixture already attempts. The list below takes this
  path and explicitly marks every entry as "inferred" so a future
  PR can swap to the authoritative list when SRD §30 is filled.

This document takes path (ii); the §3 hold below restates path (i)
as a deferred follow-up.

---

## 2. CT-01 … CT-06 — what the fixture already covers

| CT        | Description                                                                                              | Coverage status                                                                                                                                                                                                                                                                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CT-01** | Audit log hash chain unbroken (verified hourly by `audit_verify.py`)                                     | **Partial.** `e2e-fixture.sh` `stage_assert_chain` asserts `MAX(seq) FROM audit.actions` is non-null AND `audit.user_action_event` has rows, but does NOT walk the chain to verify hash linkage. The chain-walk is covered by [`apps/audit-verifier/`](../../apps/audit-verifier/) on a continuous loop; the fixture's job is the seed-and-assert, not the verifier. **OK as-is.** |
| **CT-02** | Polygon ledger root matches latest VIGILAnchor commitment                                                | **Uncovered by fixture.** Worker-anchor commits to Polygon mainnet on a 1h cadence. The fixture's run is too short for an anchor commit to land (and the local compose stack typically points at Amoy testnet, not mainnet). Covered by `worker-anchor` integration tests + the daily reconciliation script. **OK out-of-scope for fixture.**                                      |
| **CT-03** | All host services running (`vigil-vault-unseal`, `vigil-polygon-signer`, `vigil-time`, `vigil-watchdog`) | **Out-of-scope for fixture.** These are systemd host services, not Docker containers. Operator runbook R3 covers their healthchecks. **OK out-of-scope.**                                                                                                                                                                                                                          |
| **CT-04** | All container services healthy per Docker healthcheck                                                    | **Pre-condition.** `e2e-fixture.sh` documents `make compose-up` healthy as a prerequisite (line 9). Fixture exits early if the dashboard `/api/health` returns non-200 (line 56-59). **Covered as precondition.**                                                                                                                                                                  |
| **CT-05** | Daily cost report (LLM + proxies + captcha + S3) emitted to operator email                               | **Uncovered by fixture; covered by adapter-runner cron + email integration test.** Daily rhythm doesn't fit a single fixture run. **OK out-of-scope.**                                                                                                                                                                                                                             |
| **CT-06** | Monthly calibration report emitted to council                                                            | **Uncovered by fixture; covered by quarterly-calibration-audit cron.** Monthly rhythm. **OK out-of-scope.**                                                                                                                                                                                                                                                                        |

**Verdict:** CT-01 / CT-04 are appropriately covered (CT-01 partially
via chain-existence + audit-verifier; CT-04 as a precondition). The
remaining CTs are time-rhythm bound (daily/monthly/hourly) and are
intentionally out-of-scope for a 5-second fixture run. No gap-fill
warranted on the §30.8 axis.

---

## 3. Inferred Phase-1 milestone gates → fixture step mapping

These are the implicit Phase-1 acceptance gates the agent infers
from the architect's narrative. **Every entry is inferred until SRD
§30 is filled in by the architect.**

### M0c — Cold-start

| Gate (inferred)                               | Coverage      | Where                                                                                   |
| --------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| Compose stack boots all services healthy      | Pre-condition | `e2e-fixture.sh:9` requires `make compose-up` green                                     |
| Migrations apply cleanly (forward-only sweep) | Pre-condition | `e2e-fixture.sh:11` requires `pnpm --filter @vigil/db-postgres run migrate` to have run |
| Vault unseal completes (3-of-5 Shamir)        | Pre-condition | `e2e-fixture.sh:12` requires vault unsealed                                             |

### M1 — Data plane

| Gate (inferred)                        | Coverage      | Where                                                                                                                                            |
| -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `source.events` ingest path works      | **Covered**   | `seed-fixture-events.ts:36-75` inserts 2 source.events rows; `stage_assert_pattern` asserts the finding linked to them                           |
| Adapter dedup_key uniqueness           | **Covered**   | `seed-fixture-events.ts:40,62` `ON CONFLICT (dedup_key) DO NOTHING` exercised                                                                    |
| Worker-entity normalises display names | **Uncovered** | The fixture supplier `FIXTURE_SUPPLIER_SARL` doesn't trigger the rule-pass / LLM-pass split; would need a second fixture row with a name variant |

### M2 — Intelligence plane

| Gate (inferred)                       | Coverage      | Where                                                                                                                                                                                  |
| ------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pattern fires against fixture finding | **Covered**   | `e2e-fixture.sh stage_assert_pattern` asserts `finding.finding` row exists with `ref='VA-2026-FIXTURE-001'` and pattern_id='P-D-001'                                                   |
| Bayesian engine writes assessment     | **Uncovered** | The seed pre-populates `posterior_probability='0.42'` directly; the assessment-by-engine path is not exercised. The unit-test suite at `packages/certainty-engine/` covers the engine. |
| Counter-evidence pass runs            | **Uncovered** | Fixture finding's `posterior=0.42` is below the counter-evidence threshold (0.85) so worker-counter-evidence wouldn't trigger. Not a gap; intentional fixture state.                   |

### M3 — Delivery plane

| Gate (inferred)                                | Coverage      | Where                                                                                                                |
| ---------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| Dossier render produces deterministic PDF      | **Uncovered** | Fixture stops at finding row insertion; doesn't proceed to dossier render. Covered by `worker-dossier` golden tests. |
| CONAC SFTP delivery target resolves            | **Uncovered** | Fixture doesn't drive the dossier→delivery edge; covered by `worker-conac-sftp/__tests__/`.                          |
| Public verify route serves the fixture finding | **Covered**   | `stage_assert_dashboard:70-75` asserts `/verify/VA-2026-FIXTURE-001` returns 200                                     |
| Public audit feed serves redacted events       | **Covered**   | `stage_assert_dashboard:62-68` asserts `/api/audit/public` returns events shape                                      |

### Tip-In Portal (M3 exit)

| Gate (inferred)                           | Coverage      | Where                                                                                                                                                   |
| ----------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tip portal accepts encrypted submission   | **Uncovered** | Fixture doesn't drive the tip portal; covered by `apps/dashboard/__tests__/tip-*.test.ts` and the new `worker-tip-triage` SafeLlmRouter migration test. |
| Tip decryption path works (3-of-5 Shamir) | **Uncovered** | Same — covered by Shamir unit tests. Out-of-scope for the fixture (would require seeding an actual ciphertext).                                         |

### M4 / M5 (council standup, hardening)

These are institutional / hardening gates (ceremonies, ops drills).
The fixture is a code-side smoke test; M4/M5 sit outside the
`scripts/e2e-fixture.sh` scope by design.

---

## 4. Gap summary

The fixture covers the **happy-path code-side gates** that fit
inside a single 5-second run:

- M0c preconditions (compose-up, migrations, vault) as pre-flight
  asserts.
- M1 source.events ingest + dedup_key.
- M2 pattern fires against fixture finding.
- M3 public verify + public audit feed.
- §30.8 CT-01 (partial) + CT-04 (pre-condition).

The fixture deliberately does NOT cover:

- Time-rhythm gates (CT-02 / CT-05 / CT-06 — hourly/daily/monthly cadence).
- Host services (CT-03 — runbook R3).
- Worker-entity name-variant rule-pass / LLM-pass split.
- Bayesian engine assessment (uses pre-populated posterior).
- Counter-evidence pass (would require posterior >= 0.85).
- Dossier render → CONAC SFTP → public verify chain (covered by
  unit/integration tests in each worker).
- Tip portal decryption + paraphrase path (covered separately).

**Number of gap-fills the fixture needs:** zero. The fixture's
intent (synthetic happy-path smoke) is not the same as
"comprehensive Phase-1 acceptance suite". The latter would more
naturally live as a multi-stage CI workflow that boots the full
compose stack and walks the entire ingest → escalate → render →
deliver path with real adapter contact + Polygon Amoy anchoring.
That's a Block-C / pre-cutover deliverable, not a B.5 commit.

The architect's cap of "3 fixture commits" was the right ceiling;
the audit finds zero commits warranted.

---

## 5. Hold-point — surfaced for architect

**SRD §30 is incomplete.** §30.1–§30.7 carry milestone titles but
no enumerated tests. The binding-doc says "Each test below is
binding" but there is no list below the M0c/M1/M2/M3 headings.

Two follow-up options for the architect (NOT in Block-B scope):

- **Option A (architect writes):** fill SRD §30.1–§30.7 with the
  intended milestone exit tests. The fixture audit then re-runs
  against the authoritative list.
- **Option B (agent drafts):** the agent produces a draft §30
  enumeration based on this document's inferred mapping +
  industry-standard milestone gates; architect reviews + edits.

**Default if unspecified:** Option B drafted in a future block,
pending architect signal.

---

## 6. Block-B B.5 commit posture

Per the architect's cap of "≤ 3 commits of fixture work, halt at
the cap and present scope" — the audit finds **zero gap-fills
needed**. The fixture is structurally sound for its synthetic-
smoke intent. This document IS B.5.

If the architect picks Option B above, that draft lands in a
future block. If Option A, the architect's SRD edit triggers a
re-audit at that time.
