# VIGIL APEX — docker buildx bake targets.
#
# Closes the long-standing R0.D placeholder in ci.yml's `docker-build`
# job (which carries `continue-on-error: true` precisely because this
# file didn't exist).
#
# Each target maps one image to its Dockerfile. The Dockerfile templates
# under infra/docker/dockerfiles/ are shared:
#
#   - Worker.Dockerfile        : Node.js workers, takes WORKER_NAME arg
#   - PythonWorker.Dockerfile  : Python workers, takes APP_NAME / APP_MODULE / PYTHON_VERSION
#   - Dashboard.Dockerfile     : Next.js dashboard
#   - AdapterRunner.Dockerfile : the playwright-bearing adapter runner
#   - Caddy.Dockerfile         : custom Caddy build with caddy-ratelimit
#
# The image tag default is `0.1.0` (matches Chart.yaml `appVersion` +
# values.yaml entries). Override at build time with `--set *.tags=...`
# for CI/release flows.
#
# Phase 12b activation: the cosign-sign-images job in security.yml signs
# every image enumerated by scripts/enumerate-publish-images.ts; that
# enumerator's output set must match the targets here.
#
# Build everything (no push):
#   docker buildx bake --file infra/docker/docker-bake.hcl --load
#
# Build a single target:
#   docker buildx bake --file infra/docker/docker-bake.hcl worker-pattern --load
#
# Build + push (release):
#   docker buildx bake --file infra/docker/docker-bake.hcl --push

variable "VIGIL_VERSION" {
  default = "0.1.0"
}

variable "VIGIL_REGISTRY" {
  default = "registry.vigilapex.local"
}

# Default platform — single arch for the cluster (DL380 Gen11 amd64).
# Override with --set *.platforms=linux/amd64,linux/arm64 for multi-arch.
variable "PLATFORMS" {
  default = "linux/amd64"
}

# Repo root — bake's `context = "../.."` resolves from this file's dir
# (infra/docker/) to the repo root where pnpm-workspace.yaml lives.
group "default" {
  targets = [
    "dashboard",
    "caddy",
    "adapter-runner",
    "audit-bridge",
    "audit-verifier",
    "api",

    # Node.js workers
    "worker-pattern",
    "worker-entity",
    "worker-extractor",
    "worker-score",
    "worker-counter-evidence",
    "worker-document",
    "worker-dossier",
    "worker-anchor",
    "worker-audit-watch",
    "worker-governance",
    "worker-tip-triage",
    "worker-tip-channels",
    "worker-conac-sftp",
    "worker-minfi-api",
    "worker-adapter-repair",
    "worker-fabric-bridge",
    "worker-federation-agent",
    "worker-federation-receiver",
    "worker-reconcil-audit",
    "worker-pattern-discovery",
    "worker-outcome-feedback",

    # Python workers
    "worker-satellite",
    "worker-image-forensics",
  ]
}

# ── Shared bake function for Node.js workers ──────────────────────────────
# Every Node.js worker uses Worker.Dockerfile with a WORKER_NAME build-arg.
# This function generates the target shape; each worker just calls it.
function "node_worker" {
  params = [name]
  result = {
    context    = "../.."
    dockerfile = "infra/docker/dockerfiles/Worker.Dockerfile"
    target     = "runtime"
    args = {
      WORKER_NAME = "${name}"
    }
    tags = ["${VIGIL_REGISTRY}/vigil-apex/${name}:${VIGIL_VERSION}"]
    platforms = ["${PLATFORMS}"]
  }
}

# ── Shared bake function for Python workers ───────────────────────────────
# PythonWorker.Dockerfile uses APP_NAME + APP_MODULE + optional EXTRA_APT.
function "python_worker" {
  params = [name, app_module, extra_apt]
  result = {
    context    = "../.."
    dockerfile = "infra/docker/dockerfiles/PythonWorker.Dockerfile"
    target     = "runtime"
    args = {
      APP_NAME    = "${name}"
      APP_MODULE  = "${app_module}"
      EXTRA_APT   = "${extra_apt}"
    }
    tags = ["${VIGIL_REGISTRY}/vigil-apex/${name}:${VIGIL_VERSION}"]
    platforms = ["${PLATFORMS}"]
  }
}

# ── Dashboard (Next.js standalone) ────────────────────────────────────────
target "dashboard" {
  context    = "../.."
  dockerfile = "infra/docker/dockerfiles/Dashboard.Dockerfile"
  target     = "runtime"
  tags       = ["${VIGIL_REGISTRY}/vigil-apex/dashboard:${VIGIL_VERSION}"]
  platforms  = ["${PLATFORMS}"]
}

# ── Caddy with caddy-ratelimit ────────────────────────────────────────────
# Tag scheme `rl-<caddy-version>` reflects that this is a custom build of
# Caddy (the rate-limit plugin is compiled in). Bump alongside the FROM
# line in Caddy.Dockerfile during the quarterly base-image refresh.
target "caddy" {
  context    = "../.."
  dockerfile = "infra/docker/dockerfiles/Caddy.Dockerfile"
  tags       = ["${VIGIL_REGISTRY}/vigil-caddy:rl-2.11.3"]
  platforms  = ["${PLATFORMS}"]
}

