# Calibration Seed — RESTRICTED, ARCHITECT-ONLY

This directory holds the calibration ground-truth dataset per **EXEC §20-25**.

**Status: NEVER COMMIT TO REPO.** `seed.csv` is in `.gitignore` for a reason.
Pre-enrolment confidentiality (EXEC §24.2) requires this file remain on the
architect's encrypted laptop only.

## Schema

Per EXEC §22.2:

```
id, recorded_at, pattern_id, finding_id, case_label, case_year, region,
amount_xaf, posterior_at_review, severity_at_review, ground_truth,
ground_truth_recorded_by, ground_truth_evidence_json, closure_reason, notes
```

## Targets

- **30 entries**: Phase 9 floor (EXEC §20.3)
- **50 entries**: per-pattern-category bin density (EXEC §00 banner)
- **200 entries**: 12-month horizon for fine-grained per-pattern calibration

## Cadence

Per EXEC §21.2: 3-4 hours per session, 2-3 sessions per week, yields 5-15
entries per week. 30 entries reachable in 3-4 weeks if disciplined.

## Storage tiers (EXEC §24)

- **Working copy**: `personal/calibration-seed/seed.csv` on architect's local
  encrypted laptop (LUKS2 partition).
- **Backup copy**: encrypted backup to architect's personal cloud (Tresorit or
  similar) with strong passphrase.
- **Phase 9 enrolment**: loaded via `scripts/seed-calibration.ts` (BUILD-V2
  §68.4) into the production `calibration_entry` table; each entry committed
  to the audit chain via `audit_event 'calibration.entry_added'`.
- **Personal copy after enrolment**: read-only encrypted snapshot retained.

## Ground-truth discipline (EXEC §23)

Two-source rule: every TP/FP label backed by ≥ 2 evidence kinds, ideally from
different evidence categories (court_judgement, cour_comptes_observation,
conac_finding, criminal_conviction, dismissed_by_court,
presidential_decree_emergency, disciplinary_action).

Single-source cases are labelled `partial_match` or `pending` — the seed is
the foundation of trust; do not weaken it for volume.

## Architect's discipline

Architect labels first 50 entries personally; senior operators label after 50
with architect review; broader operator pool after 200 with 10% spot-check.
Every label is itself an audit_event signed with the architect's YubiKey.

## Sources to mine (EXEC §21.1)

- Cour des Comptes annual reports (2010-2024) — highest yield for category A
- CONAC annual reports
- TRACFIN-CEMAC and ANIF financial intelligence reports
- Operation Sparrowhawk / Opération Épervier judicial archives (2006-present)
- Tribunal Criminel Spécial archives (2012-present)
- Cameroonian press archives (cross-reference, never sole source)
- TI Cameroon and CHRDA case files (cross-reference)
- Academic theses from U. Yaoundé II / Douala / Buea
- Parliamentary commission reports
- Open Government Partnership Cameroon outputs
