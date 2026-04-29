# Runbook — worker-pattern (EN)

<!-- BEGIN auto-generated -->

**Description:** Pattern worker — applies @vigil/patterns registry to incoming subjects.

**Source:** [`apps/worker-pattern/`](../../../apps/worker-pattern/)

**Package manifest:** [`apps/worker-pattern/package.json`](../../../apps/worker-pattern/package.json)

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
docker compose restart worker-pattern
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
