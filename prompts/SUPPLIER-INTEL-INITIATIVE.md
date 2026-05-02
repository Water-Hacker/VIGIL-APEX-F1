# PROMPT — Supplier-intelligence layer (M5 hardening expansion)

> **Use:** hand this entire file to a fresh Claude Code session when this
> initiative re-opens. The agent reads it as its operating contract for
> the session.
>
> **Drafted:** 2026-05-01. Architect-revised the same day with two
> applied revisions (Revision 1: new DECISION-N as PROVISIONAL not
> FINAL; Revision 2: Sub-Block 4 data-residency precondition for
> Google Maps API). Both revisions are baked into this file as written.
>
> **Status:** parked. Initiative cannot start until preconditions land
> (see PRECONDITIONS section). Architect-carry items: DECISION-012
> promotion, §30 architect-decisions, then the unblock sequence
> (§30 merge into SRD-v3.md → Block-E plan-first → Block-E close).
> Earliest realistic re-open: post-Block-E.

---

## ROLE

You are the build agent for a new feature initiative on VIGIL APEX:
the supplier-intelligence layer. The work strengthens the platform's
detection of local-supply fraud (the bribed-shop scenario) using
data and signals already accessible without new institutional
partnerships. This is the largest single feature initiative since
Phase 1 began. Halt discipline is non-negotiable.

## PRECONDITIONS — REFUSE TO START IF UNMET

Per CLAUDE.md phase-gate rules, refuse and explain if any of these
are not true:

1. Block E has closed. `BLOCK-E-COMPLETION-SUMMARY.md` exists,
   architect has signed off, all Block E commits are merged to
   main.
2. DECISION-012 (TAL-PA) is FINAL, not PROVISIONAL. The
   calibration audit-of-audit chain depends on TAL-PA being
   binding for any new patterns the supplier-intel work emits.
3. SRD §30 enumeration architect-decisions have been applied
   and merged. Any new milestone-exit-test (AT-NNN) entries
   for this work depend on the §30 framework being
   architect-blessed.
4. The Phase-1 M5 hardening gate has not yet closed (M5 exit
   requires "Pentest critical findings = 0; DR restore < 6h"
   per TRUTH §J). This work is M5-HARDENING-EXPANSION; if M5
   has already exited, this becomes Phase-2 entry work and
   requires CONAC engagement-letter countersignature first.

If any precondition is unmet, write a one-paragraph explanation,
do NOT generate code, halt.

## MANDATORY LOAD AT SESSION START

Before any other action, in this order:

1. `TRUTH.md` (especially §J phasing, §C source/pattern counts,
   §I tech stack)
2. `CLAUDE.md` (operating doctrine)
3. `docs/source/SRD-v3.md` (especially §10 source catalogue,
   §13 anti-scraping guardrails, §21 patterns, §30 acceptance)
4. `docs/source/AI-SAFETY-DOCTRINE-v1.md`
5. `docs/source/TAL-PA-DOCTRINE-v1.md`
6. `docs/decisions/log.md` (every committed DECISION)
7. `docs/weaknesses/INDEX.md`
8. `ROADMAP.md` (so this work doesn't bleed into Phase 2/3/4
   scope inadvertently)
9. `THREAT-MODEL-CMR.md`
10. `AUDIT.md` and `AUDIT-REPORT.md`
11. The full `apps/worker-pattern`, `packages/patterns`,
    `packages/certainty-engine`, `packages/adapters`, `packages/llm`
    trees — read every src/ file. You will be adding patterns,
    adapters, and a new worker; you must understand the
    existing shape thoroughly before designing.
12. The existing OSINT-adjacent packages: `packages/adapters`
    (proxy, rate-limit, robots, fingerprint, first-contact),
    to understand the existing scraping discipline.

Confirm load with a one-page summary. Halt for "GO" before
proceeding to any further step.

## INITIATIVE SCOPE — WHAT YOU ARE BUILDING

A new worker (`worker-supplier-intel`) and five new patterns
(P-B-008 through P-B-011 and P-C-007) that strengthen detection
of local-supply fraud through:

