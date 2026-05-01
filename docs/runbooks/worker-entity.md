# Runbook — worker-entity

> Bilingual operator runbook. **FR section first** (operator de
> garde langue par défaut), EN section second. Both populated;
> drift between them is a documentation defect.
>
> SRD §31.1–§31.6 R1–R6 templates were not enumerated in the
> binding doc as of 2026-05-01 (architect-tracked Block-D follow-up).
> This runbook adopts an **inferred** R1–R6 structure that the
> remaining 22 worker runbooks will replicate; Block-D codifies the
> template back into SRD §31 once the architect signs.
>
> **Service:** [`apps/worker-entity/`](../../apps/worker-entity/) — entity resolution + Postgres canonical write + Neo4j mirror.

---

## 🇫🇷 Français

### Description

`worker-entity` consomme le flux Redis `vigil:entity:resolve`. Pour
chaque enveloppe d'alias (provenant de l'extracteur ou d'un adaptateur),
il :

1. **Résolution déterministique (rule-pass)** — appariement par
   numéro RCCM, NIU, ou nom normalisé. Trois compartiments :
   - `resolved` — appariement RCCM ou NIU exact (auto-fusion sûre).
   - `nameOnlyCandidates` — appariement par nom normalisé sans
     corroboration RCCM/NIU dans le même lot. Routé vers
     `entity.er_review_queue` pour décision opérateur (PAS d'auto-fusion ;
     deux entreprises distinctes peuvent partager un nom).
   - `unresolved` — passé à l'étape LLM.
2. **LLM-pass (SafeLlmRouter)** — uniquement les alias non résolus.
   Routé via `SafeLlmRouter.call({findingId, assessmentId, promptName,
task, sources, responseSchema, modelId})` per DECISION-011.
3. **Écriture Postgres FIRST** (SRD §15.1) — `EntityRepo.upsertCluster`
   en transaction atomique : un canonique + N alias en une seule
   transaction. Échec de transaction → retry.
4. **Mirror Neo4j (best-effort)** — boucle de retry bornée
   (env `NEO4J_MIRROR_MAX_RETRIES`, défaut 3). Sur succès :
   `entity.canonical.neo4j_mirror_state = 'synced'`. Sur échec final :
   `'failed'`. Sur défaut : `'pending'`. La métrique Prometheus
   `vigil_neo4j_mirror_state_total{state}` reflète l'état.
5. **Publish PATTERN_DETECT** — UNIQUEMENT sur le chemin de succès
   (Block-A A.4 / Block-B). Une enveloppe par canonique avec
   `subject_kind`, `canonical_id`, `event_ids: [source_event_id]`.

### Séquence de démarrage

1. `initTracing({ service: 'worker-entity' })` — OpenTelemetry.
2. `startMetricsServer()` — port `PROMETHEUS_PORT` (défaut 9100).
3. `QueueClient.ping()` — Redis (`REDIS_URL`).
4. `Neo4jClient.connect()` + `bootstrapSchema()` — bolt URI `NEO4J_URI`.
5. `VaultClient.connect()` — lecture `anthropic/api_key`.
6. `LlmRouter` instancié, puis `SafeLlmRouter` enveloppant (DECISION-011 ;
   sink `CallRecordRepo`).
7. `EntityRepo` + `getDb()` — Postgres (`POSTGRES_URL`).
8. `Safety.adversarialPromptsRegistered()` — refuse de démarrer si
   les prompts canoniques manquent du registry.
9. Boucle de tick métrique `vigil_neo4j_mirror_state_total{state}`
   (intervalle `NEO4J_MIRROR_GAUGE_INTERVAL_MS`, défaut 60 s).
10. `worker.start()` — abonnement consumer-group au flux
    `vigil:entity:resolve`.

### Signaux de bon fonctionnement

