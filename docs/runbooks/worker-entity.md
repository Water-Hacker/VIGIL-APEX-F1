# Runbook — worker-entity

> Bilingual operator runbook. **FR primary, EN secondary.**
> Block-C B2 contract: language-neutral content (metric tables,
> command snippets, file paths, env vars, error codes, P0–P3
> thresholds, step numbering) appears ONCE per document. Only
> narrative prose is duplicated under language-specific sub-headings.
> Drift on operational facts is a documentation defect.
>
> **Service:** [`apps/worker-entity/`](../../apps/worker-entity/) — entity resolution + Postgres canonical write + Neo4j mirror.

---

## Description

### 🇫🇷

`worker-entity` consomme le flux Redis `vigil:entity:resolve`. Pour
chaque enveloppe d'alias, il exécute :

1. **Résolution déterministique (rule-pass)** — appariement par
   numéro RCCM, NIU, ou nom normalisé. Trois compartiments :
   - `resolved` — appariement RCCM ou NIU exact (auto-fusion sûre).
   - `nameOnlyCandidates` — appariement par nom normalisé sans
     corroboration RCCM/NIU dans le même lot. Routé vers
     `entity.er_review_queue` pour décision opérateur (PAS
     d'auto-fusion ; deux entreprises distinctes peuvent partager
     un nom).
   - `unresolved` — passé à l'étape LLM.
2. **LLM-pass (SafeLlmRouter)** — uniquement les alias non résolus.
   Routé via `SafeLlmRouter.call({...})` per DECISION-011.
3. **Écriture Postgres FIRST** (SRD §15.1) — `EntityRepo.upsertCluster`
   en transaction atomique : un canonique + N alias.
4. **Mirror Neo4j (best-effort)** — boucle de retry bornée
   (`NEO4J_MIRROR_MAX_RETRIES`, défaut 3). État reflété par la
   colonne `entity.canonical.neo4j_mirror_state` et la métrique
   `vigil_neo4j_mirror_state_total{state}`.
5. **Publish PATTERN_DETECT** — UNIQUEMENT sur le chemin de succès
   (Block-A A.4). Une enveloppe par canonique.

### 🇬🇧

`worker-entity` consumes the Redis stream `vigil:entity:resolve`.
For each alias envelope, it executes:

1. **Deterministic resolution (rule-pass)** — match by RCCM
   number, NIU, or normalised name. Three buckets:
   - `resolved` — exact RCCM or NIU match (safe auto-merge).
   - `nameOnlyCandidates` — normalised-name match WITHOUT
     RCCM/NIU corroboration in the same batch. Routed to
     `entity.er_review_queue` for operator decision (NOT
     auto-merged; two distinct companies can share a name).
   - `unresolved` — passed to the LLM step.
2. **LLM-pass (SafeLlmRouter)** — unresolved aliases only. Routed
   via `SafeLlmRouter.call({...})` per DECISION-011.
3. **Postgres write FIRST** (SRD §15.1) — `EntityRepo.upsertCluster`
   in a single atomic transaction.
4. **Neo4j mirror (best-effort)** — bounded retry loop
   (`NEO4J_MIRROR_MAX_RETRIES`, default 3). State reflected in the
   `entity.canonical.neo4j_mirror_state` column and the
   `vigil_neo4j_mirror_state_total{state}` metric.
5. **Publish PATTERN_DETECT** — ONLY on the success path (Block-A
   A.4). One envelope per canonical.

---

## Boot sequence

1. `initTracing({ service: 'worker-entity' })` — OpenTelemetry.
2. `startMetricsServer()` — port `PROMETHEUS_PORT` (default 9100).
3. `QueueClient.ping()` — Redis (`REDIS_URL`).
4. `Neo4jClient.connect()` + `bootstrapSchema()` — `NEO4J_URI`.
5. `VaultClient.connect()` — read `anthropic/api_key`.
6. `LlmRouter` instantiated, then `SafeLlmRouter` wraps it
   (DECISION-011; sink = `CallRecordRepo`).
7. `EntityRepo` + `getDb()` — Postgres (`POSTGRES_URL`).
8. `Safety.adversarialPromptsRegistered()` — refuses to start if
   the canonical prompts are missing from the registry.
9. Periodic gauge tick of `vigil_neo4j_mirror_state_total{state}`
   (`NEO4J_MIRROR_GAUGE_INTERVAL_MS`, default 60 s).
10. `worker.start()` — consumer-group subscription to
    `vigil:entity:resolve`.

---

## Health-check signals

Binary alive/dead. **Page-worthy.**

