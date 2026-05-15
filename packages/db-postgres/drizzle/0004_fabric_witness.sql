-- @migration-locks-acknowledged: schema-init for audit.fabric_witness. CREATE TABLE + CREATE INDEX in same DDL batch against an empty table; lock is instantaneous. Future indexes on this table MUST use CONCURRENTLY.
-- 0004_fabric_witness.sql — Phase G6.
--
-- Records when each `audit.actions` row landed in the Hyperledger
-- Fabric `audit-witness` chaincode. Postgres remains the source of
-- truth; this table is a local mirror of the Fabric write-ack so the
-- cross-witness verifier (Phase I1) can answer "is seq X bridged yet?"
-- without round-tripping the gateway.
--
-- Idempotent insert path: worker-fabric-bridge issues
-- INSERT ... ON CONFLICT (seq) DO NOTHING after every successful
-- chaincode submit. The chaincode itself is idempotent on (seq, hash).

CREATE TABLE IF NOT EXISTS audit.fabric_witness (
  seq                 BIGINT      PRIMARY KEY,
  body_hash           BYTEA       NOT NULL,
  fabric_tx_id        TEXT        NOT NULL,
  fabric_block_height BIGINT,
  anchored_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cross-witness verifier sweep walks ascending seq.
CREATE INDEX IF NOT EXISTS fabric_witness_seq_idx
  ON audit.fabric_witness (seq);

-- Operator dashboard "rows still pending Fabric write" — tiny set in
-- steady state, but useful when the bridge is degraded.
CREATE INDEX IF NOT EXISTS fabric_witness_anchored_at_idx
  ON audit.fabric_witness (anchored_at DESC);

-- Constraint: body_hash must be 32 bytes (sha256). Postgres does not
-- have a fixed-length BYTEA type so we enforce via CHECK.
ALTER TABLE audit.fabric_witness
  DROP CONSTRAINT IF EXISTS fabric_witness_body_hash_len;
ALTER TABLE audit.fabric_witness
  ADD  CONSTRAINT fabric_witness_body_hash_len
  CHECK (octet_length(body_hash) = 32);
