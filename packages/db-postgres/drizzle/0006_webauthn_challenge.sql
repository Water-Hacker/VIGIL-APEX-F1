-- 0006_webauthn_challenge.sql — Tier 5 / DECISION-008.
--
-- Stores short-lived WebAuthn challenges issued by /api/council/vote/challenge
-- and adds the credential public-key columns to governance.member that the
-- assertion verifier reads at /api/council/vote.
--
-- Per SRD §17.8.3 + W-10: ES256K (secp256k1, COSE alg -47) is the primary
-- algorithm; ES256 is an accessibility fallback. The credential's public key
-- bytes are the COSE-encoded form, persisted as bytea.

CREATE TABLE IF NOT EXISTS governance.webauthn_challenge (
  id              UUID PRIMARY KEY,
  member_id       UUID REFERENCES governance.member(id) ON DELETE CASCADE,
  voter_address   TEXT NOT NULL,
  proposal_id     UUID NOT NULL,
  challenge_b64u  TEXT NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ,
  -- Each (proposal, voter) gets at most one open challenge at a time. Issuing
  -- a fresh challenge supersedes any unconsumed earlier one.
  UNIQUE (proposal_id, voter_address, consumed_at)
);

CREATE INDEX IF NOT EXISTS webauthn_challenge_voter_idx
  ON governance.webauthn_challenge (voter_address, expires_at);

ALTER TABLE governance.member
  ADD COLUMN IF NOT EXISTS webauthn_credential_id TEXT,
  ADD COLUMN IF NOT EXISTS webauthn_public_key    BYTEA,
  ADD COLUMN IF NOT EXISTS webauthn_counter       BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS member_webauthn_credential_unique
  ON governance.member (webauthn_credential_id)
  WHERE webauthn_credential_id IS NOT NULL;
