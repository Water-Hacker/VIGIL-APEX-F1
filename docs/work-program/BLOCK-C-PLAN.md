# BLOCK C — plan (Track B, items B1–B5)

> **Status:** awaiting architect counter-signature on §3 hold-points.
> **Date:** 2026-05-01.
> **Author:** build agent (Claude).
>
> Plan-first per architect operating posture. Track C
> (operational readiness) is **explicitly Block D**, NOT this block.
> B6+ (TRUTH §C / footers / etc) are out of scope for this plan
> per architect's "B1 through B5 only" instruction.

---

## 1. State reconciliation

A pre-flight against the live tree shows partial coverage on every
B-item. The plan deltas against what's missing.

| Item | Spec                                                       | Live state                                                                                                                                                                                                             | Delta                                                                         |
| ---- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| B1   | Pattern catalogue at `docs/patterns/catalogue.md`          | 43 individual `P-X-NNN.md` files exist with description_fr/en, prior, weight, fixture link. **No catalogue.md aggregator.**                                                                                            | NEW: generate the rolled-up catalogue + CI lint coupling                      |
| B2   | Worker runbook per worker following SRD §31 R1–R6 template | 41 files at `docs/runbooks/workers/<svc>.{en,fr}.md`. **Skeleton-only**: BEGIN auto-generated header + empty section anchors.\*\* Different path convention than the spec asks for (`docs/runbooks/worker-{name}.md`). | Decide path convention → fill the SRD §31 template per worker                 |
| B3   | DR rehearsal script + runbook                              | `scripts/dr-restore-test.sh` exists (used by C9 backup test). **No `scripts/dr-rehearsal.ts`** simulating host loss + recovery time validation.                                                                        | NEW: scripts/dr-rehearsal.ts + runbook                                        |
| B4   | TRUTH.md reconciliation across Block-A/B drift             | TRUTH.md was already touched in `19e29ca` (sources 26→29). Other Block-A/B drift has been logged to PHASE-1-COMPLETION.md but not flipped in TRUTH.md or as override DECISIONs.                                        | Sweep + flip + override-decisions where required                              |
| B5   | Decision-log cross-link audit + CI lint                    | 19 DECISIONs in `docs/decisions/log.md`. AUDIT-NNN cross-refs are sparse; W-NN refs and code-commit refs are inconsistently present. **No CI lint enforcing the cross-link triple.**                                   | NEW: cross-link audit doc + CI lint (`scripts/check-decision-cross-links.ts`) |

---

## 2. Proposed Block C execution order

Six commits. Each is one logical unit; B2 is the largest (one
runbook fill per worker) and may split into sub-commits (one per
worker family) — see §3 hold-point #2 for the path-convention
question that constrains B2's shape.

