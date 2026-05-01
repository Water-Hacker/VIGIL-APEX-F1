# Decision-log cross-link audit (Block-C B5 / 2026-05-01)

> Per Block-C C.5: every DECISION-N (N >= 7) must carry, anywhere
> in its body, AT LEAST ONE `AUDIT-NNN` reference AND ONE of
> {`W-NN` weakness id, 7+-character commit sha,
> `commit: <sha>` line}. Permissive contract per architect signoff.
>
> DECISION-000 through DECISION-006 are LEGACY-EXEMPT (predate the
> cross-link convention). The lint at
> [`scripts/check-decision-cross-links.ts`](../../scripts/check-decision-cross-links.ts)
> enforces the contract; this document is the human-readable audit.

---

## Status — first run, 2026-05-01

`pnpm exec tsx scripts/check-decision-cross-links.ts` reports
**10 of 19 entries failing** the contract.

Per architect signoff ("Do not retrofit cross-links to predate the
convention"): the agent does NOT backfill. The 10 failures are
surfaced for architect resolution.

### Per-entry status

| ID            | Status        | Has AUDIT-NNN   | Has W-NN OR commit-sha | Note                                                                                              |
| ------------- | ------------- | --------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| DECISION-000  | LEGACY-EXEMPT | —               | —                      | Pre-convention                                                                                    |
| DECISION-001  | LEGACY-EXEMPT | —               | —                      | Pre-convention                                                                                    |
| DECISION-002  | LEGACY-EXEMPT | —               | —                      | Pre-convention                                                                                    |
| DECISION-003  | LEGACY-EXEMPT | —               | —                      | Pre-convention                                                                                    |
| DECISION-004  | LEGACY-EXEMPT | —               | —                      | Pre-convention                                                                                    |
| DECISION-005  | LEGACY-EXEMPT | —               | —                      | Pre-convention                                                                                    |
| DECISION-006  | LEGACY-EXEMPT | —               | —                      | Pre-convention                                                                                    |
| DECISION-007  | OK            | yes             | yes                    |                                                                                                   |
| DECISION-008  | OK            | yes             | yes                    |                                                                                                   |
| DECISION-009  | **FAIL**      | yes (AUDIT-071) | no                     | Has the AUDIT-071 PROVISIONAL banner but no W-NN or commit ref in body.                           |
| DECISION-010  | **FAIL**      | yes (AUDIT-071) | no                     | Same shape as DECISION-009.                                                                       |
| DECISION-011  | **FAIL**      | yes (AUDIT-071) | no                     | Same shape.                                                                                       |
| DECISION-012  | **FAIL**      | no              | yes (W-11)             | TAL-PA doctrine; references W-11 (Polygon-anchor weakness) but no AUDIT-NNN.                      |
| DECISION-013  | **FAIL**      | no              | yes (W-03,08,10,14,16) | Multiple W-NN; no AUDIT-NNN.                                                                      |
| DECISION-014  | **FAIL**      | no              | no                     | Pattern library production-input wiring; no cross-refs in body.                                   |
| DECISION-014b | **FAIL**      | no              | no                     | Pattern stages 3/4/6/8 closure; no cross-refs.                                                    |
| DECISION-014c | **FAIL**      | no              | no                     | All 43 patterns production-ready closure; no cross-refs.                                          |
| DECISION-015  | **FAIL**      | no              | yes (W-14, ed25519)    | Codebase scaffold + TODO closure; W-14 + a 7-char ed25519 substring (false positive — not a sha). |
| DECISION-016  | **FAIL**      | no              | yes (W-03, W-17)       | Tip retention + dashboard UI/UX; W-03 + W-17 but no AUDIT-NNN.                                    |

### Architect-action options

The architect chooses ONE (per the "do not retrofit" instruction):

- **(a) Backfill in a separate architect session.** Walk D-009 to
  D-016, add the missing AUDIT-NNN / commit-sha / W-NN references
  the architect can recall (or has at hand). The lint then passes.
  Recommended for entries the architect does remember the relevant
  audit findings for.

- **(b) Extend the legacy allowlist to D-009..D-016.** Treats the
  failing entries as pre-convention and only enforces from D-017
  onward. Pragmatic if backfill burden is high.

- **(c) Loosen the lint contract.** Drop the W-NN/commit-sha
  requirement; require only AUDIT-NNN. (D-009/010/011 would then
  pass via AUDIT-071. D-012..016 still fail on AUDIT-NNN.)

- **(d) Accept temporary red CI.** Lint stays strict; CI fails
  until the architect backfills at their own pace. Forcing
  function — but blocks every PR until resolved.

### Forward contract

Regardless of how the existing failures resolve, every DECISION-N
landing AFTER 2026-05-01 must satisfy the contract:

> Anywhere in the entry body, AT LEAST ONE `AUDIT-NNN` reference
> AND ONE of: `W-NN` weakness id, 7+-character commit sha,
> `commit: <sha>` line.

The lint catches drift at PR-time so the architect cannot
accidentally land an under-cross-linked decision.

### Lint false-positive surface

The 7+-character commit-sha regex `\b[0-9a-f]{7,40}\b` matches
genuine sha1/sha256 prefixes BUT also matches arbitrary lower-hex
substrings. Notable false positive:

- DECISION-015 body contains `ed25519` which matches the regex (7
  hex chars). The lint counts this as a commit-sha; in fact it's
  not. The contract is satisfied "for the wrong reason" but is
  satisfied. Architect call whether to tighten.

Tightening (`(?:commit|sha)[:\s]+[0-9a-f]{7,40}`) is a one-line
follow-up if the false-positive surface bites in practice.

---

## Cross-references

- [`scripts/check-decision-cross-links.ts`](../../scripts/check-decision-cross-links.ts) — the lint.
- [`scripts/check-decisions.ts`](../../scripts/check-decisions.ts) — orthogonal lint (W-27 phase + audit-event-id).
- **DECISION-007** — the first entry expected to satisfy the contract.
- **OPERATIONS.md §7** — broader decision-log discipline.
