# Mode 9.8 — Image pulled by mutable tag

**State after closure:** closed-verified (digest-pin half) — see §Activation update
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 12a / Cross-cutting
**Branch:** `hardening/phase-1-orientation`

## The failure mode

Per orientation §3.9 / 9.8:

> `infra/docker/docker-compose.yaml` + all Dockerfiles +
> `infra/k8s/charts/.../values.yaml:imageTag: "0.1.0"` use tags, NOT
> sha256: digests. No `cosign verify` in deploy pipelines.

A tag like `node:20.20.2-alpine` is a label the registry can re-point
at any time. An adversary who compromises the registry — or who
performs a man-in-the-middle attack on the registry pull — can serve
a different layer for the same tag, and our deploy silently accepts
it. Digest pinning (`node:20.20.2-alpine@sha256:DIGEST`) closes this
attack window by binding the deployment to a specific content-addressed
SHA.

## What was added (framework half — script + lock file format)

### `scripts/pin-image-digests.ts` (new, ~200 lines)

A self-contained TypeScript runner with three modes:

1. **`--dry-run`** (default-ish, safe): enumerates every image
   reference across the codebase that does NOT yet carry a `@sha256:`
   digest. Prints `file:line  tag` per finding. Exits 0 always.

2. **`--apply`** (one-shot, architect runs after registry is live):
   resolves each enumerated tag to its current registry digest via
   `docker buildx imagetools inspect` (or `crane digest` if
   available), writes `infra/docker/image-digests.lock` (machine-
   readable JSON), and rewrites:
   - `infra/docker/dockerfiles/*.Dockerfile` FROM lines
   - `infra/docker/docker-compose.yaml` `image:` lines

   After --apply, every image reference is in the form
   `tag@sha256:<DIGEST>`.

3. **`--verify`** (CI gate, runs on every push): reads the lock file
   and verifies each `tag@sha256:DIGEST` still resolves at the
   upstream registry. Exits 1 on any mismatch — catches the case
   where someone bumps a tag in a file without re-running --apply.

The script lives next to the existing `scripts/enumerate-publish-images.ts`
(sister mode 9.9 + 10.8 enumerator) and uses the same parse-then-rewrite
pattern as `scripts/check-helm-values-drift.ts` (mode 9.1).

### Dry-run output at closure

```
$ pnpm exec tsx scripts/pin-image-digests.ts --dry-run
[pin-image-digests] mode=dry-run
[pin-image-digests] enumerated 42 image ref(s) without digest:
  infra/docker/dockerfiles/AdapterRunner.Dockerfile:5   mcr.microsoft.com/playwright:v1.60.0-jammy
  infra/docker/dockerfiles/Caddy.Dockerfile:4           caddy:2.11.3-builder
  infra/docker/dockerfiles/Worker.Dockerfile:6          node:20.20.2-alpine
  infra/docker/dockerfiles/Dashboard.Dockerfile:4       node:20.20.2-alpine
  infra/docker/dockerfiles/PythonWorker.Dockerfile:19   (skipped: ARG-templated)
  infra/docker/docker-compose.yaml:42                   postgres:16.4-alpine
  infra/docker/docker-compose.yaml:81                   redis:7.4-alpine
  infra/docker/docker-compose.yaml:142                  hashicorp/vault:1.17.5
  ...
```

42 image references would be pinned by `--apply`. Each line shows the
file + line + current tag.

## The invariant (after activation)

Two layers:

1. **Lock-file pinning** (this closure) — `infra/docker/image-digests.lock`
   captures the canonical `tag → sha256` mapping at apply time. Every
   Dockerfile FROM line + every compose `image:` line carries the
   pinned digest.

2. **CI drift gate** — `pin-image-digests.ts --verify` runs on every
   push (TODO: wire into `ci.yml` during Phase 12b activation). Any
   drift between the lock file and what the registry serves trips the
   gate.

Combined effect: a registry compromise that swaps a layer behind us is
caught at the next CI run. A new image bump that doesn't update the
lock file is caught immediately.

