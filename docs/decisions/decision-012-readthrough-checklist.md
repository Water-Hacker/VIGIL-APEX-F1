# DECISION-012 (TAL-PA) — Architect Read-Through Checklist

> Use this checklist to promote DECISION-012 from **PROVISIONAL** → **FINAL**
> in [docs/decisions/log.md](log.md). Walk every item; sign each box; write
> a one-line decision-log update when done.

**Doctrine:** [docs/source/TAL-PA-DOCTRINE-v1.md](../source/TAL-PA-DOCTRINE-v1.md)

**Date opened:** 2026-04-29
**Promoted to FINAL on:** **\*\***\_**\*\***
**Architect signature:** **\*\***\_**\*\***

---

## §1 Principle

- [ ] The single-sentence commitment in §1 is the architectural promise I want to make to CONAC, the council, and the public. If anything in §2–§11 contradicts §1, §1 wins.
- [ ] The three sub-commitments (completeness, cryptographic integrity, public legibility) are jointly achievable in Phase 1 with current code.

## §2 Eleven-Category Taxonomy

- [ ] The 11 categories cover every action a real user takes on the platform. Categories I've considered and rejected: \***\*\_\_\_\*\***
- [ ] [`KNOWN_EVENT_TYPES`](../../packages/shared/src/schemas/audit-log.ts) ≈ 80 slugs is a reasonable Phase-1 starting set.
- [ ] [`HIGH_SIGNIFICANCE_EVENT_TYPES`](../../packages/shared/src/schemas/audit-log.ts) is the exact subset I want anchored individually within seconds (vs hourly batch).
- [ ] `categoryOf()` regex fallback for unknown slugs maps to the right category in every case I tested.

## §3 Per-Actor Hash Chain

- [ ] CAS in [`UserActionEventRepo.insertAndAdvanceChain`](../../packages/db-postgres/src/repos/audit-log.ts) is the right chain-integrity mechanism (vs alternatives: serializable transaction, advisory lock, optimistic concurrency).
- [ ] NFKC + sorted-key JSON canonicalisation in [`computeRecordHash`](../../packages/audit-log/src/hash.ts) handles every Unicode-equivalence trap I'm aware of.
- [ ] `DeterministicTestSigner` is acceptable for tests; production swap to YubiKey PKCS#11 happens at M0c.

## §4 Two-Chain Architecture

- [ ] Hourly Merkle batch + 5 s individual high-sig anchor is the right cadence. Cost projection (~$0.05/hr batch + ~$0.001/high-sig event) is acceptable.
- [ ] Polygon mainnet (vs Ethereum L1, Arbitrum, Base) is the right choice for Phase 1.
- [ ] [`runHighSigAnchorLoop`](../../apps/worker-anchor/src/high-sig-loop.ts) handles the failure modes I care about (RPC outage, gas spike, signer down).

## §5 Public-View Scoping

- [ ] [`toPublicView`](../../packages/audit-log/src/public-view.ts) drops every field I want hidden and keeps every field I want shown.
- [ ] Category B/C `[REDACTED:CATEGORY-X]` policy is the right level of public protection (vs partial reveal, vs full hide).
- [ ] Quarterly CSV's `actor_id_hash` derived via `hashPii(actor_id, salt)` with **per-quarter rotated salt** is the right anonymisation.
- [ ] The public `/api/audit/public` route's auth-free contract is acceptable from a counsel perspective.

## §6 Halt-on-Failure

- [ ] An audit-emitter outage taking down the privileged dashboard surfaces is the trade-off I want (completeness over availability).
- [ ] HTTP 503 + `Retry-After: 30` is the right operator message.
- [ ] The dashboard's `audit(req, spec, work)` wrapper is the only mutation/sensitive-read surface that needs this guard. Other surfaces I've considered: \***\*\_\_\_\*\***

## §7 Anomaly Detection

- [ ] The 10 deterministic rules in [`anomaly.ts`](../../packages/audit-log/src/anomaly.ts) are a reasonable Phase-1 starting set.
- [ ] 5-minute cadence + 24-hour rolling window is acceptable detection latency.
- [ ] Severity mapping (info/low/medium/high/critical) lines up with the on-call rota I want to wake up.
- [ ] Rule version `v1.0.0` is appropriate; new rules require a doctrine amendment.

