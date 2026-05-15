# Hardening Pass · Category 10 (Supply chain and dependency hygiene) — Completion Note

**Date:** 2026-05-15
**Branch:** `hardening/phase-1-orientation`
**Phase:** 11 of 11 in the 90-mode hardening pass (the non-cosign portion)
**Modes closed this category:** 2 open→CV (10.3, 10.7); 1 partial moved 2 of 3 sub-tasks (10.2 — Trivy + refresh; digest pinning deferred to Phase 12)
**Modes pre-existing closed-verified:** 5 (10.1, 10.4, 10.5, 10.6, 10.9)
**Modes deferred to Phase 12:** 1 (10.8 — cosign, bundled with 9.8 + 9.9)

## What landed

Three mode-closure commits:

| Mode(s)        | Title                                         | Commit                   | Tests / Artefacts                                                   |
| -------------- | --------------------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| 10.7 + 10.2(a) | Trivy base-image CVE gate                     | `ci(infra)` (`e6eb6b1`)  | `scripts/enumerate-base-images.ts` + new `trivy-base-images` CI job |
| 10.2(c)        | Quarterly base-image refresh policy           | `docs(repo)` (`0dbcf67`) | `docs/runbooks/base-image-refresh.md`                               |
| 10.3           | SHA-pin actions + pin pip + gitleaks checksum | `ci(infra)` (`7415907`)  | 7 workflows touched; 12 actions pinned; 3 binary installs hardened  |

## Tests added

No new unit tests — Cat 10 closures are all CI-gate-shaped (the gate
itself is the test).

Two new CI jobs running on every push + PR:

- `trivy-base-images` — `trivy image --severity HIGH,CRITICAL
--ignore-unfixed --exit-code 1` against every Dockerfile FROM image.
- (Sub-task within `secret-scan.yml`) gitleaks tarball sha256 verify
  step.

One new runbook:

- `docs/runbooks/base-image-refresh.md` (~200 lines) — quarterly
  cadence + 8-step procedure + out-of-band CVE refresh path.

## Invariants added

| Layer        | Invariant                                                                                                       | Effect                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| CI           | `trivy-base-images` job hard-gates HIGH/CRITICAL CVEs in every Dockerfile FROM image (modes 10.7 + 10.2(a))     | A fixed CVE in any base image fails CI on first push; refresh procedure documented per 10.2(c) |
| CI           | Every `uses:` in every workflow resolves to a 40-char commit SHA (mode 10.3 sub-task 1)                         | Action-maintainer compromise no longer auto-propagates; Dependabot manages SHA bumps           |
| CI           | `pip install` lines pin `pip==25.2 wheel==0.45.1 setuptools==80.9.0` (mode 10.3 sub-task 2)                     | PyPI mirror compromise can't auto-update us to a malicious version                             |
| CI           | gitleaks + Trivy binary downloads sha256-verify before tar-extract (mode 10.3 sub-task 3)                       | CDN-edge tarball swap fails at `sha256sum -c -` before any binary lands in `/usr/local/bin`    |
| Doc / Policy | `docs/runbooks/base-image-refresh.md` quarterly cadence + 8-step procedure + architect-signed PR checklist      | Even when Trivy gate is green, stale base images get rotated on a calendar                     |
| Doc / Policy | `scripts/enumerate-base-images.ts` is single source of truth for the image list (CI gate + runbook both use it) | Adding a new Dockerfile auto-extends both the CVE gate AND the refresh procedure               |

## Cross-cutting verification

- `pnpm exec tsx scripts/enumerate-base-images.ts` → 5 base images
  enumerated correctly (caddy:2.8-alpine, caddy:2.8-builder,
  mcr.microsoft.com/playwright:v1.47.2-jammy, node:20.17.0-alpine,
  python:3.12.6-slim-bookworm).
- `grep -hE "uses:\s+[a-zA-Z0-9/-]+@[a-zA-Z0-9._-]+" .github/workflows/*.yml | sort -u`
  confirms every workflow `uses:` reference is a 40-char SHA.
- Local tests pass: queue 27/27, observability 65/65 + 1 skipped (no
  regressions from Cat 10 work which touches only CI YAML + new
  script).
- All Cat-1/2/3/4/5/6/7/8/9 invariants still hold.

## Secondary findings surfaced during Category 10

Three observations:

