# VIGIL APEX Audit Chain — Triple-Witness Implementation

**Document:** Institutional Binding Audit — Audit Chain Integrity
**Status:** Static Implementation Analysis (Live-fire Replay Deferred to Operator Run)
**Scope:** Postgres hash chain, Polygon mainnet anchoring, Hyperledger Fabric witness

---

## Stage 1: Implementation Map

### Hash Chain Core

- `packages/audit-chain/src/hash-chain.ts` (214 lines) — Append-only, hash-linked audit log in Postgres. SERIALIZABLE transactions with 3-attempt retry. Computes `body_hash` (SHA-256 over canonical form) and `row_hash` (SHA-256 over prev_hash|body_hash).
- `packages/audit-chain/src/canonical.ts` (55 lines) — Deterministic serialization for audit events (sorted keys, NFC normalization). Single source: imported by both hash-chain and offline verifier.
- `packages/audit-chain/src/offline-verify.ts` (287 lines) — CSV-based verification (RFC-4180; zero third-party dependencies per architect E.13.a). Bit-identical mirror of `HashChain.verify()`. Continue-and-collect mode (collects ALL divergences).
- `packages/audit-chain/src/polygon-anchor.ts` (237 lines) — Submits hash-chain roots to `VIGILAnchor.sol` on Polygon mainnet. Private key never leaves YubiKey (via `/run/vigil/polygon-signer.sock` Unix socket).
- `packages/audit-chain/src/verifier.ts` (64 lines) — Hourly cross-check: reads latest on-chain commitment, recomputes local hash chain range, fails fast on mismatch (HASH_CHAIN_BREAK).

### Audit Log Emission (TAL-PA)

- `packages/audit-log/src/emit.ts` (214 lines) — Single chokepoint for all audit events. Wraps in transaction with global hash chain + user-action chain (per-actor). **Halt-on-failure** doctrine.
- `packages/audit-log/src/hash.ts` (49 lines) — Computes `record_hash` (SHA-256) over TAL-PA event payload.
- `packages/audit-log/src/halt.ts` (35 lines) — `withHaltOnFailure(emit, thenDo)` pattern. Throws `AuditEmitterUnavailableError` on emit failure.

### Database Schema (Postgres)

- `packages/db-postgres/src/schema/audit.ts` (45 lines):
  - `audit.actions`: UUID PK, seq (unique, bigint), action, actor, subject_kind, subject_id, occurred_at, payload (JSONB), prev_hash (bytea), body_hash (bytea)
  - `audit.anchor_commitment`: seq_from, seq_to, root_hash (bytea), polygon_tx_hash, polygon_block_number
- `packages/db-postgres/src/schema/audit-log.ts` (150 lines):
  - `audit.user_action_event`: TAL-PA per-actor events with `digital_signature`, `chain_anchor_tx`, `high_significance`, `prior_event_id` (per-actor chain)
  - `audit.user_action_chain`: CAS marker (latest_event_id + latest_event_hash + event_count per actor)
  - `audit.anomaly_alert`: Detected anomalies
  - `audit.public_anchor`: Individual high-sig event anchors
- `packages/db-postgres/drizzle/0004_fabric_witness.sql` (37 lines):
  - `audit.fabric_witness`: seq (PK), body_hash (32-byte bytea), fabric_tx_id, fabric_block_height, anchored_at; idempotent `ON CONFLICT (seq) DO NOTHING`

### Workers & Integrations

- `apps/worker-fabric-bridge/src/index.ts` (147 lines) — Consumes `STREAMS.AUDIT_PUBLISH`; calls chaincode `RecordCommitment(seq, body_hash)`; records witness row idempotently; routes divergence to dead-letter + critical alert.
- `chaincode/audit-witness/src/contract.ts` (104 lines) — `RecordCommitment` idempotent on (seq, hash); throws on divergence. `GetCommitment(seq)`, `ListCommitments(from, to)`. Stores only `seq`, `bodyHash`, `recordedAt` — no PII.
- `apps/worker-anchor/src/index.ts` (176 lines) — Periodic loop reads tail of hash chain, computes Merkle root over unanchored range (Bitcoin-style, odd-layer duplication), submits to VIGILAnchor.sol.
- `apps/worker-anchor/src/high-sig-loop.ts` (75 lines) — Fast-lane: polls every 5 seconds for `high_significance=true AND chain_anchor_tx IS NULL`; anchors each individually.
- `apps/worker-audit-watch/src/index.ts` (147 lines) — Audit-of-audit: polls `audit.user_action_event` every 5 minutes (24-hour window), runs anomaly rules, persists alerts. Emits `audit.hash_chain_verified` to global chain each cycle.

### Cross-Witness Verifier

