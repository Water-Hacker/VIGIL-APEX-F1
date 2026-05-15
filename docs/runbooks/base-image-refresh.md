# Runbook — Quarterly base-image refresh

> Operational policy + procedure for rotating the base image tags
> referenced in `infra/docker/dockerfiles/*.Dockerfile`. Closes the (c)
> sub-task of mode 10.2 (Compromised container base image).
>
> **Audience:** the on-call engineer running a scheduled base-image
> rotation or responding to a `trivy-base-images` CI failure that the
> Trivy gate can't auto-remediate.
>
> **Authority:** the architect schedules the cadence; this document is
> the canonical procedure. The pre-deploy checklist below is recorded
> in the PR description.

---

## Why a calendar cadence, even without a CVE alert

The `trivy-base-images` CI gate (mode 10.7 + 10.2(a) closure) catches
**published, fixed CVEs**. Two failure modes it does NOT catch:

1. **CVEs without a published fix.** The gate uses `--ignore-unfixed`
   to avoid flapping on unfixable findings. An unfixable CVE in
   `node:20.17.0-alpine` accumulates risk silently — until the
   upstream maintainer ships a fix in `node:20.18.x-alpine`. Without
   a calendar bump, we'd stay on the affected tag indefinitely.

2. **Latent CVE-disclosure drift.** The CVE database is necessarily
   reactive; a vulnerability may exist in the base image's binaries
   for months before it's catalogued. Pulling a fresher base image
   gets us the maintainer's accumulated fixes for not-yet-disclosed
   issues.

The quarterly cadence is a hedge against both. **Even when the Trivy
gate is green, we rotate.**

---

## Cadence

**Quarterly: the first Monday of January, April, July, and October.**

The cadence is set in the architect's calendar with a 1-week lead.
The lead lets the on-call review upstream changelog notes before
the bump.

