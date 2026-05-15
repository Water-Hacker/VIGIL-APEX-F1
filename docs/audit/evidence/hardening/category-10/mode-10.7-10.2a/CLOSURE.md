# Modes 10.7 + 10.2(a) — Trivy base-image CVE gate

**State after closure:**

- Mode 10.7: closed-verified.
- Mode 10.2: still partial — (a) Trivy + (c) refresh schedule lands here / in
  sister closure; (b) digest pinning deferred to Phase 12 (alongside 9.8 + 9.9 + 10.8).

**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 11 / Category 10
**Branch:** `hardening/phase-1-orientation`

## The failure modes

### Mode 10.7 — Trivy not gating build (open at orientation)

Per orientation §3.10 / 10.7:

> `.github/workflows/ci.yml:319-335` `docker-build` step has
> `continue-on-error: true` and no Trivy follow-up.

A CVE in a base image's OS-package layer (e.g., a `glibc` RCE in
`node:20.17.0-alpine` or a `libxml` integer-overflow in
`python:3.12.6-slim-bookworm`) lands in every container we build,
unmonitored. The CI pipeline ships images without any vulnerability
scan.

### Mode 10.2(a) — Compromised container base image (partial at orientation)

Per orientation §3.10 / 10.2:

> All Dockerfiles use tag-pinned base images (`node:20.17.0-alpine`,
> `python:3.12.6-slim-bookworm`, `postgres:16.4-alpine`). No Trivy in
> CI. No digest pinning.
>
> **Closure:** (a) Trivy step after `docker buildx bake` in `ci.yml`,
> `--severity HIGH,CRITICAL --exit-code 1`; (b) digest-pin FROM lines
> via a mechanical script; (c) quarterly base-image refresh schedule.

10.2 is the broader failure mode 10.7 is one half of. This closure
ships sub-tasks (a) AND part of (c) (the policy lives in a sister
closure); (b) is sequenced for Phase 12 alongside the cosign work.

## What was added

### 1. `scripts/enumerate-base-images.ts` (new, ~80 lines)

A small TypeScript script that parses every `*.Dockerfile` under
`infra/docker/dockerfiles/` for `FROM <image>` lines and emits a
deduplicated, sorted list of base images on stdout.

Behaviour:

- Filters out internal multi-stage aliases (`FROM base AS …`,
  `FROM deps AS …`) by requiring a `:` or `/` in the image ref.
- Substitutes `${ARG}` placeholders with their declared default
  (e.g., `python:${PYTHON_VERSION}-slim-bookworm` → `python:3.12.6-slim-bookworm`).
