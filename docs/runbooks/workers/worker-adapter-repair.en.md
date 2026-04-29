# Runbook — worker-adapter-repair (EN)

<!-- BEGIN auto-generated -->

**Description:** W-19 self-healing — LLM re-derives broken adapter selectors and shadow-tests against the live source before promotion.

**Source:** [`apps/worker-adapter-repair/`](../../../apps/worker-adapter-repair/)

**Package manifest:** [`apps/worker-adapter-repair/package.json`](../../../apps/worker-adapter-repair/package.json)

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
docker compose restart worker-adapter-repair
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
