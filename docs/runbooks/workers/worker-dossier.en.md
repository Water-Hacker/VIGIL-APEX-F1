# Runbook — worker-dossier (EN)

<!-- BEGIN auto-generated -->

**Description:** Renders bilingual FR/EN PDF dossiers; signs with YubiKey-backed GPG; pins to IPFS.

**Source:** [`apps/worker-dossier/`](../../../apps/worker-dossier/)

**Package manifest:** [`apps/worker-dossier/package.json`](../../../apps/worker-dossier/package.json)

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
docker compose restart worker-dossier
```

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
