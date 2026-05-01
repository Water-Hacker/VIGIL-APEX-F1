# Runbook — worker-audit-watch

> Anomaly detector over the audit chain. 5-minute tick over a
> 24-hour rolling window. Persists alerts to `audit.anomaly_alert`.
> Per AI-SAFETY-DOCTRINE-v1 §A.6 + DECISION-012.
>
> **Service:** [`apps/worker-audit-watch/`](../../apps/worker-audit-watch/) — Postgres-only.

---

## Description

### 🇫🇷

Détecteur d'anomalies sur la chaîne d'audit. Toutes les 5 minutes,
applique 10 règles déterministes (`packages/audit-log/src/anomaly.ts`)
sur la fenêtre des 24 dernières heures de `audit.user_action_event`.
Persiste chaque alerte dans `audit.anomaly_alert`. Émet une ligne
`audit.hash_chain_verified` audit-of-audit par tick.

### 🇬🇧

Anomaly detector on the audit chain. Every 5 minutes, applies 10
deterministic rules (`packages/audit-log/src/anomaly.ts`) over the
last 24 h of `audit.user_action_event`. Persists each alert to
`audit.anomaly_alert`. Emits one `audit.hash_chain_verified`
audit-of-audit row per tick.

---

## Boot sequence

1. `getDb()` — Postgres.
2. Load 10 rule definitions from `packages/audit-log/src/anomaly.ts`.
3. `setInterval` tick at `AUDIT_WATCH_INTERVAL_MS` (default 300 s).

---

## Health-check signals

| Metric                                                        | Healthy  | Unhealthy → action |
| ------------------------------------------------------------- | -------- | ------------------ |
| `up{instance=~".*worker-audit-watch.*"}`                      | `1`      | `0` > 2 min → P1   |
| `vigil_worker_last_tick_seconds{worker="worker-audit-watch"}` | < 10 min | > 30 min → P1      |

## SLO signals

| Metric               | SLO target | Investigate-worthy                         |
| -------------------- | ---------- | ------------------------------------------ |
| Tick duration        | < 30 s     | > 5 min → query slow                       |
| Alert rate by `kind` | bimodal    | drift to all-info → rules calibrated wrong |

---

## Common failures

| Symptom                     | Likely cause                                | Mitigation                                             |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| Tick takes > 5 min          | 24h window grew large                       | Index audit on (timestamp_utc, actor_id, category).    |
| Alert spam on a single rule | rule false-positive after data shape change | Tune threshold OR mark rule as `disabled` in registry. |

---

## R1 — Routine deploy

```sh
docker compose pull worker-audit-watch
docker compose up -d worker-audit-watch
```

## R2 — Restore from backup

Reads `audit.user_action_event` + writes `audit.anomaly_alert`. No
local state.

## R3 — Credential rotation

N/A — service has no rotatable external credential. Postgres + Redis
creds rotate via [postgres.md R3](./postgres.md) and
[redis.md R3](./redis.md).

## R5 — Incident response

| Severity | Trigger                                | Action                                                |
| -------- | -------------------------------------- | ----------------------------------------------------- |
| **P1**   | Worker down + anomaly detection lapses | Page on-call. Anomaly window without coverage.        |
| **P2**   | Alert spam on one rule                 | Operator triages; tune or disable per registry.       |
| **P3**   | Tick duration creeping up              | Index audit; consider partitioning if Phase-2 volume. |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).

---

## Cross-references

- [`apps/worker-audit-watch/src/index.ts`](../../apps/worker-audit-watch/src/index.ts) — tick loop.
- [`packages/audit-log/src/anomaly.ts`](../../packages/audit-log/src/anomaly.ts) — 10 rules.
- **DECISION-012** / TAL-PA — anomaly detection scope.
- **AI-SAFETY-DOCTRINE-v1 §A.6** — calibration audit cadence.
