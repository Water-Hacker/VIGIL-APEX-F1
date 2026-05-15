# Mode 10.2(c) — Quarterly base-image refresh policy

**State after closure:** sister to 10.2(a) (Trivy gate). Mode 10.2 remains
partial pending (b) digest pinning, deferred to Phase 12.
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 11 / Category 10
**Branch:** `hardening/phase-1-orientation`

## The failure mode

Per orientation §3.10 / 10.2 sub-task (c):

> Quarterly base-image refresh schedule.

The Trivy gate (10.7 + 10.2(a) sister closure) catches CVEs with
published fixes. It explicitly does NOT catch:

1. **CVEs without a published fix** — `--ignore-unfixed` is used to
   avoid flapping on unfixable findings; an accumulating unfixable CVE
   on a stale tag is silent risk.
2. **Latent CVE-disclosure drift** — vulnerabilities in the base
   image's binaries may exist for months before they're catalogued.

A calendar cadence hedges both.

## Q4-default ratification

Orientation §7 has no question on this sub-task — it's a procedural
deliverable. The architect's `proceed` for Category 10 is the
on-record signal that the quarterly cadence (chosen as the
orientation's default) is acceptable.

## What was added

### `docs/runbooks/base-image-refresh.md` (new, ~200 lines)

A new operational runbook with:

- **Why a calendar cadence**: rationale for rotating even when the
  Trivy gate is green.
- **Cadence**: first Monday of January, April, July, October.
  1-week architect-calendar lead time.
- **8-step procedure**: enumerate → identify candidate → update
  Dockerfiles → re-enumerate → local Trivy → PR with architect-signed
  checklist → merge + monitor → audit-chain entry.
- **Out-of-band refresh**: shorter CVE-triggered procedure when the
  Trivy gate fires between scheduled refreshes.
- **Out-of-scope**: digest pinning (10.2(b)), cosign refresh (10.8),
  vendor-lifecycle migrations, major version bumps.

The runbook explicitly references `scripts/enumerate-base-images.ts`
as the single source of truth — the same enumerator the Trivy CI gate
uses. A future contributor who adds a new Dockerfile picks up the
refresh procedure automatically.

## The invariant

Three layers protect against base-image staleness:

1. **Trivy CI gate** (sister closure, 10.7 + 10.2(a)) — catches
   published, fixable CVEs continuously.
2. **Quarterly refresh runbook** (this closure) — calendar cadence
   that pulls fresher tags even without a CVE alert.
3. **Architect-signed PR checklist** — five-item review before each
   refresh merges, ensuring no major version bumps slip through under
   the "quarterly refresh" label.

The third layer (digest pinning, 10.2(b)) lands in Phase 12 alongside
cosign. Until then, the refresh procedure is the operator-vigilance
layer.

## What this closure does NOT include

- **A CI gate enforcing cadence.** No automation fails CI when the
  last refresh is > 90 days old. Could be added (~30 min — query
  `git log -1 --format=%ci infra/docker/dockerfiles/` and assert
  recency), but the calendar reminder + architect-priority review
  catches this at the human layer. Future hardening.

- **Automated PR generation.** Renovate or Dependabot can be
  configured to open PRs for base-image bumps, similar to the
  npm-package automation we already have. Out of scope for this
  closure; would require Renovate config additions + per-image
  groupSlug + commit-message templating. Flagged for future
  hardening.

- **Vendor-lifecycle monitoring.** When `node:20.x` reaches EOL, no
  automation alerts the architect. Manual via the architect's
  external calendar; not part of this runbook.

## Files touched

- `docs/runbooks/base-image-refresh.md` (new, ~200 lines)
- `docs/audit/evidence/hardening/category-10/mode-10.2c/CLOSURE.md` (this file)

## Verification

- The runbook references `scripts/enumerate-base-images.ts` by exact
  path; the script exists at that path with the documented behaviour
  (verified by `pnpm exec tsx scripts/enumerate-base-images.ts` → 5
  images enumerated).
- The 8-step procedure was hand-walked against the current Dockerfile
  set (5 base images) with a hypothetical `node:20.17.0-alpine` →
  `node:20.19.4-alpine` bump; the sed pattern + Trivy local-gate step
  cover the work-block.
- The runbook's `Related` section links to all four sister artefacts
  (script, CI job, secret-rotation pattern, sister closure doc) by
  exact path.
