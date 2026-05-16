# Runbook — Cosign verification rollout (Phase 12a → 12b activation)

> Step-by-step procedure to activate the cosign image-signature
> verification framework that landed in Phase 12a. Closes the
> activation half of modes 9.8 + 9.9 + 10.8 + 10.2(b) of the 90-mode
> hardening pass.
>
> **Audience:** the architect, executing after the Phase-2 cluster
> procurement (DECISION-020) + registry deployment lands.
>
> **Prerequisites:** see §"Pre-flight gates" below — every gate must
> pass before any step in §"Activation steps" runs.

---

## Why this runbook exists

Phase 12a shipped the framework (CI sign step, digest-pin script,
compose verifier overlay, Kyverno ClusterPolicy template, key-rotation
runbook). All of it is **gated** — disabled by default, fails-loud if
half-configured.

This runbook is the activation flow: the discrete steps the architect
runs to flip the framework from `enabled: false` to `enabled: true`
across all three deployment paths (CI, compose, k3s).

The framework's existence does NOT close the failure modes. Activation
does. Until this runbook is executed, modes 9.8 / 9.9 / 10.8 / 10.2(b)
remain "framework-closed, activation-pending" in the audit chain.

---

## Pre-flight gates

Every gate must pass before activation. If any fails, fix the gate
first; do NOT proceed to §Activation.

### Gate 1: Registry is live

```bash
curl -fsS https://registry.vigilapex.local/v2/ | grep -q "{}"
echo $? # must be 0
```

If 1, deploy the registry first per Phase 12b registry-deploy runbook
(separate doc, not yet written).

### Gate 2: docker-bake produces real images

```bash
cd /home/kali/Documents/vigil-apex
docker buildx bake \
  --file infra/docker/docker-bake.hcl \
  --set '*.platform=linux/amd64' \
  --load
echo $? # must be 0
docker image ls | grep -c vigil-apex # must be >= 3
```

If bake fails or produces zero images, the `docker-build` CI job's
`continue-on-error: true` is the symptom — fix `docker-bake.hcl`
first. (This is a pre-existing Phase-1 incompleteness; not part of
this runbook.)

### Gate 3: Cosign signing key is provisioned

```bash
# Vault must have the public key + metadata.
vault kv get -format=json vigil/cosign | jq -e '.data.data.public_key_pem' >/dev/null
echo $? # must be 0
```

If 1, run `docs/runbooks/cosign-key-rotation.md` §"Initial key
generation" first.

### Gate 4: Image-digest lock file is current

```bash
pnpm exec tsx scripts/pin-image-digests.ts --verify
echo $? # must be 0
```

If 1 (or "no lock file"): run
`pnpm exec tsx scripts/pin-image-digests.ts --apply` first, commit
the changes (`infra/docker/image-digests.lock`, Dockerfile FROM lines,
compose `image:` lines), and re-verify.

### Gate 5: Kyverno is installed in k3s (k3s path only)

```bash
kubectl get crd clusterpolicies.kyverno.io
echo $? # must be 0
```

If 1, install Kyverno per the upstream docs:

```bash
helm repo add kyverno https://kyverno.github.io/kyverno/
helm install kyverno kyverno/kyverno -n kyverno --create-namespace
```

Pin the kyverno chart to a specific version in production; SHA-pin
the install per mode 10.3 discipline.

---

## Activation steps

Run in order. Each step is **idempotent** — re-running it is safe.

### Step A: Sign a release tag (exercises the CI signing path)

```bash
# Cut a release tag in the repo. The security.yml workflow's
# cosign-sign-images job fires on tag-push events only.
git tag -a v0.2.0-cosign-test -m "Phase 12b cosign activation test tag"
git push origin v0.2.0-cosign-test
```

Watch the workflow run. Expected behaviour:

1. SBOM signing succeeds (existing flow).
2. `cosign-sign-images` job runs, validates secrets present, installs
   cosign, enumerates images via
   `scripts/enumerate-publish-images.ts`, signs each.
3. Job exits 0.

If the cosign-sign-images job fails with "COSIGN_PRIVATE_KEY missing":
re-run §Pre-flight gate 3 — the secret didn't land in GitHub Actions.

### Step B: Verify the signature in the registry

```bash
# Pull the cosign public key out of Vault.
vault kv get -field=public_key_pem vigil/cosign > /tmp/cosign.pub

# Verify each signed image. cosign 'verify' returns 0 on success.
for IMG in $(pnpm exec tsx scripts/enumerate-publish-images.ts); do
  cosign verify --key /tmp/cosign.pub "$IMG" || echo "FAIL: $IMG"
done
```

If any image fails: re-run §Pre-flight gate 1 (registry) + §Step A.

### Step C: Activate the compose verifier

```bash
# Place the public key on each host that runs the compose stack.
sudo install -m 0444 -o root -g root /tmp/cosign.pub /srv/vigil/cosign/cosign.pub

# Bring up the verifier overlay alongside the base stack. The verifier
# is a one-shot service; if it exits 0, the rest of the stack starts.
docker compose \
  -f infra/docker/docker-compose.yaml \
  -f infra/docker/compose.cosign-verify.yaml \
  up -d
```

