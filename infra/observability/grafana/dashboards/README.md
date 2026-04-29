# Grafana dashboards

> **Canonical location:** [`infra/docker/grafana/dashboards/`](../../../docker/grafana/dashboards/) — that path is mounted into the Grafana container by [docker-compose.yaml](../../../docker/docker-compose.yaml) and provisioned by [grafana/provisioning/dashboards/vigil.yaml](../../../docker/grafana/provisioning/dashboards/vigil.yaml).
>
> Phase-1 dashboards (Grafana 10+, schemaVersion 38). Metric names come from
> [`packages/observability/src/metrics.ts`](../../../../packages/observability/src/metrics.ts).
> Every panel cites the metric (or PromQL recording-rule alias).

## Catalogue

| File                        | Title                         | Purpose                                                          |
| --------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `ingestion-throughput.json` | Adapter ingestion throughput  | rows/min by source; failure rate; rate-limit headroom            |
| `pattern-fire-rate.json`    | Pattern fire-rate by category | how often each P-X-NNN matched in the last 24h; strength p50/p95 |
| `calibration-bands.json`    | Calibration reliability bands | predicted vs observed by quintile (W-14 / DECISION-011)          |
| `audit-chain-tail.json`     | Audit-chain tail              | seq tip, gap-detection, hourly verify outcome                    |
| `polygon-anchor-cost.json`  | Polygon anchor cost + latency | gas spent (USD), tx confirmation time                            |
| `council-vote-lag.json`     | Council vote latency          | open-to-quorum age; per-pillar response time                     |
| `tip-volume.json`           | Tip portal volume             | submissions/day, decryption queue depth                          |
| `llm-cost-per-finding.json` | LLM cost-per-finding          | $/finding, canary trip rate, schema-fail rate                    |

## Adding a new dashboard

1. Create `<slug>.json` (export from Grafana UI; strip `id` field).
2. Add an entry to the table above.
3. Reference the metric name in
   [`packages/observability/src/metrics.ts`](../../../packages/observability/src/metrics.ts);
   if the metric doesn't exist, declare it there first.
