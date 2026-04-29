# Runbook — worker-document (EN)

<!-- BEGIN auto-generated -->

**Description:** Document fetch → SHA-256 → MIME → OCR → IPFS pin pipeline.

**Source:** [`apps/worker-document/`](../../../apps/worker-document/)

**Package manifest:** [`apps/worker-document/package.json`](../../../apps/worker-document/package.json)

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
docker compose restart worker-document
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
