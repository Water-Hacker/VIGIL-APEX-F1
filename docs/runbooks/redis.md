# Runbook — redis (vigil-redis)

> Infra-plane service. Docker-compose-managed. Redis 7 (RESP +
> Streams with consumer groups) per TRUTH §C / SRD §08.5.
>
> **Service:** docker-compose service `vigil-redis`. Stream
> backbone for inter-worker dispatch. Cache layer for adapter
> dedup_keys + dashboard session.

---

## Description

### 🇫🇷

Backbone de streams entre workers. Chaque envelope passe par un
stream `vigil:<topic>` consommé par un consumer-group dédié. Cache
en plus pour les dedup-keys d'adaptateurs et les sessions dashboard.
Pas source de vérité — la perte d'un stream est tolérable
(idempotence côté worker).

### 🇬🇧

Inter-worker stream backbone. Every envelope passes through a
`vigil:<topic>` stream consumed by a dedicated consumer group.
Also a cache for adapter dedup_keys and dashboard sessions. Not a
system of record — stream loss is tolerable (idempotency on the
worker side).

---

## Boot sequence

1. Docker compose pulls `redis:7.2-alpine`.
2. AOF + RDB persistence per `infra/docker/redis/redis.conf`.
3. Workers connect via `REDIS_URL` (`redis://vigil-redis:6379`).
4. Each worker creates its consumer group on first call
   (`XGROUP CREATE ... MKSTREAM`).

---

## Health-check signals

| Metric                              | Healthy | Unhealthy → action                           |
| ----------------------------------- | ------- | -------------------------------------------- |
| Docker healthcheck `redis-cli ping` | `PONG`  | non-PONG > 30 s → P1                         |
| `redis_uptime_in_seconds`           | growing | reset → restart event (expected: log review) |

## SLO signals

| Metric                                                   | SLO target | Investigate-worthy                                  |
| -------------------------------------------------------- | ---------- | --------------------------------------------------- |
| Per-stream PEL length (`XPENDING vigil:<topic> <group>`) | < 100      | > 1000 → consumer falling behind                    |
| `redis_memory_used_bytes` / `maxmemory`                  | < 60 %     | > 80 % → eviction pressure                          |
| Stream entry count (`XLEN vigil:<topic>`)                | < 100k     | > 1M → trimming policy not enforcing (audit MAXLEN) |
| `vigil_redis_ack_latency_seconds` p99                    | < 100 ms   | > 1 s → broker latency or worker hung               |

---

## Common failures

| Symptom                              | Likely cause                                           | Mitigation                                                                              |
| ------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Workers logging `XREADGROUP timeout` | redis down or consumer group misconfigured             | `docker compose logs vigil-redis`; verify `XGROUP CREATE` ran; restart affected worker. |
| Stream PEL backlog growing           | consumer worker dead or stuck                          | Identify via `XPENDING`; restart consumer worker; auto-claim via `XAUTOCLAIM` if stale. |
| Memory pressure / eviction           | MAXLEN trim not enforcing OR genuinely high throughput | Check stream MAXLEN approximate trim; bump `maxmemory` if hardware allows.              |
| AOF rewrite failing                  | disk full or fsync lock                                | Free disk; check `appendonly.aof.rewrite-in-progress`.                                  |

---

## R1 — Routine deploy

```sh
docker compose pull vigil-redis
docker compose up -d vigil-redis
```

Workers reconnect automatically. Brief per-worker `XREADGROUP`
timeout during the restart window is expected; consumer groups
resume from where they left off (Redis stream IDs are persistent).

---

## R2 — Restore from backup

Per SRD §31.2.

Redis is **not** the system of record; loss is tolerable. After a
host loss + restore:

1. Bring `vigil-redis` up fresh (no data restore needed).
2. Workers re-create their consumer groups on first XREADGROUP
   (`MKSTREAM` idempotent).
3. **In-flight envelopes lost.** Affected workers re-emit on retry
   (idempotent dedup_keys) when their parent envelope's source
   re-fires (e.g., adapter cron next tick).
4. Acceptable data-loss: the last-cron-window's dispatch envelopes
   for non-event-bearing streams (PATTERN_DETECT, SCORE_COMPUTE,
   etc.). Re-derived on the next tick. Source events themselves
   live in postgres `source.events`; never lost.

---

## R3 — Credential rotation

Rotate the Redis ACL password (Vault path
`secret/redis/service_password`).

```sh
NEW_PWD="$(openssl rand -base64 32)"

# 1. Update redis.conf via the appropriate method
docker compose exec vigil-redis redis-cli ACL SETUSER vigil on \
  ">$NEW_PWD" ~* +@all

# 2. Update Vault
vault kv put secret/redis service_password="$NEW_PWD"

# 3. Restart workers (each re-reads REDIS_URL on boot)
docker compose restart $(docker compose config --services | grep -E '^(worker-|adapter-runner|dashboard|audit-)')

# 4. Verify
docker compose exec vigil-redis redis-cli AUTH vigil "$NEW_PWD" && \
  docker compose exec vigil-redis redis-cli PING
```

Quarterly per HSK-v1 §6.

---

## R5 — Incident response

| Severity | Trigger                                        | Action                                                                                              |
| -------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **P1**   | redis down for > 2 min                         | Page on-call. Workers backing up on enqueue; postgres writes still go through (DB-first invariant). |
| **P1**   | Memory > 90 % with eviction-pressure log lines | Page on-call. Triage MAXLEN trim policy + per-stream backlog; bump memory if hardware allows.       |
| **P2**   | Single stream PEL > 5000                       | Investigate consumer worker; XAUTOCLAIM stale entries; restart worker if needed.                    |
| **P3**   | AOF rewrite slow                               | Operator triage; consider increasing `auto-aof-rewrite-percentage`.                                 |

---

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md). Redis
restore is fast (no data restore; consumer groups re-created on
demand) and contributes < 5 min to the 6-h SLA.

---

## Cross-references

### Code

- [`packages/queue/src/`](../../packages/queue/src/) — RESP wrapper, consumer-group management, XADD / XREADGROUP / XACK.
- [`infra/docker/redis/redis.conf`](../../infra/docker/redis/redis.conf) — server config.

### Binding spec

- **TRUTH §C** — Redis 7 + streams.
- **SRD §08.5** — stream design.
- **SRD §08.6** — consumer-group setup.
- **HSK-v1 §6** — credential rotation cadence.
