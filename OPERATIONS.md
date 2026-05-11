# OPERATIONS.md — Repo Strategy, Branching, CI, Code Review

Resolves **W-20** (no documented git/repo strategy) and supplements EXEC §37
(decision-log discipline).

---

## 1. Repository Hosting

**Primary**: Self-hosted Forgejo on the Hetzner CPX31 ingestion VPS (N02), at
`git@vigil-apex.git:vigil-apex/core.git`. The Forgejo instance lives behind
WireGuard; SSH access is YubiKey-PIV-only.

**Mirror (read-only push)**: Private GitHub repository at
`github.com/vigilapexsas/core` for off-site backup and architect mobility (cloning
from a coffee shop without exposing the Hetzner WireGuard tunnel).

**Backup**: Daily `git clone --mirror` to the Synology primary NAS WORM volume.

**Why Forgejo not GitHub primary**: The Cameroonian state cannot compel disclosure
from a Hetzner VPS in Germany the way a US-jurisdiction adversary could compel
GitHub. The mirror is convenience, not authority.

---

## 2. Branching

**Trunk-based**. Single long-lived branch: `main`.

- Feature work: short-lived branches `feat/<scope>`, `fix/<scope>`, `chore/<scope>`.
- Maximum branch age: 7 days. Older branches are rebased or closed.
- No `develop`, no `staging`, no long-lived release branches.
- Tagged releases: `v0.x.y` semver during MVP; `v1.0.0` at M6 public launch.
- Hotfix path: branch from the most recent tag, fix, tag, fast-forward main.

---

## 3. Commits

- **Conventional Commits** enforced via `commitlint` (BUILD-V1 §05.4).
- **Every commit signed** with the architect's YubiKey (PIV slot 9c, GPG-style):
  `git config commit.gpgsign true` is mandatory.
- During the build, signed commits are required on `main` only — feature
  branches may have unsigned exploration commits but the merge commit itself is signed.
- Co-authorship attributed to Claude Code agent on AI-augmented work:
  `Co-Authored-By: Claude (Anthropic) <noreply@anthropic.com>`.

---

## 4. Code Review

Solo-architect mode (Phase 1):

- Architect self-reviews via GitHub-style PR template (`PULL_REQUEST_TEMPLATE.md`).
- Backup architect review required for: contract deploys, Vault policy changes,
  YubiKey provisioning code, council-portal vote-signing path, anything in
  `infra/host-bootstrap/`.
- Senior engineer (if hired per EXEC §32) reviews routine work; architect reviews
  governance/security changes.

CI gates (must be green to merge):

| Gate                      | Tool                                             | Failure mode                             |
| ------------------------- | ------------------------------------------------ | ---------------------------------------- |
| Lint                      | ESLint + Prettier                                | non-blocking warning, blocking error     |
| Type-check                | `tsc --noEmit`                                   | blocking                                 |
| Test                      | Vitest (unit) + Playwright (e2e for UI surfaces) | blocking                                 |
| Schema validation         | `drizzle-kit check`                              | blocking                                 |
| Secret scan               | `gitleaks`                                       | blocking — no exceptions                 |
| Dependency vulnerability  | Snyk Pro                                         | blocking on Critical, warning on High    |
| Anti-hallucination corpus | nightly + on PR                                  | blocking on PRs touching `packages/llm/` |
| Adapter health            | nightly against frozen fixtures                  | warning (W-19 self-heal kicks in)        |

---

## 5. Documentation Discipline

- The 5 binding documents under `docs/source/` are reviewed quarterly per EXEC §43.4.
- Any commit changing a binding markdown MUST include a corresponding `docs/decisions/log.md` entry.
- The `.docx` archive in `docs/archive/` is **never edited** in-place; new versions get a new sha256 entry in `TRUTH.md` Section K.
- Markdown rewrites are the source of truth; `.docx` is rendered via pandoc CI for institutional distribution.

---

## 6. Secrets Management

- **No secrets in the repo, ever**. Pre-commit hook (`gitleaks`) blocks accidents.
- All runtime secrets in HashiCorp Vault (Phase 1+).
- `.env.example` template lives at the repo root; `.env` is gitignored.
- API key bootstrap at M0c is paper-based: the architect, with the backup
  architect present, pastes each key into Vault from a sealed envelope.

---

## 7. Decision Log Enforcement (W-27 fix)

A CI lint (`scripts/check-decisions.ts`) runs on every push to `main` and fails
the build if:

- Any `docs/decisions/log.md` entry marked `Status: FINAL` is dated within the last
  7 days but lacks a corresponding `audit_event_id` (Phase 1+ only — pre-Phase-1 entries are migrated retroactively).
- Any decision-log entry references a phase or section that does not exist.

---

## 8. Phase Gating

Code merges to `main` are gated by phase. Phase-N PRs cannot merge until the
phase-(N-1) acceptance tests in SRD §30 are green and recorded.

The CI workflow `.github/workflows/phase-gate.yml` reads `docs/decisions/log.md`
for the "current phase" decision and refuses merges that violate the gate. The
phase pointer is itself a decision-log entry, signed by the architect.

