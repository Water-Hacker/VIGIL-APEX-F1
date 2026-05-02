# SRD §30 — Architect Decisions

> Companion to `docs/source/SRD-30-enumeration-draft.md`. The build
> agent uses this file to merge the architect-blessed §30 enumeration
> into `SRD-v3.md` §30.1..§30.7. The 39 [CITED] entries are accepted
> as-is (relocation only). The 20 [INFERRED] entries each carry an
> architect decision: ACCEPT, EDIT, or REJECT.
>
> **Decided:** 2026-05-02
> **Architect:** Junior Thuram Nana, Sovereign Architect
> **Source draft:** docs/source/SRD-30-enumeration-draft.md (Block-D D.11)

## Headline

Of the 20 INFERRED entries:

- **17 ACCEPT** (verbatim from draft)
- **3 EDIT** (revised wording or threshold)
- **0 REJECT**

Final §30 binding count after merge: **59 acceptance tests** (39 CITED + 20 INFERRED, with 3 of the latter edited from draft form).

The agent merges all 20 in their final form below.

---

## §30.1 — M0c cold-start tests

### AT-M0c-05 — Postgres schemas deployed

**Decision:** EDIT.

**Reasoning:** The draft lists six schemas but the live tree per `packages/db-postgres/src/schema/` ships eleven schema modules. The draft was written from §17.2 which is itself stale. Pin the test to the live count and let the schema list itself be derived from the migrations directory rather than hard-coded.

**Final entry:**

> **AT-M0c-05** [INFERRED §29.2 day 7-8, edited 2026-05-02] PostgreSQL container is up with all schemas in `packages/db-postgres/drizzle/` deployed; verified by `pg_dump --schema-only` matching the cumulative migration set. The schema count is whatever the migrations produce; the test is invariant to additions, only fails on missing or partial schemas.

### AT-M0c-06 — Neo4j + IPFS + Redis up

**Decision:** ACCEPT (verbatim from draft).

### AT-M0c-07 — Host systemd units running

**Decision:** ACCEPT (verbatim from draft).

### AT-M0c-08 — Keycloak FIDO2 enrolment

**Decision:** ACCEPT (verbatim from draft).

### AT-M0c-09 — Btrfs subvolume layout

**Decision:** ACCEPT (verbatim from draft).

---

## §30.2 — M1 data plane tests

### AT-M1-05 — Dead-letter queue functional

**Decision:** ACCEPT (verbatim from draft).

### AT-M1-06 — Document pipeline round-trip

**Decision:** EDIT.

**Reasoning:** "≤ 60s" is an arbitrary threshold without basis. The actual operational concern is unbounded latency, not an absolute number. Restate in terms of the worker's documented SLO rather than a fixed number.

**Final entry:**

> **AT-M1-06** [INFERRED §29.3 week 5, edited 2026-05-02] Document pipeline (fetch → hash → MIME → OCR → IPFS pin → store) round-trips a sample text PDF (≤10 pages) end-to-end within the worker-document SLO published in `docs/runbooks/worker-document.md`; the resulting `document.processed` event carries `{document_cid, sha256, mime, ocr_text_excerpt}`. Larger documents are tested against the per-page SLO, not an absolute end-to-end time.

### AT-M1-07 — Entity resolution rule-pass + LLM-pass

**Decision:** EDIT.

**Reasoning:** The draft says "within 5s" which is too tight for the LLM-pass path under realistic provider latencies. Split the threshold by path.

**Final entry:**

> **AT-M1-07** [INFERRED §29.3 week 6, edited 2026-05-02] Entity-resolution worker collapses two `source.events` referencing the same supplier under different display-name spellings into one `entity.canonical` row. The rule-pass path (RCCM/NIU exact match, normalised-name match) completes within 5s. The LLM-pass path (similarity-based clustering) completes within 20s under normal LLM provider latency. Both paths are verified end-to-end with one trivial-match pair (rule-pass) and one variant pair (LLM-pass).

### AT-M1-08 — Operator dashboard live counts

**Decision:** ACCEPT (verbatim from draft).

---

## §30.3 — M2 intelligence plane tests

### AT-M2-08 — Bedrock failover

**Decision:** ACCEPT (verbatim from draft).

### AT-M2-09 — All 12 anti-hallucination layers emit telemetry

**Decision:** ACCEPT (verbatim from draft).

### AT-M2-10 — First calibration report archived

**Decision:** ACCEPT (verbatim from draft).

### AT-M2-11 — Pattern firing visible in operator dashboard

**Decision:** ACCEPT (verbatim from draft).

---

## §30.4 — M3 delivery plane tests

### AT-M3-07 — Triage UI for tips

**Decision:** ACCEPT (verbatim from draft).

### AT-M3-08 — Public-verification reachable via .onion

**Decision:** ACCEPT (verbatim from draft).

---

## §30.5 — Tip-In Portal tests

No INFERRED entries. All 8 are CITED from Table 190 (renumbered AT-28-NN to AT-30.5-NN).

---

## §30.6 — M4 council standup tests

### AT-M4-03 — All 5 pillars enrolled in Keycloak

**Decision:** ACCEPT (verbatim from draft).

### AT-M4-04 — Pillar training acknowledgements

**Decision:** ACCEPT (verbatim from draft).

### AT-M4-05 — End-to-end dry run

**Decision:** ACCEPT (verbatim from draft).

---

## §30.7 — M5 hardening tests

### AT-M5-03 — Final calibration sweep

**Decision:** ACCEPT (verbatim from draft).

### AT-M5-04 — Launch readiness review with funder

**Decision:** ACCEPT (verbatim from draft).

---

## §30.8 — Continuous tests

No INFERRED entries.

---

## Summary

| Section   | INFERRED | ACCEPT |  EDIT | REJECT |
| --------- | -------: | -----: | ----: | -----: |
| §30.1     |        5 |      4 |     1 |      0 |
| §30.2     |        4 |      2 |     2 |      0 |
| §30.3     |        4 |      4 |     0 |      0 |
| §30.4     |        2 |      2 |     0 |      0 |
| §30.5     |        0 |      - |     - |      - |
| §30.6     |        3 |      3 |     0 |      0 |
| §30.7     |        2 |      2 |     0 |      0 |
| **Total** |   **20** | **17** | **3** |  **0** |

Final SRD §30 binding count after merge: **59 acceptance tests**.

## Edits captured

The 3 EDIT decisions:

1. **AT-M0c-05** — schema list reads from migrations directory rather than hard-coded set of 6.
2. **AT-M1-06** — document-pipeline round-trip threshold tied to worker SLO not absolute 60s.
3. **AT-M1-07** — entity-resolution latency split into rule-pass (5s) vs LLM-pass (20s).

No REJECTs.

## Next step

The build agent merges all 20 final entries above into `docs/source/SRD-v3.md` §30.1..§30.7, replacing the empty sub-headings. Use the FINAL ENTRY wording from the 3 EDIT entries; use the draft wording for the 17 ACCEPT entries. The 39 CITED entries land verbatim in their new sub-headings.