| Métrique Prometheus                                         | Bonne valeur                                     |
| ----------------------------------------------------------- | ------------------------------------------------ |
| `vigil_worker_inflight{worker="worker-entity"}`             | > 0 en charge ; ≤ concurrency (4)                |
| `vigil_worker_last_tick_seconds{worker="worker-entity"}`    | dans les 5 dernières minutes                     |
| `vigil_neo4j_mirror_state_total{state="synced"}`            | augmente progressivement                         |
| `vigil_neo4j_mirror_state_total{state="failed"}`            | **0** (alerte sinon)                             |
| `vigil_neo4j_mirror_state_total{state="pending"}`           | < 100 (alerte si > 100 pendant 30 min)           |
| `vigil_llm_calls_total{provider="anthropic", outcome="ok"}` | augmente sur les batches qui tombent en LLM-pass |
| `vigil_errors_total{service="worker-entity"}`               | rare ; pics indiquent retry-storms               |

### Pannes courantes

| Symptôme                                             | Cause probable                                                   | Mitigation                                                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Logs `er-rejected-missing-source-event-id`           | Adaptateur émet une enveloppe sans `source_event_id`             | Dead-letter ; investiguer l'adaptateur amont. Block-A §5.d a supprimé le fallback `'unknown'`.                                           |
| Logs `neo4j-mirror-attempt-failed` répétés           | Neo4j hors-ligne ou réseau Bolt cassé                            | Vérifier `vigil-neo4j` ; sur échec final, la ligne canonique reste, état `'failed'` enregistré ; le worker reconcile (différé) reprendra |
| `vigil_neo4j_mirror_state_total{state="failed"} > 0` | Le worker a épuisé le budget de retry sur au moins un mirror     | Page on-call (alerte `Neo4jMirrorFailedRows`) ; SQL `SELECT id FROM entity.canonical WHERE neo4j_mirror_state='failed'` pour la liste    |
| Logs `name-only-match-routed-to-review-queue`        | Comportement attendu — Block-A §5.c                              | Aucune action ; un opérateur revoit la `entity.er_review_queue` UI                                                                       |
| Logs `postgres-upsert-failed`                        | Contrainte unique `alias_unique` violée OU pool DB épuisé        | Investiguer ; le worker retry automatiquement                                                                                            |
| `er-failed` avec retry continu                       | Erreur LLM-pass (registry manquant, schéma rejeté, plafond coût) | Vérifier `Safety.globalPromptRegistry` + `llm.call_record` ; si plafond coût, voir `LlmCostCeilingError`                                 |

### R1 — Déploiement de routine

1. PR mergée sur `main` après CI verte (lint + typecheck + build + test + phase-gate tous verts).
2. CI émet image Docker `worker-entity:<sha>` via `docker compose build worker-entity`.
3. Sur l'hôte de production :
   ```sh
   cd /opt/vigil-apex
   git pull --ff-only
   docker compose pull worker-entity
   docker compose up -d worker-entity
   ```
4. Vérifier `docker compose ps worker-entity` → `healthy` dans 30 s.
5. Vérifier `curl localhost:9100/metrics | grep vigil_worker_last_tick_seconds.*worker-entity` → timestamp récent.
6. Surveiller `vigil_errors_total{service="worker-entity"}` 5 minutes après le déploiement.

### R2 — Restauration depuis sauvegarde

Si Postgres ou Neo4j est restauré depuis le NAS-replica (R2 de SRD §31.2) :

1. **Postgres** — restauré par le runbook DB ; `worker-entity` redémarre automatiquement après `vigil-postgres` healthy.
2. **Neo4j** — `entity.canonical.neo4j_mirror_state` peut indiquer `'synced'` pour des canoniques absents du nouveau Neo4j. Lancer la rétrohydratation :
   ```sql
   UPDATE entity.canonical SET neo4j_mirror_state = 'pending';
   ```
   `worker-entity` mirrore au prochain événement traité ; le worker de réconciliation différé (track Neo4j retry queue) reprend les `'pending'` orphelins.
3. Vérifier `vigil_neo4j_mirror_state_total{state="synced"}` revient à la valeur attendue dans 1 h.