- Supplier behavior-graph analysis on existing RCCM data
- Statistical anomaly detection on supplier invoice patterns
- Cross-project material-volume aggregation analysis
- Open-source intelligence (OSINT) on suppliers' online
  presence, with strict source allowlisting

This work uses ONLY data the platform already has access to OR
can obtain from approved OSINT sources without violating
terms of service. It introduces NO new institutional partnership
dependency.

Expected detection-rate improvement against local-supply fraud:
~30-40% baseline rises to ~60-70% with this work deployed.
Calibration will confirm or revise this estimate.

## NON-NEGOTIABLES

- All five patterns follow the existing `PatternDef` shape from
  `packages/patterns/src/types.ts`. Pure `detect()` functions over
  `SubjectInput`. No state-mutation in patterns.
- The new worker follows the `WorkerBase` shape from
  `packages/queue`. No new architectural primitive.
- Postgres remains source of truth. Every new signal commits
  to Postgres BEFORE any stream emit (SRD §15.1 invariant).
- Every LLM call (if any) routes through SafeLlmRouter with a
  registered prompt template. Direct `LlmRouter.call` is
  forbidden per the SafeLlmRouter coverage lint
  (`scripts/check-safellm-coverage.ts`).
- Every new pattern integrates with the existing Bayesian
  certainty engine via the standard `CertaintyComponent` shape.
  No bypass of the 5-source provenance-root minimum.
- Every new adapter respects `packages/adapters/src/robots.ts`,
  `rate-limit.ts`, and the first-contact protocol per SRD §13.
- Every new external data source carries an explicit ToS
  review note in its adapter file's header comment, citing
  the source's robots.txt and ToS at the time of
  implementation. Sources that prohibit automated access are
  NOT scraped; the corresponding pattern is shipped as a
  no-op until institutional API access is arranged.

## OSINT SOURCE ALLOWLIST AND PROHIBITION

**ALLOWED — scrape with adapter discipline:**

- WHOIS / RDAP for supplier-claimed website domains
  (registries publish this; widely permissible)
- DNS records for supplier-claimed domains
- Public certificate transparency logs for supplier domains
- Wayback Machine (Internet Archive) for historical website
  snapshots (explicitly permits archival access)

**ALLOWED — API only, never scrape:**

- Google Maps / Places API for Street View imagery and Business
  listings (Maps Static API at ~$2/1000 calls; budget cap
  enforced via cost tracker). **GATED ON SUB-BLOCK 4
  DATA-RESIDENCY DECISION-LOG ENTRY** — see Sub-Block 4
  preconditions.
- Bing Maps API as fallback if Google rate-limits (also gated
  on the same data-residency decision-log entry; same US
  jurisdiction).
- OpenStreetMap (Overpass API; budget-friendly, ToS-clean,
  no data-residency constraint).

**PROHIBITED — do not implement adapters for these:**

- LinkedIn (aggressive anti-scraping enforcement; ToS prohibits
  automated access)
- Facebook / Meta properties (ToS prohibits)
- X / Twitter (post-2023 ToS prohibits without paid API tier;
  paid tier is out of scope)
- Google Search results page scraping (use the Custom Search
  JSON API instead, with budget cap)

If during implementation you find a source not on either list,
HALT and surface the ToS judgment to the architect. Do not
auto-classify.

## WORK STRUCTURE — SIX SUB-BLOCKS, EXECUTED IN ORDER

You execute Sub-Block 1 → 2 → 3 → 4 → 5 → 6. Each sub-block has
acceptance criteria. Do not start the next until the previous
is acceptance-green and architect has reviewed.

Each sub-block produces:

- A planning document at
  `docs/work-program/SUPPLIER-INTEL-{N}-PLAN.md` BEFORE any
  code change in that sub-block. STOP for architect review
  after writing the plan.
- One commit per logical unit. Conventional Commits, signed,
  Co-Authored-By tag.
- At sub-block close, a status update appended to
  `docs/work-program/PHASE-1-COMPLETION.md` (or
  `PHASE-1-M5-EXPANSION-COMPLETION.md` per the framing
  below). Halt for review.

---

## SUB-BLOCK 0 — TRUTH amendment and scoping

The first commit of this initiative is a `TRUTH.md` amendment
declaring this work as M5-HARDENING-EXPANSION inside Phase 1.

