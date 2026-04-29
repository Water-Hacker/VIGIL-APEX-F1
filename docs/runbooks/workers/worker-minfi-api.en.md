# Runbook — worker-minfi-api (EN)

<!-- BEGIN auto-generated -->

**Description:** MINFI pre-disbursement scoring API (SRD §26).

**Source:** [`apps/worker-minfi-api/`](../../../apps/worker-minfi-api/)

**Package manifest:** [`apps/worker-minfi-api/package.json`](../../../apps/worker-minfi-api/package.json)

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
docker compose restart worker-minfi-api
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