# ── adapter-runner (Playwright-bearing) ───────────────────────────────────
target "adapter-runner" {
  context    = "../.."
  dockerfile = "infra/docker/dockerfiles/AdapterRunner.Dockerfile"
  target     = "runtime"
  tags       = ["${VIGIL_REGISTRY}/vigil-apex/adapter-runner:${VIGIL_VERSION}"]
  platforms  = ["${PLATFORMS}"]
}

# ── audit-bridge ──────────────────────────────────────────────────────────
# Uses Worker.Dockerfile because it's a TS service that builds the same way.
target "audit-bridge" {
  inherits = ["worker-pattern"]
  args = { WORKER_NAME = "audit-bridge" }
  tags = ["${VIGIL_REGISTRY}/vigil-apex/audit-bridge:${VIGIL_VERSION}"]
}

target "audit-verifier" {
  inherits = ["worker-pattern"]
  args = { WORKER_NAME = "audit-verifier" }
  tags = ["${VIGIL_REGISTRY}/vigil-apex/audit-verifier:${VIGIL_VERSION}"]
}

target "api" {
  inherits = ["worker-pattern"]
  args = { WORKER_NAME = "api" }
  tags = ["${VIGIL_REGISTRY}/vigil-apex/api:${VIGIL_VERSION}"]
}

# ── Node.js workers (one target per worker) ───────────────────────────────
# Each inherits the hidden `_node_worker_base` target + overrides WORKER_NAME
# + sets the canonical image tag.

target "worker-pattern" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-pattern" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-pattern:${VIGIL_VERSION}"]
}
target "worker-entity" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-entity" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-entity:${VIGIL_VERSION}"]
}
target "worker-extractor" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-extractor" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-extractor:${VIGIL_VERSION}"]
}
target "worker-score" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-score" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-score:${VIGIL_VERSION}"]
}
target "worker-counter-evidence" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-counter-evidence" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-counter-evidence:${VIGIL_VERSION}"]
}
target "worker-document" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-document" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-document:${VIGIL_VERSION}"]
}
target "worker-dossier" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-dossier" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-dossier:${VIGIL_VERSION}"]
}
target "worker-anchor" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-anchor" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-anchor:${VIGIL_VERSION}"]
}
target "worker-audit-watch" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-audit-watch" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-audit-watch:${VIGIL_VERSION}"]
}
target "worker-governance" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-governance" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-governance:${VIGIL_VERSION}"]
}
target "worker-tip-triage" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-tip-triage" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-tip-triage:${VIGIL_VERSION}"]
}
target "worker-tip-channels" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-tip-channels" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-tip-channels:${VIGIL_VERSION}"]
}
target "worker-conac-sftp" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-conac-sftp" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-conac-sftp:${VIGIL_VERSION}"]
}
target "worker-minfi-api" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-minfi-api" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-minfi-api:${VIGIL_VERSION}"]
}
target "worker-adapter-repair" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-adapter-repair" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-adapter-repair:${VIGIL_VERSION}"]
}
target "worker-fabric-bridge" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-fabric-bridge" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-fabric-bridge:${VIGIL_VERSION}"]
}
target "worker-federation-agent" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-federation-agent" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-federation-agent:${VIGIL_VERSION}"]
}
target "worker-federation-receiver" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-federation-receiver" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-federation-receiver:${VIGIL_VERSION}"]
}
target "worker-reconcil-audit" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-reconcil-audit" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-reconcil-audit:${VIGIL_VERSION}"]
}
target "worker-pattern-discovery" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-pattern-discovery" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-pattern-discovery:${VIGIL_VERSION}"]
}
target "worker-outcome-feedback" {
  inherits = ["_node_worker_base"]
  args     = { WORKER_NAME = "worker-outcome-feedback" }
  tags     = ["${VIGIL_REGISTRY}/vigil-apex/worker-outcome-feedback:${VIGIL_VERSION}"]
}

# Hidden base target for all Node.js workers — not in `default` group.
target "_node_worker_base" {
  context    = "../.."
  dockerfile = "infra/docker/dockerfiles/Worker.Dockerfile"
  target     = "runtime"
  platforms  = ["${PLATFORMS}"]
}

# ── Python workers ────────────────────────────────────────────────────────

target "worker-satellite" {
  context    = "../.."
  dockerfile = "infra/docker/dockerfiles/PythonWorker.Dockerfile"
  target     = "runtime"
  args = {
    APP_NAME   = "worker-satellite"
    APP_MODULE = "vigil_satellite.main"
    # gdal-bin + libproj already in base; no extra apt needed.
    EXTRA_APT  = ""
  }
  tags       = ["${VIGIL_REGISTRY}/vigil-apex/worker-satellite:${VIGIL_VERSION}"]
  platforms  = ["${PLATFORMS}"]
}

target "worker-image-forensics" {
  context    = "../.."
  dockerfile = "infra/docker/dockerfiles/PythonWorker.Dockerfile"
  target     = "runtime"
  args = {
    APP_NAME   = "worker-image-forensics"
    APP_MODULE = "vigil_forensics.main"
    # tesseract-ocr needed for OCR-based font-anomaly path.
    EXTRA_APT  = "tesseract-ocr"
  }
  tags       = ["${VIGIL_REGISTRY}/vigil-apex/worker-image-forensics:${VIGIL_VERSION}"]
  platforms  = ["${PLATFORMS}"]
}
