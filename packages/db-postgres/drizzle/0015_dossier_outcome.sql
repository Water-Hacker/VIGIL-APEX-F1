-- FRONTIER-AUDIT Layer-7 — outcome feedback loop.
--
-- After a dossier is delivered to a recipient body, the platform must
-- measure whether it produced institutional action. worker-outcome-feedback
-- consumes external operational signals (CONAC press release, Cour Suprême
-- judgment, ARMP debarment, ANIF bulletin, MINFI clawback bulletin) and
-- writes one row per high-confidence match here. Operators see the trail
-- in the dashboard; calibration uses it to refine pattern priors.
--
-- One signal can match multiple dossiers (e.g. a CONAC press release naming
-- a tendering authority that appears across multiple findings); we therefore
-- do NOT enforce a UNIQUE constraint on signal_id alone — the composite
-- (signal_id, dossier_id) is the natural key.

CREATE TABLE IF NOT EXISTS dossier.dossier_outcome (
  id                    uuid        PRIMARY KEY,
  dossier_id            uuid        NOT NULL,
  dossier_ref           text        NOT NULL,
  signal_id             text        NOT NULL,
  signal_source         text        NOT NULL,
  signal_kind           text        NOT NULL,
  signal_date           timestamptz NOT NULL,
  match_score           numeric(5,4) NOT NULL,
  entity_overlap        numeric(5,4) NOT NULL,
  temporal_proximity    numeric(5,4) NOT NULL,
  body_alignment        numeric(5,4) NOT NULL,
  category_alignment    numeric(5,4) NOT NULL,
  is_high_confidence    boolean     NOT NULL,
  rationale             text        NOT NULL,
  matched_at            timestamptz NOT NULL DEFAULT now(),
  audit_event_id        uuid
);

ALTER TABLE dossier.dossier_outcome
  DROP CONSTRAINT IF EXISTS dossier_outcome_signal_source_check;
ALTER TABLE dossier.dossier_outcome
  ADD CONSTRAINT dossier_outcome_signal_source_check
  CHECK (signal_source IN (
    'conac_press',
    'cour_supreme',
    'armp_debarment',
    'tpi_court_roll',
    'anif_bulletin',
    'minfi_clawback'
  ));

ALTER TABLE dossier.dossier_outcome
  DROP CONSTRAINT IF EXISTS dossier_outcome_signal_dossier_unique;
ALTER TABLE dossier.dossier_outcome
  ADD CONSTRAINT dossier_outcome_signal_dossier_unique
  UNIQUE (signal_id, dossier_id);

CREATE INDEX IF NOT EXISTS dossier_outcome_dossier_idx
  ON dossier.dossier_outcome (dossier_id, matched_at DESC);

CREATE INDEX IF NOT EXISTS dossier_outcome_high_conf_idx
  ON dossier.dossier_outcome (is_high_confidence, matched_at DESC)
  WHERE is_high_confidence = true;
