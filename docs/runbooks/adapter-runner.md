# Runbook — adapter-runner

> Cron host for all 29 source adapters (per `infra/sources.json`).
> Schedules per-source crawls; emits `vigil:source:event`. Hosts the
> quarterly audit-export trigger.
>
> **Service:** [`apps/adapter-runner/`](../../apps/adapter-runner/) — edge ingest.

---

## Description

### 🇫🇷

Cron host pour les 29 adaptateurs sources. Chaque adaptateur a son
propre cadran (`infra/sources.json:cron`), respecte
`rate_interval_ms` et `daily_request_cap`, écrit dans `source.events`

- émet `vigil:source:event`. Héberge aussi le trigger d'export
  trimestriel d'audit (DECISION-012 §8) et le trigger de calibration.

### 🇬🇧

Cron host for the 29 source adapters. Each adapter has its own
schedule (`infra/sources.json:cron`), honours `rate_interval_ms` and
`daily_request_cap`, writes to `source.events`, emits
`vigil:source:event`. Also hosts the quarterly audit-export trigger
(DECISION-012 §8) and the calibration audit trigger.

---

## Boot sequence

1. Reads `infra/sources.json` — refuses to boot if count drifts
   from binding-doc value (Block-A A.7 lint catches drift in CI).
2. `getDb()` — Postgres.
3. Per-adapter cron registered via `node-cron`.
4. Quarterly audit-export cron (`AUDIT_PUBLIC_EXPORT_CRON`,
   default `0 5 1 1,4,7,10 *` Africa/Douala).
5. Calibration-audit cron (quarterly).

---

## Health-check signals

| Metric                               | Healthy          | Unhealthy → action     |
| ------------------------------------ | ---------------- | ---------------------- |
| `up{instance=~".*adapter-runner.*"}` | `1`              | `0` > 5 min → P1       |
| `vigil_adapter_runs_total` rate      | matches schedule | flat → cron not firing |

## SLO signals

| Metric                                                         | SLO target                    | Investigate-worthy                                                            |
| -------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `vigil_adapter_runs_total{outcome="failed"}` rate (per source) | < 0.5/min sustained           | > 0.5/min for 10 min → `AdapterFailing` alert; worker-adapter-repair triggers |
| `vigil_adapter_rows_emitted_total` rate                        | matches per-source baseline   | flat for one source → adapter logic broken                                    |
| Per-adapter latency p99                                        | within source-specific bounds | exceeds → adapter slow                                                        |

---

## Common failures

| Symptom                                 | Likely cause                                 | Mitigation                                                                                |
| --------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `AdapterFailing` alert (rate > 0.5/min) | source page changed shape OR source down     | worker-adapter-repair triggers on `consecutive_failures >= 3`. Verify upstream.           |
| MOU-gated adapter refuses to run        | expected pre-MOU; AUDIT-001/002/003 mou-gate | No action until MOU per [R7-mou-activation.md](./R7-mou-activation.md).                   |
| Quarterly export skipped                | `AUDIT_PUBLIC_EXPORT_SALT` PLACEHOLDER       | Rotate per [decision-012-promotion-prep.md](../decisions/decision-012-promotion-prep.md). |
| robots.txt fetch fail-open log          | source's robots.txt unreachable              | Adapter falls back to documented EXEC §10 policy; no operator action.                     |

---

## R1 — Routine deploy

```sh
docker compose pull adapter-runner
docker compose up -d adapter-runner
```

Verify within 30 s:

- Cron schedules visible in logs (`vigil-cron-registered ...`).
- One source-event written to `source.events` within the next adapter window.

## R2 — Restore from backup

Reads `infra/sources.json` (in-tree) + writes `source.events`. No
local state. Resumes after postgres restore.

## R3 — Credential rotation

Adapter-specific. Examples:

- **API-key adapters** (`PLANET_API_KEY` for satellite NICFI, etc.):
  rotate via the source's portal, update Vault, restart
  adapter-runner. Adapter degrades to no-op pre-rotation
  (graceful per Block-B A9).

- **MOU-gated adapters** (`anif-amlscreen`, `minfi-bis`, `beac-payments`):
  see per-source rotation in MOU annex.

- **No-auth adapters** (most public source crawlers): no rotation.

`AUDIT_PUBLIC_EXPORT_SALT` quarterly rotation per
[decision-012-promotion-prep.md A6.4](../decisions/decision-012-promotion-prep.md):

```sh
NEW_SALT="$(openssl rand -hex 32)"
NEXT_Q="$(date -d 'next quarter' +%YQ%q)"
vault kv put tal-pa/public-export-salt-${NEXT_Q} salt="$NEW_SALT"
# Update env to point at the new path; restart adapter-runner
```

## R5 — Incident response

| Severity | Trigger                                                                   | Action                                                                                    |
| -------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **P1**   | adapter-runner down for > 30 min                                          | Page on-call. No new source.events ingested; downstream pipeline starves.                 |
| **P1**   | Quarterly audit-export skipped                                            | Page architect. TAL-PA public-permanence pillar misses cadence; manual export within 7 d. |
| **P2**   | `AdapterFailing` on multiple sources                                      | Investigate upstream sources; coordinate with worker-adapter-repair proposals.            |
| **P2**   | `Anthropic API rate-limit exceeded with no failover` on calibration audit | Tier-1 Bedrock failover; if both circuits open, escalate.                                 |
| **P3**   | Single source's daily volume below baseline                               | Operator investigates; possibly source page changed.                                      |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md). The
post-restore first-cron-window of each adapter is the SLA datapoint.

---

## Cross-references

### Code

- [`apps/adapter-runner/src/index.ts`](../../apps/adapter-runner/src/index.ts) — cron registry.
- [`apps/adapter-runner/src/triggers/quarterly-audit-export.ts`](../../apps/adapter-runner/src/triggers/quarterly-audit-export.ts) — TAL-PA quarterly export.
- [`apps/adapter-runner/src/adapters/`](../../apps/adapter-runner/src/adapters/) — 29 adapter files.
- [`infra/sources.json`](../../infra/sources.json) — source catalogue.
- [`scripts/check-source-count.ts`](../../scripts/check-source-count.ts) — Block-A A.7 drift lint.

### Binding spec

- **SRD §10.2** — source catalogue (29 sources per Block-A reconciliation §2.A.9).
- **SRD §11–§13** — adapter architecture.
- **EXEC §10** — robots.txt policy.
- **DECISION-008** — MOU-gated source additions.
- **DECISION-012** — TAL-PA quarterly export.
