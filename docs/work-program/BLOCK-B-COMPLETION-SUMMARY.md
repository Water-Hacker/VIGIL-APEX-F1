# BLOCK B — completion summary (2026-05-01)

> **Status:** all six items in the Block-B plan §2 running order
> shipped. Workspace gates green. Halting for architect review
> before opening Block C.

---

## Commits

| #     | Item                                                     | Commit    |
| ----- | -------------------------------------------------------- | --------- |
| 0     | Block-B plan + 3 batched hold-points                     | `63b8dc5` |
| 0a    | (CI fix) doc-banners test 27 → 29                        | `4c71e5f` |
| B.1   | Track A reconciliation — flip 🟩 on A1/A3/A4/A7/A10      | `1cda4c3` |
| B.2   | A9 PLACEHOLDER sweep + worker-anchor guard tighten       | `7230283` |
| B.3   | A5.4 CAS test no-skip regression in CI                   | `04175f9` |
| B.4   | A2 SafeLlmRouter migration (tip-triage + adapter-repair) | `10dac28` |
| B.5   | A8 E2E fixture coverage audit                            | `7bc3f33` |
| B.6   | A6 DECISION-012 promotion prep (A6.1 + A6.3 + A6.4)      | `dda20b7` |
| B.6.1 | (chore) vitest devDep fix for tip-triage                 | `d0b1a53` |

(Block-A blanket reset commits 19e29ca through 4c71e5f are
on the same branch but landed before Block B opened.)

---

## Workspace gate state

- `pnpm exec turbo run build  --continue --force` → **39/39 green**
- `pnpm exec turbo run typecheck --continue --force` → **56/56 green**
- `pnpm exec turbo run lint   --continue --force` → **56/56 green**
- `pnpm exec turbo run test   --continue --force` → **49/49 green** (was 48 pre-B.4; +1 from worker-tip-triage now testing)

---

## Track A status after Block B

| Item | Status  | Source                                                                                                 |
| ---- | ------- | ------------------------------------------------------------------------------------------------------ |
| A1   | 🟩      | corpus 224 ≥ 200 (no commit needed)                                                                    |
| A2   | 🟩      | all five workers wrap LlmRouter with SafeLlmRouter (B.4 migrated the last two)                         |
| A3   | 🟩      | all 11 listed packages have ≥ 1 test file                                                              |
| A4   | 🟩      | worker-federation-receiver 40/40 pass                                                                  |
| A5   | 🟩      | A5.1/2/3 already done; A5.4 CAS-no-skip pin shipped in B.3                                             |
| A6   | 🟩 / 🟦 | Agent-side A6.1 / A6.3 / A6.4 shipped in B.6. **A6.5 (FINAL flip) is the remaining architect action.** |
| A7   | 🟩      | both stale TODO C5b refs already cleaned (no commit needed)                                            |
| A8   | 🟩      | fixture audit doc shipped; 0 fixture commits warranted                                                 |
| A9   | 🟩      | 23 PLACEHOLDER hits classified; 1 real gap (POLYGON_ANCHOR_CONTRACT) closed in B.2                     |
| A10  | 🟩      | check-pattern-coverage.ts already wired in phase-gate.yml                                              |

---

## Doctrine-preservation evidence (A2 / B.4)

The architect's Block-B note specified that the SafeLlmRouter
migration must preserve every layer of AI-SAFETY-DOCTRINE-v1. The
doctrine-surface tests added in B.4 pin the contract for both
newly-migrated workers (worker-tip-triage 11/11; worker-adapter-repair
11/11):

| Layer                              | worker-tip-triage              | worker-adapter-repair          |
| ---------------------------------- | ------------------------------ | ------------------------------ |
| L1 hallucination (citations)       | N/A (paraphrase)               | N/A (selector inference)       |
| L4 prompt injection (system rules) | uniform via doctrine preamble  | uniform                        |
| L4 schema validation               | preserved (zParaphrase)        | preserved (zCandidateSelector) |
| L8 anchoring                       | N/A                            | N/A                            |
| L9 prompt-version pin              | NEW                            | NEW                            |
| L11 daily canary                   | NEW                            | NEW                            |
| L11 call-record audit              | NEW                            | NEW                            |
| L13 jailbreak                      | T=0.1 default + schema floor   | T=0.1 + schema floor           |
| L14 model update                   | model_id pinned in call_record | same                           |

**No layer weakened.** Both workers strengthened on L9/L11/L14.

The PII-stripping (worker-tip-triage) and conservative-selector
(worker-adapter-repair) instructions moved from system prompts to
the closed-context `<task>` element. The doctrine system preamble
still binds Claude to "Output STRICTLY the JSON schema you are
given" (rule 4), and zParaphrase's 500-char ceiling provides a
structural floor against verbatim-echo. Same pattern worker-
extractor uses (its SafeLlmExtractor also passes rich `task`
instructions, not a one-word label).

