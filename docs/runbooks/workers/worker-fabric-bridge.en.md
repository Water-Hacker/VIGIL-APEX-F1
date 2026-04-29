# Runbook — worker-fabric-bridge (EN)

<!-- BEGIN auto-generated -->

**Description:** Postgres audit.actions → Fabric audit-witness chaincode replication. Phase G of the country-grade plan.

**Source:** [`apps/worker-fabric-bridge/`](../../../apps/worker-fabric-bridge/)

**Package manifest:** [`apps/worker-fabric-bridge/package.json`](../../../apps/worker-fabric-bridge/package.json)

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
docker compose restart worker-fabric-bridge
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
