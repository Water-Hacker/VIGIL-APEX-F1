# BLOCK E — plan (Track D + Track E + A5.4 + C9 backup gaps + C2 Vault Shamir + housekeeping)

> **Status:** awaiting architect counter-signature on §3 hold-points.
> **Date:** 2026-05-02.
> **Author:** build agent (Claude).
>
> Plan-first per architect operating posture. Block-E entry Commit 1
> (`b39a18c`) already shipped: applied architect §30 decisions
> (17 ACCEPT / 3 EDIT / 0 REJECT) into SRD-v3.md §30.1..§30.7 and
> retargeted BLOCK-D-COMPLETION-SUMMARY §2.1/§2.3/§2.4 from
> "M0c hardening week" to Block E sub-blocks per audit-trail-
> consistency.
>
> Block-E preconditions verified met: DECISION-012 FINAL on main
> (commit `89b0abb`, 2026-05-02); SRD-30-architect-decisions.md
> committed on this branch (commit `c28e6d6`, 2026-05-02);
> phase-gate.yml CI green at branch tip.
>
> Architect note (carried forward from Block-D close): "Block E is
> the largest of the five blocks. Don't compress. The pattern that's
> worked through A-D is the pattern that should carry E."

---

## 1. Sub-stage decomposition

Eighteen sub-blocks plus the close summary. Architect's "don't
compress" note is honoured by per-commit decomposition; the two
substantial sub-blocks (E.13 audit-chain offline export with new
verifier tool, E.17 C2 Vault Shamir Option B) sub-split internally.

| #    | Track           | Item                                                       | Output                                                                                                           |
| ---- | --------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| E.0  | Housekeeping    | Sentinel rename + complete-on-arrival markers              | one commit (see §2.0)                                                                                            |
| E.1  | Track D         | D1 Council vote ceremony E2E                               | E2E test driver + 5-mock-pillar fixture; assert vote + posterior + dossier-render + high-sig anchor              |
| E.2  | Track D         | D2 Tip portal Tor flow E2E                                 | Tor SOCKS proxy E2E; assert ciphertext + 3-of-5 decrypt + paraphrase + raw-text-stays-behind-quorum              |
| E.3  | Track D         | D3 + D4 Delivery + federation E2E (bundled)                | local SFTP E2E (CONAC) + federation envelope sign/verify/replay-protect E2E                                      |
| E.4  | Track D         | D5 WebAuthn → secp256k1 E2E                                | E2E for the WebAuthn-fallback path (W-10); native libykcs11 helper remains M3-M4                                 |
| E.5  | Track D         | D6 + D7 a11y CI + visual regression (bundled)              | playwright a11y wired into ci.yml + visual snapshot harness over the 19 dashboard pages                          |
| E.6  | Track E         | E1 Snyk Pro vulnerability scan                             | CI step gating on Critical / warning on High per OPERATIONS §4                                                   |
| E.7  | Track E         | E2 threat-model code-coverage matrix                       | CSV / matrix doc cross-referencing THREAT-MODEL-CMR.md threats × code mitigations                                |
| E.8  | Track E         | E3 dependency rotation                                     | renovate-bot config + 7-day Critical CVE SLA documentation                                                       |
| E.9  | Track E         | E4 pre-commit secret scan — complete-on-arrival            | mark 🟩 (already shipped in C10); cite the pre-commit + workflow + allowlist                                     |
| E.10 | Track E         | E5 SBOM generation                                         | per-package SBOM via cyclonedx; signed; release-time generation                                                  |
| E.11 | A5.4            | Salt-collision CI alert                                    | wire `audit.public_export_salt_collisions` view → CI alert on non-empty result                                   |
| E.12 | C9 backup gap 1 | Vault snapshot (raft-aware)                                | `vault operator raft snapshot save` step in `10-vigil-backup.sh`; scoped token (NOT root); custody + rotation    |
| E.13 | C9 backup gap 3 | Audit-chain offline export + verifier (substantial)        | COPY-CSV exports for `audit.actions` + `audit.user_action_event` + GPG-sign + new `verify-hashchain-offline.ts`  |
| E.14 | C9 backup gap 4 | Encrypted-at-rest archive                                  | wrap archive outputs in `gpg --encrypt --recipient`; verify architect's PGP encrypt-subkey; R6 runbook update    |
| E.15 | C9 backup gap 2 | Git bundle (low-priority follow-up)                        | `git bundle create` step in `10-vigil-backup.sh`; small follow-up                                                |
| E.16 | C9 backup gap 5 | Hetzner data-residency decision-log entry only             | append decision-log entry on data-residency tradeoff (FR/DE jurisdiction); architect signs separately            |
| E.17 | C2              | Vault Shamir Option B (substantial — 2-3 internal commits) | extend `03-vault-shamir-init.sh` with `--recipient` flags + inline age + KNOWN_EVENT_TYPES + sandboxed Vault E2E |
| E.18 | Close           | Block E completion summary + halt for review               | `docs/work-program/BLOCK-E-COMPLETION-SUMMARY.md`                                                                |

