# Recommendations and Remediation Plan

This document groups the critical and high findings (from doc 10) into a remediation plan ordered by what closes the most institutional risk per unit of work.

---

## Cheap to close (under 1 day each)

Ordered by impact, highest first:

### R1 — Close FIND-002 (CONAC threshold)

**Add the constants and enforce at the worker-pattern boundary.**

- Add `packages/shared/src/constants.ts` exporting `POSTERIOR_THRESHOLD_CONAC = 0.95` and `MIN_SOURCE_COUNT_CONAC = 5`.
- In `apps/worker-pattern/src/index.ts`, before publishing `dossier.render` envelope, guard:
  ```typescript
  if (finding.posterior < POSTERIOR_THRESHOLD_CONAC) return;
  if (finding.signal_count < MIN_SOURCE_COUNT_CONAC) return;
  ```
- Add defensive re-check in `apps/worker-conac-sftp/src/index.ts` before SFTP put.
- Add test in `apps/worker-pattern/test/` verifying posterior=0.94 + sources=5 is NOT delivered.
- **Closes:** FIND-002 (critical).
- **Impact:** prevents a wrong finding reaching CONAC. Highest institutional risk per minute of work.

### R2 — Close FIND-001 (forbidden-access audit)

**Add audit emission in /403 page server component.**

- Edit `apps/dashboard/src/app/403/page.tsx` to call `auditEmit({ eventType: 'access.forbidden', ... })` from a server action.
- Verify event reaches Postgres + (high-significance?) Polygon + Fabric per doc 08 § 3.
- **Closes:** FIND-001 (critical).

### R3 — Close FIND-003 (nav link leak)

**Conditional render OPERATOR_LINKS in NavBar.**

- Read `x-vigil-roles` header in `nav-bar.tsx`.
- Hide OPERATOR_LINKS for users without operator-class roles.
- **Closes:** FIND-003 (critical).

### R4 — Close FIND-006 (FROST/multi-sig doctrine drift)

**Doctrinal documentation fix.**

- Update SRD §23.3 to describe contract-native multi-sig with FROST-equivalence note.
- Update BUILD-COMPANION-v2 §FROST accordingly.
- Touch AUDIT-098 or supersede it with a new decision record.
- **Closes:** FIND-006 (high).
- **Impact:** removes the spec/code divergence that would damage external review.

### R5 — Close FIND-008 (Role enum)

**Define `Role` type.**

- Create `packages/security/src/roles.ts` exporting `Role` union.
- Import in `middleware.ts`; replace string literals.
- TypeScript fails compilation on typos.
- **Closes:** FIND-008 (high).

### R6 — Close FIND-009 (RBAC matrix screen)

**Build read-only `/audit/rbac-matrix/page.tsx`.**

- Import ROUTE_RULES.
- Render table.
- Gate behind auditor/architect.
- **Closes:** FIND-009 (high).

### R7 — Close FIND-011 (public branding)

**Route-group split for public vs operator metadata + title.**

- Move `apps/dashboard/src/app/page.tsx` and other public pages under `(public)/` route group.
- Move operator pages under `(operator)/` route group.
- Different `layout.tsx` per group with appropriate metadata.
- **Closes:** FIND-011 (medium).

### R8 — Close FIND-012 (gitleaks history)

**Run gitleaks against full history.**

```bash
gitleaks detect --source . --log-opts="--all" --report-format json \
  --report-path docs/audit/evidence/secret-scan/gitleaks-history.json --config .gitleaks.toml
```

- If anything found: rotate credentials + remediate history (BFG repo-cleaner or `git filter-repo`).
- **Closes:** FIND-012 (low).

### R9 — Close FIND-013 (reverse cross-witness scan)

**Add reverse scan to cross-witness.ts.**

- Trivial addition (~30 min).
- **Closes:** FIND-013 (low).

### R10 — Close FIND-014 (audit-of-audit chain verify)

**Add hash chain verify to worker-audit-watch each cycle.**

- Call `HashChain.verify(lastChecked, currentTail)` once per cycle.
- Emit `audit.hash_chain_broken` if it fails.
- **Closes:** FIND-014 (low).

---

## Medium (1–5 days)