---

## 9. Backup Architect Onboarding (W-17 fix)

Before any code is committed to `main`, the backup architect:

1. Receives a paid retainer letter (~€400/month, signed before M0c).
2. Holds 1 Vault Shamir share + 1 Polygon Shamir share (paper, sealed).
3. Has read access to the Forgejo repo and the GitHub mirror.
4. Attends monthly architecture review (1 hr).
5. Performs the quarterly DR rehearsal alongside the architect.
6. Has the safe combination + the §34.5 envelope address on file.

---

## 10. Emergency Repo Access

If the architect is unreachable for 14 consecutive days:

- The backup architect contacts Hetzner support with the SAS company papers and
  the architect's personal lawyer (per EXEC §34.5 envelope).
- Forgejo VPS access is restored via Hetzner web console + recovery codes from the safe.
- The backup architect's YubiKey can decrypt their Vault Shamir share; combined
  with the safe paper share + the institutional-partner share = 3-of-5, system unsealed.
- No code may be merged to `main` during this window without 4-of-5 council vote.

---

## 11. Dead-letter queue replay (FIND-015 closure)

Closes FIND-015 from whole-system-audit doc 10. Several workers
(`worker-fabric-bridge`, `worker-conac-sftp`, `worker-anchor`,
`worker-tip-triage`, `worker-dossier`) stop retrying a single envelope
after 8 attempts and move it to a dead-letter Redis stream. The
operator dashboard at `/dead-letter` lists pending entries; this
section is the runbook for replaying them.

### Symptom

`/dead-letter` shows entries with `resolved=false` and the
`reason` column names a recoverable cause (e.g. `ipfs-fetch-failed`,
`fabric-peer-rpc-timeout`, `awaiting-sibling-language`,
`finding-below-conac-threshold`).

### Triage decision tree

1. **`reason = finding-below-conac-threshold`** — this is FIND-002
   working as intended; the underlying finding has posterior < 0.95
   or signal_count < 5. **Do not replay.** Either wait for the
   certainty engine to produce more evidence (preferred), or decide
   the finding warrants delivery anyway and route via a different
   recipient body (e.g. `MINFI` for procurement) — `CONAC` only
   accepts findings that clear the anti-corruption-grade threshold.

2. **`reason = finding-missing-at-conac-boundary`** — finding row was
   deleted or wasn't created yet. **Investigate first**, then either
   delete the dead-letter envelope (if intentional rollback) or
   reconstruct the finding before replay.

3. **`reason = fabric-postgres-divergence`** — non-recoverable.
   **STOP. Do not replay.** Hash chain integrity is at risk. Open
   `/audit/ai-safety`, run `pnpm --filter audit-verifier run
verify-once`, and engage the architect + 4-of-5 council before
   any further write to the chain.

4. **Anything else (transient infra)** — proceed with replay below.

### Replay procedure

```
# 1. Identify the envelope id and stream name
PGPASSWORD=$PG vigil-pg psql -c \
  "SELECT id, queue, dedup_key, reason, created_at FROM audit.dead_letter \
    WHERE resolved=false ORDER BY created_at DESC LIMIT 20"

# 2. Read the envelope payload (stored verbatim)
PGPASSWORD=$PG vigil-pg psql -c \
  "SELECT envelope::jsonb FROM audit.dead_letter WHERE id='<id>'"

# 3. Republish to the original stream
ENVELOPE='...'  # the JSONB body from step 2
echo "$ENVELOPE" | docker exec -i vigil-redis redis-cli -a $REDIS_PASS \
  XADD vigil:<stream-name> '*' envelope -

# 4. Mark the dead-letter row resolved
PGPASSWORD=$PG vigil-pg psql -c \
  "UPDATE audit.dead_letter SET resolved=true, resolved_at=NOW(), \
   resolved_by='<operator-id>', resolution='manual-replay' WHERE id='<id>'"

# 5. Watch the worker pick it back up
docker logs -f --tail 100 <worker-name>
```

### Bulk replay

If a backlog accumulated during a Fabric outage:

```
PGPASSWORD=$PG vigil-pg psql -c \
  "SELECT id, queue, envelope::text FROM audit.dead_letter \
    WHERE resolved=false AND reason LIKE 'fabric-%' \
    ORDER BY created_at ASC"
```

Pipe the resulting CSV through a small script that issues one
`XADD` per row. **Bounded rate** — no more than 100/minute to avoid
overwhelming the recovering worker.

### Reconciliation-worker integration

The new `worker-reconcil-audit` (FIND-005 closure) republishes
missing-from-Fabric envelopes automatically on its hourly tick, up to
`RECONCIL_AUDIT_MAX_REPUBLISH` envelopes per tick (default 100). For
audit-chain gaps you typically do not need to manually replay — give
the reconcil worker one or two cycles and confirm via the next tick's
`audit.reconciliation_completed` chain row.

### Postmortem

Every manual replay should land a one-line note in
`docs/runbook/dead-letter-replays.md` (create on first use): date,
envelope id, original failure reason, resolution. This builds the
historical record an external auditor or post-incident reviewer will
ask for.
