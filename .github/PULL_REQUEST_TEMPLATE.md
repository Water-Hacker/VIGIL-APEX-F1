# Pull Request

## Ring & Scope

<!-- Which ring is this PR part of? Which packages/apps does it touch? -->

- Ring: `0` / `1` / `2` / `3` / `4` / `5`
- Scope: `<package or app name>`

## Description

<!-- What does this PR do? Why? Cite SRD/EXEC/Companion sections. -->

## Self-critique checklist (per [docs/IMPLEMENTATION-PLAN.md](../docs/IMPLEMENTATION-PLAN.md))

- [ ] Matches SRD spec exactly, with cited section numbers
- [ ] Every external input validated (Zod / parameterised SQL / CSP / rate-limited)
- [ ] Secrets only via Vault, never hardcoded
- [ ] All operations idempotent or with deterministic dedup keys
- [ ] Failure logged with structured context, metrics, and correlation ID
- [ ] Unit tests written; coverage ≥ 80% on critical paths
- [ ] Runs as non-root in minimal container with read-only filesystem (where applicable)
- [ ] Audit trail captured for any consequential action
- [ ] Cannot produce a fabricated finding under malicious input
- [ ] No code is dead (YAGNI check)

## Acceptance test reference

<!-- Which SRD §30 acceptance test(s) does this satisfy or move closer to passing? -->

- AT-?-??:

## Decision-log entries

<!-- Any new entries in docs/decisions/log.md? -->

- DECISION-???:

## Architect sign-off

<!-- Once merged to main, the architect signs the merge commit with their YubiKey. -->

🤖 Generated with [Claude Code](https://claude.com/claude-code)
