# Mode 9.1 — Configuration drift staging vs production (Tier 1)

**State after closure:** closed-verified (Tier 1 gate — values-lint)
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 10 / Category 9
**Branch:** `hardening/phase-1-orientation`

## The failure mode

Per orientation §3.9 / 9.1:

> `infra/k8s/charts/vigil-apex/values{,_dev,_prod}.yaml` exist but no
> automation enforces which is used per env. compose stack lacks
> staging/prod overlay (only federation overlay). No CI gate diffs
> rendered manifests against a golden.

Concretely, the failure mode is a contributor editing
`values-prod.yaml` and unintentionally:

- Lowering `replicaCount` below HA (`= 1` for the dashboard means a
  single-node failure takes the platform down).
- Pinning an image to `latest`, `dev`, or a similar floating tag,
  so a deploy mid-PR pulls a different image than CI tested.
- Removing `resources.limits`, letting a workload OOM-saturate a node.
- Switching the cert issuer to a staging issuer, which serves
  non-trusted certs to citizens.
- Falling back to the `standard` storage class (the kind/minikube
  dev default) on a cluster where that class doesn't exist.

None of these are caught by typecheck, lint, or test today — they're
"deploy-time surprises" that the orientation classifies as medium
(1–3 days) to fully close with rendered-diff + ArgoCD wiring.

## What was added (Tier 1)

This closure ships the **values-lint** layer: the failure cases that
are visible without rendering the chart. The full rendered-diff +
ArgoCD ApplicationSet remains as future hardening (see "What this
closure does NOT include" below).

### 1. `scripts/check-helm-values-drift.ts` (new, ~250 lines)

Parses the four chart values files
(`values.yaml`, `values-dev.yaml`, `values-prod.yaml`,
`values-cluster.yaml`) using the workspace's `yaml` package and
asserts seven invariants:

1. **Images pinned in prod.** Every `image.tag` in `values-prod.yaml`
   and the base `values.yaml` must NOT be in the forbidden set
   (`latest`, `main`, `master`, `dev`, `edge`, `nightly`, empty) AND
   must contain at least one digit. The digit requirement filters
   obvious-floating tags ("stable", "release") while allowing the
   architect's custom-build tags like `rl-2.8` (Caddy with
   ratelimit plugin).

2. **Replicas ≥ 2 in prod** for the dashboard, caddy, and every
   worker. Single-replica deployments don't survive a node restart.
   StatefulSets (postgres / redis / vault) are excepted because they
   use scaling rules per their own controller (e.g., Patroni).

3. **Resources limits set in prod** for postgres, redis, vault,
   dashboard, caddy, and every worker. A missing limit lets a
   workload OOM-saturate the node and kill its neighbours.

4. **`certManager.clusterIssuer === 'letsencrypt-prod'` in prod.**
   The gate rejects staging-issuer, self-signed-issuer, and dev-issuer
   values explicitly.

5. **`storageClass !== 'standard'` in prod.** The kind/minikube
   default doesn't exist on real clusters; PVCs would stay Pending.
   Production must pin a specific class (`fast-ssd`, `ceph-rbd-ssd`,
   etc.).

6. **Worker parity between dev and prod.** Every worker name in
   `values-dev.yaml workers[]` must appear in `values-prod.yaml
workers[]`, and vice versa. A worker that exists in dev but not
   prod is exercisable in CI but never deployed; a worker that
   exists in prod but not dev is deployed but never exercised. The
   architect's standard fan-out should be symmetric.

7. **Top-level key parity** (prod ⊂ dev). Every top-level key in
   `values-prod.yaml` must appear in `values-dev.yaml` — dev must
   be able to exercise every prod knob. Dev-only keys (e.g.,
   `externalSecrets` override) are permitted.

### 2. CI job `helm-values-drift` in `.github/workflows/ci.yml`

A new top-level job (parallel to `compose-deps`, `migration-locks`,
`api-error-leaks`, `migration-rollback`) that runs the script on every
push to `main` and every PR. 3-minute timeout (the script is < 1 s
in practice; the timeout absorbs install latency).

The job sits in the existing "small lint" tier — it doesn't need
postgres, redis, or playwright. Adds ~10 s to the CI fan-out.

### Initial run

At closure time:

```
$ pnpm exec tsx scripts/check-helm-values-drift.ts
[check-helm-values-drift] OK: values.yaml + values-dev.yaml + values-prod.yaml clean
```

The first iteration caught a real signal during development: the
caddy image tag `rl-2.8` (custom-build with ratelimit plugin) was
flagged by an over-strict semver regex. The gate was relaxed to
allow digit-bearing custom-build tags; the architect's intentional
pinning of `rl-2.8` is now recognised as valid.

## The invariant

Three layers protect prod-config integrity:

