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

---

## Activation update (2026-05-15) — partial activation

**Digest-pin sub-mode (mode 9.8 + 10.2(b)): closed-verified.**
`scripts/pin-image-digests.ts --apply` ran against the local docker
daemon and resolved 23 upstream image digests. Every Dockerfile FROM
line + every docker-compose `image:` ref now carries
`@sha256:DIGEST`. The canonical mapping is at
`infra/docker/image-digests.lock`. See
`docs/audit/evidence/hardening/category-9/mode-9.8/CLOSURE.md`
§"Activation update" for full detail.

**Cosign-sign sub-mode (mode 9.9 + 10.8): code-side ready;
production activation requires the architect's YubiKey ceremony.**
The cosign sign step in `.github/workflows/security.yml` is gated
on tag-push events and validates `COSIGN_PRIVATE_KEY` +
`COSIGN_PASSWORD` secrets are present. The architect runs
`docs/runbooks/cosign-key-rotation.md §"Initial key generation"`
to mint the keypair on a YubiKey + populate the GitHub secrets;
the first release-tag push thereafter produces signed images.

The classifier explicitly denied test-key generation in this session
(empty-password test keys committed to the repo would be a
credential-handling violation per the rotation runbook §"YubiKey-
backed key custody"). This is correct posture: cosign keys must
exist only on the YubiKey + in encrypted CI secrets, never as
plaintext files in the working tree.

### State at this session

- Code-side: every file the Phase 12a closure docs listed is in
  place. The CI signing job validates secrets + invokes cosign.
  The compose verifier overlay is committed. The Kyverno
  ClusterPolicy template is committed (gated `enabled: false`).
- Operational: digest-pin half is fully activated (this commit).
  Cosign-signing half is **architect-ceremony only**; no
  remaining code-side work to enable activation.

This mode is **closed-at-the-code-layer**. The final flip to
"closed-verified in the pass ledger" happens when the first
release tag completes the cosign-sign-images job (a one-time
architect ceremony for the YubiKey, then automatic per release).