If a Trivy gate failure can't be remediated by an immediate bump
(e.g., the maintainer hasn't shipped a fix yet), the next scheduled
refresh is the recovery checkpoint.

---

## Procedure

### 1. Enumerate the current base images

The source of truth is `scripts/enumerate-base-images.ts`:

```bash
pnpm exec tsx scripts/enumerate-base-images.ts
```

This emits the list the Trivy gate scans. At closure time:

```
caddy:2.8-alpine
caddy:2.8-builder
mcr.microsoft.com/playwright:v1.47.2-jammy
node:20.17.0-alpine
python:3.12.6-slim-bookworm
```

If the script reports SKIP for any Dockerfile, resolve the
unsubstituted ARG before proceeding — otherwise the refresh might
miss an image.

### 2. Identify the candidate bump for each image

Per image:

1. Visit the upstream registry / repo:
   - `docker pull --quiet $IMG && docker image ls --format '{{.Repository}}:{{.Tag}} {{.Size}}'`
     for a sanity-check.
   - For Docker Hub-hosted images
     (`node`, `python`, `caddy`, `postgres`, `redis`, `hashicorp/vault`):
     visit `hub.docker.com/_/$REPO/tags?page=1&ordering=last_updated`
     and identify the latest patch release for the major series we
     pin (e.g., `node:20.X.Y-alpine` for the 20.x line).
   - For Microsoft Container Registry (`mcr.microsoft.com/playwright`):
     `hub.docker.com` doesn't index it; visit the project's docs
     or `https://mcr.microsoft.com/v2/playwright/tags/list`.

2. **DO NOT** bump the major version line without a separate review
   pass. Quarterly refresh is patch-level (e.g., `20.17.0-alpine` →
   `20.19.4-alpine`). A major bump (20.x → 22.x) carries breaking-
   change risk; do that in a dedicated, architect-approved PR.

3. Note the candidate version per image.

### 3. Update the Dockerfile FROM lines

For each Dockerfile under `infra/docker/dockerfiles/`:

```bash
# Example: bumping node from 20.17.0 to 20.19.4
sed -i 's|node:20\.17\.0-alpine|node:20.19.4-alpine|g' \
  infra/docker/dockerfiles/Worker.Dockerfile \
  infra/docker/dockerfiles/Dashboard.Dockerfile \
  infra/docker/dockerfiles/AdapterRunner.Dockerfile

# For Python ARG-substituted images, update the ARG default:
sed -i 's|ARG PYTHON_VERSION=3\.12\.6|ARG PYTHON_VERSION=3.12.10|' \
  infra/docker/dockerfiles/PythonWorker.Dockerfile
```

Or open each file manually. The mechanical sed is fine for a single-
character version bump; check the diff before committing.

### 4. Verify the enumeration is unchanged in shape

```bash
pnpm exec tsx scripts/enumerate-base-images.ts
```

Should still emit one line per image, no SKIPs introduced by the bump.

### 5. Run the Trivy gate locally (optional, recommended)

```bash
# Install trivy if needed (see ci.yml `trivy-base-images` job for the
# sha256-verified install pattern).
trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 node:20.19.4-alpine
# Repeat for each bumped image.
```

If any image fails locally, the bump introduces a new CVE the previous
tag didn't have — abandon this candidate, find a newer patch, or wait
for the maintainer to publish a fix.

### 6. Open a PR

PR title: `chore(docker): quarterly base-image refresh — YYYY-QN`.

PR description (architect-signed checklist):

- [ ] **What changed**: list the bumps in a table (old → new per image).
- [ ] **Trivy local gate passed for every bumped image.**
- [ ] **No major version bump.** (Patch / minor only.)
- [ ] **CI `trivy-base-images` is green** on the PR.
- [ ] **CI `test` + `docker-build` are green** on the PR.
- [ ] **Changelog notes reviewed for each bumped image** (any
      breaking changes upstream that affect our usage?).

### 7. Merge + monitor

After merge, the deployed images on the next deploy will use the new
base. Watch:

- The `vigil_container_*` Prometheus metrics for any startup
  regression.
- The audit-chain reconciler for any false-positive triggered by
  changed binary behaviour.

### 8. Audit log

```sql
INSERT INTO audit.event (kind, payload, actor) VALUES (
  'base_image.refreshed',
  jsonb_build_object('quarter', '2026-Q3', 'pr', '#NNN', 'at', NOW()),
  'on-call@example.org'
);
```

---

## Out-of-band refresh (CVE-triggered)

If the `trivy-base-images` CI gate fails BETWEEN scheduled refreshes
on a CVE with a published fix:

1. Skip the cadence; the gate failure IS the trigger.
2. Run steps 1–8 above but for the affected image only.
3. PR title: `chore(docker): emergency base-image bump — CVE-YYYY-NNNNN`.
4. Architect-priority review.
5. After merge, run the `trivy-base-images` gate manually on `main`
   to confirm green.

---

## What this runbook does NOT cover

- **Digest pinning** (mode 10.2(b)). Deferred to Phase 12 alongside
  cosign verify (modes 9.8 + 9.9 + 10.8). When that closure lands,
  this runbook's step 3 expands to update both the FROM tag AND the
  pinned digest (`FROM node:20.19.4-alpine@sha256:<DIGEST>`).

- **Cosign signature refresh** (mode 10.8 / 9.9). Same Phase 12.

- **Vendor lifecycle changes.** If an upstream image (e.g., a Node.js
  major version) reaches end-of-life and we need to migrate to a new
  major series, that's a dedicated migration PR with its own testing
  campaign, not a quarterly refresh.

- **Application-language version bumps.** Bumping `node:20.X.Y` to
  `node:22.X.Y` is a different exercise — it changes the V8 runtime,
  the npm-resolved tree, and potentially breaks workspace packages.
  Out of scope for quarterly refresh.

---

## Related

- `scripts/enumerate-base-images.ts` — single source of truth for the
  image list.
- `.github/workflows/ci.yml` `trivy-base-images` job — the always-on
  CVE gate.
- `docs/runbooks/secret-rotation.md` — sister operational runbook
  pattern (quarterly cadence with calendar reminders).
- `docs/audit/evidence/hardening/category-10/mode-10.7-10.2a/CLOSURE.md`
  — the Trivy gate closure that this runbook depends on.
- `docs/audit/evidence/hardening/category-10/mode-10.2c/CLOSURE.md` —
  this closure.