### R3 — Rotation YubiKey

`worker-entity` n'utilise PAS de YubiKey directement. Il lit
`anthropic/api_key` depuis Vault. Si la rotation YubiKey de
l'opérateur affecte l'unseal Vault, suivre le runbook Vault général.
Aucune action spécifique au worker.

### R4 — Changement de membre du conseil

N/A — `worker-entity` ne lit PAS la table `governance.council_member`.

### R5 — Réponse aux incidents

| Sévérité | Déclencheur                                                                                    | Action immédiate                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **P0**   | `worker-entity` down et alertes `WorkerLoopStalled` ET `Neo4jMirrorPendingBacklog` simultanées | Page architecte. Stop ingest amont (`adapter-runner`). Investiguer cause racine.                                                           |
| **P1**   | `vigil_neo4j_mirror_state_total{state="failed"} > 100`                                         | Page on-call. Vérifier Neo4j. SQL diagnostic : `SELECT id, display_name FROM entity.canonical WHERE neo4j_mirror_state='failed' LIMIT 50;` |
| **P2**   | `er-rejected-missing-source-event-id` > 10/min                                                 | Investiguer adaptateur amont émettant des enveloppes incomplètes.                                                                          |
| **P3**   | Latence > 30 s sur la queue `vigil:entity:resolve`                                             | Vérifier consommation LLM (plafond coût ?) ; vérifier saturation pool DB.                                                                  |

### R6 — Exercice DR mensuel

`worker-entity` est inclus dans l'exercice DR mensuel. Vérifier
que le mirror Neo4j et le pattern dispatch reprennent dans les
6 heures de SLA après une perte d'hôte simulée. Voir
[scripts/dr-rehearsal.ts](../../scripts/dr-rehearsal.ts) (livrable
Block-C C.3).

### Politique d'astreinte

- **P0** → page architecte 24/7.
- **P1** → page on-call (heures ouvrables Africa/Douala) ; page architecte si > 4 h.
- **P2** → ticket dashboard ; revue du jour ouvrable suivant.
- **P3** → ticket dashboard ; revue de la semaine suivante.

---

## 🇬🇧 English

### Description

`worker-entity` consumes the Redis stream `vigil:entity:resolve`.
For each alias envelope (from the extractor or an adapter), it:

1. **Deterministic resolution (rule-pass)** — match by RCCM
   number, NIU, or normalised name. Three buckets:
   - `resolved` — exact RCCM or NIU match (safe auto-merge).
   - `nameOnlyCandidates` — normalised-name match WITHOUT
     RCCM/NIU corroboration in the same batch. Routed to
     `entity.er_review_queue` for operator decision (NOT
     auto-merged; two distinct companies can share a display name).
   - `unresolved` — passed to the LLM step.
2. **LLM-pass (SafeLlmRouter)** — unresolved aliases only. Routed via
   `SafeLlmRouter.call({findingId, assessmentId, promptName, task,
sources, responseSchema, modelId})` per DECISION-011.
3. **Postgres write FIRST** (SRD §15.1) — `EntityRepo.upsertCluster`
   in an atomic transaction: one canonical + N aliases in a single
   transaction. Transaction failure → retry.
4. **Neo4j mirror (best-effort)** — bounded retry loop (env
   `NEO4J_MIRROR_MAX_RETRIES`, default 3). On success:
   `entity.canonical.neo4j_mirror_state = 'synced'`. On final
   failure: `'failed'`. Default: `'pending'`. The Prometheus
   metric `vigil_neo4j_mirror_state_total{state}` reflects state.
5. **Publish PATTERN_DETECT** — ONLY on the success path (Block-A
   A.4 / Block-B). One envelope per canonical with `subject_kind`,
   `canonical_id`, `event_ids: [source_event_id]`.

### Boot sequence

