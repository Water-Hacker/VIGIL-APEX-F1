# AUDIT-REPORT.md — Phase-2 audit closure summary

This document is the architect-facing summary of the
**senior-staff-engineer end-to-end audit** that began with
`AUDIT.md` (Phase 1, 89 findings) and was driven to completion on
the `audit/phase-2-execution` integration branch (Phase 2).

It complements `AUDIT.md` (the source of truth, finding-by-finding)
with: aggregate counts, what changed at the workspace level, the
patterns the audit surfaced, and the remaining work that is
intentionally deferred.

---

## 1. Headline numbers

### Original Phase-1 catalogue

- **Findings authored**: 89 total (85 Phase-1 + 4 surfaced by Block A
  cross-cuts: AUDIT-088, -089, -090, -091)
- **By severity** (final table):
  - High: 16
  - Medium: 42
  - Low: 25
  - Info: 8
  - **Total: 91 rows** (89 unique IDs; 2 IDs are split into
    related pairs — AUDIT-090/-091 share a fix, AUDIT-008/-009
    share a regression test)

### Phase-2 closure

- **Closed by code change**: 70 (16 high, 34 medium, 19 low, 1 info)
- **Verified-no-action / informational closure**: 7 (6 info + 1 low)
- **Architect-blocked / needs-human-confirmation**: 4
  - AUDIT-022, -023 — DECISION-008/-012 PROVISIONAL → FINAL
    (architect read-through workflow, AUDIT-071's blockquote banners
    surface them in `docs/decisions/log.md`)
  - AUDIT-025 — 9th deep-cold YubiKey (architect names
    safe-deposit-box jurisdiction)
  - AUDIT-032 — tip-operator-key rotation cadence (architect
    product call; not derivable from existing decisions)
  - AUDIT-088 — needs-human-confirmation
- **Tracked-deferral (Section 9)**: 9 items
  - AUDIT-079..-087 — Phase-3 federation, Cour des Comptes MOU,
    backup-architect onboarding, ZK Phase-4, etc. Documented as
    intentional out-of-scope follow-ups in AUDIT.md §9.

**Net coverage**: 91 / 91 rows have an explicit status — `open` does
not appear anywhere in the final table outside §9 deferrals.

---

## 2. Commit shape

The branch `audit/phase-2-execution` contains roughly **96 commits**
ahead of `main`, in a single linear history. Every fix follows the
same shape:

```
<type>(<scope>): AUDIT-NNN <one-line summary>

<3-15 line body explaining:>
- what the original audit description got right / wrong
- what the actual code shape was (when Phase-1 was off)
- what the fix is (1 paragraph)
- what tests pin it (file paths, count of cases)

Co-Authored-By: Claude (Anthropic) <noreply@anthropic.com>
```

Every fix is followed by a `docs(repo): AUDIT-NNN status -> fixed
(commit X)` housekeeping commit that flips the `Status` column in
`AUDIT.md` from `open` to the commit hash. The audit table is the
canonical record.

Block ordering executed:

- Block A — test net (AUDIT-061..-067; quorum, ABI, dossier render,
  AOI edge cases). Surfaced 4 NEW findings (-088..-091).
- Block B — security exploit risk (AUDIT-007, -028..-030).
  Closed: TLS opt-in guard, RevokedKeyError, crypto-RNG fingerprint,
  dynamic-import shim removed.
- Block C — transaction integrity (AUDIT-004..-006). Single multi-row
  UPDATE, typed errors, db.transaction wrapping.
- Block D — remaining highs (AUDIT-017, -018, -027, -044, -053,
  -062..-064, -071). Doctrine banners, devil's-advocate via SafeLlmRouter,
  governance-client logging, PROVISIONAL banners.
- Block E — mediums in section order §4→§5→§6→§2→§3→§7→§8.
  34 closed.
- Block F — lows in section order §4→§5→§6→§2→§3→§7→§8.
  19 closed (with `**architect-blocked**` / `**verified-no-action**`
  for the 5 that are not code-actionable).
- Block G — informational findings → verified-no-action with
  one-paragraph rationale per finding.

---

## 3. What changed at the workspace level

These are the workspace-scoped artefacts that survived the audit and
will keep paying dividends after this branch lands.

### New CI lints (4)

All wired into `.github/workflows/phase-gate.yml`. Each is a one-script
mechanical check that catches a class of drift the audit surfaced:

