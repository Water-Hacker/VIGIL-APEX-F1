-- Down migration for 0011_tip_no_delete.sql. Reverses the three
-- layers introduced; production should NEVER run this in anger
-- (citizen tips are evidence; reverting the deletion-block defeats
-- the entire DECISION-016 contract). Provided for the architect's
-- DR rehearsal flow only.

BEGIN;

DROP TRIGGER IF EXISTS tip_history_no_delete ON tip.tip_disposition_history;
DROP TRIGGER IF EXISTS tip_history_no_update ON tip.tip_disposition_history;
DROP INDEX IF EXISTS tip.tip_disposition_history_tip_idx;
DROP TABLE IF EXISTS tip.tip_disposition_history;
DROP FUNCTION IF EXISTS tip.refuse_history_mutation();

ALTER TABLE tip.tip DROP CONSTRAINT IF EXISTS tip_disposition_check;

DROP TRIGGER IF EXISTS tip_sequence_no_delete ON tip.tip_sequence;
DROP TRIGGER IF EXISTS tip_no_delete ON tip.tip;
DROP FUNCTION IF EXISTS tip.refuse_delete();

COMMIT;
