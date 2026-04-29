# Runbook — worker-audit-watch (EN)

<!-- BEGIN auto-generated -->

**Description:** TAL-PA anomaly detection (DECISION-012). Periodically evaluates the deterministic rule set in @vigil/audit-log/anomaly over a rolling window of audit.user_action_event rows; persists alerts to audit.anomaly_alert; emits an audit-of-audit row per detection.

**Source:** [`apps/worker-audit-watch/`](../../../apps/worker-audit-watch/)

**Package manifest:** [`apps/worker-audit-watch/package.json`](../../../apps/worker-audit-watch/package.json)

<!-- END auto-generated -->

## Boot sequence

<!-- Architect: list the env vars + Vault paths read at boot, in order. -->

## Healthy steady-state signals

<!-- Architect: which Prometheus metrics are non-zero in the green case? -->

## Common failures

| Symptom | Likely cause | Mitigation |
| ------- | ------------ | ---------- |
|         |              |            |

## On-call paging policy

<!-- Architect: which severity levels page on-call vs surface in dashboard only? -->

## Restart procedure

```
docker compose restart worker-audit-watch
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