Watch the verifier logs:

```bash
docker compose -f infra/docker/compose.cosign-verify.yaml logs cosign-verifier
# Expected last line: "[cosign-verifier] OK: all images verified."
```

If the verifier fails: check the audit-chain entry for the offending
image's pull SHA; investigate whether a re-build crossed signing
without re-running Step A.

### Step D: Activate Kyverno enforcement in k3s

```bash
# First pass: Audit mode. Logs unsigned-image events without rejecting
# pods.
helm upgrade vigil-apex ./infra/k8s/charts/vigil-apex \
  --reuse-values \
  --set cosignVerify.enabled=true \
  --set cosignVerify.failureAction=Audit \
  --set-file cosignVerify.publicKey=/tmp/cosign.pub

# Watch the policy reports for 14 days.
kubectl get policyreports -A | grep cosign-verify
```

After 14 days of zero unsigned-image findings:

```bash
# Flip to Enforce mode. Unsigned-image pods are rejected at admission.
helm upgrade vigil-apex ./infra/k8s/charts/vigil-apex \
  --reuse-values \
  --set cosignVerify.failureAction=Enforce
```

If pods start getting rejected: check the policy report for the
offending image, re-sign it (re-run §Step A with a tag bump), or
add `vigil.apex/cosign-verify: skip` annotation to the pod (with
an architect-approved justification recorded in the audit chain).

### Step E: Audit-chain record of activation

```bash
psql -U vigil_admin -c "INSERT INTO audit.event
  (kind, payload, actor)
VALUES (
  'cosign_verify_activated',
  jsonb_build_object(
    'paths',          ARRAY['ci', 'compose', 'k3s'],
    'public_key_sha256', '$(sha256sum /tmp/cosign.pub | awk '{print $1}')',
    'k8s_failure_action', 'Audit',
    'activated_at', now()
  ),
  'architect@vigilapex.cm'
);"
```

The next anchor sweep commits this to Polygon + Fabric.

---

## Post-activation verification

After each Step, run this verifier sweep:

```bash
# Image-digest drift gate (CI gate already runs this on every push,
# but the architect runs it locally as part of activation).
pnpm exec tsx scripts/pin-image-digests.ts --verify

# Helm chart values reflect the activation.
helm get values vigil-apex | grep -A5 cosignVerify
# Expect: enabled: true, failureAction: Audit (or Enforce after 14d),
#         publicKey: <multi-line PEM>

# The Kyverno ClusterPolicy is installed.
kubectl get clusterpolicy vigil-apex-cosign-verify-images -o yaml
# Expect: validationFailureAction matches failureAction value.

# Recent audit-chain entries include the activation.
psql -U vigil_ro -c "SELECT kind, payload, occurred_at FROM audit.event
  WHERE kind LIKE 'cosign%' ORDER BY occurred_at DESC LIMIT 5;"
```

---

## Rollback

If activation causes broken deploys:

1. **CI signing job failure**: the build still completes; only the
   signing step fails. To roll back, remove the `COSIGN_PRIVATE_KEY`
   secret from GitHub Actions — the job will fail-loud, which is the
   correct posture (you're explicitly accepting unsigned releases).

2. **Compose verifier blocks startup**: bring the stack up WITHOUT
   the verifier overlay:

   ```bash
   docker compose -f infra/docker/docker-compose.yaml up -d
   ```

   The base compose file's services have no hard dependency on the
   verifier (only the cosign-verifier overlay declares the
   `depends_on`). So omitting the overlay reverts to pre-activation
   state.

3. **k3s policy rejects pods**: flip Kyverno back to Audit, or
   disable:

   ```bash
   helm upgrade vigil-apex ./infra/k8s/charts/vigil-apex \
     --reuse-values \
     --set cosignVerify.enabled=false
   ```

In each rollback case, record the audit-chain entry:

```sql
INSERT INTO audit.event (kind, payload, actor) VALUES (
  'cosign_verify_rolled_back',
  jsonb_build_object(
    'path', '<ci | compose | k3s>',
    'reason', '<...>',
    'rolled_back_at', now()
  ),
  'architect@vigilapex.cm'
);
```

---

## Related

- `docs/runbooks/cosign-key-rotation.md` — generation + rotation of
  the underlying keypair.
- `docs/decisions/decision-020-dl380-ai-security-tier.md` — Phase 2
  cluster procurement context.
- `docs/audit/evidence/hardening/category-9/mode-9.9/CLOSURE.md` —
  the closure record this runbook activates.
- `docs/audit/evidence/hardening/category-10/mode-10.8/CLOSURE.md` —
  same.
- `scripts/enumerate-publish-images.ts` — single source of truth
  for the image list.
- `scripts/pin-image-digests.ts` — digest-pinning + drift verification.
- `infra/k8s/charts/vigil-apex/templates/kyverno-cosign-policy.yaml`
  — cluster-side enforcement.
- `infra/docker/compose.cosign-verify.yaml` — compose-side overlay.
- `.github/workflows/security.yml` `cosign-sign-images` job —
  build-side signing.