**Estimated logical commits:** 19 base entries + sub-splits in E.13 + E.17 → **20-22 total**. Matches architect's "17+" floor.

Stop after each commit only if a test or lint fails (per operating
posture).

---

## 2. Sub-block-by-sub-block detail

### 2.0 E.0 — Housekeeping

Three small things bundled into one commit:

- **Sentinel-quorum rename** (BLOCK-D §2.2 surfaced item).
  Architect's prior signoff: rename action enum from
  `system.health_degraded` to `sentinel.quorum_outage`. One-enum-add
  in `packages/shared/src/schemas/audit.ts`, one rename in
  `packages/observability/src/sentinel-quorum.ts`'s `emitOutageAuditRow`,
  unit test update + CHANGELOG note. Old enum stays for backward
  compatibility (audit chain has rows with the old name; never
  remove a chain-enum value).
- **§2.1 / §2.3 complete-on-arrival markers.** Already retargeted
  in Commit 1 of this Block-E entry; this commit appends a
  one-line "marked complete-on-arrival in BLOCK-E-PLAN E.0" note
  to `BLOCK-D-COMPLETION-SUMMARY.md` for audit-trail consistency.
- **PHASE-1-COMPLETION snapshot refresh.** Bump the "Last refreshed"
  date and refresh test counts.

**Acceptance:** all gates green; no behavioural change.

### 2.1 E.1 — D1 Council vote ceremony E2E

Mock 5 council members with deterministic test YubiKey identities
(`DeterministicTestSigner` reused from existing audit-chain tests).
Drive a 3-of-5 escalation vote end-to-end:

- council convenes → 3 of 5 ESCALATE on Polygon Mumbai stub
- finding posterior crosses 0.85 (assert)
- dossier render enqueued (assert in stream)
- worker-anchor commits each high-sig event individually (assert
  one `audit.public_anchor` row per event with `is_individual: true`)

**Output:** `apps/dashboard/__tests__/council-vote-e2e.test.ts`
(new) + fixture under `apps/dashboard/__tests__/fixtures/`. Likely
~250 lines. Mocks: PolygonAnchor, council holders, queue.

**Acceptance:** vitest run green; 5 deterministic mock pillars cast
votes; the full audit chain after the test contains the expected
4 `audit.actions` rows (proposal, 3 votes — wait, actually 5 vote
slots: proposal + 5 votes), one `finding.escalation`, and the
high-sig fast-lane anchor row.

### 2.2 E.2 — D2 Tip portal Tor flow E2E

Drive a tip submission via a Tor SOCKS proxy harness (mock
`socks-proxy-agent`; full network test against real Tor is
production-only). Assert:

- ciphertext stored in `tip.encrypted_payload` (libsodium sealed-box)
- 3-of-5 council Shamir decryption reconstructs the operator-team
  private key in-memory
- `worker-tip-triage` paraphrase pass via SafeLlmRouter
  (`tip-triage.paraphrase` prompt, mocked LLM response)
- raw decrypted text never crosses outside the council quorum
  decryption boundary (verified by greeting the `audit.user_action_event`
  rows for the entire flow and asserting no row contains the
  raw plaintext)

**Output:** `apps/worker-tip-triage/__tests__/tor-flow-e2e.test.ts`
(new). ~300 lines.

**Acceptance:** vitest green; raw-text-stays-behind-quorum invariant
asserted.

### 2.3 E.3 — D3 + D4 Delivery + federation E2E (bundled)

Two related E2E tests, one commit:

- **D3 CONAC SFTP delivery.** Spin a local SFTP server (`ssh2-sftp-server`
  in a child process). Render a deterministic dossier, deliver,
  receive ack. Assert `audit.actions` row + `dossier.delivery` row
  - `dossier.delivery_receipt` row + Polygon anchor (mocked).
