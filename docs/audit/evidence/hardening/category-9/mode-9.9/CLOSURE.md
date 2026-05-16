# Mode 9.9 — Cosign signature not verified on every pull

**State after closure:** framework-closed, activation-pending
**Closed at:** 2026-05-15 (framework). Activation-pending — see
re-open triggers + `docs/runbooks/cosign-rollout.md`.
**Pass:** code-hardening 90-mode pass, Phase 12a / Cross-cutting
**Branch:** `hardening/phase-1-orientation`

## The failure mode

Per orientation §3.9 / 9.9:

> `.github/workflows/security.yml:93-180` signs SBOMs, NOT container
> images. No `cosign sign` in build, no `cosign verify` in deploy. No
> Kyverno/Kubewarden policy.

An adversary who compromises the registry — or sits in the network
path between the registry and the deploy host — can serve a tampered
image for the same tag the architect expected. Without `cosign verify`
at deploy time, the deploy silently accepts the tampered image. SBOMs
prove "what we built"; cosign proves "the running container is what
we built." Both are needed; only the first existed at orientation.

## What "framework-closed, activation-pending" means

The Phase 12a closure ships the **framework**: every component the
activation needs is committed, tested, and gated behind explicit
opt-in switches. Activation requires architect-side ceremony +
infrastructure that Phase 12a deliberately does NOT touch (key
generation, registry deployment, Kyverno install).

Mode 9.9 is **NOT** "closed-verified" today — running container pulls
still skip signature verification because the activation switches are
off. It IS "framework-closed" because the entire end-to-end
verification chain is in place, gated, and can be activated via the
documented runbook with zero new code.

When the activation runs (per `docs/runbooks/cosign-rollout.md`), the
state moves to "closed-verified."

## What was added

### 1. CI signing pipeline — `.github/workflows/security.yml` new job

`cosign-sign-images` job, tag-push-gated, with:

- Validates `COSIGN_PRIVATE_KEY` + `COSIGN_PASSWORD` secrets present
  (fails-loud if missing on a release tag, mirroring the existing
  GPG-key pattern for SBOM signing).
- SHA-pinned `sigstore/cosign-installer@dc72c7d…` (v3.7.0) per mode
  10.3 discipline.
- Pinned cosign release `v2.4.1`.
- Enumerates publishable images via
  `scripts/enumerate-publish-images.ts` (new — pulls from
  `Chart.yaml` `appVersion` + values.yaml's `image.repository`
  entries; emits `<registry>/<repo>:<tag>` per line).
- Signs each image with `cosign sign --yes --key file:...`.
- Verifies each freshly-signed image with `cosign verify` before the
  job exits (round-trip sanity).

### 2. Kyverno ClusterPolicy template — `infra/k8s/charts/vigil-apex/templates/kyverno-cosign-policy.yaml`

A `ClusterPolicy` (apiVersion `kyverno.io/v1`) that:

- Audits / enforces every Pod creation in the chart's namespace.
- Verifies each container/initContainer/ephemeralContainer image
  against the architect-supplied cosign public key.
- Rejects pods whose images lack a valid signature (in Enforce mode).
- Honours an opt-out annotation `vigil.apex/cosign-verify: skip` —
  use must be architect-reviewed at every Helm upgrade.
- Configurable via `values.yaml`'s new `cosignVerify` section
  (`enabled`, `failureAction`, `publicKey`, `rekorURL`).

The `enabled: false` default keeps the policy ungenerated until the
architect opts in via `--set cosignVerify.enabled=true`.

### 3. Compose verifier overlay — `infra/docker/compose.cosign-verify.yaml`

A one-shot `cosign-verifier` service that:

- Mounts the public key (`./cosign/cosign.pub` read-only) + the
  digest lock file (`./image-digests.lock` read-only) + the docker
  socket (read-only).
- Iterates the lock file with `jq`, calls `cosign verify --key
/cosign/cosign.pub <tag>@<digest>` for each entry.
- Exits 0 on full pass; exits non-zero on first failure.
- Other services in the stack will declare `depends_on:
cosign-verifier: { condition: service_completed_successfully }`
  during Phase 12b activation (the second-overlay step) — gating
  stack startup on the verify pass.

## The invariant

Three layers, all framework-ready:

1. **Sign-at-build** (CI) — every release tag produces signed images
   in the registry.
