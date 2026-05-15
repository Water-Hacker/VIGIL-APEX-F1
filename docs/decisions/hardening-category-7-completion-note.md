# Hardening Pass · Category 7 (Input handling and injection) — Completion Note

**Date:** 2026-05-15
**Branch:** `hardening/phase-1-orientation`
**Phase:** 8 of 11 in the 90-mode hardening pass
**Modes closed this category:** 1 (7.9 — the only partial at orientation)
**Modes pre-existing closed-verified:** 6 (7.1, 7.3, 7.4, 7.5, 7.6, 7.7)
**Modes not applicable:** 2 (7.2 no NoSQL stores; 7.8 no XML parser)

## What landed

One mode-closure commit:

| Mode | Title                                            | Commit      | Test                                                 |
| ---- | ------------------------------------------------ | ----------- | ---------------------------------------------------- |
| 7.9  | Unbounded input size causing resource exhaustion | `test(api)` | `tip-payload-size-413.test.ts` (5 integration cases) |

## Tests added

5 new integration test cases in a single test file:

- `apps/dashboard/__tests__/tip-payload-size-413.test.ts`:
  - **tip-submit** (3 cases): 300 KB Content-Length → 413; small body → NOT 413 (cap is ceiling); non-JSON content-type → 415 before size check (locks ordering).
  - **tip-attachment** (2 cases): 11 MB arrayBuffer → 413; empty body → 400 before size check (locks ordering).

The tests invoke the actual route handlers directly with synthetic NextRequest objects. The 413 path short-circuits before any DB / Turnstile / audit side effect, so no fixtures are needed.

## Invariants added

| Layer | Invariant                                           | Effect                                                                                 |
| ----- | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Test  | 5 integration cases against the live route handlers | Removing either size cap fails the 413-path tests                                      |
| Test  | Guard-ordering tests                                | Refactoring can't reorder content-type / empty-body / size guards to bypass each other |

## Cross-cutting verification

- `pnpm run typecheck` (60 packages): 60 successful.
- `pnpm --filter dashboard test`: 134 passed (was 129 before Cat-7).
- All Cat-1/2/3/4/5/6 invariants still hold.

## Secondary findings surfaced during Category 7

Two observations:

**(a) Category 7 was the smallest closure in the pass.** 6 modes were already closed-verified at orientation; 2 are not applicable (no NoSQL stores, no XML parser); 1 partial was a missing test. The audit had done thorough input-handling work before this pass — the codebase's Drizzle / Zod / Next.js defaults push every public surface through schema validation by default, and the existing route handlers add explicit size caps + content-type guards. The closure is just locking that posture in with a test.

**(b) Two follow-ups acknowledged but explicitly out of scope:**

- **Caddy-level body-size limit** (the first line of defence; verified by DR rehearsal, not unit test).
- **Streaming body-size enforcement** (the current implementation reads the full body before checking length; a malicious client could DOS at the 10 MB cost — Caddy is the production defence; flagged if attack pressure justifies a refactor).

## Modes that revealed structural issues requiring follow-up

None. One operational follow-up flagged in the closure doc:

- **Streaming body-size enforcement refactor** if attack pressure surfaces.

## Status of the 90-mode pass after Category 7

After this category:

- **Closed-verified now:** 74 of 90 (was 73 after Category 6).
- **Partially closed:** 6 (was 7 — mode 7.9 closed).
- **Open:** 4 (unchanged — no opens in Cat 7).
- **Not applicable:** 6 (unchanged).

## Architect signal needed

None for proceeding to Category 8 (Tip portal anonymity preservation). 8 modes pre-existing closed-verified; 1 partial (8.5 timing side-channel) which the orientation classified as ACCEPTABLE due to the Tor deployment context — closure is potentially zero-code, just a documentation acknowledgement.

Five open questions from §7 of the orientation remain unaddressed. One of them (question 1: 8.5 timing side-channel acceptability) is now directly relevant to Category 8 sequencing. I'll surface it explicitly when starting Cat-8.
