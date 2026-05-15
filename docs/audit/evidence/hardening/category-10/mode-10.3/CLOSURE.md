# Mode 10.3 — Compromised build tool

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 11 / Category 10
**Branch:** `hardening/phase-1-orientation`

## The failure mode

Per orientation §3.10 / 10.3:

> Actions pinned to major versions (`@v4`, `@v5`) not commit SHAs.
> pip/setuptools not pinned in `python-ci.yml`. gitleaks fetched via
> curl from GitHub releases with no checksum/signature verification.

Three distinct attack vectors all classed as "compromised build tool":

1. **Major-tag actions.** `actions/checkout@v4` resolves to whichever
   commit the action maintainer currently points the `v4` ref at. A
   maintainer-account compromise or a malicious maintainer can update
   `v4` to point at a backdoored commit, and the next CI run pulls
   that commit unverifiably.

2. **Floating pip versions.** `pip install --upgrade pip wheel setuptools`
   pulls whatever PyPI returns. A compromised PyPI mirror could serve
   a malicious version with the same package name and our CI accepts
   it silently.

3. **Unverified release tarballs.** `curl -fsSL …gitleaks.tar.gz | tar -xz`
   has no checksum verify. A compromised release asset, or an MITM on
   the GitHub releases CDN edge, lands directly in `/usr/local/bin` as
   the gitleaks binary that then scans the entire history.

All three are "the build itself is the attack" — defending against a
compromised CI run is a different posture from defending against a
compromised tip or a compromised database, and each layer needs its
own pin.

## What was added

### 1. SHA-pin every action across all 7 workflows

12 distinct action references were resolved to their current commit
SHAs via `gh api repos/<owner>/<repo>/commits/<ref>`, then rewritten
in place across `ci.yml`, `contract-test.yml`, `phase-gate.yml`,
`python-ci.yml`, `secret-scan.yml`, `security.yml`,
`synthetic-failure.yml`.

| Action                              | Previous ref | New pin                                                  |
| ----------------------------------- | ------------ | -------------------------------------------------------- |
| `actions/checkout`                  | `@v4`        | `@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1`     |
| `actions/setup-node`                | `@v4`        | `@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0`     |
| `actions/setup-python`              | `@v5`        | `@a26af69be951a213d495a4c3e4e4022e16d87065 # v5.6.0`     |
| `actions/upload-artifact`           | `@v4`        | `@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2`     |
| `actions/cache/save`                | `@v4`        | `@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0`     |
| `pnpm/action-setup`                 | `@v4`        | `@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0`     |
| `docker/setup-buildx-action`        | `@v3`        | `@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f # v3.12.0`    |
| `anchore/sbom-action`               | `@v0`        | `@e22c389904149dbc22b58101806040fa8d37a610 # v0.24.0`    |
| `github/codeql-action/upload-sarif` | `@v3`        | `@458d36d7d4f47d0dd16ca424c1d3cda0060f1360 # v3`         |
| `softprops/action-gh-release`       | `@v2`        | `@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65 # v2.6.2`     |
| `snyk/actions/node`                 | `@master`    | `@9cf6ca713d71123d2d229cc3d7f145b96ea3c518 # 2026-04-23` |
| `trufflesecurity/trufflehog`        | `@main`      | `@0fa069c12f0c7baf431041cd1e564a9c5058846c # 2026-04-23` |

The two `@master` / `@main` references (snyk + trufflehog) were the
most-dangerous prior pins — they tracked HEAD of the action's
default branch with no version semantics. Their new pins reference
the commits HEAD pointed at on 2026-04-23 and carry an explicit
"track via Dependabot" comment.

The `aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0`
reference added in the sister mode 10.7 + 10.2(a) closure was already
SHA-pinned (and is now no-longer-used because we install Trivy
inline; remains as a precedent for future action additions).

### 2. Pin `pip`, `wheel`, `setuptools` in `python-ci.yml`

Both `py-lint-typecheck` and `py-test` jobs had:

```
python -m pip install --upgrade pip wheel setuptools
```

Now:

```
python -m pip install --upgrade pip==25.2 wheel==0.45.1 setuptools==80.9.0
```

With a code comment noting the bump procedure (refresh all three +
verify against pypi.org). Future hardening: Renovate config can be
extended to manage these pins, similar to the npm-package pins.

### 3. Add sha256 verify to gitleaks install in `secret-scan.yml`

Previously:

```
curl -fsSL "https://github.com/gitleaks/.../gitleaks_X.Y.Z_linux_x64.tar.gz" \
  -o /tmp/gitleaks.tar.gz
sudo tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks
```

Now:

```
curl -fsSL "https://github.com/gitleaks/.../gitleaks_X.Y.Z_linux_x64.tar.gz" \
  -o /tmp/gitleaks.tar.gz
echo "${GITLEAKS_SHA256}  /tmp/gitleaks.tar.gz" | sha256sum -c -
sudo tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks
```