1. `initTracing({ service: 'worker-entity' })` — OpenTelemetry.
2. `startMetricsServer()` — port `PROMETHEUS_PORT` (default 9100).
3. `QueueClient.ping()` — Redis (`REDIS_URL`).
4. `Neo4jClient.connect()` + `bootstrapSchema()` — Bolt URI `NEO4J_URI`.
5. `VaultClient.connect()` — read `anthropic/api_key`.
6. `LlmRouter` instantiated, then `SafeLlmRouter` wrapping (DECISION-011;
   sink `CallRecordRepo`).
7. `EntityRepo` + `getDb()` — Postgres (`POSTGRES_URL`).
8. `Safety.adversarialPromptsRegistered()` — refuses to start if
   the canonical prompts are missing from the registry.
9. Periodic gauge tick of `vigil_neo4j_mirror_state_total{state}`
   (interval `NEO4J_MIRROR_GAUGE_INTERVAL_MS`, default 60 s).
10. `worker.start()` — consumer-group subscription to the
    `vigil:entity:resolve` stream.

### Healthy steady-state signals

| Prometheus metric                                           | Healthy value                                  |
| ----------------------------------------------------------- | ---------------------------------------------- |
| `vigil_worker_inflight{worker="worker-entity"}`             | > 0 under load; ≤ concurrency (4)              |
| `vigil_worker_last_tick_seconds{worker="worker-entity"}`    | within last 5 minutes                          |
| `vigil_neo4j_mirror_state_total{state="synced"}`            | growing steadily                               |
| `vigil_neo4j_mirror_state_total{state="failed"}`            | **0** (alert otherwise)                        |
| `vigil_neo4j_mirror_state_total{state="pending"}`           | < 100 (alert if > 100 for 30 min)              |
| `vigil_llm_calls_total{provider="anthropic", outcome="ok"}` | grows on batches that fall through to LLM-pass |
| `vigil_errors_total{service="worker-entity"}`               | rare; spikes indicate retry storms             |

### Common failures

| Symptom                                              | Likely cause                                                     | Mitigation                                                                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Logs `er-rejected-missing-source-event-id`           | Upstream adapter emits an envelope without `source_event_id`     | Dead-letter; investigate the upstream adapter. Block-A §5.d removed the `'unknown'` fallback.                                      |
| Repeated `neo4j-mirror-attempt-failed` logs          | Neo4j offline or Bolt network broken                             | Check `vigil-neo4j`; on final failure the canonical row stands, state `'failed'` recorded; deferred reconcile worker picks up      |
| `vigil_neo4j_mirror_state_total{state="failed"} > 0` | Worker exhausted retry budget on at least one mirror             | Page on-call (alert `Neo4jMirrorFailedRows`); SQL `SELECT id FROM entity.canonical WHERE neo4j_mirror_state='failed'` for the list |
| Logs `name-only-match-routed-to-review-queue`        | Expected behaviour — Block-A §5.c                                | No action; an operator reviews the `entity.er_review_queue` UI                                                                     |
| Logs `postgres-upsert-failed`                        | `alias_unique` constraint violated OR DB pool exhausted          | Investigate; the worker retries automatically                                                                                      |
| `er-failed` with continuous retry                    | LLM-pass error (registry missing, schema rejected, cost ceiling) | Check `Safety.globalPromptRegistry` + `llm.call_record`; if cost ceiling, see `LlmCostCeilingError`                                |

### R1 — Routine deploy

1. PR merged to `main` after green CI (lint + typecheck + build + test + phase-gate all green).
2. CI emits Docker image `worker-entity:<sha>` via `docker compose build worker-entity`.
3. On the production host:
   ```sh
   cd /opt/vigil-apex
   git pull --ff-only
   docker compose pull worker-entity
   docker compose up -d worker-entity
   ```
4. Verify `docker compose ps worker-entity` → `healthy` within 30 s.
5. Verify `curl localhost:9100/metrics | grep vigil_worker_last_tick_seconds.*worker-entity` → recent timestamp.
6. Watch `vigil_errors_total{service="worker-entity"}` for 5 minutes post-deploy.

### R2 — Restore from backup

