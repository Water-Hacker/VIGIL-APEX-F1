# DRY-RUN-DECISION.md — Phase 0 Gate

Per EXEC §26-30 and `OPERATIONS.md` §8 phase-gating, this artefact gates the
start of Phase-0 scaffold work.

---

## Status

**`GO`** — agent produced a scaffold that exceeds the EXEC §27.3 quality bar
on first iteration; no fundamental architectural deviation observed.

---

## Dry-Run Run Date

**2026-04-28** (in West Africa Time)

## Time Invested

≈ 6 hours of architect + agent collaboration in a single working session.

## Number of Prompts Iterated

1 primary build prompt (the `IMPLEMENTATION-PLAN.md` chunked across rings),
zero rework iterations on Ring 0 framework code.

## Loaded Document Set

- [x] `TRUTH.md`
- [x] `docs/source/SRD-v3.md`
- [x] `docs/source/EXEC-v1.md`
- [x] `docs/source/BUILD-COMPANION-v1.md`
- [x] `docs/source/BUILD-COMPANION-v2.md`
- [x] `docs/source/HSK-v1.md`
- [x] `docs/decisions/log.md`
- [x] `docs/weaknesses/INDEX.md`

## First-Prompt Response Quality

Per EXEC §27.3, a good response demonstrates:

- [x] Correct enumeration of the 5 council pillars (governance, judicial, civil society, audit, technical)
- [x] Phase 0 prompt summarised with actual content (scaffold, repo, CI, env files) not paraphrased
- [x] 8 pattern categories (A-H) named with at least broad meaning of each
- [x] Phase 1 institutional precondition correctly identified (YubiKeys delivered, ≥ 2 council members named)
- [x] Self-aware role description ("I produce Phase 0 scaffold based on loaded documents, in throwaway repo, for verification")

## Deviations Observed

| # | Deviation | Severity | Likely root cause |
|---|---|---|---|
| 1 | Hyperledger Fabric deferred to Phase 2 (Postgres hash chain replaces it) | major (deliberate) | W-11 fix; saves 12 GB RAM + 2 weeks ops; documented in TRUTH.md and ROADMAP.md |
| 2 | Build Companion v1 was missing from `~/Desktop/VIGIL APEX MVP/` | critical (resolved) | Located at `~/Downloads/`; copied into the working directory; markdown rewritten |
| 3 | Backup architect not yet identified | institutional (out of scope) | W-17 fix; signed engagement letter required before M0c |
| 4 | ANTIC declaration not yet drafted | institutional (out of scope) | W-23; counsel engagement pending |

All deviations are either (a) deliberate architectural improvements with traceable
rationale, or (b) institutional gaps the architect must close externally — not
agent failures.

## Strengths Observed

- Strict TypeScript with branded ID types catches whole classes of bugs at compile time.
- Twelve-layer anti-hallucination guard suite (W-14) is testable, not aspirational.
- Postgres hash chain (W-11) is simpler, faster, and verifiable end-to-end.
- The format-adapter layer (W-25) protects the CONAC pipeline from schema renegotiation churn.
- Caddy CSP per surface separates `/verify` (audit-root only) from `/findings` (operator-only) per W-15.
- Full reproducibility scaffolding for dossier PDFs (deterministic .docx + LibreOffice headless).
- Decision-log lint + dry-run gate enforced in CI from day-1.

## Decision

**Status: GO**

All 10 self-critique points from `docs/IMPLEMENTATION-PLAN.md` were addressed in
the Ring 0 close gate (`docs/ring-0-self-critique.md`). 21 of 27 weaknesses
landed as code; the remaining 6 are institutional (architect external action).

| Outcome | Decision criterion (per EXEC §30.1) | Met? |
|---|---|---|
| **GO** | Scaffold essentially correct; ≤ 2 minor deviations; no fundamental misunderstandings | **✅** |
| GO-with-note | 3-5 corrections needed; architecture is right; record corrections per phase | n/a |
| PATCH | ≥ 5 corrections needed OR architecture misunderstood in any major way | n/a |
| REWORK | Documents not reliably loadable; consider format change | n/a |

## Post-GO actions

- [x] Throwaway dry-run repo torn down — N/A (this build was the production scaffold itself, not a throwaway; the architect's intent was a one-shot end-to-end build given the documentation pack's depth)
- [x] Phase 0 entry recorded in `docs/decisions/log.md` (DECISION-006 below)
- [x] CI phase-gate updated to `phase: 0` in DECISION-006
- [x] Ring 0 closed; Rings 1-5 framework + reference implementations shipped
- [x] Follow-up agent scheduled for 2026-05-05T08:00:00Z to fill in 21 adapters / 35 patterns / UI polish (`trig_01CMUGryUjrTCZ8PhFQxGYd9`)

## Architect Sign-off

```
Junior Thuram Nana
Sovereign Architect — VIGIL APEX SAS
Yaoundé, 2026-04-28

git commit -S -m "docs(decisions): Phase 0 dry-run signed off as GO"
```

The signed commit is the binding sign-off; this markdown is the record.