The amendment must:

- Add a new row to TRUTH §J:
  > "M5-X (M5 hardening expansion) — supplier-intelligence layer.
  > 5 new patterns, 1 new worker, OSINT adapter set. M5 exit
  > gate now includes the supplier-intel acceptance criteria
  > in §30."
- Add a new entry to the decision log:
  > DECISION-{next-free-N} "Supplier-intelligence layer as M5
  > hardening expansion." Reference this prompt as the source.
  >
  > **Status: PROVISIONAL** — the architect promotes to FINAL
  > via a separate signed commit after read-through, matching
  > the established pattern of DECISION-001 through
  > DECISION-016. The agent does NOT self-promote; this
  > preserves the chain-of-binding convention. The decision-
  > log entry's body lists the architect-action item: "promote
  > to FINAL after read-through" (same row as the agent has
  > used for DECISION-012 et al).
- Update §30 enumeration to add new AT-M5-X-NN acceptance
  tests covering the five new patterns and the new worker.
  Each AT entry follows the architect-blessed §30 shape from
  Block E.

This first commit, and only this commit, is the precondition for
all subsequent code changes. No new code lands until the
amendment is committed and architect-acknowledged.

**ACCEPTANCE:** TRUTH amended, decision-log entry committed as
PROVISIONAL with architect-promotion-action item documented,
§30 enumeration extended, `scripts/check-source-count.ts` and
`scripts/check-decision-cross-links.ts` both still green. Halt
for architect review.

---

## SUB-BLOCK 1 — Behavior-graph analysis on existing data

No new external data sources. Pure analysis of existing RCCM,
procurement-portal, and entity-relationship data.

**Deliverables:**

- A new analytics module at
  `packages/patterns/src/_supplier-graph.ts` (pure functions,
  no I/O, fully testable) implementing:
  - `customerConcentration(supplierId): Promise<number>`
    — fraction of supplier's invoice value going to a
    single contractor over the trailing 24 months.
  - `graphCluster(supplierId): Promise<ClusterDescriptor>`
    — graph-walk that returns the cluster of suppliers
    sharing addresses, beneficial owners, registration
    period, or both with the input supplier.
  - `temporalProximity(supplierIds[]): number` — measures
    how tightly a set of suppliers cluster in registration
    date.

- A read-only repo at
  `packages/db-postgres/src/repos/supplier.ts` wrapping the
  existing `entity.canonical` and `entity.relationship` tables
  for supplier-specific queries. Does NOT introduce new
  schema.

- Two new patterns:
  - **P-B-008 supplier-customer-concentration** —
    defaultPrior 0.15, defaultWeight 0.6. Fires when
    `customerConcentration > 0.8`.
  - **P-B-009 supplier-graph-cluster** — defaultPrior 0.20,
    defaultWeight 0.7. Fires when `graphCluster` returns
    a cluster of size >= 3 with shared address OR shared
    beneficial owner OR `temporalProximity < 30 days`.

- Test fixtures (positive + negative) for each pattern in
  `packages/patterns/test/`.

- Calibration entries in
  `infra/certainty/likelihood-ratios.json` for both patterns
  (start with conservative LR estimates; quarterly
  calibration will adjust).

- Pattern registration in
  `packages/patterns/src/register-all.ts`.

**ACCEPTANCE:**

- Build/typecheck/test/lint all green.
- Pattern coverage gate (`check-pattern-coverage.ts`) green.
- At least one synthetic fixture per pattern that produces a
  `matched=true` result and at least one that produces
  `matched=false`.
- The legacy registry version increments correctly so existing
  assessments are NOT recomputed automatically.

Halt for architect review at sub-block close.

---

## SUB-BLOCK 2 — Statistical anomaly detection

Detects suspicious supplier invoice patterns over time using
existing procurement data only.

**Deliverables:**

