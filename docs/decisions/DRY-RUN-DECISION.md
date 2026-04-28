# DRY-RUN-DECISION.md — Phase 0 Gate

Per EXEC §26-30 and `OPERATIONS.md` §8 phase-gating, this artefact gates the
start of Phase-0 scaffold work. Until this file is filled in with `Status: GO`
or `GO-with-note`, **no Phase-0 commit may land on `main`**.

The dry-run protocol (EXEC §27-29) takes 4-8 hours in a throwaway repo. It is
the single highest-information action available right now.

---

## Status

**`PENDING`** — dry-run not yet attempted.

To complete this file, the architect runs the EXEC §26-30 protocol and fills
in the sections below.

---

## Dry-Run Run Date

_(YYYY-MM-DD, in West Africa Time)_

## Time Invested

_(hours, including iteration)_

## Number of Prompts Iterated

_(integer)_

## Loaded Document Set

- [ ] `TRUTH.md`
- [ ] `docs/source/SRD-v3.md`
- [ ] `docs/source/EXEC-v1.md`
- [ ] `docs/source/BUILD-COMPANION-v1.md`
- [ ] `docs/source/BUILD-COMPANION-v2.md`
- [ ] `docs/source/HSK-v1.md`
- [ ] `docs/decisions/log.md`
- [ ] `docs/weaknesses/INDEX.md`

## First-Prompt Response Quality

Per EXEC §27.3, a good response demonstrates:

- [ ] Correct enumeration of the 5 council pillars (governance, judicial, civil society, audit, technical)
- [ ] Phase 0 prompt summarised with actual content (scaffold, repo, CI, env files) not paraphrased
- [ ] 8 pattern categories (A-H) named with at least broad meaning of each
- [ ] Phase 1 institutional precondition correctly identified (YubiKeys delivered, ≥ 2 council members named)
- [ ] Self-aware role description ("I produce Phase 0 scaffold based on loaded documents, in throwaway repo, for verification")

## Deviations Observed

(use the §29 categorisation: cosmetic / minor / major / red-flag)

| # | Deviation | Severity | Likely root cause |
|---|---|---|---|
| 1 | _example: agent missed @vigil/audit-chain package_ | major | _SRD §07 audit-chain importance underemphasised_ |
| 2 | | | |
| 3 | | | |

## Strengths Observed

_(what the agent did unexpectedly well — informs future prompt design)_

## Decision

**Status: PENDING** _(change to one of: GO / GO-with-note / PATCH / REWORK)_

| Outcome | Decision criterion (per EXEC §30.1) |
|---|---|
| GO | Scaffold essentially correct; ≤ 2 minor deviations; no fundamental misunderstandings |
| GO-with-note | 3-5 corrections needed; architecture is right; record corrections per phase |
| PATCH | ≥ 5 corrections needed OR architecture misunderstood in any major way; revise SRD/Companions; re-run |
| REWORK | Documents not reliably loadable; consider format change (split docs, custom tool, different model) |

## If GO or GO-with-note

- [ ] Throwaway dry-run repo torn down
- [ ] Phase 0 entry recorded in `docs/decisions/log.md` as DECISION-NNN
- [ ] CI phase-gate updated to `phase: 0` (per `OPERATIONS.md` §8)
- [ ] Real Phase 0 scaffold begins within 1 week per BUILD-V1 §28

## If PATCH or REWORK

- [ ] Throwaway dry-run repo torn down (PATCH) or archived (REWORK)
- [ ] Document sections requiring changes listed below
- [ ] Estimated impact on overall timeline recorded in `TRUTH.md` Section J
- [ ] New dry-run scheduled

### Sections requiring changes

| File | Section | Required change |
|---|---|---|
| _example: SRD-v3.md_ | _§08 technology choices_ | _surface Fastify/TypeScript/pnpm decisions earlier; agent kept defaulting to Express/JS/npm_ |
| | | |

## Architect Sign-off

_Signature line is the architect's commit signature on this file once filled in._

```
Junior Thuram Nana
Sovereign Architect — VIGIL APEX SAS
git commit -S -m "docs: dry-run decision: GO" docs/decisions/DRY-RUN-DECISION.md
```
