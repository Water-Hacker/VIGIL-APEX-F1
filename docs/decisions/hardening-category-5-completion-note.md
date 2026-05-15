# Hardening Pass · Category 5 (Cryptographic posture) — Completion Note

**Date:** 2026-05-15
**Branch:** `hardening/phase-1-orientation`
**Phase:** 6 of 11 in the 90-mode hardening pass
**Modes closed this category:** 1 (5.9 — the only partial at orientation)
**Modes pre-existing closed-verified:** 7 (5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7)
**Modes not applicable:** 1 (5.8 — FROST not implemented; contract-native multi-sig with equivalent guarantees)

## What landed

One mode-closure commit:

| Mode | Title                                                                   | Commit                   | Test                                                   |
| ---- | ----------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------ |
| 5.9  | Shamir reconstruction with corrupted share producing silently wrong key | `test(security)` 0c0c07a | 3 new `shamir.test.ts` cases + docstring clarification |

## Tests added

3 new test cases under a new `describe('mode 5.9 — corrupted-share detection is upstream of shamirCombine')` block in `packages/security/__tests__/shamir.test.ts`:

1. **Single Y-byte flip produces wrong secret without throw** — documents the failure mode plainly.
2. **Every single-byte flip across all positions produces a distinct wrong secret** — strength test; catches hypothetical cancel-out bugs.
3. **Upstream-contract documentation test** — round-trips clean shares; visualises the boundary by sitting next to the corruption tests.

## Invariants added

| Layer        | Invariant                                                                                           | Effect                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Test         | 3 cases lock the corruption-produces-silent-wrong contract                                          | Future PR adding in-combiner integrity fails the test and forces coordination with the production age path |
| Doc          | `shamirCombine` docstring explicitly names the upstream-responsibility contract                     | Future contributors see the contract before touching the function                                          |
| Architecture | Production `age-plugin-yubikey` → authenticated decryption → `shamirCombine` IS the integrity check | The layering is intentional and now documented                                                             |

## Cross-cutting verification

- `pnpm run typecheck` (60 packages): 60 successful.
- `pnpm --filter @vigil/security test`: 22 passed (was 19; +3 mode 5.9 tests).
- All Cat-1/2/3/4 invariants still hold (migration-locks, compose-deps, api-error-leaks, pool-saturation, finding-CAS, reconciliation, auth-proof, role-provenance, JWKS-unavailable).

## Secondary findings surfaced during Category 5

One observation:

**The orientation's mode 5.9 framing was correct, and the closure is the smallest of any category so far.** The combiner was already correct by mathematical construction; the production path already had the right integrity check at the right layer. The closure adds three tests + a docstring — no architectural change. This is the cleanest example in the pass of "the orientation was right, the gap was real, and the fix is small and surgical."

By contrast, modes 1.3, 2.3, 4.4 had orientation overstatements (the gap wasn't as the orientation framed it; closure was the regression invariant locking in already-correct behaviour). Mode 5.9 sits in the middle: the gap WAS real (no Y-corruption test, ambiguous contract) but the fix was documentation + test, not code change.

## Modes that revealed structural issues requiring follow-up

None. One optional follow-up flagged in the closure doc:

- **Shamir-level signature scheme** (per-share signature to verify before combining) — real cryptographic strengthening but heavy refactor coordinated with the host-bootstrap path. Architect's call whether to add explicit Shamir-side integrity beyond the age-plugin-yubikey layer.

## Status of the 90-mode pass after Category 5

After this category:

- **Closed-verified now:** 67 of 90 (was 66 after Category 4).
- **Partially closed:** 9 (was 10 — mode 5.9 closed).
- **Open:** 8 (unchanged — no opens in Cat 5).
- **Not applicable:** 6 (unchanged).

## Architect signal needed

None for proceeding to Category 6 (Observability and detectability). Four open modes there: 6.4 (cheap, rate-limit metric), 6.6 (cheap, TLS expiry alert), 6.7 (cheap, NTP clock-skew metric), 6.9 (cheap, feature-flag boot audit). Plus 2 partials: 6.2 (backup snapshot alert), 6.8 (per-quota gauges). Total estimated effort ~4–8 days.

Five open questions from §7 of the orientation remain unaddressed; none block Category 6.