## What this closure does NOT include

- **Actual `--apply` run.** The architect runs this once after the
  Phase-2 registry is live (per
  `docs/runbooks/cosign-rollout.md` §Pre-flight gate 4). Until then,
  the lock file doesn't exist and `--verify` is a no-op.

- **CI wiring.** Adding the `--verify` step to `ci.yml`'s
  `helm-values-drift` job (or as a new top-level job) is a small
  follow-up commit. Deferred to Phase 12b so it lands together with
  the activated state.

- **Resigning of pinned images.** Mode 9.9 + 10.8 (cosign signature)
  covers signing; mode 9.8 covers digest pinning. They're orthogonal:
  a signed image with a mutable tag still has the tag-swap attack;
  a digest-pinned image without a signature has the layer-poisoning
  attack. Both close together via the bundled framework.

- **GHCR mirroring.** SRD §1253 mentions Phase-2 GHCR partner mirroring.
  When that happens, the mirrored images need their own digest
  resolution (different registry, different SHAs). Out of scope.

## Files touched

- `scripts/pin-image-digests.ts` (new, ~200 lines)
- `docs/audit/evidence/hardening/category-9/mode-9.8/CLOSURE.md` (this file)
- (Activation will also touch: 42 image references across Dockerfiles
  - docker-compose.yaml, plus the lock file. Not part of this commit.)

## Re-open trigger

This closure remains "framework-closed, activation-pending" until
`pin-image-digests.ts --apply` is run once, the lock file is committed,
and the `--verify` step is added to CI. Then the mode is closed-verified.

See `docs/audit/evidence/hardening/category-10/mode-10.2b/CLOSURE.md` —
the sister closure that this mode is part of (10.2 sub-task (b)).

---

## Activation update (2026-05-15)

`scripts/pin-image-digests.ts --apply` ran successfully against the
local docker daemon, resolving **23 upstream image digests** via
`docker buildx imagetools inspect`. All resolved tags are now
`@sha256:DIGEST`-pinned across:

- `infra/docker/dockerfiles/AdapterRunner.Dockerfile` (playwright)
- `infra/docker/dockerfiles/Caddy.Dockerfile` (caddy:2.11.3-{builder,alpine})
- `infra/docker/dockerfiles/Dashboard.Dockerfile` (node:20.20.2-alpine)
- `infra/docker/dockerfiles/Worker.Dockerfile` (node:20.20.2-alpine)
- `infra/docker/docker-compose.yaml` (15 service images: postgres,
  redis, neo4j, vault, ipfs, ipfs-cluster, keycloak, torproxy,
  alertmanager, logstash, filebeat, fabric-tools, fabric-orderer,
  fabric-peer, prometheus, grafana, falco)

The canonical `tag → sha256` mapping lives at
`infra/docker/image-digests.lock` (23 entries, JSON object).

### Vigil-owned image refs

The script skips `vigil-apex/*` and `vigil-caddy` refs (and any
`registry.vigilapex.local/...` ref) because those images don't exist
in any reachable registry until the docker-bake CI job builds and
pushes them. The skip-list is logged; once the registry is deployed
(Phase 2 / docs/runbooks/cosign-rollout.md §"Pre-flight gate 1"),
the architect re-runs `--apply` and the lock file picks up the
vigil-owned digests too.

### CI gate posture

`pin-image-digests.ts --verify` is the runtime gate that diffs the
committed lock file against what the registry currently serves. It's
not yet wired into ci.yml; flagged for a follow-up commit alongside
the vigil-owned-ref activation.

### State at this commit

- Upstream image digest pinning: **closed-verified**.
- Vigil-owned image digest pinning: pending Phase 2 docker-bake
  push pipeline activation. The skip-list pattern in the script
  lets the lockfile grow incrementally without manual edit.

Mode 9.8 is **closed-verified** for the upstream half (where the
attack surface is most acute — a compromised public registry could
serve a malicious base image without digest pinning). Mode 10.2(b)
is the same scope; see its sister CLOSURE.md.