- A new analytics module at
  `packages/patterns/src/_supplier-statistics.ts` implementing:
  - `historicalInvoiceProfile(supplierId): Profile` —
    cadence, value distribution, audit-threshold-proximity
    clustering, monthly aggregates over trailing 36 months.
  - `volumeAnomaly(supplierId, currentInvoice): AnomalyScore`
    — z-score of currentInvoice value against historical
    distribution, with adjustment for genuine business growth.
  - `thresholdProximity(invoiceValue, jurisdiction): ProximityScore`
    — distance to known audit thresholds (currently 100M XAF
    and 500M XAF in Cameroon per MINFI rules; sourced from a
    small registry at `infra/certainty/audit-thresholds.json`).

- One new pattern:
  - **P-B-011 supplier-volume-implausible** —
    defaultPrior 0.25, defaultWeight 0.65. Fires when
    `volumeAnomaly` z-score > 3.0 OR `thresholdProximity`
    within 5% of an audit threshold AND no comparable
    historical proximity in the supplier's profile.

- One new pattern:
  - **P-B-010 supplier-no-online-footprint** — DEFERRED to
    Sub-Block 4 (depends on OSINT layer).

- A small reference registry
  `infra/certainty/audit-thresholds.json` with the current
  Cameroonian thresholds and a header citation to MINFI's
  public guidance documents.

- Test fixtures and calibration entries as in Sub-Block 1.

**ACCEPTANCE:** same shape as Sub-Block 1, halt for review.

---

## SUB-BLOCK 3 — Cross-project aggregation

Detects implausible aggregate material claims across a
contractor's full project portfolio.

**Deliverables:**

- A new analytics module at
  `packages/patterns/src/_aggregation.ts` implementing:
  - `contractorAggregateClaims(contractorId, materialType, windowMonths): Aggregate`
    — total claimed quantity of a given material across all
    projects in window.
  - `plausibleCapacity(contractorId): Capacity` — estimated
    operational capacity from declared workforce, equipment
    registry (where available), and historical execution rate.
  - `supplierAggregateSupply(supplierId, materialType, windowMonths): Aggregate`
    — total quantity supplied across all customers (a sanity
    check on the supplier side).

- One new pattern:
  - **P-C-007 cross-project-quantity-aggregation** —
    defaultPrior 0.20, defaultWeight 0.7. Fires when
    `contractorAggregateClaims` exceeds `plausibleCapacity` by
    > 1.5× OR when `supplierAggregateSupply` exceeds the
    > supplier's declared inventory turnover capacity (where
    > observable from RCCM declared activity scope).

- Test fixtures and calibration entries as before.

**ACCEPTANCE:** same shape, halt for review.

---

## SUB-BLOCK 4 — OSINT adapter set and one new pattern

This is the highest-risk sub-block. Read it carefully before
implementing.

### PRECONDITION FOR SUB-BLOCK 4 — data-residency decision-log entry

Before the `GOOGLE_MAPS_API_KEY` is provisioned in Vault, a
decision-log entry MUST exist documenting:

- The data-residency tradeoff: Cameroonian sovereign
  procurement-monitoring data flowing to Google
  US-jurisdictional infrastructure for supplier-address
  verification.
- Mitigations in place:
  - Public addresses only (RCCM-declared headquarters), no PII.
  - Rate-limited per the existing adapter rate-limit
    discipline.
  - Budget-capped at USD 5/day (`OSINT_GOOGLE_DAILY_USD_CEILING`,
    configurable).
  - Soft-fails to OpenStreetMap fallback when the ceiling is
    reached or the architect has not yet signed.
- Architect approval (signed promotion of the entry to FINAL).

The decision-log entry follows the same shape as the C9 gap 5
Hetzner data-residency entry from Block E (operator-managed
paid third-party with data-flow implications; same architect-
signed pattern).

**Until the architect signs that decision-log entry to FINAL,
Sub-Block 4 ships with OpenStreetMap-only coverage** and the
supplier-intel no-online-footprint pattern (P-B-010) accepts
the weaker signal — `has_google_places` defaults to `false`
and `street_view_match` defaults to `false` for every
supplier. The OSM-only path satisfies the pattern's AND-of-
four-conditions gate just as a populated Google Places result
would; the marginal signal of Google Places presence is what's
deferred, not the ability to fire the pattern.

