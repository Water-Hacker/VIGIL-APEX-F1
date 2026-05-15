# Hardening Pass · Category 8 (Tip portal anonymity preservation) — Completion Note

**Date:** 2026-05-15
**Branch:** `hardening/phase-1-orientation`
**Phase:** 9 of 11 in the 90-mode hardening pass
**Modes closed this category:** 1 (8.5 — the only partial at orientation; closed as documented-acceptable, no code change)
**Modes pre-existing closed-verified:** 8 (8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 8.8, 8.9)

## What landed

One mode-closure commit:

| Mode | Title                             | Commit      | Test            |
| ---- | --------------------------------- | ----------- | --------------- |
| 8.5  | Timing side-channel on tip portal | `docs(api)` | None (doc-only) |

## Tests added

None. Mode 8.5 is closed as **acceptable as-is with documented rationale**. The
orientation pre-classified this state; the architect's `proceed` after
preflight ratified it.

## Invariants added

| Layer        | Invariant                                                                    | Effect                                                                                                         |
| ------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Doc / Policy | CLOSURE.md anchors the Tor-deployment-dominates-timing rationale             | Future contributors who consider response-jitter "hardening" must reckon with the re-open triggers in §5 first |
| Doc / Policy | Re-open triggers explicitly enumerated (Tor retirement, anti-bot swap, etc.) | If any of those triggers fire, mode 8.5 reverts to OPEN automatically; no audit-archaeology required           |

## Cross-cutting verification

- No code change → no typecheck delta, no test delta.
- Orientation citations spot-checked at closure time (in mode-8.5
  CLOSURE.md §Verification): 8.1, 8.6, 8.7, 8.8 still match the
  orientation snapshot exactly.
- All Cat-1/2/3/4/5/6/7 invariants still hold.

## Secondary findings surfaced during Category 8

Three observations:

**(a) Category 8 was a doc-only category.** 8 modes pre-existing
closed-verified at orientation; the one partial (8.5) was classified as
acceptable at orientation and confirmed at closure. This is the _first_
category in the pass to close with zero code change. The closure converts
the orientation's audit-date snapshot into a permanent doc-anchored decision
with explicit re-open triggers — the audit chain stops being implicit and
starts being interrogable.

**(b) The "doc-only acceptable" pattern needs a name.** Previously every
closure landed code + tests; mode 8.5 introduces a category of closure that
records a **deliberate non-action**. The CLOSURE.md format already
accommodates this (the "What this closure does NOT include" + "Re-open
trigger" sections do the work). Future passes that encounter "the threat
is real but the deployment context makes mitigation strictly worse" can
reuse this pattern verbatim. No rework needed — flagged for the
team-handover doc.

**(c) The 8.5 rationale is load-bearing on a single deployment assumption.**
"The tip portal is deployed primarily as a v3 Tor hidden service." If the
architect ever decides — for operational, regulatory, or strategic reasons
— to retire the Tor deployment, the 8.5 closure must be re-opened _before_
the cutover, not after. The re-open trigger list in the CLOSURE.md makes
this explicit, but it's worth surfacing here too: **Tor-retirement is a
hardening-pass-affecting decision, not just an ops decision**.

## Modes that revealed structural issues requiring follow-up

None. The one operational observation:

- **(c) above** — Tor-retirement is a hardening-pass-affecting decision.
  Flagged for the deployment-strategy review, not for any new code.

## Status of the 90-mode pass after Category 8

After this category:

- **Closed-verified now:** 75 of 90 (was 74 after Category 7).
- **Partially closed:** 5 (was 6 — mode 8.5 closed).
- **Open:** 4 (unchanged — no opens in Cat 8).
- **Not applicable:** 6 (unchanged).

Total: 75 + 5 + 4 + 6 = 90 ✓.

## Architect signal needed

None for proceeding to Category 9 (Configuration, deployment, and secrets).
The orientation lists Cat 9 as:

- **9.1** Config drift staging vs production — partially closed (medium: 1–3 days for ArgoCD/Flux + CI gate)
- **9.2** Secrets in env files — closed-verified
- **9.3** TLS cert auto-rotation gap — partially closed (cheap: < 1 day with the renewal-success metric + alert)
- **9.4** Vault unseal-key custody — partially closed (cheap: doc + clevis/tang verification)
- **9.5** Backup encryption key handling — partially closed (cheap: rotation runbook + age key re-wrap)
- **9.6** through **9.9** — pre-existing closed-verified

So Cat 9 has 1 medium partial (9.1) + 3 cheap partials (9.3, 9.4, 9.5).
Estimated 2–4 days total. **Larger than Cat 6 in scope** because 9.1 is
the only "medium" partial left in the pass after 9.1 itself; everything else
is sub-day work.

**Five open questions from §7 of the orientation:**

- **Q1 (8.5 acceptability)** — _resolved by this category._ Closure
  doc explicitly records the architect's concurrence.
- Q2–Q5 — still pending; none block Category 9.

I'll surface Q2–Q5 again when their categories come up:

- Q2 (Cat 9 / config-drift CI gate scope)
- Q3 (Cat 10 / runbook authority — code vs. wiki)
- Q4 (Cat 10 / post-incident audit-chain reconciliation cadence)
- Q5 (post-pass / external red-team scope)
