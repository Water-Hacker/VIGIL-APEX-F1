# Runbook — audit-bridge (EN)

<!-- BEGIN auto-generated -->

**Description:** UDS HTTP sidecar — exposes audit-chain.append() so non-TS workers (Python worker-satellite, Bash maintenance) can write to the canonical audit chain.

**Source:** [`apps/audit-bridge/`](../../../apps/audit-bridge/)

**Package manifest:** [`apps/audit-bridge/package.json`](../../../apps/audit-bridge/package.json)

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
docker compose restart audit-bridge
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
