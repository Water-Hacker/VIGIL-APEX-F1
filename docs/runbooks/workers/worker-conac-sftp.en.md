# Runbook — worker-conac-sftp (EN)

<!-- BEGIN auto-generated -->

**Description:** CONAC SFTP delivery worker — manifest, ACK loop, format-adapter layer (W-25).

**Source:** [`apps/worker-conac-sftp/`](../../../apps/worker-conac-sftp/)

**Package manifest:** [`apps/worker-conac-sftp/package.json`](../../../apps/worker-conac-sftp/package.json)

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
docker compose restart worker-conac-sftp
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