- **D4 Federation stream E2E.** Sign a federation envelope on the
  agent (Ed25519 deterministic test key), assert: replay-protection
  (second-submit rejected), signature verification (tampered payload
  rejected), region-prefix enforcement (envelope without `region:`
  rejected), payload-cap rejection (payload >5MB rejected with the
  documented error code).

**Output:** `apps/worker-conac-sftp/__tests__/sftp-delivery-e2e.test.ts`
(new) + `packages/federation-stream/__tests__/envelope-e2e.test.ts`
(new). ~200 + ~200 lines.

**Acceptance:** vitest green on both files; full audit-chain trace
intact in both flows.

### 2.4 E.4 — D5 WebAuthn → secp256k1 E2E

Per W-10, the native libykcs11 helper is M3-M4. The WebAuthn fallback
path is shipped; this sub-block adds the E2E that asserts a sample
council member can complete a vote via WebAuthn-fallback-only (no
native helper). Mock the WebAuthn ceremony with a deterministic
test response.

**Output:** `apps/dashboard/__tests__/webauthn-fallback-e2e.test.ts`
(new). ~200 lines.

**Acceptance:** vitest green; the fallback path produces a valid
secp256k1 signature.

### 2.5 E.5 — D6 + D7 a11y CI + visual regression (bundled)

- **D6 a11y.** Wire `playwright test tests/a11y/` into `.github/workflows/ci.yml`
  (currently dashboard `test` target only runs vitest). Assertion
  rule: zero violations of `axe-core` "critical" or "serious" levels.
  Cite OPERATIONS a11y-enforcement requirement in the workflow
  comment.
- **D7 visual regression.** Snapshot the 19 dashboard pages on a
  canonical fixture (already-seeded from `e2e-fixture.sh`) using
  `playwright-snapshot` or `pixelmatch`. Threshold: >0.1% pixel
  difference fails the CI step. Snapshots live under
  `apps/dashboard/__tests__/visual/__snapshots__/`.

**Output:** `apps/dashboard/playwright-a11y.config.ts` +
`apps/dashboard/playwright-visual.config.ts` + ci.yml additions.

**Acceptance:** both Playwright configs run green on canonical
fixture; ci.yml step added; SRD §03.5 UI consistency requirement
satisfied.

### 2.6 E.6 — E1 Snyk Pro vulnerability scan

Wire Snyk into `.github/workflows/ci.yml` per OPERATIONS §4.

- Block on Critical (job fails)
- Warn on High (job passes; PR comment surfaces)
- Snyk token stored as `SNYK_TOKEN` GitHub secret (architect provisions)
- Daily scheduled scan in addition to per-PR

**Output:** ci.yml step + secret-config note in the PR-template /
deployment runbook.

**Acceptance:** Snyk runs against `pnpm-lock.yaml`; pre-existing
known-Critical vulns documented in an allowlist file
(`.snyk-policy.yaml`) with rationale + expiry per finding (no
indefinite suppressions).

**Hold-point candidate:** if any pre-existing Critical surfaces and
isn't allowlist-eligible, halt and surface — never silently suppress.

### 2.7 E.7 — E2 threat-model code-coverage matrix

Walk every threat in `THREAT-MODEL-CMR.md`. For each, cross-reference
to a code mitigation OR an explicit "out of scope" note. Output:

- `docs/security/threat-coverage-matrix.md` (already exists; sweep +
  fill gaps per current code state)

**Output:** doc-only commit; no code change.

**Acceptance:** every threat row in the matrix has either a
file-path code reference OR an "out-of-scope" reason; gaps surface
as architect-action items if any.

### 2.8 E.8 — E3 dependency rotation

Configure renovate-bot for the monorepo:

- Quarterly dependency audit cadence (renovate `schedule` config)
- Auto-merge labels for patch + minor on devDeps
- Critical CVE: renovate opens PR within 7 days; CI gates on the new
  Snyk step from E.6

**Output:** `renovate.json` (new) + a brief
`docs/runbooks/dependency-rotation.md`.

**Acceptance:** renovate-bot configured; 7-day SLA documented.

### 2.9 E.9 — E4 pre-commit secret scan — complete-on-arrival

Mark E4 🟩 in PHASE-1-COMPLETION.md; cite the existing chain:
`.husky/pre-commit` (gitleaks) + `.github/workflows/secret-scan.yml`

