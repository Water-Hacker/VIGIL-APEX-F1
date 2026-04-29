# Runbook — worker-federation-agent (EN)

<!-- BEGIN auto-generated -->

**Description:** Phase-3 regional federation agent. Drains the regional FEDERATION_PUSH stream, signs each envelope, and pushes to the Yaoundé core's federation receiver over gRPC.

**Source:** [`apps/worker-federation-agent/`](../../../apps/worker-federation-agent/)

**Package manifest:** [`apps/worker-federation-agent/package.json`](../../../apps/worker-federation-agent/package.json)

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
docker compose restart worker-federation-agent
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
