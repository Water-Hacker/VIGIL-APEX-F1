# Runbook — worker-federation-receiver (FR)

<!-- BEGIN auto-generated -->

**Description :** Phase-3 core-side federation receiver. Hosts the federation-stream gRPC server, verifies signed envelopes, and forwards into the existing pattern-detect pipeline.

**Source :** [`apps/worker-federation-receiver/`](../../../apps/worker-federation-receiver/)

**Manifeste paquet :** [`apps/worker-federation-receiver/package.json`](../../../apps/worker-federation-receiver/package.json)

<!-- END auto-generated -->

## Séquence de démarrage

<!-- Architecte : lister les variables d'environnement + chemins Vault lus au démarrage, dans l'ordre. -->

## Signaux d'état nominal

<!-- Architecte : quelles métriques Prometheus sont non nulles quand tout va bien ? -->

## Pannes fréquentes

| Symptôme | Cause probable | Mitigation |
| -------- | -------------- | ---------- |
|          |                |            |

## Politique d'astreinte

<!-- Architecte : quels niveaux de sévérité déclenchent une astreinte vs simple alerte tableau de bord ? -->

## Procédure de redémarrage

```
docker compose restart worker-federation-receiver
```

## Restauration

<!-- Architecte : comment revenir à l'image précédente en cas de régression. -->

## Références au journal des décisions

<!-- Architecte : lister chaque DECISION-NNN qui a touché ce worker. -->