**(a) The "sha256-verified binary download" pattern is now
established.** Both gitleaks (`secret-scan.yml`) and Trivy
(`ci.yml`'s new `trivy-base-images` job) follow the same shape:
pinned version constant, pinned sha256 constant from the upstream
checksums file, `sha256sum -c -` before `tar -xzf`, comment explaining
the bump procedure (refresh BOTH the version AND the sha256). Future
binary-tool installs should mirror this. The pattern is documented in
both closure docs.

**(b) `aquasecurity/trivy-action` was considered + rejected** in
favour of an inline install. Reasoning preserved in the mode 10.7 +
10.2(a) closure doc — the action's per-step API doesn't naturally
support a dynamic image-list loop, and the inline install eliminates
one third-party action from the auth chain. The SHA-pinned
`aquasecurity/trivy-action@ed142fd…` reference remains in `ci.yml`
as a precedent / commented-out placeholder for future contributors.

**(c) A `check-action-pins.ts` CI gate would lock the SHA-pin
discipline forward.** Currently the discipline is "every contributor
following the existing precedent". A small script that parses all
workflows and asserts every `uses:` reference ends in a 40-char hex
SHA would catch the regression where a contributor adds an action
with `@v4` shorthand. Flagged as future hardening (~ 1 hour); doesn't
block Cat 10 closure but is the obvious next-tier gate.

## Modes deferred to Phase 12

| Mode    | Title                                    | Why deferred                                                                                                        |
| ------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 10.8    | Cosign sig not verified on every pull    | Bundled with modes 9.8 + 9.9 (same surface — cosign sign in CI build + cosign verify in deploy + key rotation doc). |
| 10.2(b) | Digest-pin FROM lines (sub-task of 10.2) | Same surface as 9.8 — image-digest pinning across Dockerfiles + Helm chart. Bundled with the cosign work.           |

**Q2 (cosign closure scope)** is the architect-blocking question for
Phase 12: full Kyverno ClusterPolicy in k3s OR init-container
`cosign verify` in compose-only. Both end up at the same place once
k3s is in production; the architect's pick determines whether Phase 12
ships the k3s + compose path together or compose-only first.

## Status of the 90-mode pass after Category 10

### Honesty-of-record correction (carried from Cat 9 note)

Re-deriving the running counts from a per-category audit revealed the
Cat 9 completion note's "Closed-verified now: 79" had an off-by-one.
Per-category recount (each row sums to 9 modes):

| Cat | CV                                              | Partial  | Open     | N/A          | Sum |
| --- | ----------------------------------------------- | -------- | -------- | ------------ | --- |
| 1   | 7                                               | 0        | 0        | 2 (1.4, 1.8) | 9   |
| 2   | 9                                               | 0        | 0        | 0            | 9   |
| 3   | 9                                               | 0        | 0        | 0            | 9   |
| 4   | 9                                               | 0        | 0        | 0            | 9   |
| 5   | 8                                               | 0        | 0        | 1 (5.8)      | 9   |
| 6   | 9                                               | 0        | 0        | 0            | 9   |
| 7   | 7                                               | 0        | 0        | 2 (7.2, 7.8) | 9   |
| 8   | 9                                               | 0        | 0        | 0            | 9   |
| 9   | 6 (9.1, 9.2, 9.3, 9.4, 9.5, 9.6)                | 1 (9.8)  | 1 (9.9)  | 1 (9.7)      | 9   |
| 10  | 5 (10.1, 10.4–10.6, 10.9) → +2 after Cat 10 = 7 | 1 (10.2) | 1 (10.8) | 0            | 9   |

Pre-Cat-10 totals (corrected): **78 CV, 2 partial, 4 open, 6 N/A**
(not 79/1/4/6 as the Cat 9 note stated). The miscount came from
treating 10.2 as one of the 4 opens; it was actually partial.

### Cat 10 movements

- 10.3 open → CV (SHA-pin actions + pip pin + gitleaks sha256).
- 10.7 open → CV (Trivy CI gate; shared closure with 10.2 sub-task a).
- 10.2 partial → unchanged partial (Trivy + refresh-schedule shipped;
  digest-pin sub-task (b) deferred to Phase 12).
- 10.8 open → unchanged open (deferred to Phase 12).

Net deltas: +2 CV, 0 partial, −2 open, 0 N/A.

### After Category 10

- **Closed-verified now:** 78 + 2 = **80 of 90**.
- **Partially closed:** **2** (9.8 + 10.2 — both with digest-pin/cosign
  sub-tasks pending Phase 12).
- **Open:** **2** (9.9 + 10.8 — both deferred to Phase 12).
- **Not applicable:** **6** unchanged.

Total: 80 + 2 + 2 + 6 = **90** ✓.

## Architect signal needed

None for proceeding to Phase 12 (cross-cutting cosign + digest work),
which closes modes 9.8 + 9.9 + 10.8 + the deferred 10.2(b) sub-task.

**Q2 (cosign closure scope)** is the architect-blocking question for
Phase 12:

> Cosign closure scope: full Kyverno admission policy in k3s OR
> init-container verify in compose for now? Full Kyverno is the right
> end-state but adds a k3s dependency. Init-container in compose is
> cheaper but doesn't generalise. Both end up at the same place once
> k3s is in production. Confirm preferred path.

Q2 was the only orientation question deferred past Cat 9. The
architect's pick determines whether Phase 12 ships:

- **Path A (k3s + compose):** Kyverno ClusterPolicy + init-container
  - cosign sign in CI + key rotation doc. ~6–12 days.
- **Path B (compose-only first):** init-container `cosign verify` +
  cosign sign in CI + key rotation doc. ~3–5 days. The k3s Kyverno
  layer lands later when k3s is in production.

All other orientation questions (Q1, Q3, Q4, Q5) are resolved. No
other blockers.