- `scripts/check-env-vars.ts` (AUDIT-019/-020/-073) — diffs
  `process.env.*` references against `.env.example` keys with a
  closed allowlist of Phase-2-reserved keys.
- `scripts/check-weaknesses-index.ts` (AUDIT-075) — keeps
  `docs/weaknesses/INDEX.md` aligned with the `W-*.md` files on disk
  (per-row severity, severity tally, header count).
- `scripts/check-migration-pairs.ts` (AUDIT-051) — every new
  `packages/db-postgres/drizzle/NNNN_*.sql` must ship a paired
  `*_down.sql`, with a closed allowlist of legacy forward-only
  migrations.
- `scripts/check-test-coverage-floor.ts` (AUDIT-069) — every new
  app under `apps/*/` must ship at least one test file. Closed
  allowlist of 10 legacy zero-test workers.

These four lints share the same shape: a code allowlist that can
**only shrink**, not grow.

### New observability metrics (4)

All emitted from the existing `@vigil/observability` registry; all
named in the canonical `vigil_<domain>_<unit>_<aggregation>` form:

- `vigil_pattern_eval_duration_ms{pattern_id, outcome}` (AUDIT-059)
  — distinguishes ok / timeout / error / invalid_result.
- `vigil_federation_keys_loaded{directory}` (AUDIT-013) — alertable
  signal when the receiver runs with zero peer keys.
- `vigil_federation_flush_lag_seconds`, `vigil_federation_pending_envelopes`,
  `vigil_vault_token_renew_failed_total` (AUDIT-056, -058) — federation
  back-pressure + Vault-token-renewal observability.
- `vigil_tip_turnstile_verify_total{outcome}` (AUDIT-015) — Cloudflare
  outage vs user-is-bot — different runbook responses.
- `vigil_worker_last_tick_seconds{worker}` (AUDIT-076) — drives the
  generic `WorkerLoopStalled` alert that covers every WorkerBase
  worker without per-worker hand-crafting.

### New Prometheus alerts (1)

- `WorkerLoopStalled` (AUDIT-076) — `time() - vigil_worker_last_tick_seconds
  > 3600` for 5 m. Catches every worker, present and future.

### New typed errors (3)

- `RevokedKeyError` (AUDIT-007) — federation key resolver short-circuits
  to `null` on CRL hit instead of falling through to a stale directory
  layer.
- `DeadLetterNotFoundError` (AUDIT-005) — typed 404-mapping error from
  the dead-letter batch UPDATE.
- `ProposalNotEligibleError` (AUDIT-006) — typed 409-mapping error from
  the adapter-repair proposal decide path.
- `InvalidWebauthnOriginError` (AUDIT-038) — names the bad
  WEBAUTHN_RP_ORIGIN entry.

### Test additions (selected)

The branch adds ~85 net new test cases. Highlights:

- `packages/governance/__tests__/quorum-edge-cases.test.ts` — 22 cases
  (boundary, tie-break, Constants integrity).
- `packages/governance/__tests__/abi.test.ts` + `governance-client.test.ts`
  — 31 cases (every function selector + every event topic-hash pinned).
- `packages/dossier/__tests__/render.test.ts` + `sign.test.ts` — 18
  cases (caught a real canonicalisation bug — `Object.keys(input).sort()`
  was being passed as a JSON.stringify replacer-allow-list, silently
  filtering nested fields).
- `packages/satellite-client/__tests__/aoi-edge-cases.test.ts` — 24
  cases (equator, dateline, near-pole, ring closure, NaN+Infinity).
- `apps/dashboard/__tests__/doc-banners.test.ts` — regression tests
  for the AUDIT-017/-018/-071/-072/-074 doc banners.
- `apps/worker-federation-receiver/test/integration.test.ts` —
  500-envelope burst test for the no-silent-drop contract.

### Doctrine documents (1)

