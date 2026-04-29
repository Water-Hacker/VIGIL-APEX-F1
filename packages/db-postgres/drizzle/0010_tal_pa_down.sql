-- Rollback DECISION-012 forward migration. Destructive — dev only.
DROP TABLE IF EXISTS audit.public_export;
DROP TABLE IF EXISTS audit.anomaly_alert;
DROP TABLE IF EXISTS audit.public_anchor;
DROP TABLE IF EXISTS audit.redaction;
DROP TABLE IF EXISTS audit.session;
DROP TABLE IF EXISTS audit.user_action_chain;
DROP TABLE IF EXISTS audit.user_action_event;
