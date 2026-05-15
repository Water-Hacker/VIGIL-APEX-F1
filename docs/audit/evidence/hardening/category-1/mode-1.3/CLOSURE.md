# Mode 1.3 — Inter-service deadlock from circular dependencies

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 3 / Category 1
**Branch:** `hardening/phase-1-orientation`

## The failure mode

The `depends_on:` graph in `infra/docker/docker-compose.yaml` is hand-maintained. A future edit could introduce a self-loop (service depending on itself) or a multi-node cycle (A → B → A) that docker-compose would silently tolerate at runtime — Compose has historically not enforced acyclicity on `depends_on:`. The result: services start in unpredictable order, init containers may run twice or not at all, and the actual contract operators expect ("postgres before workers") becomes a coin-flip.

## What the orientation said

The Phase-1 orientation flagged a "self-loop on `vigil-fabric-bootstrap`" in the current compose file as evidence that the discipline had already drifted. **Re-investigation shows the orientation was wrong about this.** A fresh `grep -B1 -A 5 vigil-fabric-bootstrap infra/docker/docker-compose.yaml` shows `vigil-fabric-bootstrap` is depended ON by the orderer and peer services, but does not itself depend on itself. The current compose file is clean: 33 services, no cycles, no self-loops. (See verification below.)

The closure is therefore not a fix to existing drift but a **regression invariant** that prevents future drift.

## What was added

### 1. `scripts/check-compose-deps.ts`

Parses `infra/docker/docker-compose.yaml` and asserts:

- No service lists itself in its own `depends_on:`.
- The dependency DAG is acyclic (Tarjan-style DFS detects back-edges).

Handles both `depends_on:` shapes documented in compose:

- **Object form** (currently used in the repo): `name: { condition: service_healthy }`
- **Array form** (legacy/short): `- name`

The script is regex-based (no yaml dep) since docker-compose layout is predictable — services at 2-space indent, depends_on at 4-space, contents at 6-space. The architect can decide later whether to convert to a proper yaml parser; the regex is sufficient for this codebase's compose layout.

`COMPOSE_PATH` environment override lets the test suite point at synthetic fixtures.

### 2. `scripts/__tests__/check-compose-deps.test.ts`

Six test cases:

1. **Real-tree happy path** — runs against the real compose; asserts exit 0 + "OK — 33 services parsed".
2. **Self-loop detection** — synthetic fixture where `alpha` lists `alpha`; asserts exit 1 + "self-loop" + "alpha" in stderr.
3. **Two-node cycle** — `alpha → beta → alpha`; asserts exit 1 + "cycle detected".
4. **Three-node cycle** — `alpha → beta → gamma → alpha`; asserts exit 1 + "cycle detected" with any rotation of the cycle path.
5. **Valid DAG** — `alpha; beta → alpha; gamma → alpha, beta`; asserts exit 0.
6. **Array-form depends_on** — `beta: - alpha`; asserts exit 0 (parser handles both shapes).

### 3. CI gate in `.github/workflows/ci.yml`

New job `compose-deps` runs the script on every PR. The job is parallel-with `migration-locks` (no `needs:` chain other than `install`), so the gate adds ~30 s to CI wall time at most.

## The invariant

Three layers protect against regression:

1. **The CI gate** — any PR that introduces a self-loop or cycle in `depends_on:` fails before merge.
2. **The test suite** — five synthetic cases lock in the detection rules; if a future refactor changes the regex parser and stops detecting array-form deps (for example), the array-form test catches it.
3. **The script's parseable output** — `file:line ERROR: service 'X' lists itself in depends_on (self-loop).` is grep-friendly for CI annotation tooling.

## What this closure does NOT include

- **A converter to a proper YAML parser.** The regex approach is sufficient because docker-compose layout is regular. If a future migration introduces non-standard layouts (e.g. anchors, multi-line objects with nested condition + restart) the parser would need extension. Flagged for follow-up if needed.
- **Detection of `condition: service_started` vs `service_healthy` mismatches.** Out of scope — different concern (mode 1.7 territory).
- **A wider check covering `links:` or `network_mode: service:*`** (other ways one service can depend on another in compose). The current codebase doesn't use these; flagged for follow-up if a future PR adds them.

## Files touched

- `scripts/check-compose-deps.ts` (new, 159 lines)
- `scripts/__tests__/check-compose-deps.test.ts` (new, 143 lines)
- `.github/workflows/ci.yml` (+20 lines, new `compose-deps` job)
- `docs/audit/evidence/hardening/category-1/mode-1.3/CLOSURE.md` (this file)

## Verification

- `npx tsx scripts/check-compose-deps.ts` → "OK — 33 services parsed, dependency DAG is acyclic, no self-loops." Exit 0.
- Test cases against synthetic fixtures: self-loop (exit 1), two-cycle (exit 1), three-cycle (exit 1), valid DAG (exit 0), array form (exit 0).
- The orientation's claim of an existing self-loop on `vigil-fabric-bootstrap` is refuted by the gate's clean pass; the orientation overstated this mode the same way it overstated 2.3.