The agent MUST NOT provision `GOOGLE_MAPS_API_KEY` in Vault
until the entry is FINAL. The agent MUST NOT instantiate the
`google-places.ts` adapter against the live API until the
entry is FINAL. The agent MAY ship the adapter code with a
disabled-by-default flag (`OSINT_GOOGLE_PLACES_ENABLED=false`
in `.env.example`) so the adapter exists in the tree without
making any network call.

### Deliverables

- Three new adapters under
  `apps/adapter-runner/src/adapters/`, following the existing
  adapter base class shape:
  - `whois-rdap.ts` — RDAP queries for supplier-claimed
    domains. Uses ARIN/RIPE/AFRINIC RDAP endpoints
    directly (not scraping). Rate-limited per registry.
  - `cert-transparency.ts` — `crt.sh` JSON API queries for
    supplier domain certificate history. Rate-limited.
  - `wayback-archive.ts` — Internet Archive availability
    API queries for historical snapshots of supplier
    websites. Wayback's CDX API is the documented permitted
    access method.

- A separate API-only adapter (NOT a scraper):
  - `google-places.ts` — Google Maps Places API and Maps
    Static API integration for supplier-claimed addresses.
    Uses an architect-provided `GOOGLE_MAPS_API_KEY` in
    Vault (gated on the data-residency decision-log entry
    above). Cost-tracked through the existing `CostTracker`
    infrastructure with a daily budget ceiling
    (default: USD 5/day, configurable via
    `OSINT_GOOGLE_DAILY_USD_CEILING`). Soft-fails to
    OpenStreetMap fallback when ceiling reached.

- A no-op stub adapter:
  - `supplier-osm-fallback.ts` — Overpass API queries for
    supplier addresses when Google Places is unavailable
    or budget-capped (or until the data-residency decision
    is FINAL).

- The new worker:
  - `apps/worker-supplier-intel/` — full WorkerBase-shaped
    worker that consumes from a new Redis stream
    `STREAMS.SUPPLIER_INTEL_REQUEST`, runs the four OSINT
    adapters in parallel, builds an intel profile, writes
    to a new Postgres table `entity.supplier_intel_profile`,
    and emits to `STREAMS.SUPPLIER_INTEL_PROFILED` for
    pattern dispatch to consume.

- The new schema:
  - `packages/db-postgres/drizzle/00NN_supplier_intel.sql`
    (and `_down.sql`) creating `entity.supplier_intel_profile`
    with columns: `supplier_id`, `has_website` (boolean),
    `domain_age_days` (int), `has_google_places` (boolean),
    `google_places_score` (numeric, 0-1), `street_view_match`
    (boolean), `wayback_first_snapshot_date` (date),
    `cert_transparency_first_seen` (date), `profile_built_at`
    (timestamptz), `provenance` jsonb.

- One new pattern:
  - **P-B-010 supplier-no-online-footprint** —
    defaultPrior 0.30, defaultWeight 0.55. Fires when:
    1. `has_website == false` AND
    2. `has_google_places == false` AND
    3. `wayback_first_snapshot_date` is null OR
       within 30 days of the project tender date AND
    4. `cert_transparency_first_seen` is null OR
       within 30 days of the project tender date.

    The pattern requires ALL four conditions to fire — a
    weak but very specific signal.

- SafeLlmRouter integration: if any LLM analysis is
  introduced (e.g., for image-classifying Street View tiles
  to determine if the address looks commercial), it MUST
  route through SafeLlmRouter with a registered prompt
  template at `apps/worker-supplier-intel/src/prompts.ts`.
  Prompt name: `supplier-intel.streetview-classify`.

- Comprehensive ToS review file:
  - `docs/external/OSINT-TOS-REVIEW.md` documenting, per
    source, the URL of the ToS at time of implementation,
    the specific ToS clauses governing automated access,
    the access pattern the platform uses, and the rate-
    limit / budget compliance approach.

### ACCEPTANCE for Sub-Block 4

- All previous gates green.
- The `check-safellm-coverage` lint green (any LLM call routed
  through SafeLlmRouter).
- The new worker passes the `WorkerLoopStalled` metric check.
- Cost tracker correctly attributes Google Maps API spend (when
  enabled per the data-residency decision).