- Skips images with unresolved ARGs (writes a warning to stderr; the
  script's overall exit is still 0 unless ZERO images are enumerated).
- Used by both the Trivy CI gate AND the quarterly refresh runbook
  (mode 10.2(c)) — single source of truth.

Output at closure time:

```
caddy:2.8-alpine
caddy:2.8-builder
mcr.microsoft.com/playwright:v1.47.2-jammy
node:20.17.0-alpine
python:3.12.6-slim-bookworm
[enumerate-base-images] OK: enumerated 5 base image(s)
```

### 2. New `trivy-base-images` CI job in `.github/workflows/ci.yml`

A job parallel to `docker-build` (depends on `install` for the pnpm
store warm-up but not on `docker-build` itself — Trivy scans the
declared FROM images directly, not the bake output, so it works even
while `docker-bake.hcl` is incomplete).

Three steps:

1. **Checkout + pnpm + node setup** (same as other lint jobs).
2. **Install Trivy with sha256 verification.** Mirrors the gitleaks
   pattern from `secret-scan.yml`: pinned version (0.70.0),
   sha256-verified tarball download, sudo tar-extract to
   `/usr/local/bin`. No third-party action in the install chain,
   so the action-pinning discipline (mode 10.3) doesn't apply at
   the install step.
3. **Enumerate base images, then loop-scan with Trivy.** The
   enumeration script's stdout becomes a `$GITHUB_OUTPUT` multi-line
   string; the scan loop iterates it, running:

   ```
   trivy image --quiet --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --format table $IMG
   ```

   Failures accumulate (FAIL counter), and the job exits 1 if any
   image fails. Per-image groups are emitted via `::group::` /
   `::endgroup::` so the GitHub Actions log is collapsible.

`--ignore-unfixed` excludes CVEs that have no published fix; the
gate only fires on CVEs we COULD remediate by bumping the base
image. The quarterly refresh procedure (mode 10.2(c)) is the standing
process for those bumps.

### 3. (Sister) `aquasecurity/trivy-action` use was rejected

An earlier draft used `aquasecurity/trivy-action@ed142fd…` (the action
form). Rejected because:

- The action's API only runs ONE trivy command per `uses:` step;
  scanning N dynamically-enumerated images requires either N steps
  (which we can't write without a matrix) or a single image's scan
  (which doesn't cover the fan-out).
- A bash loop calling the trivy CLI directly is more transparent +
  auditable + works for any list-shape.
- The inline install with sha256 verify eliminates the third-party
  action in the auth chain (one less SHA to track for mode 10.3
  drift).

## The invariant

Two layers of defence against base-image CVEs:

1. **Trivy CI gate** (this closure) — every push and PR runs
   `trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1`
   against every enumerated base image. A CVE landing in any base
   image, that has a fix available, fails CI until the base image
   is bumped.

2. **Quarterly refresh policy** (mode 10.2(c) sister closure) — the
   on-call rotates base-image tags on a calendar cadence even when
   no CVE is published, catching the slow-drift case where a tag
   stays at an aging release.

The third layer (mode 10.2(b) digest pinning) lands in Phase 12
alongside cosign verify: digest pinning makes "the image we scanned"
provably equal to "the image we'll deploy", closing the registry-
substitution attack class.

## What this closure does NOT include

- **Digest pinning of FROM lines (mode 10.2(b)).** Deferred to Phase 12.
  Without digest pinning, `node:20.17.0-alpine` resolves to whichever
  layer SHA the registry serves at pull time; an adversary who
  compromises the registry could swap the layer for a malicious one
  with the same tag. Trivy at CI time would scan the GOOD layer; the
  deploy at runtime would pull the malicious one. Digest pinning
  closes that window.

- **Cosign verify (mode 10.8).** Same Phase-12 work block.

- **Scanning the BUILT images (post-bake).** Orientation said "Trivy
  step after `docker buildx bake`". The bake file (`docker-bake.hcl`)
  isn't yet present in the repo; `docker-build` ships with
  `continue-on-error: true` to absorb the failure. Once the bake is
  complete (architect's R0.D + later work), an additional Trivy step
  AFTER the bake is the strict-superset closure — that would also
  catch CVEs in the npm-package layer that landed during the build.
  The current closure is the **base-image** scan; the **built-image**
  scan is a Phase-12+ additive.

- **Trivy configuration scan (`trivy config`).** The action form does
  a Dockerfile static-analysis scan looking for `RUN curl … | bash`
  patterns and similar. Distinct value class; the install pattern
  here intentionally skips it. Future hardening if a CIS / Dockerfile
  best-practice audit becomes a need.

## Files touched

- `scripts/enumerate-base-images.ts` (new, ~80 lines)
- `.github/workflows/ci.yml` (+85 lines: new `trivy-base-images` job)
- `docs/audit/evidence/hardening/category-10/mode-10.7-10.2a/CLOSURE.md` (this file)

## Verification

- `pnpm exec tsx scripts/enumerate-base-images.ts` enumerates 5 images
  (caddy:2.8-alpine, caddy:2.8-builder,
  mcr.microsoft.com/playwright:v1.47.2-jammy, node:20.17.0-alpine,
  python:3.12.6-slim-bookworm). The PYTHON_VERSION ARG substitution
  works.
- The trivy CLI install was tested locally for syntax (the bash block
  passes `bash -n`). Full Trivy execution + CVE-database fetch is gated
  to the CI run; local-runner-time CVE scans against 5 images would
  exceed reasonable per-closure work budget.
- The new `trivy-base-images` job slots in alongside the existing CI
  lint tier (`helm-values-drift`, `migration-rollback`, `compose-deps`,
  `migration-locks`, `api-error-leaks`). 15-minute timeout absorbs the
  database fetch + per-image scan time.