- `.gitleaks.toml` (consolidated singular `[allowlist]` form per
  commit `7f90302`). No new code.

**Output:** PHASE-1-COMPLETION.md row flip.

**Acceptance:** PHASE-1 doc updated; no behavioural change.

### 2.10 E.10 — E5 SBOM generation

CycloneDX SBOM per package; generated on release; signed.

- `pnpm cyclonedx` (or `@cyclonedx/cyclonedx-npm`) at release time
- Signed with architect's GPG key
- Attached to GitHub release artifacts

**Output:** new `scripts/generate-sbom.ts` + ci.yml release step.

**Acceptance:** SBOM generated for a tag; signature verifies; CSV /
JSON shape matches CycloneDX 1.5.

### 2.11 E.11 — A5.4 salt-collision CI alert

The `audit.public_export_salt_collisions` view exists (commit on
`packages/db-postgres/drizzle/0012_audit_export_salt_fingerprint.sql`).
Wire a CI alert that fires when the view returns a non-empty result.

- Quarterly cron: query the view; if rows returned, fail the CI step
  AND send Prometheus alert
- 90-day detection window means the cron lives in `adapter-runner`
  alongside the existing `quarterly-audit-export` cron

**Output:** new `apps/adapter-runner/src/triggers/salt-collision-check.ts`

- Prometheus alert rule.

**Acceptance:** synthetic test seeds two consecutive identical
fingerprints; the cron fires the alert.

### 2.12 E.12 — C9 backup gap 1: Vault snapshot (raft-aware)

Add `vault operator raft snapshot save` step to
`infra/host-bootstrap/10-vigil-backup.sh` per architect's prior
decision:

- Use a scoped Vault token with ONLY the
  `sys/storage/raft/snapshot` capability (NOT root)
- Document token custody + quarterly rotation in
  `docs/runbooks/backup.md`
- Snapshot file gets the same GPG signature treatment as the
  manifest (and after E.14, the same encryption)

**Output:** script step + runbook update.

**Acceptance:** `verify-backup-config.sh` confirms `vault operator
raft snapshot save` is present; the warning flips to ✓.

### 2.13 E.13 — C9 backup gap 3: Audit-chain offline export + verifier (substantial)

Two internal commits:

- **E.13.a** Add `COPY ... TO STDOUT WITH CSV HEADER` exports for
  `audit.actions` + `audit.user_action_event` to the backup script.
  GPG-signed with detached signatures alongside.
- **E.13.b** Build `scripts/verify-hashchain-offline.ts` that walks
  the CSV files and recomputes hashes WITHOUT a Postgres
  connection. Same algorithm as `packages/audit-chain/scripts/
verify-hashchain.ts`, just CSV-input-driven.

