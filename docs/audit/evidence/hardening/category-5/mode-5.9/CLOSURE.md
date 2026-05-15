# Mode 5.9 — Shamir reconstruction with corrupted share producing silently wrong key

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 6 / Category 5
**Branch:** `hardening/phase-1-orientation`

## The failure mode

`shamirCombine` performs Lagrange interpolation over GF(256). Given 3 share tuples `(xi, yi)` it produces exactly ONE output regardless of whether the `yi` values are the originals or have been tampered with. If a single Y byte is flipped, the combiner produces a **silently-wrong** key — same length, no thrown error, no integrity-fail signal.

The combiner is correct in isolation: bytes-in, bytes-out. The detection responsibility lives UPSTREAM (the orientation called this out as "where age-plugin-yubikey's authenticated encryption sits"). Without an explicit test documenting this boundary, a future contributor might:

- Assume `shamirCombine` validates integrity → silently broken protocol.
- Add an in-combiner integrity check (e.g. sha256 prefix byte) → breaks the age-plugin-yubikey path because age-encrypted shares don't carry that prefix.

## What was already in place

- `packages/security/src/shamir.ts:56-95` — `shamirCombine()` validates X-coordinate uniqueness (`:71`), no-zero-X (`:70`), length consistency (`:66-67`). These guard structural integrity but not value integrity.
- `packages/security/__tests__/shamir.test.ts` — 6 cases covering round-trip, below-threshold rejection, duplicate X, zero X, inconsistent length, base64 wrapper. **No test for Y-byte corruption.**
- Production share-distribution path: `infra/host-bootstrap/03-vault-shamir-init.sh` encrypts each share to a council member's YubiKey via `age-plugin-yubikey`. age uses ChaCha20-Poly1305 (authenticated encryption); a flipped byte in an age ciphertext fails the MAC and age refuses to decrypt. Corrupted shares never reach `shamirCombine` in production.

## What was added

### 1. Three new test cases in `shamir.test.ts`

Under a new `describe('mode 5.9 — corrupted-share detection is upstream of shamirCombine')`:

1. **`a single flipped Y byte in one of three shares produces a WRONG secret (combiner does NOT throw)`** — confirms round-trip on clean shares; flips one Y byte (`tampered[5] ^ 0x01`); asserts the recovered output differs from the original secret AND has the same length AND no exception is thrown. This documents the failure-mode plainly.

2. **`every single-byte flip in any one share produces a distinct wrong secret`** — strength test. Iterates every Y-byte position across all 3 shares (48 total flips for a 16-byte secret), flips each in turn, asserts each recovery is wrong AND distinct. Catches a hypothetical bug where corruption at certain offsets cancels out (it doesn't — GF(256) is dense).

3. **`upstream contract: callers responsible for share integrity (age-plugin-yubikey in prod)`** — documentation test. Round-trips clean shares; the test's existence + its placement next to the corruption tests visualises the contract: pure mathematical combiner, no integrity check baked in.

### 2. Clarified docstring on `shamirCombine`

`packages/security/src/shamir.ts:49-72` now states explicitly:

- `shamirCombine` does NOT verify Y-byte integrity.
- A flipped Y byte produces a silently wrong secret.
- Upstream integrity is the responsibility (production: age-plugin-yubikey; tests/dev: caller's own check).
- The test name `mode 5.9 — corrupted-share detection is upstream of shamirCombine` is referenced from the docstring so a future PR adding in-combiner integrity will fail the test and force the change to be coordinated with the age path.

## The invariant

Three layers:

1. **The 3 new test cases** lock the corruption-produces-silent-wrong-output contract. Any future PR that adds in-combiner integrity will fail these tests, forcing explicit consideration of the age-plugin-yubikey path.

2. **The docstring** explicitly names the upstream-responsibility contract. Future contributors reading the code see the contract before they touch the function.

3. **The existing production path** (`age-plugin-yubikey` → authenticated decryption → `shamirCombine`) IS the integrity check, layered correctly. Mode 5.9 is closed by explicit documentation that this layering is INTENTIONAL.

## What this closure does NOT include

- **An in-combiner integrity check**. Deliberately rejected — would break the production age path. The right place for integrity is age-plugin-yubikey's ChaCha20-Poly1305 MAC, which is already there.

- **A test that drives age-plugin-yubikey itself**. The age path is exercised at deployment time by the host-bootstrap script + manual verification. A test that simulates age-encrypted shares + corruption would require the test to install `age` and `age-plugin-yubikey` binaries; out of scope for unit tests.

- **A Shamir-level signature scheme**. The orientation flagged this as a "could add" — bind each share to a separate signature so the combiner can verify before combining. This would be a real cryptographic strengthening but requires re-architecting the host-bootstrap path and is heavier than mode 5.9 warrants. Flagged for follow-up if the architect wants explicit Shamir-side integrity.

## Files touched

- `packages/security/src/shamir.ts` (docstring clarification on `shamirCombine`)
- `packages/security/__tests__/shamir.test.ts` (+3 test cases, ~80 lines)
- `docs/audit/evidence/hardening/category-5/mode-5.9/CLOSURE.md` (this file)

## Verification

- `pnpm --filter @vigil/security test`: 22 passed (was 19; +3 mode 5.9 tests).
- `pnpm --filter @vigil/security run typecheck`: clean.
