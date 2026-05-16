# Mode 10.2(b) — Digest-pin FROM lines (sub-task of 10.2)

**State after closure:** framework-closed, activation-pending
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 12a / Cross-cutting
**Branch:** `hardening/phase-1-orientation`

## Identical scope to mode 9.8

Per orientation §3.10 / 10.2: "(b) digest-pin FROM lines via a
mechanical script". This is the supply-chain-hygiene mirror of mode
9.8 (which the orientation classifies under "Configuration, deployment,
and secrets" Cat 9). Both modes close on the same framework:
`scripts/pin-image-digests.ts` + the resulting lockfile.

See [`../../category-9/mode-9.8/CLOSURE.md`](../../category-9/mode-9.8/CLOSURE.md)
for the full closure narrative.

## Mode 10.2 overall state

Mode 10.2 has three sub-tasks per orientation §3.10:

| Sub-task                         | Closure location                                  | State after Phase 12a                |
| -------------------------------- | ------------------------------------------------- | ------------------------------------ |
| (a) Trivy step                   | `category-10/mode-10.7-10.2a/CLOSURE.md` (Cat 10) | closed-verified                      |
| (b) Digest pinning               | This doc + `category-9/mode-9.8/CLOSURE.md`       | framework-closed, activation-pending |
| (c) Quarterly base-image refresh | `category-10/mode-10.2c/CLOSURE.md`               | closed-verified                      |

Mode 10.2 itself remains **partial** at Phase 12a end — (a) and (c)
are closed-verified, (b) is framework-closed pending activation.

## Re-open trigger

Identical to mode 9.8 — both close together when
`pin-image-digests.ts --apply` runs against the live registry, the
lock file is committed, and the `--verify` step lands in CI.