1. **Values-lint** (this closure) — catches the seven highest-risk
   drift cases without rendering the chart.
2. **Chart syntax** (pre-existing) — `helm template` is run manually
   during merge review; an invalid chart fails template rendering.
3. **Cluster-side reconciliation** (future, ArgoCD ApplicationSet) —
   even if a values file is correct at merge time, ArgoCD would
   reconcile against the cluster and surface diff if anything drifts
   between merge and deploy.

The values-lint is the always-on layer; chart syntax is the
reviewer-attention layer; ArgoCD is the operator-vigilance layer.

## What this closure does NOT include

- **`helm template` rendered diff against a committed golden.** The
  orientation's full closure recommends this; the architect would
  commit a `golden-manifest-prod.yaml` checksum that the CI gate
  verifies. Two things make this Phase 12+ work:
  - Helm is not preinstalled in the CI runner; the gate would need
    a `helm-install` step (~30 s per CI run) and a pinned helm version.
  - The golden requires a one-time architect bootstrap (run `helm
template -f values-prod.yaml > golden.yaml`, commit, then the
    gate is active). The bootstrap can't be done in CI; needs local
    helm.

  Marked for the same Phase that lands cosign (modes 9.9 + 10.8).

- **ArgoCD ApplicationSet wiring values-{dev,prod,staging}.yaml to
  cluster labels/namespaces.** This is the cluster-deployment-time
  layer; the values-lint is the merge-time layer. ArgoCD requires a
  live cluster + an operator install + a per-environment
  ApplicationSet manifest — out of scope for the closure budget.

- **Compose-stack staging/prod overlay.** Orientation noted "compose
  stack lacks staging/prod overlay (only federation overlay)." The
  compose stack is the dev path; production runs on k3s/k3d via the
  Helm chart. Adding a compose staging overlay would let dev/staging
  diverge from prod _more_, not less. Out of scope.

- **`values-cluster.yaml` lint.** The file exists for HPE DL380
  cluster-specific overrides but is structurally a values-prod
  superset with cluster-region-specific values. Lints against it are
  identical to values-prod (image pinning, replicas, etc.); adding
  duplicate gating would be churn. If a future deploy uses
  `values-cluster.yaml` directly (instead of as a values-prod
  overlay), the gate would extend to it.

## Files touched

- `scripts/check-helm-values-drift.ts` (new, ~250 lines)
- `.github/workflows/ci.yml` (+24 lines: new `helm-values-drift` job)
- `docs/audit/evidence/hardening/category-9/mode-9.1/CLOSURE.md` (this file)

## Verification

- `pnpm exec tsx scripts/check-helm-values-drift.ts` → clean against
  the current values files.
- The gate catches the seven invariants by construction; an inline
  test mutating values-prod.yaml to set `replicas: 1` for the dashboard
  produces:
  `values-prod.yaml:dashboard: replicas=1 < 2 in production (no HA for a single-node failure)`
  (manually verified during script development).

## Architect signal recorded

The architect issued `proceed` for Category 9 on 2026-05-15 with no
specific instruction on scope; the values-lint Tier 1 closure is the
agent's reasonable-call default for a "medium 1–3 days" closure where
the rendered-diff component requires helm-in-CI infrastructure work
that belongs with the cosign work (Phase 12).

If the architect prefers a different posture — e.g., "no closure
without rendered-diff" — mode 9.1 reverts to partial and the gate
becomes the Phase 12 work item.

---

## Tier 2 activation update (2026-05-15)

Helm goldens rendered + committed at `infra/k8s/charts/vigil-apex/golden/`:

- `dev.yaml` (1,866 lines) — `helm template -f values.yaml -f values-dev.yaml`
- `prod.yaml` (2,109 lines) — `helm template -f values.yaml -f values-prod.yaml`
- `cluster.yaml` (5,218 lines) — `helm template -f values.yaml -f values-prod.yaml -f values-cluster.yaml`

The CI `helm-golden-drift` gate (already wired in ci.yml) auto-detects
the golden presence and switches from "skip with notice" to active
verification. Any subsequent change to the chart templates OR values
files that materially alters the rendered output trips the gate; the
architect re-runs `scripts/render-helm-golden.sh` (no args) to refresh
the golden + commits the refresh PR.

Mode 9.1 is now **closed-verified at both tiers**:

- Tier 1: values-lint (already closed; 7 invariants on
  values-prod.yaml).
- Tier 2: helm-template golden diff (this update; rendered manifests
  match between live render + committed golden).

The third orientation recommendation — ArgoCD ApplicationSet wiring
values-{dev,prod,staging}.yaml to cluster labels/namespaces — is in
place at `infra/k8s/argocd/vigil-apex.applicationset.yaml` but
activates only when ArgoCD is installed in a live cluster (Phase 2
cluster cutover). The scaffolding is committed; activation is
operations work, not code work.