Cite the offline export path in `docs/runbooks/dossier-evidence-chain.md`
as the court-defensible artefact path (architect's prior framing:
"the artefact-of-record convention says you produce the document
itself, not the means of producing it").

**Output:** script additions + new offline verifier + 1 runbook
edit + unit test for the offline verifier (deterministic 100-row
chain fixture).

**Acceptance:** offline verifier runs against the exported CSV
in O(n) time; produces identical chain-validation result as the
Postgres-backed verifier; unit test green.

### 2.14 E.14 — C9 backup gap 4: Encrypted-at-rest archive

Wrap each archive output file (postgres tarball, btrfs send-stream,
neo4j dump, ipfs pinset, audit-chain CSV from E.13) in
`gpg --encrypt --recipient $GPG_FINGERPRINT` BEFORE it lands in the
archive directory.

- Verify architect's OpenPGP key has an encrypt-capable subkey
  (HSK-v1 says it should — confirm from the key's `gpg --list-keys
--with-colons` output; if subkey is missing, halt and surface)
- Update R6 DR runbook to reflect that restore now requires the GPG
  private-key passphrase + YubiKey at restore time
- Update `verify-backup-config.sh`: the `gpg --encrypt` warning
  flips to ✓

**Output:** script changes + R6 update + verifier flip.

**Acceptance:** test backup run produces all output files in `.gpg`
form; signature + encryption layer both verifiable; R6 runbook
reflects the new restore precondition.

**Hold-point candidate:** if the architect's key lacks an encrypt-
subkey, halt and surface — adding a subkey is an architect-side
GPG operation (not agent-action).

### 2.15 E.15 — C9 backup gap 2: Git bundle

Low-priority follow-up. Add `git bundle create` step to the backup
script:

- Bundle the architect's working tree (or a CI-pulled tip) into
  `git-bundle.bundle`
- Include in the encrypted archive (E.14 wraps it)

**Output:** one-line script addition + verifier flip.

**Acceptance:** verifier confirms `git bundle create` is present;
synthetic bundle round-trips (clone from bundle → diff against
source → no differences).

### 2.16 E.16 — C9 backup gap 5: Hetzner data-residency decision-log entry

Decision-log entry ONLY (no provisioning per architect's prior
framing). Documents:

- Data-residency tradeoff: VIGIL APEX backup → Hetzner Storage Box
  → French / German jurisdiction for sovereign Cameroon-pilot data
- Mitigations in place (encrypted-at-rest from E.14 means Hetzner
  sees only ciphertext; manifest signed; rotation policy)
- Architect-action item: the architect signs the entry to FINAL
  separately when ready to provision the Storage Box

**Output:** new `## DECISION-{next-free-N}` entry in
`docs/decisions/log.md`. **Status: PROVISIONAL** — agent does NOT
self-promote; architect promotes to FINAL via separate signed
commit. Same shape as DECISION-012 promotion pattern.

**Acceptance:** entry written; cross-link lint green; A5.4
salt-collision alert references this entry's docs/decisions log
position.

### 2.17 E.17 — C2 Vault Shamir Option B (substantial — 2-3 internal commits)

Per architect's prior detailed signoff (Block-D §2.1 retargeting +
the architect's "Option B reasoning" turn):

- **E.17.a** Extend `infra/host-bootstrap/03-vault-shamir-init.sh` to
  accept `--recipient share<N>=<recipient>` flags. Perform age
  encryption inline:

  ```sh
  vault operator init -format=json |
    jq -r '.unseal_keys_b64[N]' |
    age -r $RECIPIENT_N -o /etc/vigil/share-N.age
  ```

  Plaintext shares NEVER touch disk. Root token still goes to
  `/run/vigil/shamir/root-token` (tmpfs) per current behaviour;
  flag operator-erase-after step in the runbook.

- **E.17.b** Add `vault.unsealed` and `vault.sealed` to
  `KNOWN_EVENT_TYPES` at
  `packages/shared/src/schemas/audit-log.ts`. Add a unit test
  asserting both names are present so the ceremony's audit trail
  doesn't break silently.

- **E.17.c** Replace the stale DECISION-013 reference in
  `docs/runbooks/vault-shamir-init.md` step 7 with the actual
  next-free DECISION-NNN at commit time (grep
  `docs/decisions/log.md` for the highest committed DECISION-NNN
  and use NNN+1, reserving the slot for the ceremony's audit
  entry).

- **E.17.d** Sandboxed Vault container in dev compose. Spin up a
  test Vault container (DEV mode, in-memory storage), run the
  script end-to-end with five test age recipients, verify all
  five `.age` files decrypt correctly with the corresponding test
  identity, verify Vault unseals with 3-of-5 of those decrypted
  shares. This is the runbook verification that's been missing.

**Output:** 4 internal commits (or 2-3 if some bundle); new
sandboxed-Vault test harness in `infra/docker/docker-compose.test.yaml`
or per-test ad-hoc.

**Acceptance:** sandboxed Vault E2E green; `--recipient` flag works;
plaintext shares never reach disk (verified by mid-ceremony
filesystem check); KNOWN_EVENT_TYPES test green.

**Hold-point candidate:** if the sandboxed Vault container's API
shape differs from production Vault enough that the test isn't
representative, halt and surface — the test must be doctrine-
representative or it adds false confidence.

### 2.18 E.18 — Block E completion summary + halt for review

`docs/work-program/BLOCK-E-COMPLETION-SUMMARY.md` covering:

- Per-sub-block commit summary + verdict
- Architect-action items surfaced (PROVISIONAL DECISION-{N} for
  Hetzner from E.16; any others surfaced during execution)
- Track-D + Track-E flips in PHASE-1-COMPLETION.md
- Phase-gate state at branch tip (all 11 lints green expected)
- Checkbox list for architect sign-off:
  - [ ] Block-E commits acceptable for merge to main
  - [ ] §2 architect-action items acknowledged
  - [ ] Track-D + Track-E status flips in PHASE-1-COMPLETION accepted
  - [ ] M5 hardening can now proceed (or post-Phase-1 work; depends
        on M5 not yet exited)

**Acceptance:** doc complete; halt for review.

---

## 3. Hold-points — batched

Surfaced now per established posture (batch judgment calls; no
incremental presentation).

### Hold-point #1 — E.6 Snyk pre-existing Critical handling

If the first Snyk run surfaces pre-existing Critical CVEs that are
not architect-allowlist-eligible (i.e., genuinely exploitable in
the current code), the agent halts. Default if architect doesn't
respond: leave the CI step in **warn-only** mode for Critical (not
block) until the CVEs are addressed. Risk: Block-E ships with a
warn-not-block CI gate, which is weaker than the ultimate state.
Better to surface than to silently downgrade the gate.

### Hold-point #2 — E.13 verifier algorithm parity

The new offline verifier (`scripts/verify-hashchain-offline.ts`)
reimplements the chain-walk algorithm in TypeScript-from-CSV
form. There's a risk of algorithmic drift from the canonical
`packages/audit-chain` verifier (e.g., subtle handling of
NULL `prior_event_id`, canonicalisation of JSON payloads, etc.).
Mitigation: the unit test runs the SAME chain through both
verifiers and asserts identical hash-by-hash output. If divergence
is found, halt — picking a side is a doctrine call, not an agent
default.

### Hold-point #3 — E.14 GPG encrypt-subkey

If the architect's published GPG key per HSK-v1 lacks an encrypt-
capable subkey (i.e., it's signing-only), the encrypted-at-rest
backup cannot proceed without a subkey-add ceremony (architect-
side, requires the master key). The agent halts and surfaces; the
default is: ship E.14's code with a precondition-check that emits
a clear error message at first run, but does not actually encrypt
until the architect performs the subkey-add ceremony.

### Hold-point #4 — E.16 DECISION-N PROVISIONAL framing

Same chain-of-binding observation as the supplier-intel initiative:
the agent writes the new Hetzner DECISION-N as PROVISIONAL, not
FINAL. Architect promotes via separate signed commit. No agent
self-promotion.

---

## 4. Operating posture (unchanged from Blocks A-D)

- Plan first — this document. **HALT FOR ARCHITECT REVIEW.**
- Batch hold-points — 4 in §3 above.
- One commit per logical unit; sub-split where the work is large
  (E.13, E.17).
- Update `docs/work-program/PHASE-1-COMPLETION.md` as items close.
- Stop after a commit only if a test or lint fails.
- "Don't compress" — Block E is the largest of the five blocks per
  architect's prior framing. Sub-commit decomposition is encouraged
  where it aids review.
- At Block E close, produce
  `docs/work-program/BLOCK-E-COMPLETION-SUMMARY.md` and halt for
  review before opening any subsequent initiative (specifically,
  the supplier-intel M5-hardening-expansion remains parked until
  Block-E close).
- SafeLlmRouter coverage (`scripts/check-safellm-coverage.ts`) stays
  green throughout. Any new LLM call routes through SafeLlmRouter
  with a registered prompt template per Block-D D.10 / D.11
  pattern.
- Postgres source-of-truth invariant (SRD §15.1): every new signal
  commits to Postgres BEFORE any stream emit.

---

## 5. Block E close criteria

Block E is acceptance-green when ALL of these are true:

1. `BLOCK-E-COMPLETION-SUMMARY.md` written and architect-signed.
2. Track D items D1–D7 all 🟩 in PHASE-1-COMPLETION.md (D6/D7
   bundled in E.5 acceptable).
3. Track E items E1–E5 all 🟩 (E4 complete-on-arrival per E.9).
4. A5.4 salt-collision alert wired (E.11).
5. C9 backup gaps 1, 3, 4 all 🟩 (gap 2 acceptable in low-priority
   E.15; gap 5 acceptable as PROVISIONAL DECISION-{N} per E.16).
6. C2 Vault Shamir Option B sandboxed-Vault E2E green (E.17).
7. BLOCK-D-COMPLETION-SUMMARY §2.2 sentinel rename complete (E.0).
8. All workspace gates green:
   - `pnpm exec turbo run build --continue --force`
   - `pnpm exec turbo run typecheck --continue --force`
   - `pnpm exec turbo run lint --continue --force`
   - `pnpm exec turbo run test --continue --force`
9. All 11 phase-gate lints green at branch tip.
10. SafeLlmRouter coverage lint green at branch tip.
11. Synthetic-failure harness 6/6 REJECTED + any new lint added in
    Block-E gets a synthetic-failure case per the Block-D D.7
    1:1 invariant.

After Block E closes, M5 hardening can proceed (M5 entry per TRUTH
§J). The supplier-intel M5-hardening-expansion initiative re-opens
once Block E closes, DECISION-012 promotion remains FINAL on main,
§30 stays applied (this commit), and M5 has not yet exited.

---

## 6. Critical files (forward-looking)

| File / area                                                                               | Sub-block | Change                                                      |
| ----------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------- |
| `packages/shared/src/schemas/audit.ts` + sentinel-quorum.ts                               | E.0       | sentinel.quorum_outage enum add + emitOutageAuditRow rename |
| `apps/dashboard/__tests__/council-vote-e2e.test.ts`                                       | E.1       | NEW                                                         |
| `apps/worker-tip-triage/__tests__/tor-flow-e2e.test.ts`                                   | E.2       | NEW                                                         |
| `apps/worker-conac-sftp/__tests__/sftp-delivery-e2e.test.ts`                              | E.3       | NEW                                                         |
| `packages/federation-stream/__tests__/envelope-e2e.test.ts`                               | E.3       | NEW                                                         |
| `apps/dashboard/__tests__/webauthn-fallback-e2e.test.ts`                                  | E.4       | NEW                                                         |
| `apps/dashboard/playwright-{a11y,visual}.config.ts` + ci.yml                              | E.5       | NEW + edit                                                  |
| `.github/workflows/ci.yml` + `.snyk-policy.yaml`                                          | E.6       | edit + NEW                                                  |
| `docs/security/threat-coverage-matrix.md`                                                 | E.7       | edit                                                        |
| `renovate.json` + `docs/runbooks/dependency-rotation.md`                                  | E.8       | NEW                                                         |
| `docs/work-program/PHASE-1-COMPLETION.md` E4 row                                          | E.9       | flip 🟩                                                     |
| `scripts/generate-sbom.ts` + ci.yml release step                                          | E.10      | NEW                                                         |
| `apps/adapter-runner/src/triggers/salt-collision-check.ts` + alert rule                   | E.11      | NEW                                                         |
| `infra/host-bootstrap/10-vigil-backup.sh` + `docs/runbooks/backup.md`                     | E.12      | edit                                                        |
| `scripts/verify-hashchain-offline.ts` + CSV exports                                       | E.13      | NEW + edit                                                  |
| `infra/host-bootstrap/10-vigil-backup.sh` (gpg --encrypt) + R6 runbook                    | E.14      | edit                                                        |
| `infra/host-bootstrap/10-vigil-backup.sh` (git bundle)                                    | E.15      | edit                                                        |
| `docs/decisions/log.md` (new DECISION-{N} PROVISIONAL Hetzner)                            | E.16      | append                                                      |
| `infra/host-bootstrap/03-vault-shamir-init.sh` + KNOWN_EVENT_TYPES + sandboxed Vault test | E.17      | edit + NEW                                                  |
| `docs/work-program/BLOCK-E-COMPLETION-SUMMARY.md`                                         | E.18      | NEW                                                         |

Existing utilities to reuse:

- `DeterministicTestSigner` from audit-chain tests for E.1 (council mock).
- `socks-proxy-agent` mock pattern from existing tip tests for E.2.
- `ssh2-sftp-server` for E.3 (D3 SFTP harness).
- `playwright-snapshot` or `pixelmatch` for E.5 D7 visual regression.
- `@cyclonedx/cyclonedx-npm` for E.10 SBOM.

---

## 7. What the architect signs

Four hold-points to acknowledge:

- [ ] §3 hold-point #1 — E.6 Snyk pre-existing Critical handling: warn-only-default OR architect provides allowlist policy
- [ ] §3 hold-point #2 — E.13 offline verifier parity check: agent default is "halt on divergence"; confirm
- [ ] §3 hold-point #3 — E.14 GPG encrypt-subkey availability: agent default is "ship code with precondition-check, error at first run if subkey missing"; confirm
- [ ] §3 hold-point #4 — E.16 Hetzner DECISION-N PROVISIONAL framing: agent writes PROVISIONAL, architect promotes; confirm pattern

When signed, the agent advances to **E.0** (housekeeping) and proceeds top-to-bottom through §1.

If any hold-point lands as a non-default decision, agent absorbs the change before E.0 begins.
