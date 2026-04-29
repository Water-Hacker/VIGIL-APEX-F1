# Runbook — worker-counter-evidence (EN)

<!-- BEGIN auto-generated -->

**Description:** Devil's-advocate pass at posterior >= 0.85 (SRD §19.6).

**Source:** [`apps/worker-counter-evidence/`](../../../apps/worker-counter-evidence/)

**Package manifest:** [`apps/worker-counter-evidence/package.json`](../../../apps/worker-counter-evidence/package.json)

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
docker compose restart worker-counter-evidence
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
