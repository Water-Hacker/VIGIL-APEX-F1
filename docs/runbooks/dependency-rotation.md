# Dependency-rotation runbook

Block-E E.8 / E3.

## What this covers

The architect-review workflow for npm dependency upgrades surfaced by
**renovate-bot** ([`renovate.json`](../../renovate.json)) and
**Snyk Pro** ([`.github/workflows/security.yml`](../../.github/workflows/security.yml),
[`.snyk-policy.yaml`](../../.snyk-policy.yaml)). It captures the SLA,
the auto-merge policy, and the architect's PR-triage cadence for the
two upstream signal sources.

## SLA

| Signal class                                              | Source                                | Architect SLA            | Auto-merge policy                 |
| --------------------------------------------------------- | ------------------------------------- | ------------------------ | --------------------------------- |
| Critical CVE (CVSS ≥ 9.0)                                 | Snyk + renovate `vulnerabilityAlerts` | **7 days from PR open**  | Never (`automerge: false`)        |
| High CVE (CVSS ≥ 7.0, < 9.0)                              | Snyk + renovate `vulnerabilityAlerts` | 30 days                  | Never                             |
| Tier-1 crypto pkg (libsodium, simplewebauthn, kubo, jose) | renovate `packageRules`               | Quarterly review         | Never; 14-day minimum release age |
| Smart-contract pkg (ethers, hardhat)                      | renovate `packageRules`               | Quarterly review         | Never; 7-day minimum release age  |
| @anthropic-ai/sdk                                         | renovate `packageRules`               | Quarterly review         | Never; 3-day minimum release age  |
| Schema-shape pkg (drizzle-orm, drizzle-kit)               | renovate `packageRules`               | Quarterly review         | Never on majors                   |
| All other major bumps                                     | renovate                              | Quarterly review         | Never                             |
| All other patch / minor                                   | renovate                              | Best effort, batch-merge | Never (architect signs manually)  |

The 7-day Critical SLA is the binding figure. All others are
internal-cadence targets — slipping them is not a CI gate but does
trigger a calendar reminder on the architect's quarterly review pass.

## Why no auto-merge for devDeps patches

renovate ships with auto-merge disabled across the board, including
devDeps patch updates that the original Block-E plan called out as
auto-merge candidates. The reason is operational: every PR enters the
TAL-PA audit chain via the dashboard's git-event handler, and an
auto-merge bypasses the operator's manual review row. The architect's
preference is "low-friction batch review on Monday morning" over
"fully autonomous merging" — the former preserves the audit-row
property without measurably slowing the dependency cadence.

If the friction model proves wrong over a quarter of operation,
toggle `automerge: true` per-rule (devDeps patch is the lowest-risk
candidate to flip first); record the change in
[`docs/decisions/log.md`](../decisions/log.md) so the audit-of-audit
review can correlate the policy shift with any later incident.

## Architect's quarterly review pass

Run quarterly (March / June / September / December, week 2):

1. Open the renovate **Dependency Dashboard** issue (the bot maintains
   it via the `:dependencyDashboard` extends).
2. Review the **Pending Approval** + **Open** sections. For each PR:
   - Read the changelog link the bot embeds in the PR body.
   - Verify CI is green (build, typecheck, test, lint, a11y, snyk,
     visual when baselines exist).
   - For Tier-1 crypto, smart-contract, and `@anthropic-ai/sdk` PRs,
     manually re-read the upstream release notes and run the relevant
     workspace test suite locally before merging.
3. Batch-merge greens; close stale (>90 days idle, version
   superseded).
4. After the pass, run `pnpm exec tsx scripts/post-quarterly-audit.ts`
   to refresh the `quarterly_audit.last_run` row in
   `audit.system_lifecycle` (creates an `audit.dependency_review`
   audit-of-audit chain row per DECISION-012).

## Vulnerability-alert flow

When Snyk surfaces a Critical CVE OR renovate creates a
`vulnerabilityAlerts`-labelled PR:

1. **Triage within 24 hours** — read the advisory, decide:
   - **Upgrade** — merge the PR; CI exercises the new dep.
   - **Allowlist** — if the vulnerable code-path is unreachable from
     any VIGIL APEX entry point, add an entry to
     [`.snyk-policy.yaml`](../../.snyk-policy.yaml) per the file-
     header rules (rationale + 90-day expiry; mirrors a
     `docs/decisions/log.md` entry).
   - **Architect-acknowledged risk** — if neither upgrade nor
     allowlist applies, write a decision-log entry capturing the
     rationale and accept the temporary CI-gate failure pending
     remediation.
2. **Land the chosen action within 7 days** of PR open (Critical) or
   30 days (High).
3. **Audit row** — every Critical-class triage decision emits an
   `audit.security_decision` chain row with the CVE id, the chosen
   action, and the architect's signing-key id (TAL-PA category J).

## What renovate does NOT cover

- **Workspace cross-packages** (`workspace:*` pins) — explicitly
  ignored via the `matchCurrentVersion: workspace:*` rule. Workspace
  pin updates ship through normal PRs, not renovate.
- **System-level packages** (apt, brew, OS images) — covered by the
  base-image rotation procedure under
  [`docs/runbooks/dr-rehearsal.md`](dr-rehearsal.md).
- **Smart-contract deployment artefacts** — `contracts/` is its own
  sub-tree with hardhat-pinned versions; renovate respects this via
  `matchPackageNames: ['ethers', 'hardhat', ...]` rules.
- **Container base images** (`infra/docker/*/Dockerfile`) — renovate
  has Docker support but is not enabled today; tracked as a
  Block-F follow-up.

## Failure modes + recovery

| Symptom                                        | Likely cause                                    | Recovery                                                                                                                                                                               |
| ---------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| renovate stops opening PRs                     | GitHub App removed / repo permissions changed   | Re-install renovate from https://github.com/apps/renovate; verify org-level permissions; the dashboard issue will resume on the next schedule tick.                                    |
| Tier-1 crypto PR fails CI on `@vigil/security` | upstream API break                              | Open a separate issue; do NOT close the renovate PR. The architect either merges the API-break fix together with the dep bump (one rebase) or pins the prior version via `ignoreDeps`. |
| Snyk false-positive blocks merge               | known-unreachable code path                     | Add `.snyk-policy.yaml` entry per the file-header rules (rationale + 90-day expiry; decision-log entry).                                                                               |
| Quarterly review missed                        | architect on leave / focus block                | Skip is acceptable for one quarter (it accrues a backlog, not a vulnerability); the next pass takes the union of two quarters' PRs.                                                    |
| renovate opens too many PRs                    | `prHourlyLimit` / `prConcurrentLimit` mis-tuned | Tighten the limits in `renovate.json`; the bot self-paces from there.                                                                                                                  |

## References

- BLOCK-E-PLAN.md §2.8 (E.8 spec)
- OPERATIONS.md §4 (CI gates)
- [`renovate.json`](../../renovate.json) — bot config
- [`.snyk-policy.yaml`](../../.snyk-policy.yaml) — Snyk allowlist
- [`docs/decisions/log.md`](../decisions/log.md) — DECISION-N entries for any allowlist additions or policy shifts
