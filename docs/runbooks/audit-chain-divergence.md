# Runbook — Audit Chain Divergence Response

**Severity:** CRITICAL — operator intervention required
**Pages:** the architect via Alertmanager `audit.reconciliation_divergence` route
**Owner:** the architect (solo); audit chain integrity is platform-critical
**Last updated:** 2026-05-17 (T5 of TODO.md sweep — recompute-body-hash CLI landed)

## When this runbook applies

You see one of:

- Prometheus alert fires: `HashChainBreak` (severity critical) or `audit.reconciliation_divergence` (audit-chain row of action `audit.reconciliation_divergence` from `worker-reconcil-audit`).
- Operator-initiated `make verify-cross-witness` exits with code 3 (Postgres↔Fabric divergence).
- `audit-verifier` logs `ct-03-cross-witness-divergence` at error level with a non-empty `divergent_seqs` array.
- A spot-check `apps/audit-verifier/src/cross-witness-cli.ts` run reveals divergent body hashes between Postgres `audit.actions` and the Fabric `audit-witness` chaincode.

Divergence is **non-recoverable by automation**: the three witnesses disagree on what an event's content was, so we cannot just "pick one and copy." Either:

- Postgres has been tampered with (DB-level UPDATE; check `audit.actions` UPDATE permissions).
- Fabric has been tampered with (chaincode bug or peer compromise).
- A migration / replay step corrupted one witness during a previous incident response.

The worker-reconcil-audit loop halts the platform-side write path on divergence by emitting `audit.reconciliation_divergence` with `fatal: true`. Until the operator resolves the divergence, **stop the bleed**: do not let new events be written until the operator confirms the divergence is bounded.

---

## Step 1 — Identify scope (5 minutes)

```bash
# Reconciliation worker's last divergence row contains the seqs.
psql "${POSTGRES_URL}" -c \
  "SELECT seq, occurred_at, payload FROM audit.actions
   WHERE action = 'audit.reconciliation_divergence'
   ORDER BY seq DESC LIMIT 5;"
```

Read `payload.divergent_seqs` from the most recent row. These are the seq numbers where Postgres and Fabric disagreed. Note:

- **One seq** — likely a single Fabric write error or a single Postgres tamper. Bounded.
- **A contiguous range** — likely a replay or a migration step gone wrong. Bounded.
- **Many discontiguous seqs** — possible systematic tamper. Treat as multi-witness compromise.

Then run the full-chain verifier to get the canonical list:

```bash
make verify-cross-witness  # exits 3 + emits divergent seqs to stdout
```

Persist the output:

```bash
make verify-cross-witness 2>&1 | tee /tmp/cross-witness-$(date -u +%Y%m%dT%H%M%SZ).log
```

This log is your incident artefact; preserve it.

---

## Step 2 — Halt the bleed (within 15 minutes of detection)

The reconciliation worker has already stopped declaring success — but the `worker-anchor` may still be anchoring divergent state to Polygon. Stop the active writers:

```bash
# Stateless workers — safe to stop; the queue preserves their inputs.
docker compose stop worker-anchor worker-pattern worker-score \
  worker-counter-evidence worker-dossier worker-conac-sftp \
  worker-governance worker-audit-watch worker-reconcil-audit
```

Keep `vigil-postgres`, `vigil-redis`, and the dashboard running so you can investigate. The audit-verifier loop continues; that's read-only.

Make a snapshot of the audit tables for forensics:

```bash
pg_dump --schema=audit "${POSTGRES_URL}" \
  | gzip > "/srv/vigil/incident/audit-snapshot-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

---

## Step 3 — Diagnose: which witness diverged from the original?

For each divergent seq, compute the canonical body_hash from the audit row content and compare against both witnesses:

```bash
SEQ=42  # replace with the actual divergent seq

# Pull the Postgres-side row.
psql "${POSTGRES_URL}" -c \
  "SELECT seq, occurred_at, encode(body_hash, 'hex') AS pg_hash,
          encode(prev_hash, 'hex') AS prev_hash, payload
   FROM audit.actions WHERE seq = ${SEQ};"

# Pull the Fabric-side row.
pnpm --filter audit-verifier exec node dist/cross-witness-cli.js --seq ${SEQ}

# Recompute the canonical hash from the payload — the truth-test.
# Reads audit.actions[seq], calls bodyHash + rowHash from canonical.ts,
# prints "seq=N db_hash=... recomputed=... status=match|MISMATCH" per row.
# Exit codes: 0 = all match, 2 = at least one mismatch, 1 = usage/DB error.
DATABASE_URL="${POSTGRES_URL}" pnpm --filter @vigil/audit-chain exec \
  tsx src/scripts/recompute-body-hash.ts --seq ${SEQ}

# For a contiguous range:
DATABASE_URL="${POSTGRES_URL}" pnpm --filter @vigil/audit-chain exec \
  tsx src/scripts/recompute-body-hash.ts --from ${SEQ_LOW} --to ${SEQ_HIGH}