---

## Surfaced architect-action items

### A6.5 — DECISION-012 PROMOTION TO FINAL

The agent does NOT promote autonomously per the operating posture.

When ready, follow the procedure documented in
[docs/decisions/decision-012-readthrough-checklist.md §Promotion procedure](../decisions/decision-012-readthrough-checklist.md):

1. Walk every checkbox in
   [decision-012-readthrough-checklist.md](../decisions/decision-012-readthrough-checklist.md)
   §1–§11.
2. Reference [decision-012-promotion-prep.md](../decisions/decision-012-promotion-prep.md)
   for A6.1 / A6.3 / A6.4 evidence.
3. Edit [docs/decisions/log.md](../decisions/log.md) DECISION-012
   entry: `Status: PROVISIONAL ...` → `Status: FINAL`; append
   `Promoted to FINAL: <date>` + `Architect: Junior Thuram Nana`.
4. Commit on `main` with `git commit -S`:
   `chore(decisions): promote DECISION-012 (TAL-PA) to FINAL`.
5. Emit the `decision.recorded` audit-of-audit row via audit-bridge
   (curl block in the checklist).

### A8 follow-up — SRD §30 enumeration

[docs/work-program/E2E-FIXTURE-COVERAGE.md §5](./E2E-FIXTURE-COVERAGE.md#5-hold-point--surfaced-for-architect)
documents that SRD §30.1–§30.7 carry milestone titles but no
enumerated tests. Architect picks one:

- **Option A:** the architect writes the M0c/M1/M2/M3 acceptance
  criteria explicitly into SRD §30. Then the fixture audit
  re-runs against the authoritative list.
- **Option B (default):** the agent drafts a §30 enumeration based
  on the inferred mapping in
  [E2E-FIXTURE-COVERAGE.md §3](./E2E-FIXTURE-COVERAGE.md#3-inferred-phase-1-milestone-gates--fixture-step-mapping)
  in a future block.

### A5 deferred follow-up — salt-collision CI alert

The `audit.public_export_salt_collisions` view exists; the CI
alert that fires on a non-empty result was deferred in B.6 (see
[decision-012-promotion-prep.md A6.4 failure-mode table](../decisions/decision-012-promotion-prep.md#failure-modes--guards)).
No urgency — the cron only runs quarterly so the operator has 90
days to detect a forgotten rotation.

---

## What changed below the surface

### New files

- `docs/work-program/BLOCK-B-PLAN.md`
- `docs/work-program/BLOCK-B-COMPLETION-SUMMARY.md` (this file)
- `docs/work-program/A9-PLACEHOLDER-AUDIT.md`
- `docs/work-program/E2E-FIXTURE-COVERAGE.md`
- `docs/decisions/decision-012-promotion-prep.md`
- `apps/worker-tip-triage/src/prompts.ts`
- `apps/worker-tip-triage/__tests__/safe-call.test.ts`
- `apps/worker-adapter-repair/__tests__/safe-call.test.ts`
- `apps/worker-anchor/__tests__/contract-address-guard.test.ts`

### Modified files

- `docs/work-program/PHASE-1-COMPLETION.md` (Track A items + snapshot table)
- `apps/worker-anchor/src/index.ts` (POLYGON_ANCHOR_CONTRACT regex tightening)
- `apps/worker-tip-triage/src/index.ts` (LlmRouter → SafeLlmRouter)
- `apps/worker-tip-triage/package.json` (test script + vitest devDep)
- `apps/worker-adapter-repair/src/index.ts` (LlmRouter → SafeLlmRouter)
- `apps/worker-adapter-repair/src/prompts.ts` (registry registration + SELECTOR_REDERIVE_TASK)
- `.github/workflows/ci.yml` (CAS no-skip regression step)

---

## Next: Block C

Block C is "Track A from PHASE-1-COMPLETION.md" was actually Track B
or Track C tracks per the PHASE-1-COMPLETION.md structure. The
Block-B plan deliberately scoped Block B to Track A only. Block C
opens against:

- **Track B — Documentation completeness:** B1 pattern catalogue
  (43 docs), B2 worker runbooks (38 bilingual), B3 DR rehearsal,
  B4/B5 TRUTH/decision-log refresh.
- **Track C — Operational readiness:** C1 compose smoke, C2 Vault
  Shamir, C3 Tor health monitor, C4 Grafana, C5 Falco, C6 sentinel,
  C7 phase-gate validation, C8 PR/commitlint, C9 backup script,
  C10 secret-scan baseline.

Halting here for architect review. Recommend the architect:

1. Sign A6.5 if comfortable promoting DECISION-012 now, OR keep
   it as a separate deliberate session.
2. Pick A / B for the SRD §30 enumeration follow-up.
3. Authorise Block C scope (Track B + Track C, or one of the two,
   or a different sub-set).
