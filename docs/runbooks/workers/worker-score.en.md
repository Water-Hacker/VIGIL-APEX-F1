# Runbook — worker-score (EN)

<!-- BEGIN auto-generated -->

**Description:** Bayesian certainty engine — combines signals into posterior; triggers counter-evidence at 0.85.

**Source:** [`apps/worker-score/`](../../../apps/worker-score/)

**Package manifest:** [`apps/worker-score/package.json`](../../../apps/worker-score/package.json)

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
docker compose restart worker-score
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
