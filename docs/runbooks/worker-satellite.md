# Runbook — worker-satellite

> Python worker (Phase D7). Computes activity scores from satellite
> imagery (NICFI / Sentinel-1/2 / Maxar / Airbus chain) for
> investment-project locations. Writes to `dossier.satellite_request`.
>
> **Service:** [`apps/worker-satellite/`](../../apps/worker-satellite/) — Python; rasterio + opencv pipeline.

---

## Description

### 🇫🇷

Worker Python qui calcule des scores d'activité à partir d'imagery
satellite. Pour chaque `dossier.satellite_request`, sélectionne une
chaîne de fournisseurs (NICFI gratuit en premier, puis Sentinel,
Maxar, Airbus selon le résultat). Calcule activity_score via
`raster-diff + opencv` sur la fenêtre temporelle du contrat. Met à
jour `status='completed'` + `activity_score` + `cost_usd`.

### 🇬🇧

Python worker computing activity scores from satellite imagery. For
each `dossier.satellite_request`, picks a provider chain (free NICFI
first, then Sentinel, Maxar, Airbus depending on result). Computes
activity_score via `raster-diff + opencv` over the contract time
window. Updates `status='completed'` + `activity_score` + `cost_usd`.

---

## Boot sequence

1. `pip install` from `apps/worker-satellite/requirements.txt`
   (rasterio, opencv-python, pillow).
2. `getDb()` — Postgres.
3. `VaultClient` — reads provider API keys.
4. Polls `dossier.satellite_request WHERE status='queued'`.

---

## Health-check signals

| Metric                                 | Healthy              | Unhealthy → action       |
| -------------------------------------- | -------------------- | ------------------------ |
| `up{instance=~".*worker-satellite.*"}` | `1`                  | `0` > 5 min → P2         |
| `vigil_satellite_scenes_total` rate    | matches request rate | flat with queue → wedged |

## SLO signals

| Metric                                           | SLO target | Investigate-worthy                               |
| ------------------------------------------------ | ---------- | ------------------------------------------------ |
| Per-request latency p99                          | < 10 min   | > 1 h → provider chain slow; consider escalation |
| `dossier.satellite_request.status='failed'` rate | < 5 %      | > 20 % → provider chain unreachable              |
| Cumulative `cost_usd` per finding                | < $50      | > $100 → operator review required                |

---

## Common failures

| Symptom                                        | Likely cause                           | Mitigation                                                                         |
| ---------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `PLANET_API_KEY PLACEHOLDER` log on NICFI step | expected pre-NICFI MOU                 | Worker drops NICFI step gracefully (Block-B A9). No operator action.               |
| All providers return 4xx                       | API key invalid OR rate-limit          | Verify Vault paths; coordinate with provider ops.                                  |
| Activity score always 0                        | imagery cloud cover too high in window | Worker logs `cloud-cover-too-high`; expected; finding flagged with low confidence. |
| OpenCV crash on large raster                   | memory pressure                        | Bump container memory; consider downsampling.                                      |

---

## R1 — Routine deploy

```sh
docker compose pull worker-satellite
docker compose up -d worker-satellite
```

## R2 — Restore from backup

Reads + writes `dossier.satellite_request` in Postgres. No local
state. Resumes after postgres restore.

## R3 — Credential rotation

Per-provider API key rotation via Vault. Examples:

```sh
# Planet (NICFI)
vault kv put secret/planet api_key=<new>
# Sentinel Hub
vault kv put secret/sentinel-hub client_id=<new> client_secret=<new>
# Maxar
vault kv put secret/maxar api_key=<new>
# Airbus
vault kv put secret/airbus api_key=<new>

docker compose restart worker-satellite
```

Provider-specific cadence; typically annual.

## R5 — Incident response

| Severity | Trigger                                          | Action                                                                             |
| -------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **P1**   | All provider chains unreachable for > 4 h        | Page on-call. Investment-project findings stuck without satellite verification.    |
| **P2**   | Single provider quota exceeded (paid tier hit)   | Operator decision: continue at higher cost OR halt that source until budget reset. |
| **P3**   | Cloud-cover-too-high rate climbing in dry season | Investigate; possibly time-window selection logic needs tuning.                    |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md). Provider
API recovery is independent of host restore.

---

## Cross-references

### Code

- [`apps/worker-satellite/src/`](../../apps/worker-satellite/src/) — Python pipeline.
- [`packages/satellite-client/`](../../packages/satellite-client/) — TS-side trigger emit.
- [`apps/adapter-runner/src/triggers/satellite-trigger.ts`](../../apps/adapter-runner/src/triggers/satellite-trigger.ts) — daily trigger.

### Binding spec

- **DECISION-010** — production-complete satellite verification.
- **SRD §15.6** — satellite verification pillar.
- **HSK-v1 §6** — provider key rotation cadence (per-provider).
