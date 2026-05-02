# R6 — Disaster-recovery rehearsal (canonical)

> Monthly DR exercise. System-wide ceremony. Per-worker runbooks
> reference this file rather than replicating it.
>
> Per SRD §31.6 + SRD §27 (DR plan). The 6-h SLA is the binding
> RTO; RPO is < 5 min (NAS-replica streaming standby per SRD §31.2).

---

## Cadence

Monthly per SRD §31.6. The architect (or backup architect during
DR drills) is responsible for scheduling. Recommended window:
last Saturday of each month, 09:00–15:00 Africa/Douala (off-peak,
no live council vote, daytime so a real failure surfaces fast).

## What R6 simulates

A full host loss. Specifically:

- **Postgres** — primary host disk lost. Recovery: promote NAS-
  replica + replay WAL + restart workers.
- **Neo4j** — derived view lost. Recovery: re-hydrate from Postgres.
- **IPFS** — local pin set lost. Recovery: rclone from NAS mirror
  - re-pin from `dossier.dossier.pdf_cid` + `audit.public_export.csv_cid`.
- **Vault** — unsealed state lost. Recovery: unseal ceremony with
  3-of-5 council Shamir shares. Mock fixture used in rehearsals
  (NOT real council shares).
- **Workers** — all lost. Recovery: docker compose up; reconnect to
  restored Postgres + Neo4j + Vault.

## Pre-conditions

- The `dr-rehearsal` docker compose profile defined (separate
  service set so the rehearsal doesn't touch live containers).
- NAS-replica simulation directory bind-mounted at `/mnt/nas-dr-test/`.
- Mock Shamir fixture at `personal/dr-test/shamir-shares.json`
  (architect-provided, gitignored).
- `DR_REHEARSAL_POSTGRES_URL` env set to the dr-test Postgres
  connection (NOT production). The script refuses to query
  Postgres without it.
- **Architect's primary YubiKey present + GPG passphrase known**
  (Block-E E.14 precondition). Without these the encrypted-at-rest
  archive cannot be decrypted at step 3.5 and the rehearsal
  cannot proceed. If the architect is unavailable, the backup
  architect's YubiKey is the secondary path (HSK-v1 §6.2).

## Procedure

The actual mechanics live in
[`scripts/dr-rehearsal.ts`](../../scripts/dr-rehearsal.ts) (Block-C
B3 / C.3 deliverable). Operator invocation:

```sh
# Architect / backup architect runs:
cd /opt/vigil-apex
DR_REHEARSAL_POSTGRES_URL=postgres://... \
  pnpm exec tsx scripts/dr-rehearsal.ts \
  --report=/tmp/dr-rehearsal-$(date +%Y%m%d).json

# For dry-run validation before the actual drill:
pnpm exec tsx scripts/dr-rehearsal.ts --dry-run
```

The script walks 11 steps (step 3.5 added in Block-E E.14):

1. **Baseline capture** — counts canonicals, audit seq head, findings.
2. **Snapshot** — pg_basebackup + Vault raft snapshot to NAS-test mount.
3. **Bring DR-test stack up fresh** — separate compose profile, no data.
   3.5. **Decrypt the archive** (Block-E E.14, ~15 min) — every `.gpg`
   in the archive is unwrapped; YubiKey + GPG passphrase required.
   Procedure: [`docs/RESTORE.md` Phase 0.5](../RESTORE.md). The
   rehearsal exercises the smoke test
   [`scripts/test-encrypt-roundtrip.sh`](../../scripts/test-encrypt-roundtrip.sh)
   on a dr-test fixture before touching the real archive — this is
   the binding "restore-actually-decrypts" gate.
4. **Restore Postgres** — apply snapshot, time it.
5. **Restore IPFS** — rclone from NAS mirror, time it.
6. **Restore Vault + unseal** — raft snapshot + mock 3-share unseal.
7. **Workers up + time-to-first-event** — the SLA datapoint.
8. **Audit-verifier chain walk** — MUST be clean. The offline
   verifier ([`scripts/verify-hashchain-offline.ts`](../../scripts/verify-hashchain-offline.ts),
   Block-E E.13) runs against the decrypted CSV from step 3.5 and
   the report is captured for the rehearsal record.
9. **Baseline comparison** — restored counts within RPO tolerance.
10. **Teardown** — `docker compose down -v` on the dr-test profile.

## SLA acceptance criteria

- **RTO ≤ 6 h** end-to-end (step 3 → step 7 first successful event).
- **RPO ≤ 5 min** verified by step 9 baseline comparison.
- **Audit chain clean** post-restore (step 8 emits zero
  `AUDIT_HASH_CHAIN_BROKEN`).
- **All workers green** in `vigil_worker_inflight > 0` within
  10 min of step 7.

The script's exit code:

- `0` — SLA met, all steps ok.
- `1` — SLA missed OR any step failed.
- `2` — pre-flight failure (missing profile / mount / fixture).

## What R6 does NOT simulate

- **Real Shamir-share unseal.** Real council members aren't
  available for monthly rehearsals; the mock fixture is a
  procedural rehearsal, not a cryptographic one. Once a year the
  architect runs the real-share unseal as part of the annual
  Shamir rotation per [vault.md R3](./vault.md).
- **NAS-replica loss.** R6 assumes the NAS is intact. The
  catastrophic NAS-loss scenario (W-08 / HSK-v1 §5.6 deep-cold
  backup) is a separate ceremony, not monthly.
- **Live-traffic load.** The dr-test stack runs without inbound
  source events; SLA timing is for the bare recovery, not
  "recovery + catch up live ingest backlog" (which would add
  another hour at Phase-1 scale).

## Architect-tracked

- **Block-D follow-up**: SRD §31.6 enumeration is empty in the
  binding doc as of 2026-05-01. The 10-step procedure in
  `scripts/dr-rehearsal.ts` is the de facto template the
  Block-D §31.6 SRD work codifies.
- **Phase-3 federation**: R6 doesn't currently exercise the
  federation receiver / agents. Add when those land in production.

## On-call paging during the rehearsal

The architect runs R6 directly. If the rehearsal fails the SLA OR
any step errors, the architect drives root-cause investigation
inline; on-call is NOT paged for rehearsal failures (those are
expected learning events).

## Cross-references

- [`scripts/dr-rehearsal.ts`](../../scripts/dr-rehearsal.ts) — the script.
- [`scripts/dr-restore-test.sh`](../../scripts/dr-restore-test.sh) — the existing pre-rehearsal backup-restore smoke test (subset of step 4).
- [`docs/runbooks/postgres.md`](./postgres.md) R2 — Postgres restore.
- [`docs/runbooks/neo4j.md`](./neo4j.md) R2 — Neo4j re-hydration.
- [`docs/runbooks/ipfs.md`](./ipfs.md) R2 — IPFS pin restore from NAS.
- [`docs/runbooks/vault.md`](./vault.md) R2 + R3 — Vault unseal + Shamir.
- **SRD §27** — DR plan (high-level architecture).
- **SRD §31.2** — R2 restore template.
- **SRD §31.6** — R6 monthly exercise (currently empty heading; Block-D follow-up).
- **HSK-v1 §5.6** — deep-cold backup scenario.
- **W-08** — off-jurisdiction safe-deposit-box (catastrophic-NAS-loss alternative).