- `apps/audit-verifier/src/cross-witness.ts` (91 lines) — Compares Postgres `audit.actions.body_hash` vs Postgres `audit.anchor_commitment.root_hash` vs Fabric `audit-witness.GetCommitment(seq).bodyHash` for range [from, to]. Reports count checked, missing-from-Fabric, divergent seqs.

---

## Stage 2: Hash Chain Mechanics

### Canonicalization

**File:** `packages/audit-chain/src/canonical.ts:23–34`

```typescript
export function canonicalise(event: AuditEventLike): string {
  const stableJson = JSON.stringify(sortKeys(event.payload));
  return [
    event.seq,
    event.action,
    event.actor.normalize('NFC'),
    event.subject_kind,
    event.subject_id,
    event.occurred_at,
    stableJson.normalize('NFC'),
  ].join('|');
}
```

✓ **Deterministic:** Sorted keys (recursive `sortKeys()` at lines 44–54), NFC normalization, fixed field order.
✓ **Tested:** `__tests__/canonical.test.ts:16–19` proves payloads in different key orders produce identical hashes.

### Hash Functions

**File:** `canonical.ts:36–42`

```typescript
export function bodyHash(event): string {
  return createHash('sha256').update(canonicalise(event)).digest('hex');
}
export function rowHash(prevHash: string | null, body: string): string {
  return createHash('sha256')
    .update(`${prevHash ?? '0'.repeat(64)}|${body}`)
    .digest('hex');
}
```

✓ **SHA-256** via `node:crypto`.
✓ **Genesis row:** prev_hash = 64-char zero hex.
✓ **Single source:** Both functions imported by offline verifier — no drift risk.

### Chain Head Pointer

**File:** `hash-chain.ts:206–212`

Stored implicitly as `MAX(seq)` row in `audit.actions`. Atomically read via SERIALIZABLE isolation.

### Append Mechanics (Transaction Isolation)

**File:** `hash-chain.ts:47–144`

- `BEGIN ISOLATION LEVEL SERIALIZABLE` per attempt (line 69).
- Read tail (lines 71–76), compute seq = lastSeq + 1 (line 79).
- Compute body_hash + row_hash; insert atomically (lines 90–108).
- COMMIT (line 110). Retry loop (3 attempts) handles transient serialization failures (line 137 returns failure).
- ✓ **No race-condition seq allocation** (SERIALIZABLE).
- ✓ **Atomic write of seq + prev_hash + body_hash** (single INSERT).
- ✓ **Single source of truth:** Only `HashChain.append()` writes to `audit.actions`.

### Replay (Verification)

**File:** `hash-chain.ts:147–203`

For each row in range, recomputes body_hash + row_hash from canonical form. Detects:

- Sequence gap (line 174–176) — throws `HashChainBrokenError`.
- Body hash mismatch (line 186–190) — throws.
- Prev hash mismatch (line 191–194) — throws.

✓ **No tolerance / skip mode** — throw on first divergence.
✓ **21 offline-verify tests pass** (evidence: `docs/audit/evidence/audit-chain/audit-chain-tests.log`).

### Offline Verifier

**File:** `offline-verify.ts:179–244`