- `docs/source/TAL-PA-DOCTRINE-v1.md` — the binding doctrine for
  DECISION-012 (Total Action Logging with Public Anchoring; "the
  watcher is watched").

---

## 4. Patterns the audit surfaced

Five recurring shapes across the 70 closed findings. Each is
documented here so future audits don't re-discover them.

### Pattern 1 — Phase-1 description was wrong, but scope was right

**5 findings**: AUDIT-027 (worker-extractor was already routed via
SafeLlmRouter; the bypass was in worker-counter-evidence's narrative
path), AUDIT-044 (toLowerCase is locale-invariant per ES spec, not
locale-dependent — but the regex allow-list also rejects non-ASCII
input ahead of the call), AUDIT-053 (the "no logger" claim was wrong;
the missing piece was the staticCall wrapper, not the field), AUDIT-061
& -064 ("no test file" — files existed; the gap was edge-case
coverage), AUDIT-038 (the WEBAUTHN_RP_ORIGIN consumer is in the vote
route, not middleware).

**Fix shape**: each closure carried an explicit "Reframing during
execution:" note in both the AUDIT.md description and the commit body.
Scope unchanged.

### Pattern 2 — "Swallow the secondary signal"

**4 findings (AUDIT-012/-013/-014/-015)**: production code did the
right thing on the load-bearing path but ate the secondary signal,
leaving oncall blind to recurring-but-non-fatal problems.

**Fix shape**: log the swallowed error at the right level (`debug` /
`info` / `warn`) AND surface a labelled metric so an alert can fire
on the metric, not the log. Each finding got both halves.

### Pattern 3 — "Magic boolean is fine until it isn't"

**Several findings**: VIGIL_FEDERATION_INSECURE_OK (AUDIT-041) was a
single-flag gate; AUDIT-038 split origins on `,` without normalising;
AUDIT-001/-002/-003 had `_ENABLED` without a paired `_MOU_ACK`.

**Fix shape**: layer a second guard for the production blast-radius
(NODE_ENV=production), normalise via the standard library
(`new URL(s).origin`, `Number.isFinite`), or pair the user-control
flag with a deeper institutional gate.

### Pattern 4 — "Test pins the easy half, misses the load-bearing half"

**AUDIT-068**: `toMatchObject({ payload: { request_id: ... }})` — the
test asserted one field of the publish envelope and missed the rest.
A regression that dropped any other field would have passed.

**Fix shape**: snapshot or `toEqual` the full payload contract at the
boundary; partial-match tests are appropriate for "is this set",
useless for "are all of these set".

### Pattern 5 — "Drift hazard, not exploit"

**Several documentation findings (AUDIT-072..-077)** + the four CI
lints they motivated. The pattern: a doc says X, the code does Y, no
mechanism exists to keep them aligned.

**Fix shape**: a CI script that reads both ends of the drift and
fails CI when they disagree, with a closed allowlist for
intentional gaps. The allowlist can only shrink.

---

## 5. Remaining work — tracked deferrals

The 13 items still flagged in `AUDIT.md` are NOT bugs — every one is
a tracked-deferral with a clear architect / Phase / institutional
gate. Reproduced here for one-stop visibility:

### Architect read-through (3)

- **AUDIT-022** — DECISION-008 PROVISIONAL → FINAL (12-layer
  anti-hallucination + Bayesian engine; ~15 packages depend).
- **AUDIT-023** — DECISION-012 PROVISIONAL → FINAL (TAL-PA / Total
  Action Logging with Public Anchoring; quarterly export cron is live).
- **AUDIT-088** — needs-human-confirmation (architect product call).

### Architect product call (1)

- **AUDIT-032** — tip-operator-key rotation cadence (operator long-term
  libsodium key; needs an architect decision: 90 d / quarterly / coupled
  to council rotation).

### Institutional gate (5; documented in §9)

- **AUDIT-079** — Phase-3 regional-node Helm chart dormant until
  council 4-of-5 vote + CEMAC funding.
- **AUDIT-080** — CONAC subdomain (`vigil.gov.cm`) pursuit.
- **AUDIT-081** — backup-architect onboarding (architect names + retainer).
- **AUDIT-082** — architect-unreachable >14 d protocol DR rehearsal.
- **AUDIT-083** — `FABRIC_PEER_ENDPOINT` cross-witness gated on
  Phase-2 Cour des Comptes MOU.

### Pure deferrals (4)

- **AUDIT-025** — 9th deep-cold YubiKey (architect names off-jurisdiction
  safe-deposit-box location).
- **AUDIT-026** — ZK-proof circuits (Phase-4).
- **AUDIT-084** — same.
- **AUDIT-085** — Phase-1 closeout activity log.
- **AUDIT-086** — OPERATIONS / CLAUDE style-guide alignment.
- **AUDIT-087** — research follow-up.

---

## 6. Recommended hardening (post-audit)

These are NOT included in this audit's scope but were noted in passing
during execution. Architect can prioritise:

1. **Promote DECISION-008 + DECISION-012 to FINAL** (closes AUDIT-022/-023
   and removes the AUDIT-071 blockquote banners). Single read-through
   session; mechanical from there.

2. **Decide tip-operator-key rotation cadence** (AUDIT-032). Proposed
   default: 90 d to mirror the federation-signer (DECISION-014c). Code
   change is one runtime check at `/api/tip/public-key`; test is one
   case asserting refusal past max-age.

3. **Backfill the legacy zero-test apps** (AUDIT-069 allowlist).
   Removing items from the allowlist as workers acquire smoke tests
   is a one-line PR per worker.

4. **Backfill the legacy forward-only migrations** (AUDIT-051 allowlist).
   Same shape: a `_down.sql` per legacy NNNN.

5. **Adjust the AUDIT-070 ratchet** — set a CI floor on test/src ratio
   per workspace, ratchet up over time. (Shape: another lint script
   wired into phase-gate.yml; same as the four already added.)

6. **Cohort the Block-A test additions into the architect's review
   queue** — the 95 new test cases under `packages/governance`,
   `packages/dossier`, `packages/satellite-client` document the
   architect's intended invariants and are worth a read-through pass.

---

**Generated**: 2026-04-30
**Branch**: `audit/phase-2-execution` (~96 commits ahead of `main`)
**Source of truth**: `AUDIT.md`

---

## Phase-3 post-closure rescan addendum (2026-04-30, same day)

After Phase-2 closure landed on `main`, a fresh end-to-end rescan was
run against the same scope using the original Phase-1 grep patterns
(see `AUDIT.md` §10). Two new findings surfaced — both class-matches
with closed Phase-2 findings on different code paths the original
sweep didn't reach.

### Headline numbers

- **New findings authored**: 2 (1 high, 1 medium)
- **Fixed by code change**: 2 / 2 (both)
- **Architect-blocked / needs-human-confirmation**: 0
- **Out-of-scope**: 0

### Fixes shipped

| ID        | Severity | Commit  | Test count                                           | Class-match with |
| --------- | -------- | ------- | ---------------------------------------------------- | ---------------- |
| AUDIT-092 | high     | 1deca6f | 11 cases (boundary + uniformity + 4 source-grep)     | AUDIT-029        |
| AUDIT-093 | medium   | 0304fba | 13 cases (defaults + happy + oversize + source-grep) | AUDIT-036        |

### Patterns observed

The same two recurring weakness classes called out in §4 of the main
report (RNG choice and external-input bounds) re-surfaced on code
paths Phase-1 didn't index:

1. **Non-cryptographic RNG on adversarial paths**. AUDIT-029 closed
   `packages/adapters/src/fingerprint.ts`; AUDIT-092 closed
   `apps/adapter-runner/src/triggers/verbatim-audit-sampler.ts`. Both
   used `Math.random`. The rescan suggests a project-wide lint rule
   banning `Math.random` outside an explicit allow-list of UI-only
   modules (a `no-restricted-syntax` ESLint rule keyed on the
   identifier path) would prevent the next instance.

2. **Unbounded external-input consumption**. AUDIT-036 capped the
   federation-receiver CRL parse; AUDIT-093 capped the adapter-runner
   network helpers. Both consumed bytes from a network peer with no
   pre-cap. A workspace-wide lint rule banning
   `\.body\.text\(\)`/`\.body\.json\(\)` outside a small bounded-fetch
   allow-list would prevent the next instance.

### Recommended hardening (additions to §6 of the main report)

7. **Add an ESLint `no-restricted-syntax` rule banning `Math.random`
   in code under `apps/` and `packages/` outside an explicit
   `// eslint-disable-next-line  -- ui-only-rng` opt-out comment.** The
   only legitimate uses today are the worker `instanceId` (worker.ts),
   the Anthropic batch `customId` (anthropic.ts), and the toast `id`
   (toast.tsx) — three sites, all UI/log-disambiguation. A targeted
   restriction catches every regression of the AUDIT-029 / AUDIT-092
   class.

8. **Add a similar rule banning `await .body.text()` / `.body.json()`
   on undici responses outside `_bounded-fetch.ts` and the
   federation-receiver bounded path.** Keeps the AUDIT-036 / AUDIT-093
   class closed by mechanical CI rather than reviewer attention.

### Process note

The rescan cost ~30 minutes of grep-and-read against a repo where the
prior 91-finding pass had run earlier the same day, and surfaced 2
real findings. That 2 % residual rate after a thorough audit aligns
with the rescan cadence in the original audit prompt
("After every fifth finding closed, re-run the original Phase-1
patterns") and supports keeping that cadence as a permanent practice
during long-running audits.