```

The recompute step is the truth-test:

- If `recompute == pg_hash != fabric_hash`: Fabric has been tampered with or had a chaincode bug at write time.
- If `recompute == fabric_hash != pg_hash`: Postgres has been tampered with (most likely a manual UPDATE).
- If `recompute matches neither`: the audit row's payload itself was rewritten — both witnesses then captured the bad version. Look further back in `audit.user_action_event` for the actor that mutated the payload.

The Polygon anchor commitment for the seq range provides a third witness. Pull the Merkle root from `audit.anchor_commitment` covering the seq, then re-verify the row's inclusion proof against the on-chain root via the `audit-verifier` CT-02 check. If the Polygon root agrees with Postgres, Fabric is the wrong one; vice versa.

---

## Step 4 — Decide remediation

The architect alone makes this call. Three options:

### Option A — Restore the affected seq from the surviving consistent witness

If two of three witnesses agree (Postgres + Polygon agree; Fabric is wrong, OR Fabric + Polygon agree; Postgres is wrong), restore the minority witness from the majority:

- **Fabric is the outlier:** re-invoke the chaincode submission with the correct body_hash. The chaincode is idempotent on (seq, body_hash); the new entry replaces the old. Capture the transaction in a new `audit.actions` row with action `audit.fabric_correction` recording (a) the seq, (b) the prior bad hash, (c) the new correct hash, (d) the architect's signature.
- **Postgres is the outlier:** restore the affected row(s) from the most recent pre-incident backup (see [backup.md](backup.md)). Emit an `audit.postgres_correction` row to acknowledge. Re-verify with `make verify-cross-witness`.

### Option B — Quarantine the divergent seq range and continue forward

If you cannot determine the truth (e.g. all three witnesses disagree, or the Polygon anchor is missing), emit an `audit.divergence_quarantine` audit row that:

- Lists every divergent seq in the affected range.
- Pins the prior-chain-clean seq + the next-clean seq the operator will resume from.
- Carries the architect's GPG-signed attestation that the quarantine is intentional and the cause is under investigation.

Downstream verifiers honor the quarantine boundary: the chain `verify` step skips over the quarantined range, the dashboard surfaces a "chain quarantined seq X..Y" banner, and external auditors are notified per the institutional escalation matrix.

### Option C — Halt indefinitely and call counsel

If the divergence appears to be a state-actor compromise (multiple witnesses tampered, Vault audit log shows unauthorised access, fabric peer cert serial doesn't match the chain anchor's signer), do not attempt remediation. Halt indefinitely, page the architect's legal counsel via the protocol in [docs/source/EXEC-v1.md](../source/EXEC-v1.md) §43.3.

---

## Step 5 — After remediation: prove the chain is clean again

```bash
make verify-cross-witness         # must exit 0
make verify-hashchain             # must exit 0 (CT-01)
make verify-ledger                # must exit 0 (CT-02 against Polygon)
```

Then resume the worker fleet:

```bash
docker compose start worker-anchor worker-pattern worker-score \
  worker-counter-evidence worker-dossier worker-conac-sftp \
  worker-governance worker-audit-watch worker-reconcil-audit
```

Watch the next reconciliation tick (default 1 hour):

```bash
docker compose logs -f worker-reconcil-audit
```

Confirm it emits `reconcil-tick` with `clean: true`.

---

## Step 6 — Incident write-up

Within 7 days of resolution, append an entry to [docs/decisions/log.md](../decisions/log.md):

- Detection timestamp + how the divergence was caught.
- Scope (which seqs, which witness was wrong).
- Truth-test outcome (which witness was the source of truth).
- Remediation option chosen (A / B / C).
- The architect's signed attestation that the chain is clean.
- Follow-up actions to prevent recurrence (e.g. tighter `audit.actions` UPDATE permissions, chaincode test additions).

The audit chain itself contains the operational events of the remediation (the `audit.fabric_correction` / `audit.postgres_correction` / `audit.divergence_quarantine` row); the decision log is the human-readable summary.

---

## Related runbooks

- [audit-bridge.md](audit-bridge.md) — fabric-bridge worker operations
- [audit-verifier.md](audit-verifier.md) — verifier loop semantics
- [worker-anchor.md](worker-anchor.md) — Polygon anchor loop
- [backup.md](backup.md) — Postgres restore procedure
- [vault-raft-reattach.md](vault-raft-reattach.md) — Vault Raft recovery (related but distinct)

## Related audit doc

- [docs/audit/08-audit-chain.md](../audit/08-audit-chain.md) — three-witness architecture
- [docs/audit/evidence/hardening/category-3/mode-3.2/CLOSURE.md](../audit/evidence/hardening/category-3/mode-3.2/CLOSURE.md) — silent-drop recovery
- [docs/audit/evidence/hardening/category-3/mode-3.4/CLOSURE.md](../audit/evidence/hardening/category-3/mode-3.4/CLOSURE.md) — this runbook is the operational counterpart
