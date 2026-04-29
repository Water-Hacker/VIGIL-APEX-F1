# Runbook — worker-federation-receiver (EN)

<!-- BEGIN auto-generated -->

**Description:** Phase-3 core-side federation receiver. Hosts the federation-stream gRPC server, verifies signed envelopes, and forwards into the existing pattern-detect pipeline.

**Source:** [`apps/worker-federation-receiver/`](../../../apps/worker-federation-receiver/)

**Package manifest:** [`apps/worker-federation-receiver/package.json`](../../../apps/worker-federation-receiver/package.json)

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
docker compose restart worker-federation-receiver
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