If Postgres or Neo4j is restored from the NAS-replica (SRD §31.2 R2):

1. **Postgres** — restored by the DB runbook; `worker-entity` restarts automatically after `vigil-postgres` is healthy.
2. **Neo4j** — `entity.canonical.neo4j_mirror_state` may show `'synced'` for canonicals missing from the new Neo4j. Trigger rehydration:
   ```sql
   UPDATE entity.canonical SET neo4j_mirror_state = 'pending';
   ```
   `worker-entity` mirrors on the next event processed; the deferred reconcile worker (Neo4j retry-queue track) picks up orphan `'pending'` rows.
3. Verify `vigil_neo4j_mirror_state_total{state="synced"}` returns to the expected value within 1 h.

### R3 — Rotate YubiKey

`worker-entity` does NOT use a YubiKey directly. It reads
`anthropic/api_key` from Vault. If operator YubiKey rotation
affects Vault unseal, follow the general Vault runbook. No
worker-specific action.

### R4 — Pillar holder change

N/A — `worker-entity` does NOT read the `governance.council_member`
table.

### R5 — Incident response

| Severity | Trigger                                                                                          | Immediate action                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**   | `worker-entity` down AND `WorkerLoopStalled` + `Neo4jMirrorPendingBacklog` alerts simultaneously | Page architect. Stop upstream ingest (`adapter-runner`). Root-cause investigate.                                                       |
| **P1**   | `vigil_neo4j_mirror_state_total{state="failed"} > 100`                                           | Page on-call. Check Neo4j. Diagnostic SQL: `SELECT id, display_name FROM entity.canonical WHERE neo4j_mirror_state='failed' LIMIT 50;` |
| **P2**   | `er-rejected-missing-source-event-id` > 10/min                                                   | Investigate upstream adapter emitting incomplete envelopes.                                                                            |
| **P3**   | Latency > 30 s on the `vigil:entity:resolve` queue                                               | Check LLM consumption (cost ceiling?); check DB pool saturation.                                                                       |

### R6 — Monthly DR exercise

`worker-entity` is included in the monthly DR exercise. Verify
that Neo4j mirror and pattern dispatch resume within the 6-hour
SLA after a simulated host loss. See
[scripts/dr-rehearsal.ts](../../scripts/dr-rehearsal.ts) (Block-C C.3
deliverable).

### On-call paging policy

- **P0** → page architect 24/7.
- **P1** → page on-call (Africa/Douala business hours); page architect if > 4 h.
- **P2** → dashboard ticket; review next business day.
- **P3** → dashboard ticket; review next week.

---

## Cross-references

- [`apps/worker-entity/src/index.ts`](../../apps/worker-entity/src/index.ts) — handler + boot.
- [`apps/worker-entity/src/rule-pass.ts`](../../apps/worker-entity/src/rule-pass.ts) — RCCM_RE / NIU_RE / detectLanguage / canonicalRccm / canonicalNiu.
- [`packages/db-postgres/src/repos/entity.ts`](../../packages/db-postgres/src/repos/entity.ts) — EntityRepo.upsertCluster + neo4j_mirror_state helpers.
- [`packages/db-postgres/drizzle/0013_canonical_neo4j_mirror_state.sql`](../../packages/db-postgres/drizzle/0013_canonical_neo4j_mirror_state.sql) — Block-A §5.b migration.
- [`packages/db-postgres/drizzle/0014_canonical_normalised_name_idx.sql`](../../packages/db-postgres/drizzle/0014_canonical_normalised_name_idx.sql) — Block-A A.6 expression index.
- [`infra/docker/prometheus/alerts/vigil.yml`](../../infra/docker/prometheus/alerts/vigil.yml) — `Neo4jMirrorFailedRows` + `Neo4jMirrorPendingBacklog` alert rules.
- DECISION-011 (AI Safety Doctrine) — SafeLlmRouter chokepoint.
- Block-A reconciliation §5.b / §5.c / §5.d — Postgres-first, three-bucket rule-pass, source_id discipline.
