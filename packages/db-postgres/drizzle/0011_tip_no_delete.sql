-- Migration 0011 — tamper-evident tip retention.
--
-- DECISION-016. Citizen tips are evidence. Once received they cannot be
-- deleted from the database. They CAN be redacted under court order
-- (body_ciphertext blanked, an explicit `REDACTED_BY_COURT_ORDER`
-- disposition recorded), but the row itself MUST persist forever so
-- that:
--
--   * a citizen can verify with their TIP-YYYY-NNNN reference at any
--     time that their tip is still in the system,
--   * the audit chain has a stable per-id anchor,
--   * a future inquest can reconstruct what was reported, when, by
--     which operator, and the chain of disposition changes.
--
-- Three layers of defence:
--
--   1. A trigger that raises an exception on every DELETE FROM tip.tip.
--      Even a privileged operator running raw SQL cannot drop a row.
--      The redaction path uses UPDATE, not DELETE.
--
--   2. The disposition column is constrained to a closed set. New
--      values can only be added by a follow-up migration that the
--      architect signs off — preventing a "DROPPED" or similar
--      disposition slipping in via ad-hoc UPDATE.
--
--   3. An audit-trail table tip.tip_disposition_history records every
--      transition with actor, timestamp, prior-disposition, and the
--      audit_event_id of the TAL-PA emit. The history table is itself
--      append-only via a second trigger that blocks UPDATE/DELETE.

BEGIN;

-- (1) Hard delete-block on tip.tip ------------------------------------------

CREATE OR REPLACE FUNCTION tip.refuse_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'tip.tip rows are append-only — citizen-tip retention guarantee'
    USING ERRCODE = 'restrict_violation',
          DETAIL  = 'Use UPDATE to set disposition = ''REDACTED_BY_COURT_ORDER'' and blank body_ciphertext. See DECISION-016.',
          HINT    = 'TipRepo.redact() is the only sanctioned path; raw DELETE is blocked at the database layer.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tip_no_delete
  BEFORE DELETE ON tip.tip
  FOR EACH ROW
  EXECUTE FUNCTION tip.refuse_delete();

-- Same for the sequence row — its history is part of the corpus integrity.
CREATE TRIGGER tip_sequence_no_delete
  BEFORE DELETE ON tip.tip_sequence
  FOR EACH ROW
  EXECUTE FUNCTION tip.refuse_delete();

-- (2) Closed-set check on disposition --------------------------------------

ALTER TABLE tip.tip
  ADD CONSTRAINT tip_disposition_check
  CHECK (disposition IN (
    'NEW',
    'IN_TRIAGE',
    'DISMISSED',
    'ARCHIVED',
    'PROMOTED',
    'REDACTED_BY_COURT_ORDER'
  ));

-- (3) Append-only disposition-history table --------------------------------

CREATE TABLE tip.tip_disposition_history (
  id                 UUID PRIMARY KEY,
  tip_id             UUID NOT NULL REFERENCES tip.tip(id) ON DELETE NO ACTION,
  prior_disposition  TEXT NOT NULL,
  new_disposition    TEXT NOT NULL,
  actor              TEXT NOT NULL,
  notes              TEXT,
  audit_event_id     TEXT,
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tip_disposition_history_tip_idx
  ON tip.tip_disposition_history(tip_id, recorded_at DESC);

-- The history table itself is also append-only.
CREATE OR REPLACE FUNCTION tip.refuse_history_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'tip.tip_disposition_history is append-only'
    USING ERRCODE = 'restrict_violation',
          HINT    = 'Append a new row to record a correction; never UPDATE or DELETE.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tip_history_no_update
  BEFORE UPDATE ON tip.tip_disposition_history
  FOR EACH ROW
  EXECUTE FUNCTION tip.refuse_history_mutation();

CREATE TRIGGER tip_history_no_delete
  BEFORE DELETE ON tip.tip_disposition_history
  FOR EACH ROW
  EXECUTE FUNCTION tip.refuse_history_mutation();

COMMIT;
