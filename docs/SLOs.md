# VIGIL APEX — Service-Level Objectives

**Phase E6 deliverable.** Numbers are operational targets, not contractual
guarantees. Every SLO has a Prometheus query and an AlertManager rule;
when a query goes red for `for:` duration, AlertManager pages per the
severity mapping in `infra/docker/alertmanager/alertmanager.yml`.

The error budget is 1 − SLO. We track monthly burn; when more than 50 %
of a month's budget is consumed in a week, the architect declares an
incident-response review (see `docs/incident-response/`).

| SLI | Target | Window | Severity on breach |
|---|---|---|---|
| Verify-page p99 latency | < 2 s | 5 min | warning |
| Verify-page p95 latency | < 800 ms | 5 min | warning |
| Findings-list p99 latency (operator) | < 500 ms | 5 min | warning |
| MINFI /score p95 latency | < 100 ms | 5 min | warning |
| Tip portal p99 latency | < 2 s | 5 min | warning |
| ARMP-event → finding (p95) | < 4 hours | 24 h | warning |
| Finding → escalation-vote (p50) | < 7 days | rolling 30 d | info |
| Dossier → CONAC ACK (p99) | < 24 hours | rolling 7 d | warning |
| Platform uptime (excluding planned maintenance) | ≥ 99.5 % | rolling 30 d | warning |
| Audit-chain hash integrity violations | 0 (zero tolerance) | always | **critical** |
| Polygon anchor success | ≥ 99 % | 24 h | warning |
| LLM monthly cost | ≤ $2,500 USD | calendar month | warning at 80 %, critical at 100 % |
| Calibration ECE overall | ≤ 5 % | rolling 30 d | warning at 7 %, critical at 10 % |

## SLI definitions (Prometheus)

```promql
# Verify-page p99 (Phase F load gate target: < 2 s @ 1K rps)
histogram_quantile(
  0.99,
  sum by (le) (rate(http_server_request_duration_seconds_bucket{
    service="dashboard", route="/verify/:ref"
  }[5m]))
)

# Findings-list p99 — operator dashboard
histogram_quantile(
  0.99,
  sum by (le) (rate(http_server_request_duration_seconds_bucket{
    service="dashboard", route="/findings"
  }[5m]))
)

# MINFI /score p95
histogram_quantile(
  0.95,
  sum by (le) (rate(http_server_request_duration_seconds_bucket{
    service="worker-minfi-api", route="/score"
  }[5m]))
)

# ARMP-event → finding p95 (E2E pipeline latency)
histogram_quantile(
  0.95,
  sum by (le) (rate(vigil_processing_duration_seconds_bucket{
    worker="worker-pattern"
  }[1h]))
)

# Polygon anchor success ratio
sum(rate(vigil_polygon_anchor_total{outcome="ok"}[24h]))
  /
sum(rate(vigil_polygon_anchor_total[24h]))

# LLM monthly cost
sum(increase(vigil_llm_cost_usd_total[30d]))

# ECE overall
vigil_calibration_ece_overall
```

## Error budget burn

| Target | 30-day budget | Weekly review trigger |
|---|---|---|
| 99.5 % uptime | 3.6 hours | > 1.8 hours consumed by week 2 |
| 99 % anchor success | 14.4 attempts/month allowed | > 7 in any 7-day window |

## Out of scope

- Adapter source-website availability — VIGIL APEX cannot SLO upstream
  ARMP / DGI / cour-des-comptes uptime. We track per-source `vigil_adapter_runs_total`
  and surface them in [vigil-adapters](../infra/docker/grafana/dashboards/vigil-adapters.json).
- Polygon mainnet finality. We require ≥ 24 confirmations before marking
  `polygon_confirmed_at`; reorgs beyond that are treated as Polygon
  network incidents and escalated through the AlertManager `pager`
  receiver.

## Versioning

This document supersedes any earlier informal SLO statements in SRD §15.
Changes require architect sign-off in `docs/decisions/log.md`.