| Metric                                                   | Healthy | Unhealthy → action                                         |
| -------------------------------------------------------- | ------- | ---------------------------------------------------------- |
| `up{job="vigil-workers", instance=~".*worker-entity.*"}` | `1`     | `0` for > 2 min → P0 (alert: `WorkerUnhealthy`)            |
| `vigil_worker_last_tick_seconds{worker="worker-entity"}` | < 1 h   | `time() - <gauge>` > 1 h → P1 (alert: `WorkerLoopStalled`) |
| `vigil_neo4j_mirror_state_total{state="failed"}`         | `0`     | `> 0` for 5 min → P1 (alert: `Neo4jMirrorFailedRows`)      |

## SLO signals

Latency / error-rate / lag. **Investigate-worthy** but not
necessarily page-worthy.

| Metric                                                                | SLO target        | Investigate-worthy threshold                                           |
| --------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------- |
| `vigil_worker_inflight{worker="worker-entity"}`                       | ≤ concurrency (4) | sustained at ceiling > 10 min → saturation                             |
| `vigil_neo4j_mirror_state_total{state="pending"}`                     | < 100             | > 100 for 30 min → alert `Neo4jMirrorPendingBacklog`                   |
| `vigil_neo4j_mirror_state_total{state="synced"}`                      | growing           | flat for > 1 h with non-zero `pending` → mirror loop wedged            |
| `vigil_llm_calls_total{provider="anthropic", outcome="error"}`        | rate < 1/min      | rate > 10/min for 5 min → LLM-pass failing                             |
| `vigil_llm_cost_usd_total` rate                                       | < $30/day         | > $30/day → soft ceiling (warning); > $100/day → `LlmCostCeilingError` |
| Redis stream `vigil:entity:resolve` PEL (pending entries list) length | < 100             | > 1000 → consumer group falling behind                                 |

---

## Common failures

| Symptom                                              | Likely cause                                                            | Mitigation                                                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Logs `er-rejected-missing-source-event-id`           | Upstream adapter emits envelope without `source_event_id`               | Dead-letter; investigate upstream adapter. Block-A §5.d removed the `'unknown'` fallback so the gap surfaces immediately.          |
| Repeated `neo4j-mirror-attempt-failed`               | Neo4j offline or Bolt network broken                                    | Check `vigil-neo4j` health. On final failure, canonical row stands; state `'failed'` recorded; deferred reconcile worker picks up. |
| `vigil_neo4j_mirror_state_total{state="failed"} > 0` | Worker exhausted retry budget on at least one mirror                    | `SELECT id, display_name FROM entity.canonical WHERE neo4j_mirror_state='failed' LIMIT 50;` — operator triages.                    |
| Logs `name-only-match-routed-to-review-queue`        | Expected behaviour — Block-A §5.c (no auto-merge on name alone)         | No action. Operator reviews `entity.er_review_queue` UI to merge or split.                                                         |
| Logs `postgres-upsert-failed`                        | `alias_unique` violated OR DB pool exhausted                            | Worker auto-retries. Persistent → check pool saturation (`vigil_db_pool_waiting`).                                                 |
| `er-failed` retrying continuously                    | LLM-pass error: registry missing, schema rejected, cost ceiling tripped | Inspect `Safety.globalPromptRegistry` + `llm.call_record`. Cost ceiling → `LlmCostCeilingError`; operator decision required.       |

---

## R1 — Routine deploy

Per SRD §31.1.

```sh
# On the production host, after PR merged + CI green:
cd /opt/vigil-apex
git pull --ff-only
docker compose pull worker-entity
docker compose up -d worker-entity
```

Verify within 30 s:

- `docker compose ps worker-entity` → `healthy`.
- `curl -s localhost:9100/metrics | grep vigil_worker_last_tick_seconds.*worker-entity` → recent timestamp.
- Watch `vigil_errors_total{service="worker-entity"}` for 5 minutes
  post-deploy.

### 🇫🇷 Notes opérateur

Aucun ordre particulier ; le worker peut être redéployé à chaud
sans coordination avec d'autres services.

### 🇬🇧 Operator notes

No special ordering; the worker can be redeployed live without
coordinating with other services.

---

## R2 — Restore from backup

Per SRD §31.2.

If Postgres or Neo4j is restored from the NAS-replica, run after
the upstream DB runbook completes:

```sql
-- Re-mark every canonical as pending so the next pass re-mirrors:
UPDATE entity.canonical SET neo4j_mirror_state = 'pending';
```

Verify `vigil_neo4j_mirror_state_total{state="synced"}` returns to
expected within 1 h.

### 🇫🇷 Notes opérateur

Sans ce reset, des canoniques peuvent rester marqués `'synced'`
alors que le nouveau Neo4j ne les contient pas — le mirror ne
reprend que sur événement entrant. Le reset force la re-hydratation
au prochain événement par canonical.