### R11 — Close FIND-004 (build-time RBAC coverage check)

- Create `scripts/check-rbac-coverage.ts`.
- AST-parse `middleware.ts` to extract ROUTE_RULES prefixes.
- Enumerate operator pages from filesystem.
- Fail if mismatch.
- Wire into `pnpm build` via `prebuild` script or `package.json:scripts.test`.
- **Closes:** FIND-004 (critical). Medium effort because requires AST parsing rather than regex.

### R12 — Close FIND-005 (audit-chain reconciliation job)

- New `apps/worker-reconcil-audit/` worker.
- Hourly scan across `audit.actions` / `audit.fabric_witness` / `audit.anchor_commitment`.
- Resubmit gaps; alert divergence.
- **Closes:** FIND-005 (critical). 3–5 days because new worker + Postgres queries + alert plumbing + tests.

### R13 — Close FIND-010 (bilingual drift)

- For each affected page, extract strings to `apps/dashboard/src/locales/{fr,en}/<namespace>.json`.
- Wire `loadMessages()` + `t('key')`.
- Spot-check FR translations (architect or council pillar with FR fluency should review).
- **Closes:** FIND-010 (medium).

---

## Expensive (more than 5 days or institutional precondition)

### R14 — Close FIND-007 (Polygon Python signer Rust helper)

- Complete the Rust crate (per `tools/vigil-polygon-signer/README.md`).
- Likely uses `pkcs11` crate or `cryptoki` for PKCS#11 bindings + `secp256k1` for ECDSA.
- Integrate with Python service via subprocess or FFI.
- Add Hardhat E2E test on Polygon Mumbai testnet.
- **Closes:** FIND-007 (high). 5–7 days depending on PKCS#11 ECDSA recovery complexity.

### R15 — Run live-fire stress tests (doc 09)

- Bring up full stack via `make smoke` or `docker compose up -d`.
- Execute 11.1 through 11.13.
- Save artifacts to `docs/audit/evidence/stress-test/`.
- Confirm or revise findings 001/003/004 based on observed behavior.
- **Effort:** 2–3 days of focused operator + agent work.

### R16 — Live-fire Lighthouse / axe runs (doc 06)

- After dev server up, run Lighthouse against all priority screens.
- Save reports.
- **Effort:** 0.5–1 day.

### R17 — Run gitleaks + manual scan against full history

Already in R8 (cheap) but if anything is found, rotation + history rewrite is expensive. **Effort if leak found:** 1–5 days plus credential rotation institutional steps.

---

## One-page priority order

| Order | Action                      | Closes                  | Severity | Effort       |
| ----- | --------------------------- | ----------------------- | -------- | ------------ |
| 1     | R1 — CONAC threshold        | FIND-002                | critical | cheap        |
| 2     | R2 — Forbidden audit        | FIND-001                | critical | cheap        |
| 3     | R3 — Nav link leak          | FIND-003                | critical | cheap        |
| 4     | R11 — Build-time RBAC check | FIND-004                | critical | medium       |
| 5     | R12 — Reconciliation worker | FIND-005                | critical | medium       |
| 6     | R4 — FROST doctrine fix     | FIND-006                | high     | cheap (docs) |
| 7     | R8 — gitleaks history       | FIND-012                | low      | cheap        |
| 8     | R5 — Role enum              | FIND-008                | high     | cheap        |
| 9     | R6 — RBAC matrix screen     | FIND-009                | high     | cheap        |
| 10    | R7 — Public branding        | FIND-011                | medium   | cheap        |
| 11    | R9 — Reverse cross-witness  | FIND-013                | low      | cheap        |
| 12    | R10 — Audit-of-audit verify | FIND-014                | low      | cheap        |
| 13    | R13 — Bilingual fix         | FIND-010                | medium   | medium       |
| 14    | R14 — Polygon signer Rust   | FIND-007                | high     | expensive    |
| 15    | R15 — Stress tests          | (deferred verification) | —        | expensive    |
| 16    | R16 — Lighthouse            | (deferred verification) | —        | medium       |

**Top 5 closures** (items 1–5) close all five CRITICAL findings. Of these, three are cheap (under 1 day each) and two are medium effort. **The entire critical-set could close in ~1 working week.**