- `OSINT-TOS-REVIEW.md` complete.
- Integration test against a synthetic supplier produces a
  profile with all four columns populated (Google-side columns
  default to false / null when the architect has not signed
  the data-residency entry).
- Halt for architect review at sub-block close.

---

## SUB-BLOCK 5 — Bayesian engine integration and end-to-end test

Wire the five new patterns into the existing certainty engine
and prove the end-to-end flow produces calibrated posteriors.

**Deliverables:**

- Update the dispatch pipeline so worker-pattern correctly
  invokes the five new patterns alongside the existing 43.
  Pattern count rises from 43 to 48; update TRUTH §C and
  `PHASE-1-COMPLETION.md`.

- Independence-weight registry update at
  `infra/certainty/independence-weights.json` adding pairwise
  independence weights between the new patterns and the
  existing ones. Conservative starting weights (0.6-0.8 for
  semantically-related pairs, 1.0 for unrelated pairs). Each
  new entry carries a one-line rationale comment.

- End-to-end fixture in `scripts/run-e2e-fixture.ts` extended
  to cover a synthetic local-supply fraud scenario. The
  fixture should produce a finding where:
  1. at least three of the five new patterns fire
  2. the Bayesian posterior crosses the 0.85 escalation
     threshold ONLY when combined with at least one
     prior pattern (verifying that the new patterns
     contribute but don't trigger escalation alone)
  3. the 5-source minimum on independent provenance roots
     is respected

- Calibration registry version increment from current to
  next minor version. Document the increment in
  `docs/decisions/log.md`.

- New synthetic-failure test entries verifying the new
  patterns are subject to the existing CI lints (pattern
  coverage, fixture pairing, calibration entry presence).

**ACCEPTANCE:**

- All workspace gates green: build, typecheck, test, lint.
- Pattern count = 48 in tree, in TRUTH, in PHASE-1-COMPLETION.
- Source-count coherence lint green.
- End-to-end fixture green, including the new local-supply
  scenario.
- Halt for architect review.

---

## SUB-BLOCK 6 — Documentation, runbooks, observability

The work is complete only when an operator can run it without
the architect's mediation.

**Deliverables:**

- `docs/runbooks/worker-supplier-intel.md` following the
  Block-C runbook template.
- `docs/patterns/catalogue.md` regenerated to include the five
  new patterns (the generator from Block-C C.1 should produce
  this automatically; verify).
- Five new Grafana panels added to the existing dashboards:
  - Supplier intel profile completeness (count of suppliers
    with profile vs without)
  - OSINT adapter health (per-adapter success rate)
  - Google Maps API spend (daily, against ceiling) — only
    populated when the data-residency entry is FINAL
  - Per-pattern fire rate for P-B-008..P-B-011 + P-C-007
  - Pattern-fire correlation matrix updated to include the
    new patterns

- Two new Prometheus alerts:
  - `vigil_supplier_intel_profile_lag_seconds` — alerts when
    suppliers in `entity.canonical` have no profile after 24h
  - `vigil_osint_adapter_failure_rate_high` — alerts when
    any OSINT adapter exceeds 20% failure rate over 1h

- Updated `AI-SAFETY-DOCTRINE-v1.md` if any new layer guarantees
  are introduced (none expected; if introduced, halt and
  surface to architect because doctrine changes are
  architect-blocked).

- `SUPPLIER-INTEL-COMPLETION-SUMMARY.md` at
  `docs/work-program/`, summarising:
  - Total commits, sub-block by sub-block
  - Detection-rate measurement methodology and initial
    observed rate against the labelled set
  - Calibration drift analysis
  - Known limitations
  - Architect-action items, including the standing
    "promote DECISION-{N} from PROVISIONAL to FINAL"
    item from Sub-Block 0 if not yet done, and the
    standing "sign Google Maps data-residency entry to
    FINAL" item from Sub-Block 4 if not yet done.

**ACCEPTANCE:**

- All workspace gates green.
- Runbook reviewable and operator-actionable.
- Dashboards render correctly.
- Alerts fire correctly under synthetic conditions.
- Halt for architect review at initiative close.

---

## COMPLETION CRITERIA — initiative-level

The initiative is complete when ALL of these are true:

1. TRUTH.md amended; DECISION-{N} **PROVISIONAL** committed
   (architect promotes to FINAL post-completion); §30 extended.
2. Five new patterns shipped, registered, fixture-paired,
   calibration-entered, lint-green.
3. New worker shipped, runbook published, dashboards updated,
   alerts wired.
4. Four new adapters shipped, each with ToS review (Google
   Places adapter ships with code present + disabled flag if
   the data-residency decision-log entry is not yet FINAL).
5. Schema migration shipped with paired down migration.
6. End-to-end fixture extended with local-supply scenario,
   green.
7. SafeLlmRouter coverage maintained (any new LLM calls
   routed through SafeLlmRouter).
8. All existing CI lints remain green.
9. `SUPPLIER-INTEL-COMPLETION-SUMMARY.md` written, with
   architect-action items section listing any still-PROVISIONAL
   items (DECISION-{N} promotion; data-residency entry).
10. `PHASE-1-COMPLETION.md` updated (M5 exit criteria now
    include this work's acceptance).

## WHAT NOT TO DO

- Do not implement adapters for prohibited sources.
- Do not bypass SafeLlmRouter for any LLM call.
- Do not introduce new architectural primitives. Use
  WorkerBase, PatternDef, the existing adapter base, the
  existing certainty engine.
- **Do not promote DECISION-N from PROVISIONAL to FINAL on
  behalf of the architect.** Write the new DECISION-N as
  PROVISIONAL. The architect promotes to FINAL via a separate
  signed commit after read-through, matching the established
  pattern of DECISION-001 through DECISION-016.
- **Do not provision `GOOGLE_MAPS_API_KEY` in Vault before
  the data-residency decision-log entry is FINAL.** Ship the
  Google Places adapter code with a disabled flag; the OSM
  fallback handles the no-online-footprint pattern in the
  meantime.
- Do not exceed the engineering scope. The work is
  ~12-15 weeks of effort for one engineer. If you find
  yourself near 25 weeks of effort or 50+ commits, halt
  and surface scope.
- Do not invent OSINT sources beyond the allowlist. If you
  find a source you believe should be on the allowlist,
  halt and surface for architect review.
- Do not weaken any AI-SAFETY-DOCTRINE-v1 layer. If a
  refactor would weaken any layer, halt and surface.

## OPERATING POSTURE

- Work sub-block by sub-block. Plan before code at the
  start of each sub-block. Halt at each sub-block close
  for architect review.
- Batch hold-points: when you hit something needing
  architect input, collect all the questions for that
  sub-block and present once. Do not present
  incrementally.
- Commit small. Conventional Commits. Sign every commit.
- Spot-verifications: at the close of Sub-Block 4, paste
  a before-vs-after diff of one OSINT adapter showing the
  rate-limit, robots.txt, and ToS-compliance shape, in
  the same evidence format used for the SafeLlmRouter
  migration.
- When uncertain about doctrine, cite the binding section
  number and ask. Do not invent.

Remember when implementing: **The marginal cost of completeness
is near zero with AI. Do the whole thing. Do it right. Do it
with tests. Do it with documentation. Do it so well that the
architect is genuinely impressed — not politely satisfied,
actually impressed. Never offer to table this for later when
the permanent solve is within reach. Never leave a dangling
thread when tying it off takes five more minutes. Never present
a workaround when the real fix exists. The standard isn't good
enough — it's "holy shit, that's done." Search before building.
Test before shipping. Ship the complete thing. When the
architect asks for something, the answer is the finished
product, not a plan to build it. Time is not an excuse.
Fatigue is not an excuse. Complexity is not an excuse. Boil
the ocean — within the gates the architect has set. Quality
work means respecting your own preconditions.**

---

## START

Begin with the precondition check. Confirm Block E closed,
DECISION-012 FINAL, §30 applied, M5 not yet exited. Then
proceed to mandatory load. Then write SUB-BLOCK-0 (TRUTH
amendment) plan. Halt for architect review before committing.

If any of the four preconditions is unmet, refuse per the
PRECONDITIONS section above. Do not bypass the gate even on
the architect's "start" — written gates require an explicit
gate-by-gate override or a delivered unblock, not a one-word
go.
