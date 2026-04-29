# Runbook — audit-verifier (EN)

<!-- BEGIN auto-generated -->

**Description:** Hourly hash-chain integrity check (CT-01) + Polygon-anchor match (CT-02).

**Source:** [`apps/audit-verifier/`](../../../apps/audit-verifier/)

**Package manifest:** [`apps/audit-verifier/package.json`](../../../apps/audit-verifier/package.json)

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
docker compose restart audit-verifier
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
