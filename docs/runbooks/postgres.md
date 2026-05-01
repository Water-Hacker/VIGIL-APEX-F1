# Runbook — postgres (vigil-postgres)

> Infra-plane service. Docker-compose-managed; not an `apps/<x>/`
> worker. PostgreSQL 16 + TimescaleDB + pgvector per TRUTH §C.
>
> **Service:** docker-compose service `vigil-postgres`. Authoritative
> data store; everything writes here first, Neo4j is derived.

---

## Description

### 🇫🇷

Source de vérité du système (TRUTH §B). Chaque worker écrit ici
en premier (SRD §15.1 invariant). Migrations Drizzle gérées par
`pnpm --filter @vigil/db-postgres run migrate`. Schémas :
`source`, `entity`, `finding`, `dossier`, `governance`, `tip`,
`audit`, `llm`, `meta`.

### 🇬🇧

System of record (TRUTH §B). Every worker writes here first
(SRD §15.1 invariant). Drizzle migrations managed via
`pnpm --filter @vigil/db-postgres run migrate`. Schemas:
`source`, `entity`, `finding`, `dossier`, `governance`, `tip`,
`audit`, `llm`, `meta`.

---

## Boot sequence

1. Docker compose pulls `postgres:16-alpine` (with TimescaleDB +
   pgvector extensions per `infra/docker/postgres/Dockerfile`).
2. Init scripts in `/docker-entrypoint-initdb.d/` run on first boot
   (creates the `vigil` role + extensions).
3. Workers connect via `POSTGRES_URL` (`postgres://vigil:<pwd>@vigil-postgres:5432/vigil`).
4. Migration sweep: any worker calling `getDb()` triggers no
   automatic migration; the operator runs `pnpm migrate` manually
   or via `infra/host-bootstrap/04-db-migrate.sh`.

---

## Health-check signals

| Metric                                                 | Healthy | Unhealthy → action                    |
| ------------------------------------------------------ | ------- | ------------------------------------- |
| `pg_up`                                                | `1`     | `0` for > 2 min → P0                  |
| `vigil_db_pool_total` ≥ `vigil_db_pool_idle + waiting` | true    | violation → connection accounting bug |
| Docker healthcheck `pg_isready -U vigil`               | OK      | failing > 30 s → P0                   |

## SLO signals

| Metric                                                  | SLO target    | Investigate-worthy                         |
| ------------------------------------------------------- | ------------- | ------------------------------------------ |
| `vigil_db_pool_waiting`                                 | `0`           | sustained > 0 → connection-pool saturation |
| `pg_stat_activity` rows with `wait_event_type = 'Lock'` | < 5           | > 20 → lock contention                     |
| Replication lag (NAS replica)                           | < 5 min (RPO) | > 5 min → page on-call                     |
| Disk usage on `pg_data` volume                          | < 70 %        | > 85 % → P1; > 95 % → P0                   |

---

## Common failures

| Symptom                               | Likely cause                                                        | Mitigation                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Workers logging `ECONNREFUSED 5432`   | postgres container down / restarting                                | `docker compose ps vigil-postgres`; `docker compose logs vigil-postgres --tail=200`        |
| `vigil_db_pool_waiting` > 0 sustained | pool exhausted (worker concurrency too high or query loop too slow) | Audit slow query log; bump `POSTGRES_POOL_MAX` if justified; reduce per-worker concurrency |
| Migration failure on boot             | hand-curated SQL conflicts with existing state                      | Operator inspects `_vigil_migrations` table; fixes the SQL; never reverts a forward        |
| Disk full alert                       | accumulated WAL or vacuum lag                                       | Force checkpoint + vacuum-analyse; if WAL volume, archive + truncate                       |
| Replication paused                    | NAS network partition or replica disk full                          | Check WireGuard tunnel; check replica disk; on resume, replay window catches up            |

---

## R1 — Routine deploy

Postgres image bumps are rare. When they happen:

```sh
# On host, after testing the new image in dev:
cd /opt/vigil-apex
docker compose pull vigil-postgres
docker compose up -d vigil-postgres
# Workers reconnect automatically via pg.Pool retries.
```

Verify within 60 s:

