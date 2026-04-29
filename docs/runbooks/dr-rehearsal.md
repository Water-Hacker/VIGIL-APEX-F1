# Disaster-Recovery Rehearsal Runbook

> Quarterly drill executed by the architect (and backup architect when
> available). Verifies SRD §27 RTO < 6h / RPO < 5min commitments by
> rebuilding the platform from cold backups.
>
> Cross-references: OPERATIONS §10 (Emergency Repo Access), HSK §06
> (key-recovery ceremony), TRUTH §B (NAS pair + WireGuard replication).

**Frequency:** quarterly (Mar / Jun / Sep / Dec, week 2). Audit-of-audit row emitted at start + finish.

**Time required:** ~5 hours nominal, 8 hours stretch.

---

## 0. Pre-flight

- [ ] Architect AND backup architect both available for the entire window.
- [ ] Test environment provisioned (`vigil-dr-rehearsal-YYYY-QN.lab`) — separate from production.
- [ ] Backup snapshots accessible:
  - Primary NAS WORM volume `/srv/vigil/backup/<YYYY-QN>/`
  - Secondary NAS replica
  - Hetzner archive in `archive.vigilapex.cm`
- [ ] Vault Shamir shares 1, 2, 3 available (3-of-5 quorum, per the W-12 ceremony).
- [ ] Polygon-signer YubiKey available for signing test transactions on Polygon Mumbai testnet (NOT mainnet).
- [ ] A blank Hetzner CPX31 VPS provisioned and reachable.
- [ ] [`scripts/dr-restore-test.sh`](../../scripts/dr-restore-test.sh) checked out on the workstation.

## 1. Open the drill (audit row)

Emit a `system.bootstrap` audit-of-audit row marking the start:

```
curl --unix-socket /run/vigil/audit-bridge.sock http://localhost/append \
  -H 'content-type: application/json' \
  -d '{"action":"system.bootstrap","actor":"architect:junior","subject_kind":"system","subject_id":"dr-rehearsal-YYYY-QN","payload":{"phase":"start"}}'
```

Record the returned `seq` in the rehearsal notebook.

## 2. Restore Postgres

```
./scripts/dr-restore-test.sh restore-postgres \
  --snapshot /srv/vigil/backup/YYYY-QN/postgres-tip.tar.zst \
  --target  vigil-dr-rehearsal-YYYY-QN.lab:5432
```

Assert:

- `\dt audit.*` shows the 7 TAL-PA tables + `audit.actions`.
- `SELECT MAX(seq) FROM audit.actions` returns the seq from production at backup time.
- `pnpm verify:hashchain` walks the chain top-to-tail without errors.

Record: row count + tail seq + total bytes restored. Target: ≤ 90 minutes.

## 3. Restore Redis Streams

```
./scripts/dr-restore-test.sh restore-redis \
  --rdb /srv/vigil/backup/YYYY-QN/redis.rdb \
  --target vigil-dr-rehearsal-YYYY-QN.lab:6379
```

Assert: `XINFO STREAM vigil:audit:emit` shows entries; consumer-group state preserved.

## 4. Restore IPFS pinset

```
./scripts/dr-restore-test.sh restore-ipfs \
  --pinset /srv/vigil/backup/YYYY-QN/kubo-pinset.txt \
  --target vigil-dr-rehearsal-YYYY-QN.lab:5001
```

Assert: at least 95% of pinned CIDs are recoverable from peers. Failed CIDs go on the rehearsal report.

## 5. Restore Vault unseal flow

```
./scripts/dr-restore-test.sh restore-vault \
  --snapshot /srv/vigil/backup/YYYY-QN/vault-snapshot.json \
  --target vigil-dr-rehearsal-YYYY-QN.lab:8200
```

Use shares 1, 2, 3 (architect + backup + safe-deposit-box if available) to unseal. Assert:

- `vault status` → `Sealed: false`.
- `vault read sys/health` → `initialized:true, sealed:false, standby:false`.

Re-seal before continuing.

## 6. Restore audit-chain integrity (cross-witness)

```
./scripts/dr-restore-test.sh verify-cross-witness
```

Walks `audit.actions` (Postgres) ↔ Polygon anchor commitments ↔ Fabric chaincode commitments (W-11 / TRUTH §B.2). Asserts: every `seq` has a body-hash that matches all three witnesses.

Target: no divergence. One divergence ⇒ open `incident-response/dr-divergence-YYYY-QN.md` and abort the rehearsal.

## 7. Bring up workers + dashboard

```
docker compose --env-file .env.rehearsal up -d
./scripts/smoke-stack.sh                       # health-check probe
./scripts/e2e-fixture.sh                        # full fixture path
```

Assert: every container reaches `healthy`; `/api/health` → 200; `/api/audit/public` returns events; the seeded fixture finding flows through to `dossier.rendered` within 5 minutes.

## 8. Time-to-restore summary

Compute and record:

- T0 → end of Postgres restore (target ≤ 90 min).
- T0 → end of Vault unseal (target ≤ 120 min).
- T0 → first successful `/api/audit/public` request (target ≤ 240 min).
- T0 → first end-to-end fixture pass (target ≤ 360 min = 6h RTO).

If any target missed, open a `decision.recorded` entry detailing the slowest stage and the planned fix.

## 9. Close the drill (audit row)

```
curl --unix-socket /run/vigil/audit-bridge.sock http://localhost/append \
  -H 'content-type: application/json' \
  -d '{"action":"system.bootstrap","actor":"architect:junior","subject_kind":"system","subject_id":"dr-rehearsal-YYYY-QN","payload":{"phase":"end","time_to_restore_minutes":<MEASURED>,"divergences":<COUNT>,"failed_pins":<COUNT>}}'
```

## 10. Tear down

```
docker compose --env-file .env.rehearsal down -v
terraform -chdir=infra/dr-rehearsal destroy
```

Wipe the rehearsal lab's disks. The Vault snapshot file used in Step 5 is shredded with `shred -uvz`.

## 11. Report

Append a section to `docs/runbooks/dr-rehearsal-history.md`:

- Date + architect signature.
- Time-to-restore for each milestone.
- Divergences (witnesses, pins).
- Action items + responsible party + due date.

The report is committed on `main`; signed by both architect and backup architect.

---

## Companion script

[`scripts/dr-restore-test.sh`](../../scripts/dr-restore-test.sh) provides the
mechanical commands listed above. The rehearsal driver invokes it stage by
stage. Each stage exits non-zero on failure so the rehearsal halts at the
first broken contract.
