# Runbook — neo4j (vigil-neo4j)

> Infra-plane service. Docker-compose-managed. Neo4j Community 5.18
> with custom GDS substitute (TRUTH §C; SRD §08).
>
> **Service:** docker-compose service `vigil-neo4j`. Derived view
> only — Postgres is authoritative; Neo4j is rebuilt from it on demand.

---

## Description

### 🇫🇷

Vue dérivée pour les requêtes graphes (anneaux de directeurs,
chaînes de bénéficiaires). PAS source de vérité ; reconstruite
depuis Postgres via la procédure de réhydratation. PageRank,
Louvain, NodeSimilarity implémentés en TypeScript dans
`packages/db-neo4j/gds/` (substitut à Enterprise GDS).

### 🇬🇧

Derived view for graph queries (director rings, beneficial-owner
chains). NOT a system of record; rebuilt from Postgres via the
rehydration procedure. PageRank, Louvain, NodeSimilarity
implemented in TypeScript in `packages/db-neo4j/gds/` (substitute
for Enterprise GDS).

---

## Boot sequence

1. Docker compose pulls `neo4j:5.18-community`.
2. Volume `neo4j_data` mounted (persistent across restarts).
3. Workers connect via `NEO4J_URI` (`bolt://vigil-neo4j:7687`),
   `NEO4J_USER`, `NEO4J_PASSWORD_FILE` (Docker secret).
4. `Neo4jClient.connect()` + `bootstrapSchema()` declares
   constraints + indexes (lazy-idempotent).

---

## Health-check signals

| Metric                                           | Healthy | Unhealthy → action                                    |
| ------------------------------------------------ | ------- | ----------------------------------------------------- |
| Docker healthcheck `cypher-shell ... 'RETURN 1'` | OK      | failing > 60 s → P1                                   |
| `vigil_neo4j_mirror_state_total{state="failed"}` | `0`     | `> 0` for 5 min → P1 (alert: `Neo4jMirrorFailedRows`) |

## SLO signals

| Metric                                            | SLO target | Investigate-worthy                                 |
| ------------------------------------------------- | ---------- | -------------------------------------------------- |
| `vigil_neo4j_mirror_state_total{state="pending"}` | < 100      | > 100 for 30 min → `Neo4jMirrorPendingBacklog`     |
| Bolt connection pool saturation (per-worker logs) | < 50 %     | sustained > 80 % → bump `NEO4J_MAX_CONN_POOL_SIZE` |
| Disk usage on `neo4j_data`                        | < 70 %     | > 85 % → page on-call                              |

---

## Common failures

| Symptom                                              | Likely cause                                  | Mitigation                                                                                         |
| ---------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Workers logging `neo4j-mirror-attempt-failed`        | neo4j down OR Bolt network partition          | `docker compose logs vigil-neo4j --tail=200`. Postgres canonical row stands; mirror retries later. |
| `vigil_neo4j_mirror_state_total{state="failed"} > 0` | worker-entity exhausted retry budget          | Operator triages via `SELECT id FROM entity.canonical WHERE neo4j_mirror_state='failed'`.          |
| Cypher queries returning stale data                  | rehydration incomplete after postgres restore | See R2 — re-mark canonicals pending; Neo4j re-mirrors on next worker-entity tick.                  |
| Disk full                                            | accumulated transaction logs                  | `cypher-shell> CALL db.checkpoint();`; archive old segments.                                       |

---

## R1 — Routine deploy

Neo4j Community image bumps are rare. Procedure mirrors postgres.md
R1.

```sh
docker compose pull vigil-neo4j
docker compose up -d vigil-neo4j
```

`worker-entity` reconnects automatically via the Bolt driver's
built-in retry. Watch `vigil_neo4j_mirror_state_total{state="failed"}`
for restart-window blips.

---

## R2 — Restore from backup

Per SRD §31.2.

Neo4j is rebuilt from Postgres rather than restored from a Neo4j-side
backup. Procedure:

1. Stop `vigil-neo4j`. Volume can be wiped or kept (keeping is faster).
2. Bring `vigil-neo4j` back up, fresh.
3. Mark every canonical as pending re-mirror:
   ```sql
   UPDATE entity.canonical SET neo4j_mirror_state = 'pending';
   ```
4. The deferred Neo4j-reconcile worker (track Neo4j retry-queue;
   not yet shipped) will re-mirror in the background. In Phase 1,
   the next event per canonical re-mirrors on demand via worker-entity.
5. For relationships + aliases-of-existing-canonicals: a manual
   rehydration script walks `entity.relationship` + `entity.alias`
   and replays them through `Cypher.upsertEntity` /
   `Cypher.addRelationship` / `Cypher.addAlias`. Lives at
   `scripts/neo4j-rehydrate.ts` (Phase-1 deliverable; not yet shipped).

---

## R3 — Credential rotation

Rotate the `neo4j` service password (Vault path
`secret/neo4j/service_password`).

```sh
# 1. Generate new password
NEW_PWD="$(openssl rand -base64 32)"

# 2. Rotate via cypher-shell (admin connection)
docker compose exec vigil-neo4j cypher-shell -u neo4j -p "$OLD_PWD" \
  "ALTER USER neo4j SET PASSWORD '$NEW_PWD';"

# 3. Update Vault
vault kv put secret/neo4j service_password="$NEW_PWD"

# 4. Update the Docker secret + restart workers reading NEO4J_PASSWORD_FILE
echo "$NEW_PWD" | docker secret create neo4j_password_v$(date +%s) -
# (Update compose to reference the new secret name; redeploy.)

# 5. Verify
docker compose exec vigil-neo4j cypher-shell -u neo4j -p "$NEW_PWD" 'RETURN 1;'
```

Quarterly per HSK-v1 §6.

---

## R5 — Incident response

| Severity | Trigger                                                      | Action                                                                                        |
| -------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **P1**   | Neo4j down for > 60 s                                        | Page on-call. worker-entity continues writing Postgres + queueing mirror state; data path OK. |
| **P1**   | `vigil_neo4j_mirror_state_total{state="failed"} > 100`       | Page on-call. SQL list above. Decide retry vs full re-hydration.                              |
| **P2**   | Cypher query returns wrong-cardinality result (post-restore) | Trigger full re-hydration via R2.                                                             |
| **P3**   | Disk approaching 85 %                                        | Schedule checkpoint + archive.                                                                |

---

## R4 — Council pillar rotation

N/A — neo4j is council-state-blind. See [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included in scope. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).
Neo4j re-hydration time (~30 min for ~10k entities at Phase-1 scale)
is part of the 6-h SLA budget.

---

## Cross-references

### Code

- [`packages/db-neo4j/src/client.ts`](../../packages/db-neo4j/src/client.ts) — Bolt driver wrapper.
- [`packages/db-neo4j/src/queries.ts`](../../packages/db-neo4j/src/queries.ts) — Cypher templates.
- [`packages/db-neo4j/gds/`](../../packages/db-neo4j/gds/) — TS-side PageRank / Louvain / NodeSimilarity.

### Binding spec

- **TRUTH §C** — Neo4j Community + custom GDS.
- **SRD §08** — graph view rationale + 1-hop / multi-hop traversals.
- **SRD §31.2** — R2 (re-hydration is the restore mechanism, not a Neo4j-side backup).
- **HSK-v1 §6** — credential rotation cadence.