| #   | Item                                  | Output                                                                                                                                                             |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C.1 | B1 — Pattern catalogue generator      | `docs/patterns/catalogue.md` + `scripts/generate-pattern-catalogue.ts` (or extend the existing one) + CI gate ensuring catalogue is regenerated on pattern changes |
| C.2 | B2 — Worker runbooks (one per worker) | One `docs/runbooks/worker-{name}.md` (or `docs/runbooks/workers/<svc>.{en,fr}.md` per existing convention — pending §3 hold-point #2) per service. 23 services.    |
| C.3 | B3 — DR rehearsal script              | `scripts/dr-rehearsal.ts` + `docs/runbooks/dr-rehearsal.md` runbook                                                                                                |
| C.4 | B4 — TRUTH.md reconciliation          | TRUTH.md edits + (if needed) one or more override decision-log entries                                                                                             |
| C.5 | B5 — Decision-log cross-link audit    | `docs/decisions/cross-link-audit.md` (the audit doc) + `scripts/check-decision-cross-links.ts` + phase-gate.yml wiring                                             |
| C.6 | Block C completion summary            | `docs/work-program/BLOCK-C-COMPLETION-SUMMARY.md` + halt for review                                                                                                |

---

## 3. Hold-points — batched

### Hold-point #1 — B1 catalogue: generator vs hand-curate

**The question.** The 43 P-X-NNN.md files have an
`<!-- BEGIN auto-generated -->` … `<!-- END auto-generated -->` block
that already encodes what the catalogue.md needs (description_fr/en,
prior, weight, fixture link). Two paths to ship the catalogue:

- **(a) Generator script.** New `scripts/generate-pattern-catalogue.ts`
  walks `packages/patterns/src/category-*/p-*-*.ts`, reads each
  PatternDef + matched fixture-test path, emits `catalogue.md`. CI
  gate asserts the committed `catalogue.md` matches the regenerated
  output (drift detection — same pattern as existing
  `scripts/check-pattern-coverage.ts`).
- **(b) Hand-curate the catalogue.md** as a single markdown file
  consolidating the 43 P-files. No regeneration; CI doesn't enforce
  freshness. Lower agent cost; higher long-term drift risk.

**Question for architect.** (a) or (b)?

**Default if unspecified.** (a) — the registry is the source-of-truth
per AUDIT-097 Phase B (still pending in Track A as separate work);
treating catalogue.md as a derived artefact aligns with that
direction.

### Hold-point #2 — B2 path convention + bilingual scope

**The question.** The architect's spec asks for
`docs/runbooks/worker-{name}.md` (per worker, single file, no
language suffix). The live tree has
`docs/runbooks/workers/<svc>.{en,fr}.md` (41 files). Two questions:

1. **Path convention** — adopt the spec (`worker-{name}.md`,
   monolingual, replaces the existing tree) OR keep the existing
   bilingual layout (`workers/<svc>.{en,fr}.md`)?
2. **Bilingual scope** — Phase-1 doctrine has been bilingual
   throughout (FR primary, EN automatic, both populated). Dropping
   to monolingual is a doctrine-soft regression unless there's a
   specific reason. Is the spec's monolingual `worker-{name}.md` an
   intentional change, or a phrasing shorthand?

**Question for architect.** Pick one of:

- **(P-1) Keep bilingual at `docs/runbooks/workers/<svc>.{en,fr}.md`.**
  Fill the 23 × 2 = 46 files with SRD §31 R1–R6 content. Heavier
  scope (~46 commits potentially; can batch by category).
- **(P-2) Adopt the spec's `docs/runbooks/worker-{name}.md` as the
  canonical layout.** Migrate the 41 existing files into 23
  monolingual ones (architect-language pick). FR content moves to
  the FR section; EN to EN; one file per worker.
- **(P-3) Hybrid.** Single `worker-{name}.md` per worker that contains
  both FR and EN sections (FR primary, EN below). Reuses the
  existing two files' content. 23 commits.

**Default if unspecified.** **(P-3)** — preserves the bilingual
doctrine, reduces file count to a single worker file (matching the
architect's spec phrasing literally), and keeps the existing FR/EN
content as authoritative source. Each runbook structured as:

```
# Runbook — <name>
## Description (FR / EN)
## Boot sequence
## Healthy steady-state signals
## Common failures
## R1 — Routine deploy
## R2 — Restore from backup (DR)
## R3 — Rotate operator YubiKey
## R4 — Pillar holder change (when applicable)
## R5 — Incident response (P0/P1/P2/P3)
## R6 — Monthly DR exercise (when applicable)
## On-call paging policy
```

**Architect-side scope check.** SRD §31.1–§31.6 are the runbook
templates BUT (mirrors of the SRD §30 issue I surfaced in Block B)
the section bodies appear to be empty headings. The agent can
proceed with the inferred R1–R6 structure above; if SRD §31 should
be filled in first, that's another architect-action item to
surface alongside §30.

### Hold-point #3 — B4 reconciliation scope

**The question.** "Every drift surfaced across Block A and Block B
flips a line in TRUTH.md or files an explicit override decision-log
entry."

The build agent's audit of Block-A and Block-B drift surfaces
across PHASE-1-COMPLETION.md / BLOCK-A-RECONCILIATION.md /
BLOCK-B-COMPLETION-SUMMARY.md inventories these candidates:

| Drift                                                                | Source           | Proposed disposition                                                                      |
| -------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `infra/sources.json: 29` vs TRUTH §C "27" / SRD §10.2 "26"           | Block-A §2.A.9   | **Flipped** in commit `19e29ca` (TRUTH §A 26→29, §C 27→29; SRD §10.2 26→29).              |
| Source-count lint added                                              | Block-A §2.A.9   | TRUTH §C add a row noting the lint exists?                                                |
| LLM pricing keyed by model_id (was modelClass)                       | Block-A §2.A.4   | TRUTH §C "LLM tier 0" row could note the pricing-table location; or override-DECISION     |
| `aws_bedrock_premium_multiplier` field per model                     | Block-A §2.A.5   | Same                                                                                      |
| `neo4j_mirror_state` column                                          | Block-A §5.b     | TRUTH §B add a row? Or §C? Or new override DECISION?                                      |
| SafeLlmRouter migration of worker-tip-triage / worker-adapter-repair | Block-B B.4      | Doctrine implementation detail; may not warrant a TRUTH line; AUDIT-NNN cross-ref instead |
| POLYGON_ANCHOR_CONTRACT shape regex                                  | Block-B B.2 / A9 | Operational hardening; TRUTH may not need; ENV doc + runbook do                           |

**Question for architect.** Should B4 flip ALL the above (and
similar small drifts) into TRUTH lines, or should B4 set a
selectivity bar (e.g. "TRUTH carries architectural facts; ops
hardening goes in runbooks/decisions, not TRUTH")?

**Default if unspecified.** Selective: only the 5 highest-architectural-
weight drifts get TRUTH lines or override DECISIONs; the rest are
recorded in PHASE-1-COMPLETION.md and the relevant runbook (which
is also a B2 deliverable). The 5 candidates the agent picks:

1. Source-count → already flipped in 19e29ca; add a "Lint enforces" footnote in TRUTH §C.
2. SafeLlmRouter universal coverage (5/5 workers) → new TRUTH §C row pinning it.
3. neo4j_mirror_state column → new TRUTH §B row noting the
   observability surface.
4. LLM pricing canonical location → new TRUTH §C row pointing at
   `infra/llm/pricing.json`.
5. AUDIT_PUBLIC_EXPORT_SALT custody (Vault path + quarterly rotation) → new TRUTH §E row.

The remainder land in BLOCK-B-COMPLETION-SUMMARY.md (already shipped) + worker runbooks (B2).

### Hold-point #4 — B5 cross-link rigor

**The question.** The architect's spec: "every DECISION links to
its AUDIT-NNN, W-NN, and code commit."

The 19 DECISIONs in `docs/decisions/log.md` show **inconsistent**
cross-link presence. Some examples:

- DECISION-009 has the AUDIT-071 PROVISIONAL banner but no other AUDIT-NNN, W-NN, or code-commit refs in the entry header.
- DECISION-008 references many AUDIT-NNN throughout the body but doesn't have a centralized "Cross-references:" block.
- Older DECISION-001 through -006 predate the cross-link convention.

Two ways to define "links":

- **(s) Strict.** Every DECISION carries a `Cross-references:` line
  block at the top with `audit_ids: [...]`, `weakness_ids: [...]`,
  `code_commit: <sha>`. Lint enforces presence + nonempty arrays.
- **(p) Permissive.** A DECISION passes the lint if it contains AT
  LEAST one AUDIT-NNN AND AT LEAST one of {W-NN, code commit ref}
  ANYWHERE in the entry body. Older entries can be exempted via a
  closed allowlist (precedent: `LEGACY_FORWARD_ONLY` migrations,
  `LEGACY_ZERO_TEST` apps).

**Question for architect.** (s) strict + retrofit, or (p)
permissive + closed allowlist for the legacy entries?

**Default if unspecified.** **(p)** + closed allowlist for
DECISION-000 through DECISION-006 (predate the cross-link
convention). DECISION-007 onward must satisfy the permissive
contract. The agent's first pass surfaces which entries fail and
either (a) backfills the cross-refs the agent can find, or (b)
flags them for architect-fill in a follow-up.

---

## 4. Block C operating posture (re-stated)

Per architect instruction 2026-05-01:

- Plan first — this document. **HALT FOR ARCHITECT REVIEW.**
- Batch hold-points — collected in §3 above.
- One commit per logical unit (some items may need sub-commits;
  flagged in §2).
- Update PHASE-1-COMPLETION.md as items close.
- Stop after a commit only if a test or lint fails.
- At Block C close, produce
  `docs/work-program/BLOCK-C-COMPLETION-SUMMARY.md` and halt for
  review before opening Block D.

**Track-scope discipline.** Block C is Track B ONLY (B1–B5).
Track C (operational readiness, items C1–C10) is **Block D**, NOT
this block — architect explicitly said so. The agent will not
touch Track C items in Block C even if a B-item adjacency suggests
it.

---

## 5. What the architect signs

Four checkboxes:

- [ ] §3 hold-point #1 — B1 catalogue: (a) generator OR (b) hand-curate. **Default: (a).**
- [ ] §3 hold-point #2 — B2 path convention: (P-1) keep `workers/<svc>.{en,fr}.md` OR (P-2) migrate to `worker-{name}.md` monolingual OR (P-3) `worker-{name}.md` with FR/EN sections. **Default: (P-3).**
- [ ] §3 hold-point #3 — B4 selectivity: blanket (every drift) OR selective (5 highest-weight). **Default: selective.**
- [ ] §3 hold-point #4 — B5 lint: (s) strict + retrofit OR (p) permissive + legacy allowlist. **Default: (p).**

When all four are signed, the agent advances to **C.1** (B1 catalogue
generator) and proceeds top-to-bottom through §2.

---

## 6. Critical-files list (forward-looking)

Files this block will touch (depending on which hold-points clear):

| File                                                          | Item    | Change                                                                  |
| ------------------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| `scripts/generate-pattern-catalogue.ts`                       | C.1     | NEW — registry → catalogue.md generator (or extend existing if present) |
| `docs/patterns/catalogue.md`                                  | C.1     | NEW — rolled-up 43-pattern catalogue                                    |
| `.github/workflows/phase-gate.yml`                            | C.1+C.5 | Wire pattern-catalogue freshness lint + cross-link lint                 |
| `docs/runbooks/worker-{name}.md` × 23 (pending hold-point #2) | C.2     | NEW or migrated; SRD §31 R1–R6 template per worker                      |
| `scripts/dr-rehearsal.ts`                                     | C.3     | NEW — simulates host loss; validates restore from NAS-replica < 6 h     |
| `docs/runbooks/dr-rehearsal.md`                               | C.3     | NEW — runbook for the rehearsal                                         |
| `TRUTH.md`                                                    | C.4     | Selective drift flips per hold-point #3                                 |
| `docs/decisions/log.md`                                       | C.4     | (Possibly) override DECISION entry for any drift not flipped in TRUTH   |
| `docs/decisions/cross-link-audit.md`                          | C.5     | NEW — audit of which DECISIONs satisfy the cross-link contract          |
| `scripts/check-decision-cross-links.ts`                       | C.5     | NEW — CI lint                                                           |
| `docs/work-program/PHASE-1-COMPLETION.md`                     | each    | Flip B1–B5 to 🟩 as items close                                         |
| `docs/work-program/BLOCK-C-COMPLETION-SUMMARY.md`             | C.6     | NEW — close report                                                      |

Existing utilities to reuse:

- [`scripts/check-pattern-coverage.ts`](../../scripts/check-pattern-coverage.ts) — pattern coverage gate; the catalogue freshness lint can borrow its directory-walk logic.
- [`scripts/audit-decision-log.ts`](../../scripts/audit-decision-log.ts) — already verifies decision-log markdown links resolve. The new cross-link lint extends this.
- The existing `<!-- BEGIN auto-generated -->` markers in P-X-NNN.md — the catalogue generator can pull from those if architect picks Option (a).