## §8 Retention & Public-Permanence Export

- [ ] Quarterly cadence (`0 5 1 1,4,7,10 *` Africa/Douala) is the right rhythm.
- [ ] IPFS pinning (vs S3, vs Arweave) is the right permanence layer.
- [ ] Refusing to export without `AUDIT_PUBLIC_EXPORT_SALT` is the right boot-time guard.
- [ ] Salt rotation policy (per-quarter) is documented somewhere the future architect will find it.

## §9 Adversarial Scenarios

- [ ] Every threat in [THREAT-MODEL-CMR.md](../../THREAT-MODEL-CMR.md) is covered by either a §9 row or an explicit "out of scope" note.
- [ ] The "rogue admin truncates audit.actions" mitigation (Polygon + cross-witness verifier) is the right defence-in-depth.

## §10 Institutional Commitments

- [ ] The promises to CONAC / Cour des Comptes / MINFI / ANIF in §10 are commitments I'll make in writing in the engagement letters.
- [ ] The "what TAL-PA does NOT promise" section is honest and matches my legal posture.

## §11 Implementation Index

- [ ] Every file path in §11 exists in tree at the cited path. (Run [`scripts/check-decision-log.ts`](../../scripts/check-decision-log.ts) to mechanically verify.)
- [ ] Every test surface in §11 actually runs in CI.

---

## Pre-promotion checks (mechanical)

Run these before you sign:

```bash
# 1. All four pipelines green
pnpm exec turbo run build --continue
pnpm exec turbo run typecheck --continue
pnpm exec turbo run lint --continue
pnpm exec turbo run test --continue

# 2. TAL-PA-specific test surfaces
pnpm --filter @vigil/audit-log run test                # 34 tests
pnpm --filter adapter-runner exec vitest run __tests__/quarterly-audit-export.test.ts  # 5 tests
pnpm --filter worker-anchor exec vitest run __tests__/high-sig-loop.test.ts            # 3 tests
pnpm --filter dashboard exec vitest run __tests__/public-audit-route.test.ts           # 4 tests

# 3. Pattern coverage gate
node_modules/.pnpm/node_modules/.bin/tsx scripts/check-pattern-coverage.ts

# 4. Decision-log cross-link audit (when scripts/audit-decision-log.ts ships)
# pnpm exec tsx scripts/audit-decision-log.ts

# 5. CAS integration test against a live Postgres
INTEGRATION_DB_URL=postgres://vigil:vigil_test_password@localhost:5432/vigil_test \
  pnpm --filter @vigil/db-postgres run test
```

Expected: every pipeline green, every TAL-PA-specific test passes, no broken doctrine cross-references.

---

## Promotion procedure

When every box above is signed:

1. Open [docs/decisions/log.md](log.md), find the DECISION-012 entry.
2. Change `Status: PROVISIONAL ...` → `Status: FINAL`.
3. Change `Date: 2026-04-29` → `Promoted to FINAL: <today>`.
4. Append: `Architect: Junior Thuram Nana, Sovereign Architect.`
5. Commit on `main` with `git commit -S` (signed): `chore(decisions): promote DECISION-012 (TAL-PA) to FINAL`.
6. Emit one corresponding `decision.recorded` audit row through the audit-bridge:
   ```
   curl --unix-socket /run/vigil/audit-bridge.sock http://localhost/append \
     -H 'content-type: application/json' \
     -d '{"action":"decision.recorded","actor":"architect:junior","subject_kind":"decision","subject_id":"DECISION-012","payload":{"status":"FINAL","doctrine":"TAL-PA-DOCTRINE-v1.md"}}'
   ```
7. Mark this checklist file as completed in the work program.

---

## Rollback

If after promotion a defect surfaces that requires reverting:

1. New decision-log entry **DECISION-013** documents the defect + the
   superseding doctrine.
2. DECISION-012 is marked `Status: SUPERSEDED by DECISION-013` (do **not**
   delete or rewrite history).
3. Code reverts via a normal feature branch + signed merge to main.
4. The audit chain itself is **not rewindable** — superseded events remain
   on Polygon forever; the supersession is a forward-only record.