- `docker compose ps vigil-postgres` → `healthy`.
- Run a sanity query: `psql $POSTGRES_URL -c 'SELECT version();'`.
- Watch `vigil_errors_total{service=~"worker-.*"}` for connection blips
  during the restart window.

---

## R2 — Restore from backup

Per SRD §31.2 + SRD §27.

The NAS-replica holds a streaming standby. Procedure (high-level;
operator runbook lives at `infra/host-bootstrap/restore-pg.sh`):

1. Stop all workers (`docker compose stop $(grep '^  worker' docker-compose.yml | awk '{print $1}' | tr -d ':')`).
2. Promote NAS-replica to primary (`pg_ctl promote`).
3. Re-point `POSTGRES_URL` to the new primary.
4. Restart workers in reverse-dependency order (DB-using → queue-using → edge).
5. Run `scripts/dr-rehearsal.ts` (Block-C C.3 deliverable) to validate
   the 6-h SLA.

After restore: the `entity.canonical.neo4j_mirror_state` reset is
required (see [worker-entity.md R2](./worker-entity.md)).

---

## R3 — Credential rotation

Rotate the `vigil` service password (Vault path
`secret/postgres/service_password`).

```sh
# 1. Generate new password
NEW_PWD="$(openssl rand -base64 32)"

# 2. Update Postgres role (architect's psql admin connection)
psql "$POSTGRES_ADMIN_URL" -c "ALTER ROLE vigil WITH PASSWORD '$NEW_PWD';"

# 3. Update Vault
vault kv put secret/postgres service_password="$NEW_PWD"

# 4. Update POSTGRES_URL in env / compose, restart all workers
docker compose restart $(docker compose config --services | grep -E '^(worker-|adapter-runner|dashboard|audit-)')

# 5. Verify
psql "$POSTGRES_URL" -c 'SELECT 1;'
```

Quarterly rotation per HSK-v1 §6. Coordinated with vault.md R3.

---

## R5 — Incident response

| Severity | Trigger                                        | Action                                                                                                                  |
| -------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **P0**   | `pg_up = 0` for > 2 min OR disk > 95 %         | Page architect 24/7. Halt all workers. Decide failover-to-NAS-replica vs in-place fix.                                  |
| **P0**   | Suspected data corruption / hash-chain break   | Page architect. Stop all writes. Run `audit-verifier` chain walk; consult R7-mou-activation if CONAC delivery affected. |
| **P1**   | Replication lag > 15 min                       | Page on-call. Check WireGuard + replica disk; consider catch-up window.                                                 |
| **P1**   | Disk usage > 85 %                              | Page on-call. Vacuum-analyse + archive WAL.                                                                             |
| **P2**   | `vigil_db_pool_waiting > 0` sustained > 30 min | Investigate per-worker pool config; reduce concurrency or bump pool max.                                                |
| **P3**   | Slow query log noise                           | Operator triage; add indexes if justified.                                                                              |

### 🇫🇷 Astreinte

P0 → architecte 24/7. P1 → on-call (heures ouvrables Africa/Douala).

### 🇬🇧 Paging

P0 → architect 24/7. P1 → on-call (Africa/Douala business hours).

---

## R4 — Council pillar rotation

N/A — postgres does not gate council state directly. Council
pillar appointment writes hit the `governance.council_member`
table; postgres just hosts it. See [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Postgres is the centre of the DR rehearsal scope. See
[R6-dr-rehearsal.md](./R6-dr-rehearsal.md). The 6-h SLA is
dominated by the postgres restore time (typically 1–3 h on the
target hardware).

---

## Cross-references

### Code

- [`packages/db-postgres/src/client.ts`](../../packages/db-postgres/src/client.ts) — pool config + sslMode handling.
- [`packages/db-postgres/drizzle/`](../../packages/db-postgres/drizzle/) — migrations.
- [`infra/docker/postgres/`](../../infra/docker/postgres/) — Dockerfile + init scripts.

### Binding spec

- **TRUTH §B / §C** — postgres as authoritative store.
- **SRD §07** — schema design.
- **SRD §15.1** — DB-first invariant.
- **SRD §27** — DR plan.
- **SRD §31.2** — R2 restore template.
- **HSK-v1 §6** — credential rotation cadence.