### 🇬🇧 Operator notes

Without the reset, canonicals may remain marked `'synced'` while
the new Neo4j doesn't carry them — the mirror only fires on
incoming events. The reset forces re-hydration at the next event
per canonical.

---

## R3 — Rotate operator YubiKey

Per SRD §31.3.

`worker-entity` does NOT use a YubiKey directly. It reads
`anthropic/api_key` from Vault. Operator YubiKey rotation that
affects Vault unseal cascades through the general Vault runbook;
no worker-specific action.

---

## R5 — Incident response

Per SRD §31.5.

| Severity | Trigger                                                                          | Action                                                                                    |
| -------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **P0**   | Worker down AND `WorkerLoopStalled` + `Neo4jMirrorPendingBacklog` simultaneously | Page architect 24/7. Stop upstream `adapter-runner`. Root-cause investigate.              |
| **P1**   | `vigil_neo4j_mirror_state_total{state="failed"} > 100`                           | Page on-call. Diagnostic SQL above. Check Neo4j health.                                   |
| **P2**   | `er-rejected-missing-source-event-id` rate > 10/min                              | Investigate upstream adapter emitting incomplete envelopes. No worker-side action needed. |
| **P3**   | Latency > 30 s on `vigil:entity:resolve` PEL                                     | Check LLM consumption (cost ceiling? circuit breaker?); check DB pool saturation.         |

### 🇫🇷 Astreinte

P0 → architecte 24/7. P1 → on-call (heures ouvrables Africa/Douala),
escalade architecte si > 4 h. P2/P3 → ticket dashboard.

### 🇬🇧 Paging

P0 → architect 24/7. P1 → on-call (Africa/Douala business hours),
escalate to architect if > 4 h. P2/P3 → dashboard ticket.

---

## R4 — Council pillar rotation

N/A — `worker-entity` does not read or write `governance.council_member`.
See [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Covered system-wide. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).
`worker-entity` is included in the rehearsal scope; the SLA is
6 h end-to-end restore including this worker's resumed pattern
dispatch and Neo4j mirror.

---

## Cross-references

### Code

- [`apps/worker-entity/src/index.ts`](../../apps/worker-entity/src/index.ts) — handler + boot.
- [`apps/worker-entity/src/rule-pass.ts`](../../apps/worker-entity/src/rule-pass.ts) — RCCM_RE / NIU_RE / language detection / canonical normalisers.
- [`packages/db-postgres/src/repos/entity.ts`](../../packages/db-postgres/src/repos/entity.ts) — `EntityRepo.upsertCluster` + `markNeo4jSynced` / `markNeo4jFailed`.
- [`packages/db-postgres/drizzle/0013_canonical_neo4j_mirror_state.sql`](../../packages/db-postgres/drizzle/0013_canonical_neo4j_mirror_state.sql) — Block-A §5.b migration.
- [`packages/db-postgres/drizzle/0014_canonical_normalised_name_idx.sql`](../../packages/db-postgres/drizzle/0014_canonical_normalised_name_idx.sql) — Block-A A.6 expression index.
- [`infra/docker/prometheus/alerts/vigil.yml`](../../infra/docker/prometheus/alerts/vigil.yml) — `Neo4jMirrorFailedRows` + `Neo4jMirrorPendingBacklog`.

### Binding spec

- **SRD §15.1** — DB commit precedes stream emit.
- **SRD §15.5.1** — entity-resolution strategy (rule-pass → LLM-pass → review-queue).
- **SRD §17** — audit chain integration (PATTERN_DETECT envelopes feed pattern dispatch which feeds Bayesian engine).
- **SRD §18** — LLM tier 0 / 1 / 2; cost ceilings.
- **SRD §31.1** — R1 routine deploy template.
- **SRD §31.2** — R2 restore from backup template.
- **SRD §31.3** — R3 YubiKey rotation template.
- **SRD §31.5** — R5 incident response template.
- **DECISION-011 (AI-SAFETY-DOCTRINE-v1)** — SafeLlmRouter chokepoint; 12-layer defences uniformly applied.
- **DECISION-012 (TAL-PA-DOCTRINE-v1)** — entity-resolution events emit user-action-event rows via `audit-emit.server.ts`.

### Block-A reconciliation

- §5.b — `neo4j_mirror_state` column + Cypher.addAlias `MATCH→MERGE` fix.
- §5.c — three-bucket rule-pass + `er_review_queue` routing for name-only candidates.
- §5.d — `source_id` discipline (no `'unknown'` fallback).
- A.6 — expression B-tree index on normalised display_name.
- A.4 — `finally`-block emit fix (PATTERN_DETECT only on success path).