2. **Verify-at-deploy in compose** — the `cosign-verifier` one-shot
   blocks stack startup until every digest-pinned image's signature
   checks out.
3. **Verify-at-admission in k3s** — the Kyverno ClusterPolicy rejects
   any pod whose image fails signature verification.

The matching key lives in:

- GitHub Actions secret (private) for the CI signing step.
- Vault (`vigil/cosign`) for distribution.
- Helm chart values + the cluster (public) for Kyverno verification.
- Disk at `/srv/vigil/cosign/cosign.pub` for the compose verifier.

The four locations are kept in sync by the architect's cosign-key-
rotation runbook procedure.

## What this closure does NOT include

- **Activation.** `docs/runbooks/cosign-rollout.md` is the architect's
  step-by-step. Activation requires registry deployment + key
  generation ceremony + Kyverno install — none of which Phase 12a
  delivers (all are Phase 12b / Phase 2 infrastructure work).

- **Keyless / OIDC verification.** The `COSIGN_EXPERIMENTAL=0`
  setting in the compose verifier locks us to key-based verification
  only. Keyless mode (via Sigstore Fulcio / Rekor public roots) is
  an option once the architect's policy on third-party trust roots
  is settled — flagged for future hardening, not part of this
  closure.

- **Registry-side mirroring to GHCR.** SRD §1253 mentions
  "Phase-2 may publish a subset to GHCR for partner mirroring."
  Mirroring would mean re-signing for the GHCR push OR cross-trusting
  the existing signature — out of scope for Phase 12a.

- **Cosign-verified base images.** Mode 10.3 sister closure pinned
  the trivy + gitleaks downloads to sha256 verify; cosign-verifying
  upstream base images (alpine, node, python, caddy, playwright)
  would require those upstream projects to publish cosign signatures.
  Some do (caddy starts signing in 2.11); most don't yet. Future
  hardening; not blocking.

## Files touched

- `.github/workflows/security.yml` (+95 lines: new
  `cosign-sign-images` job)
- `scripts/enumerate-publish-images.ts` (new, ~120 lines)
- `scripts/pin-image-digests.ts` (new, ~200 lines — shared with mode
  9.8 + 10.2(b))
- `infra/docker/compose.cosign-verify.yaml` (new, ~90 lines)
- `infra/k8s/charts/vigil-apex/templates/kyverno-cosign-policy.yaml`
  (new, ~80 lines)
- `infra/k8s/charts/vigil-apex/values.yaml` (+30 lines:
  `cosignVerify` section)
- `docs/runbooks/cosign-key-rotation.md` (new, ~250 lines)
- `docs/runbooks/cosign-rollout.md` (new, ~200 lines)
- `docs/audit/evidence/hardening/category-9/mode-9.9/CLOSURE.md`
  (this file)
- `docs/audit/evidence/hardening/category-10/mode-10.8/CLOSURE.md`
  (sister)
- `docs/audit/evidence/hardening/category-9/mode-9.8/CLOSURE.md`
  (sister)
- `docs/audit/evidence/hardening/category-10/mode-10.2b/CLOSURE.md`
  (sister)

## Re-open trigger (back to "open" → activation forces "closed-verified")

This closure remains "framework-closed, activation-pending" until ALL
THREE deployment paths run the activation steps in
`docs/runbooks/cosign-rollout.md`:

- **CI path** activated when the first release tag completes
  cosign-sign-images with exit code 0.
- **Compose path** activated when the verifier overlay is applied
  - every base-stack service gets the `depends_on: cosign-verifier`
    edge (the second overlay step).
- **k3s path** activated when Kyverno is installed + the
  ClusterPolicy is in `Enforce` mode for ≥ 14 days with zero
  unsigned-image findings.

The mode is "closed-verified" only after all three are recorded in
the audit chain via the `cosign_verify_activated` entries (kind
defined in `docs/runbooks/cosign-rollout.md` §Step E).

## Architect signal recorded

Orientation §7 Q2: "Cosign closure scope: full Kyverno admission policy
in k3s OR init-container verify in compose for now?" — architect
selected **Path A** on 2026-05-15: "k3s Kyverno + compose
init-container (full both-paths)." This closure delivers Path A's
framework end-to-end; Phase 12b activation will complete it.

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