Continue-and-collect: scans entire CSV; collects ALL divergences (architect review E.13.c #4). Returns `VerifyResult` with `divergences[]` array.

---

## Stage 3: Triple-Witness Path (`tip.received` example, high-significance)

### 1. Emission Initiation

`packages/audit-log/src/emit.ts:103–202` — `emitAudit()` chokepoint:

1. Per-actor chain head lookup
2. Compute `record_hash` via `computeRecordHash()`
3. Sign(actor_id, recordHash) — YubiKey PKCS#11 in prod, DeterministicTestSigner in tests, NoopSigner default
4. Persist via TRANSACTION:
   a. `chain.append({...})` → global hash chain row
   b. `userActionRepo.insertAndAdvanceChain(row)` → audit.user_action_event + audit.user_action_chain CAS

### 2. Postgres Hash Chain (Witness 1)

Row in `audit.actions`:

- `id` (UUID), `seq` (auto-allocated SERIALIZABLE), `action='tip.received'`, `actor`, `subject_kind`, `subject_id`, `occurred_at`, `payload` (incl. tal_pa_event_id), `prev_hash`, `body_hash`, `inserted_at`.

Immutability: PK on id, unique on seq. Chain-linked: body_hash includes prior body_hash.

### 3. Polygon Anchor (Witness 2 — high-significance fast lane)

`apps/worker-anchor/src/high-sig-loop.ts:25–56`:

1. Poll every 5s for `high_significance=true AND chain_anchor_tx IS NULL`.
2. For each event: `tx_seq = floor(timestamp/1000)`; `anchor.commit(tx_seq, tx_seq, record_hash)` → `VIGILAnchor.sol`.
3. Record `audit.public_anchor (event_id, polygon_tx_hash, anchored_at)`.
4. Set `chain_anchor_tx` on event row.

Failure modes: gas-price spike → retryable; RPC unavailable → retry with fallback URLs; timeout → 30s deadline per Unix-socket RPC call; **no explicit retry loop** — relies on next 5s poll (implicit retry via polling).

### 4. Fabric Witness (Witness 3)

`apps/worker-fabric-bridge/src/index.ts:46–101`:

1. HashChain.append() emits envelope on `STREAMS.AUDIT_PUBLISH`.
2. Worker (concurrency 4, max retries 8) calls `bridge.submitCommitment(seq, body_hash)`.
3. Chaincode `RecordCommitment(seq, body_hash)`:
   - Idempotent on (seq, body_hash): existing same-hash → no-op.
   - Different hash for same seq → **throws divergence error**.
4. On success: `INSERT INTO audit.fabric_witness ... ON CONFLICT (seq) DO NOTHING`.

Divergence path (`index.ts:71–89`):

```
errorsTotal.labels({code: 'AUDIT_HASH_CHAIN_BROKEN', severity: 'fatal'}).inc();
logger.error({seq, expected, fabric}, 'fabric-postgres-divergence');
return { kind: 'dead-letter', reason: `divergence at seq=${seq}: ...` };
```

✓ Metric incremented (AlertManager HashChainBreak rule).
✓ Message routed to dead-letter.
✗ No automatic backfill/remediation.

---

## Stage 4: Reconciliation & Divergence Detection

### Cross-Witness Verifier (On-Demand Only)

`apps/audit-verifier/src/cross-witness.ts:31–90` — Compares three witnesses. Detects:

1. ✓ Postgres entry lacking Fabric witness (missing seq).
2. ✓ Hash divergence between Postgres and Fabric.
3. ✗ Fabric entry lacking Postgres (no reverse scan).

**No automated reconciliation:** Verifier only reports. Operator must manually investigate divergences.

### CRITICAL FINDING — F-AC-01

**Severity:** CRITICAL

**Title:** No automated audit-chain reconciliation job exists.

**Spec claim (§10.6):** "Take down one witness (block Polygon RPC at the network layer). Submit an audit event. Confirm the event still persists to Postgres + Fabric with a clear flag that the Polygon anchor is pending. **Confirm a background reconciliation job exists**, document where it lives, and confirm it retries the missing anchor when Polygon RPC returns."

**Actual:**

- ✓ Cross-witness verifier exists (`apps/audit-verifier/src/cross-witness.ts`) but **runs only on-demand via CLI** (`npm run audit:cross-witness --from=X --to=Y`).
- ✓ `apps/worker-anchor/src/high-sig-loop.ts` retries missing high-sig anchors via 5s polling.
- ✗ **No scheduled reconciliation worker** (no systemd timer, no cron, no in-app scheduled job) for the general case.
- ✗ **No dead-letter replay mechanism** — worker-fabric-bridge stops after 8 retries; operator must manually replay.
- ✗ **No Sentry/operator-notification routing** for cross-witness divergence beyond Prometheus metric.

**Risk:** A transient Polygon RPC outage during a non-high-sig event window could leave entries un-anchored. Operator has no automated detection/recovery path. Manual cross-witness invocation requires architect awareness of the issue first.

**Remediation:** Create `apps/worker-reconcil-audit` with:

1. Hourly job reading `audit.actions` vs `audit.fabric_witness` vs `audit.anchor_commitment` for gaps.
2. Resubmit missing entries to fabric-bridge queue and anchor worker.
3. Emit reconciliation alerts (Sentry, structured log, optional Slack webhook).

### Anomaly Detection (Audit-of-Audit)

`apps/worker-audit-watch/src/index.ts` — Polls `user_action_event` every 5 minutes; emits `audit.hash_chain_verified` to global chain each cycle. **Detects suspicious patterns** in user actions, **does NOT detect** silent drops or reordering in `audit.actions`.

---

## Stage 5: Silent-Drop & Race-Condition Analysis

### Single Source of Truth ✓

All audit events route through `emitAudit()`. No alternative writers. Halt-on-failure rethrows on any error (line 194–199).

### Transaction Boundaries ✓

`emit.ts:147–192` — HashChain.append() and userActionRepo.insertAndAdvanceChain() executed sequentially. If chain.append succeeds but user-action insert fails, audit.actions has entry but user_action_event lacks it. **Mitigation:** Both in same database; admin can replay missing user_action_event rows from audit.actions. CAS on prior_event_id prevents double-insertion on retry.

### Idempotency on Retry ✓

- Per-actor CAS on prior_event_id (`audit-log/src/repo`) — only first emit of a given event succeeds.
- Fabric witness: ON CONFLICT (seq) DO NOTHING.
- Chaincode RecordCommitment: idempotent on (seq, hash).

### Double-Counting Risk ✓ None

- Global seq auto-incremented in SERIALIZABLE — no two emits get same seq.
- Per-actor prior_event_id prevents replay of same event_id.

### Out-of-Order Emission ✓ None

- Seq strictly incremented under SERIALIZABLE.
- Hash chain verify() fails on out-of-order seqs.

### Loss on Process Crash ✓ None

- Persistent in Postgres ACID.
- Fabric witness persistent in Postgres mirror + Fabric ledger.
- Polygon anchor on-chain + recorded in `audit.anchor_commitment`.

**Residual risk:** Worker crashes after chaincode success but before audit.fabric_witness insert → next worker startup re-consumes envelope (idempotent insert covers).

---

## Stage 6: Deferred Live-Fire Tests

These tests require running infrastructure (Postgres + Polygon RPC reachable + Fabric peer) and cannot run in the static audit. The harnesses below are ready to execute when the architect brings the stack up.

### T1: Replay 100 entries

```bash
createdb vigil-apex-test && export DATABASE_URL=postgres://localhost/vigil-apex-test
pnpm --filter @vigil/db-postgres migrate
# Emit 100 events via API or test fixture
pnpm --filter @vigil/audit-chain run verify --from=1 --to=100
# Expected: "100 rows verified" or first-divergence index
```

### T2: Corrupt entry 47

```sql
UPDATE audit.actions
SET body_hash = decode('ff'||repeat('00',31), 'hex')
WHERE seq = 47;
```

Then run verify. Expected: throw `HashChainBrokenError` at seq=47 with `expected ≠ actual`.

### T3: Reorder seqs 30 & 31

Swap seq values. Expected: prev_hash chain breaks at seq=30 or 31.

### T4: Canonicalization order-independence

Insert same 100 events in two different orders into two databases. Compare tail body_hash. **Expected: identical.** (Already covered statically by `canonical.test.ts:16–19`.)

### T5: Real audit event end-to-end (3 witnesses)

Submit `council.vote` event via API. Verify within ~20s:

- Postgres row in `audit.actions`.
- Polygon `audit.public_anchor` row + polygon_tx_hash resolves on polygonscan.
- Fabric `audit.fabric_witness` row + fabric_tx_id resolves on peer.

### T6: Witness degradation + recovery

Stop Fabric peer; emit events; observe dead-letter accumulation + AlertManager fire. Restart Fabric. **Expected (per F-AC-01):** automated reconciliation job would resubmit. **Actual today:** operator must manually run `pnpm --filter @vigil/audit-verifier run cross-witness` and replay dead-letter queue.

### T7: Silent-drop hunt

Synthetically inject a try/catch around `emit.ts:194–199` (revert immediately) and prove no event is dropped. (Static analysis: rethrow confirmed. No silent-drop path exists in current code.)

---

## Summary of Findings

| ID      | Severity | Title                                                                                      | Location                                                                             |
| ------- | -------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| F-AC-01 | CRITICAL | No automated audit-chain reconciliation job                                                | `apps/audit-verifier/src/cross-witness.ts` is on-demand only; no scheduled worker    |
| F-AC-02 | LOW      | No reverse-scan: Fabric→Postgres divergence (chaincode entry without Postgres counterpart) | `cross-witness.ts:31–90`                                                             |
| F-AC-03 | LOW      | Audit-of-audit loop does not verify chain integrity                                        | `worker-audit-watch` detects user-action anomalies, not tampering in `audit.actions` |
| F-AC-04 | INFO     | Worker stops after 8 retries; operator must replay dead-letter manually                    | `apps/worker-fabric-bridge/src/index.ts`                                             |

**Standout positives:**

- Hash chain canonicalization is order-independent and tested.
- SHA-256 via node:crypto, not stub.
- SERIALIZABLE isolation prevents race on seq.
- Halt-on-failure doctrine ensures no silent drops.
- Cross-witness verifier exists (just needs scheduling).
- 26 tests pass (canonical: 5, offline-verify: 21).

---

## Conclusion

**The audit-chain core mechanics are sound.** Canonical hashing is deterministic and tested. Triple-witness paths exist and are correctly wired. Idempotency is enforced at every layer. Halt-on-failure prevents silent drops.

**The operational recovery path is incomplete.** F-AC-01 (no scheduled reconciliation) is the single most important closure for the audit chain. Without it, a transient witness outage requires manual operator intervention — acceptable for Phase 1 pilot but not for full production.

Live-fire replay tests (T1–T7) are ready to execute against a running stack and should be performed before Phase 1 close.