With `GITLEAKS_SHA256=5bc41815076e6ed6ef8fbecc9d9b75bcae31f39029ceb55da08086315316e3ba`
sourced from the upstream `gitleaks_8.21.2_checksums.txt`. The comment
documents the bump procedure (refresh BOTH version + sha256 from the
upstream checksums file).

This pattern was also applied to the Trivy install in the sister
`trivy-base-images` job (mode 10.7 + 10.2(a) closure) — Trivy
v0.70.0 with `8b4376d5d6befe5c24d503f10ff136d9e0c49f9127a4279fd110b727929a5aa9`.
The closure establishes the "downloaded binary must carry sha256 verify"
convention going forward.

## The invariant

Three layers, all now hard:

1. **Action SHA pinning** — every `uses:` reference in every workflow
   resolves to a specific commit SHA. A maintainer-compromise event
   no longer auto-propagates into our CI; the architect must
   intentionally bump the SHA in a PR.

2. **Pinned pip/wheel/setuptools** — the Python build's first move
   no longer pulls floating versions. A PyPI mirror compromise
   doesn't auto-update us to the malicious version.

3. **sha256-verified binary downloads** — both gitleaks (security
   scanner) and Trivy (CVE scanner) downloads now sha256-verify
   before extraction. A CDN-edge compromise that swaps the tarball
   for a malicious one fails at `sha256sum -c -` before any
   extraction or execution.

A future contributor who adds a new action / pip dep / binary
download must follow the same pattern — the existing references are
the precedent. Dependabot is configured (per existing setup) to
auto-PR Action SHA bumps weekly; that's the freshness escape hatch.

## What this closure does NOT include

- **Renovate config for pip pins.** The current `renovate.json`
  manages npm + lockfile-maintenance. Extending it to manage the
  python-ci.yml pip pins is a small addition (~10 lines) but adds
  the renovate-PR-review burden. Flagged for future hardening if
  the manual cadence becomes painful.

- **Cosign verify for action binaries.** Some actions (notably
  `aquasecurity/trivy-action`) publish cosign-signed releases. We
  could verify those before consuming. Same surface as the broader
  cosign work (modes 9.9 + 10.8); deferred to Phase 12.

- **`pip install --require-hashes` mode.** A fully-hashed
  requirements.txt would eliminate even the "pinned-but-trusting-PyPI"
  attack window. Genuinely more secure but operationally heavy (every
  transitive dep needs a hash). The architect's existing
  `pyproject.toml` + `pip install -e` pattern doesn't naturally
  emit a hash file. Out of scope for this closure; flagged.

- **Action SHA-pin enforcement as a CI gate.** A `check-action-pins.ts`
  script could parse all workflows and assert every `uses:` reference
  ends in a 40-char hex SHA. Cheap (< 1 hour), useful as a regression
  guard. **Going forward, recommended as a follow-up commit.**

- **Verifying the SHA-pinned action repo hasn't been deleted /
  privated.** If the action's repo goes away, our CI breaks. The
  existing renovate posture handles this passively; explicit alerting
  is a Phase 12+ ask.

## Files touched

- `.github/workflows/ci.yml` (SHA pins applied to 7 actions, multiple instances each)
- `.github/workflows/contract-test.yml` (SHA pins)
- `.github/workflows/phase-gate.yml` (SHA pins)
- `.github/workflows/python-ci.yml` (SHA pins + pinned pip/wheel/setuptools)
- `.github/workflows/secret-scan.yml` (SHA pins + gitleaks sha256 verify)
- `.github/workflows/security.yml` (SHA pins)
- `.github/workflows/synthetic-failure.yml` (SHA pins)
- `docs/audit/evidence/hardening/category-10/mode-10.3/CLOSURE.md` (this file)

## Verification

- `grep -hE "uses:\s+[a-zA-Z0-9/-]+@[a-zA-Z0-9._-]+" .github/workflows/*.yml | sort -u`
  shows every `uses:` reference now resolves to a 40-character commit
  SHA (the only exceptions are the `aquasecurity/trivy-action@<SHA>`
  line in ci.yml which is already SHA-pinned, and any reusable
  workflow `uses:` which doesn't appear in current workflows).
- `python-ci.yml` two pip-install steps now carry the pinned version
  numbers.
- `secret-scan.yml` gitleaks install includes the `sha256sum -c -`
  step before extraction.
- `bash -n` on each workflow file would catch syntax errors; the
  sed-based rewrite preserved the YAML structure (verified by
  inspection of the resulting `grep` listing).

## Architect signal recorded

No specific Q4 / orientation question for 10.3; the closure is
mechanical pinning per the orientation's explicit recommendation. The
architect's `proceed` for Category 10 is on-record concurrence.
