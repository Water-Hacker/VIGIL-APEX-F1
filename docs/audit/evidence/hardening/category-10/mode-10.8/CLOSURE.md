# Mode 10.8 — Cosign signature not verified on every pull

**State after closure:** framework-closed, activation-pending
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 12a / Cross-cutting
**Branch:** `hardening/phase-1-orientation`

## Identical scope to mode 9.9

Per orientation §3.10 / 10.8: "Same as 9.9. **Expensive (> 3 days).
One closure satisfies both.**"

This closure is the cross-category mirror of mode 9.9. The orientation
explicitly classifies 9.9 + 10.8 as a single bundled closure across the
"Configuration, deployment, and secrets" (Cat 9) and "Supply chain and
dependency hygiene" (Cat 10) categories.

See [`../../category-9/mode-9.9/CLOSURE.md`](../../category-9/mode-9.9/CLOSURE.md)
for the full closure narrative, file list, invariant layers, and
"What this closure does NOT include" notes.

## Re-open trigger

Identical to mode 9.9 — the same three activation gates close both
modes simultaneously. See the sister closure doc.

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
